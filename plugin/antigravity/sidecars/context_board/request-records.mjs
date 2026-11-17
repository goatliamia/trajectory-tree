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
const stepNumber = (map, key) => {
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

export function decodeRequest(data, index) {
  const record = fields(data), model = first(record, 1), usage = first(model, 4);
  const start = first(model, 9), window = first(start, 10), time = first(start, 4);
  const indices = integers(record, 2);
  const request = {
    index, seq: indices[0] ?? number(start, 1, null),
    checkpoint: stepNumber(start, 2),
    at: number(time, 1) > 0 ? new Date(number(time, 1) * 1000).toISOString() : '',
    inputTokens: usage.size ? number(usage, 2) : null,
    outputTokens: usage.size ? number(usage, 3) : null,
    cacheWriteTokens: usage.size ? number(usage, 4) : null,
    cacheReadTokens: usage.size ? number(usage, 5) : null,
    contextWindow: number(window, 4, null),
    system: text(model, 1),
    sections: nested(model, 16).map(s => ({ title: text(s, 1), content: text(s, 2), tokenType: number(s, 6) })),
    tools: nested(model, 8).map(t => ({ name: text(t, 1), description: text(t, 2), schema: text(t, 3) })),
    messages: nested(model, 2).map(m => ({
      source: number(m, 2), content: text(m, 3), seq: stepNumber(m, 18),
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

export async function readRequests(path) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('BEGIN');
    return db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx').all().map(row => decodeRequest(row.data, row.idx));
  } finally { db.close(); }
}
