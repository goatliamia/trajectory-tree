// Minimal reader for the recorded CortexStepGeneratorMetadata / ChatModelMetadata
// wire format. Field numbers were checked against the installed host descriptors.
// No signatures, reasoning bodies, response headers or credentials are projected.
const decoder = new TextDecoder('utf-8', { fatal: true });

function uint(bytes, cursor) {
  let value = 0n;
  for (let shift = 0n; shift < 70n && cursor.pos < bytes.length; shift += 7n) {
    const byte = bytes[cursor.pos++];
    value |= BigInt(byte & 127) << shift;
    if (byte < 128) return value;
  }
  throw new Error('Invalid protobuf varint');
}

export function fields(bytes) {
  const result = new Map(), cursor = { pos: 0 };
  while (cursor.pos < bytes.length) {
    const tag = Number(uint(bytes, cursor)), number = tag >>> 3, wire = tag & 7;
    if (!number) throw new Error('Invalid protobuf field');
    let value;
    if (wire === 0) value = uint(bytes, cursor);
    else if (wire === 1 || wire === 2 || wire === 5) {
      const size = wire === 2 ? Number(uint(bytes, cursor)) : wire === 1 ? 8 : 4;
      if (!Number.isSafeInteger(size) || size > bytes.length - cursor.pos) throw new Error('Truncated protobuf');
      value = bytes.subarray(cursor.pos, cursor.pos += size);
    } else throw new Error('Unsupported protobuf wire type');
    if (!result.has(number)) result.set(number, []);
    result.get(number).push({ wire, value });
  }
  return result;
}

const blobs = (map, key) => (map.get(key) || []).filter(v => v.wire === 2).map(v => v.value);
const nested = (map, key) => blobs(map, key).map(fields);
const first = (map, key) => nested(map, key)[0] || new Map();
const text = (map, key) => { const v = blobs(map, key)[0]; return v ? decoder.decode(v) : ''; };
const number = (map, key, fallback = 0) => {
  const v = map.get(key)?.find(v => v.wire === 0)?.value;
  if (v == null) return fallback;
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Oversized protobuf integer');
  return Number(v);
};
const nonnegativeInt32 = (map, key) => {
  const v = map.get(key)?.find(v => v.wire === 0)?.value;
  if (v == null) return null;
  const value = Number(BigInt.asIntN(32, v));
  return value < 0 ? null : value;
};
function integers(map, key) {
  return (map.get(key) || []).flatMap(v => {
    if (v.wire === 0) return [Number(v.value)];
    if (v.wire !== 2) return [];
    const cursor = { pos: 0 }, values = [];
    while (cursor.pos < v.value.length) values.push(Number(uint(v.value, cursor)));
    return values;
  });
}

function tokenCounts(usage) {
  // A usage message can contain just the model and provider after a cancelled request.
  const inputReported = [2, 4, 5].some(key => usage.has(key));
  return {
    inputTokens: inputReported ? number(usage, 2) : null,
    cacheWriteTokens: inputReported ? number(usage, 4) : null,
    cacheReadTokens: inputReported ? number(usage, 5) : null,
    outputTokens: number(usage, 3, null),
  };
}

function durationSeconds(model, key) {
  const bytes = blobs(model, key)[0];
  if (bytes == null) return null;
  const duration = fields(bytes);
  const seconds = duration.get(1)?.[0]?.value ?? 0n;
  const nanos = duration.get(2)?.[0]?.value ?? 0n;
  if (typeof seconds !== 'bigint' || typeof nanos !== 'bigint' ||
      seconds > 315576000000n || nanos >= 1000000000n) return null;
  return Number(seconds) + Number(nanos) / 1e9;
}

function requestMetrics(model, usage) {
  const mode = text(model, 21) || null;
  const responseModel = text(model, 22) || text(model, 19) || null;
  const modelId = number(usage, 1) || number(model, 3);
  return { ...tokenCounts(usage), mode, responseModel,
    model: mode || responseModel || (modelId ? '模型 #' + modelId : '未记录模型'),
    firstTokenSeconds: durationSeconds(model, 11), streamSeconds: durationSeconds(model, 12) };
}

export function outputRate(tokens, seconds) {
  return Number.isFinite(tokens) && tokens >= 0 && Number.isFinite(seconds) && seconds > 0 ? tokens / seconds : null;
}

// Host display names can describe either a selected intensity or a role within one coordinated run.
export function requestRoute(displayName, responseModel) {
  const raw = displayName?.trim() || '';
  const parts = /^(.+?)\s+\(([^()]+)\)$/.exec(raw);
  const family = parts?.[1], variant = parts?.[2];
  if (family === 'Orchestrator' || variant === 'Orchestrator') {
    const role = /(?:^|-)worker(?:-|$)/i.test(responseModel || '') ? '执行'
      : /(?:^|-)orchestrator(?:-|$)/i.test(responseModel || '') ? '调度' : '';
    const modelName = family === 'Orchestrator' ? variant : family;
    return { mode: '协作', role, modelName, label: [role || '角色未记录', modelName].filter(Boolean).join(' · ') };
  }
  const intensity = intensities.get(variant);
  const modelName = intensity ? family : responseModel?.trim() || (raw && !/^(?:auto|automatic|orchestrator|high|medium|low|未记录模式|自动)$/i.test(raw) ? raw : '未记录模型');
  return { mode: intensity || raw || '未记录模式', role: '', modelName, label: modelName };
}
const intensities = new Map([['High','高强度'],['Medium','中强度'],['Low','低强度']]);

function timestampMs(message, key) {
  const ts = first(message, key), sec = number(ts, 1, null);
  return sec > 0 && sec < 253402300800 ? sec * 1000 + number(ts, 2) / 1e6 : null;
}

function stepEvidence(db, includeTools) {
  const times = new Map(), tools = [];
  const columns = new Set(db.prepare('PRAGMA table_info(steps)').all().map(row => row.name));
  if (!columns.has('idx') || !columns.has('metadata')) return { times, tools };
  const status = columns.has('status') ? 'status' : 'NULL AS status';
  for (const step of db.prepare('SELECT idx, metadata, ' + status + ' FROM steps').iterate()) {
    const meta = fields(step.metadata || []), at = timestampMs(meta, 1);
    if (at != null) times.set(step.idx, at);
    if (!includeTools) continue;
    const name = text(first(meta, 4), 2);
    if (!name) continue;
    const start = timestampMs(meta, 32), end = timestampMs(meta, 8);
    tools.push({ seq: step.idx, name, outcome: ({3:'done', 6:'stopped', 7:'error', 12:'stopped'})[step.status] || 'unknown',
      seconds: start != null && end != null && end >= start ? (end - start) / 1000 : null });
  }
  return { times, tools };
}

// Only the recorded counters, timing and identity are needed for the overview.
// Skipping the nested prompt and response-header fields also keeps bodies out of its cache.
export async function readUsageRecords(path) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('BEGIN');
    const records = [], parents = new Set();
    const { times } = stepEvidence(db, false);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='parent_references'").get()) {
      for (const row of db.prepare('SELECT data FROM parent_references').iterate()) {
        const parentId = text(fields(row.data), 6); // The recorded parent conversation (cascade) ID.
        if (parentId) parents.add(parentId);
      }
    }
    for (const row of db.prepare('SELECT data FROM gen_metadata ORDER BY idx').iterate()) {
      const record = fields(row.data), model = first(record, 1);
      if (!model.size) continue;
      const usage = first(model, 4);
      const start = first(model, 9), seq = integers(record, 2)[0] ?? nonnegativeInt32(start, 1);
      const responseId = text(usage, 11) || text(usage, 7);
      records.push({
        seq, at: timestampMs(start, 4) ?? times.get(seq) ?? null,
        requestId: responseId ? number(usage, 6) + '/' + responseId : null,
        ...requestMetrics(model, usage),
      });
    }
    return { records, parents: [...parents] };
  } finally { db.close(); }
}

export function decodeRequest(data, index) {
  const record = fields(data), model = first(record, 1);
  if (!model.size) return null;
  const usage = first(model, 4);
  const start = first(model, 9), window = first(start, 10), time = first(start, 4);
  const indices = integers(record, 2);
  const request = {
    index, seq: indices[0] ?? number(start, 1, null),
    checkpoint: nonnegativeInt32(start, 2),
    at: number(time, 1) > 0 ? new Date(number(time, 1) * 1000).toISOString() : '',
    ...requestMetrics(model, usage),
    contextWindow: nonnegativeInt32(window, 4),
    estimatedTokensUsed: nonnegativeInt32(window, 1),
    system: text(model, 1),
    sections: nested(model, 16).map(s => ({ title: text(s, 1), content: text(s, 2), tokenType: number(s, 6) })),
    tools: nested(model, 8).map(t => ({ name: text(t, 1), description: text(t, 2), schema: text(t, 3) })),
    messages: nested(model, 2).map(m => ({
      source: number(m, 2), content: text(m, 3), seq: nonnegativeInt32(m, 18),
      toolCallId: text(m, 7),
      calls: nested(m, 6).map(c => ({ id: text(c, 1), name: text(c, 2), args: text(c, 3) || text(c, 4) })),
    })),
  };
  request.windowTokens = request.inputTokens == null ? null : request.inputTokens + request.cacheReadTokens + request.cacheWriteTokens;
  // The host strips older prompts from gen_metadata. Never backfill a missing
  // latest prompt with an earlier request or a fabricated system/tool catalogue.
  request.hasPrompt = Boolean(request.system || request.messages.length || request.tools.length);
  return request;
}

export async function readRequests(path, evidence) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('BEGIN');
    const requests = [];
    const { times, tools } = stepEvidence(db, Boolean(evidence));
    if (evidence) evidence.tools = tools;
    for (const row of db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx').iterate()) {
      const request = decodeRequest(row.data, row.idx);
      if (request) {
        if (!request.at && times.has(request.seq)) request.at = new Date(times.get(request.seq)).toISOString();
        requests.push(request);
      }
    }
    return requests;
  } finally { db.close(); }
}
