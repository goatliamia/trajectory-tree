// Antigravity native conversation adapter -> canonical Trajectory Tree payload & Eval runtime.
// Reads conversations/<id>.db (SQLite) + brain/<id>/.system_generated/logs/transcript_full.jsonl.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { fields, readRequestRows } from '../request-records.mjs';
import { projectContext, transcriptRows, transcriptRoute, transcriptTokens } from '../context-data.mjs';
import { attributeToolFailure, isProgramTool, isShellTool, powerShellScript } from './trace/shared/tool-attribution.mjs';
import {
  feedbackArgs, inputToolMeasure, recordedDiagnostics, settleToolMeasure,
} from './trace/shared/tool-feedback.mjs';
import { failureControls } from './trace/shared/tool-control.mjs';
import { scopeByTurn } from './trace/shared/scope-index.mjs';
import { describeCall } from './trace/models/step-insight.mjs';
import { describeOperation } from './trace/models/tool-operation-model.mjs';

const decoder = new TextDecoder('utf-8', { fatal: false });
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const stepTypes = { 14: 'USER_INPUT', 15: 'PLANNER_RESPONSE', 132: 'GENERIC', 23: 'CHECKPOINT', 17: 'ERROR_MESSAGE', 101: 'SYSTEM_MESSAGE' };
const recordedTime = value => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
};

const excerpt = (text, limit = 6000) => {
  const s = typeof text === 'string' ? text : '';
  return s.length <= limit ? { text: s, omitted: 0 } : { text: s.slice(0, limit), omitted: s.length - limit };
};

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
    : value;

function parseJsonSafe(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

function normalizePath(p) {
  if (typeof p !== 'string' || !p.trim()) return null;
  const path = p.trim().replace(/\\/g, '/');
  const normalized = path.replace(/\/+/g, '/');
  return /^[a-z]:\//i.test(path) || path.startsWith('//') ? normalized.toLowerCase() : normalized;
}

function extractTarget(argsObj) {
  if (!argsObj || typeof argsObj !== 'object') return null;
  const raw = argsObj.Path ?? argsObj.path ?? argsObj.file_path ?? argsObj.filePath
    ?? argsObj.AbsolutePath ?? argsObj.TargetFile ?? argsObj.target ?? argsObj.SearchPath;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function extractUserPrompt(content) {
  if (typeof content !== 'string') return '';
  const m = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i.exec(content);
  return (m ? m[1] : content).trim();
}

function canonicalToolAlias(name) {
  const map = {
    read_file: 'read',
    view_file: 'read',
    write_file: 'write',
    write_to_file: 'write',
    edit_file: 'edit',
    replace_file_content: 'edit',
    multi_replace_file_content: 'edit',
    search_web: 'web_search',
  };
  return map[String(name || '').toLowerCase()] ?? name;
}

function decodeProtobufStrings(bytes) {
  if (!bytes || !bytes.length) return [];
  const out = [];
  try {
    const map = fields(bytes);
    for (const entries of map.values()) {
      for (const e of entries) {
        if (e.wire !== 2 || !e.value?.length) continue;
        const txt = decoder.decode(e.value);
        // Keep printable UTF-8 strings (skip binary/nested blobs with control bytes)
        if (txt.length >= 3 && !/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFD]/.test(txt)) {
          out.push(txt.trim());
        } else {
          // Try one level deeper
          try {
            const sub = fields(e.value);
            for (const subEntries of sub.values()) {
              for (const se of subEntries) {
                if (se.wire !== 2 || !se.value?.length) continue;
                const stxt = decoder.decode(se.value);
                if (stxt.length >= 3 && !/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFD]/.test(stxt)) out.push(stxt.trim());
              }
            }
          } catch {}
        }
      }
    }
  } catch {}
  return [...new Set(out.filter(Boolean))];
}

function protoTimestampMs(map, key) {
  const bytes = map.get(key)?.find(v => v.wire === 2)?.value;
  if (!bytes) return null;
  try {
    const ts = fields(bytes);
    const sec = ts.get(1)?.find(v => v.wire === 0)?.value;
    const nanos = ts.get(2)?.find(v => v.wire === 0)?.value ?? 0n;
    if (sec == null || sec <= 0n || sec >= 253402300800n) return null;
    return Math.round(Number(sec) * 1000 + Number(nanos) / 1e6);
  } catch { return null; }
}

function protoText(map, key) {
  const bytes = map.get(key)?.find(v => v.wire === 2)?.value;
  return bytes ? decoder.decode(bytes) : '';
}

const emptyNative = () => ({ steps: new Map(), parents: [], requests: [] });

async function readAntigravityDb(dbPath) {
  if (!dbPath || !existsSync(dbPath)) return emptyNative();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('BEGIN');
    const steps = new Map(), times = new Map();
    const cols = new Set(db.prepare('PRAGMA table_info(steps)').all().map(r => r.name));
    if (cols.has('idx') && cols.has('metadata')) {
      const sel = [
        'idx',
        cols.has('step_type') ? 'step_type' : '0 AS step_type',
        cols.has('status') ? 'status' : '0 AS status',
        'metadata',
        cols.has('error_details') ? 'error_details' : 'NULL AS error_details',
      ].join(', ');
      for (const row of db.prepare(`SELECT ${sel} FROM steps ORDER BY idx`).iterate()) {
        let meta = new Map();
        try { if (row.metadata) meta = fields(row.metadata); } catch {}
        const createdAt = protoTimestampMs(meta, 1);
        if (createdAt != null) times.set(row.idx, createdAt);
        const start = protoTimestampMs(meta, 32);
        const end = protoTimestampMs(meta, 8);
        const tcBytes = meta.get(4)?.find(v => v.wire === 2)?.value;
        let toolCall = null;
        if (tcBytes) {
          try {
            const tc = fields(tcBytes);
            const id = protoText(tc, 1);
            const name = protoText(tc, 2);
            const args = protoText(tc, 3) || protoText(tc, 4);
            if (name) toolCall = { id: id || null, name, args };
          } catch {}
        }
        const errStrings = row.error_details ? decodeProtobufStrings(row.error_details) : [];
        steps.set(row.idx, {
          idx: row.idx,
          stepType: row.step_type,
          status: row.status,
          createdAt,
          start,
          end,
          toolCall,
          errorText: errStrings.join('\n') || null,
        });
      }
    }
    const parents = [];
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='parent_references'").get()) {
      for (const row of db.prepare('SELECT data FROM parent_references').iterate()) {
        try {
          const parentId = protoText(fields(row.data), 6);
          if (parentId) parents.push(parentId);
        } catch {}
      }
    }
    const requestColumns = new Set(db.prepare('PRAGMA table_info(gen_metadata)').all().map(row => row.name));
    const requests = requestColumns.has('idx') && requestColumns.has('data') ? readRequestRows(db, times) : [];
    return { steps, parents, requests };
  } finally {
    db.close();
  }
}

function estimateTextTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  let cjk = 0;
  for (const ch of text) if (/[\u3400-\u9fff]/u.test(ch)) cjk++;
  return Math.max(1, Math.round(cjk * 0.68 + (text.length - cjk) / 3.8));
}

function parseCommandExitCode(text) {
  if (typeof text !== 'string') return null;
  const m = /Command exited with code (-?\d+)/.exec(text);
  return m ? Number(m[1]) : null;
}

function stripAntigravityToolWrapper(text, isShell = false) {
  if (typeof text !== 'string') return '';
  let out = text.replace(/^(?:(?:Created|Completed) At:[^\r\n]*\r?\n)+/gm, '').trim();
  out = out.replace(/^Encountered error in step execution:\s*/i, '').trim();
  if (isShell) {
    out = out.replace(/^Command exited with code -?\d+\.?\s*/i, '').trim();
    if (/^No output from the command\.?\s*$/i.test(out)) return '';
    out = out.replace(/^Command output:\s*/i, '').trim();
  }
  return out;
}

function beforeStep(rows, seq) {
  let low = 0, high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].seq < seq) low = mid + 1;
    else high = mid;
  }
  return low;
}

function buildAntigravityCacheCompaction({ requests, checkpoints, allCalls, postCompactionWindow = 15 }) {
  const minPrevCacheTokens = 4000;
  const minLostCacheTokens = 4000;
  const minLostCacheRatio = 0.25;
  const idleTtlSec = 300;

  const readHistory = new Map();
  const modifyHistory = new Map();
  const callsOrdered = [...allCalls].sort((a, b) => a.seq - b.seq);
  for (const c of callsOrdered) {
    const alias = canonicalToolAlias(c.nativeName || c.name);
    const norm = normalizePath(c.target);
    if (!norm) continue;
    if (alias === 'read' && c.status === 'returned') {
      if (!readHistory.has(norm)) readHistory.set(norm, []);
      readHistory.get(norm).push({ seq: c.seq, turn: c.turn, rawPath: c.target, base: basename(c.target.replace(/\\/g, '/')) });
    } else if ((alias === 'edit' || alias === 'write') && c.status === 'returned') {
      if (!modifyHistory.has(norm)) modifyHistory.set(norm, []);
      modifyHistory.get(norm).push({ seq: c.seq, turn: c.turn, kind: c.name });
    }
  }

  const reqRows = [];
  const dropBySeq = new Map();
  const ratioDilutions = [];
  let prev = null;
  let lastRequestSeq = -1, checkpointIndex = 0;

  for (const r of requests) {
    while (checkpoints[checkpointIndex]?.seq < r.seq) checkpointIndex++;
    const checkpoint = checkpoints[checkpointIndex - 1];
    const boundary = checkpoint?.seq > lastRequestSeq ? checkpoint : null;
    lastRequestSeq = r.seq;
    if (r.inputTokens == null || r.cacheReadTokens == null) {
      prev = null;
      continue;
    }
    const cacheWriteTokens = r.cacheWriteTokens ?? 0;
    const uncachedInputTokens = r.inputTokens + cacheWriteTokens;
    const totalInputTokens = uncachedInputTokens + r.cacheReadTokens;
    const cacheHitRatio = totalInputTokens > 0 ? r.cacheReadTokens / totalInputTokens : null;
    const time = r.time;
    let drop = null;
    if (prev) {
      const gapSec = (Number.isFinite(time) && Number.isFinite(prev.time)) ? Math.max(0, (time - prev.time) / 1000) : null;
      const lostCacheTokens = prev.cacheReadTokens - r.cacheReadTokens;
      const lostRatio = prev.cacheReadTokens > 0 ? lostCacheTokens / prev.cacheReadTokens : 0;
      const routeChanged = (r.model && prev.model && r.model !== prev.model)
        || (r.mode && prev.mode && r.mode !== prev.mode);
      if (prev.cacheReadTokens >= minPrevCacheTokens && lostCacheTokens >= minLostCacheTokens && lostRatio >= minLostCacheRatio) {
        let cause = 'unexplained';
        let boundarySeq = null;
        if (boundary) { cause = 'compaction/summary'; boundarySeq = boundary.seq; }
        else if (routeChanged) { cause = 'header/system'; }
        else if (gapSec != null && gapSec >= idleTtlSec) { cause = 'idle-ttl'; }
        drop = {
          seq: r.seq, prevSeq: prev.seq, turn: r.turn, step: r.step,
          cause, boundarySeq,
          prevCacheRead: prev.cacheReadTokens, currCacheRead: r.cacheReadTokens,
          lostCacheTokens, lostRatio,
          prevHitRatio: prev.cacheHitRatio, currHitRatio: cacheHitRatio,
          gapSec: gapSec != null ? Math.round(gapSec) : null,
          extraCostCny: null, extraCostReason: 'host',
        };
        dropBySeq.set(r.seq, drop);
      } else if (prev.cacheHitRatio != null && cacheHitRatio != null
        && (prev.cacheHitRatio - cacheHitRatio) >= 0.30 && lostCacheTokens < minLostCacheTokens) {
        ratioDilutions.push({ seq: r.seq, turn: r.turn, prevHitRatio: prev.cacheHitRatio, currHitRatio: cacheHitRatio });
      }
    }
    const row = {
      index: reqRows.length,
      seq: r.seq,
      turn: r.turn,
      step: r.step,
      time: Number.isFinite(time) ? time : null,
      provider: 'antigravity',
      model: r.model,
      mode: r.mode || null,
      inputTokens: r.inputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWriteTokens,
      uncachedInputTokens,
      outputTokens: r.outputTokens,
      totalInputTokens,
      cacheHitRatio,
      hadCompactionBefore: Boolean(boundary),
      hadPruneBefore: false,
      hadReloadBefore: false,
      drop,
    };
    reqRows.push(row);
    prev = row;
  }

  const compactions = checkpoints.map((cp, index) => {
    const nextReq = requests[beforeStep(requests, cp.seq + 1)];
    const nextCpSeq = checkpoints[index + 1]?.seq ?? Infinity;
    let observed = 0, readCalls = 0, pureReReads = 0, modifiedReReads = 0, editCalls = 0, editErrors = 0;
    const reReadItems = [];
    for (let i = beforeStep(callsOrdered, cp.seq + 1); i < callsOrdered.length; i++) {
      const c = callsOrdered[i];
      if (c.seq >= nextCpSeq || observed >= postCompactionWindow) break;
      observed++;
      const alias = canonicalToolAlias(c.nativeName || c.name);
      const norm = normalizePath(c.target);
      if (alias === 'read') {
        readCalls++;
        const reads = readHistory.get(norm) ?? [];
        const prior = c.status === 'returned' ? reads[beforeStep(reads, cp.seq) - 1] : null;
        if (prior) {
          const mods = modifyHistory.get(norm) ?? [];
          const modifiedInBetween = mods[beforeStep(mods, c.seq) - 1]?.seq > prior.seq;
          if (modifiedInBetween) modifiedReReads++;
          else pureReReads++;
          reReadItems.push({
            path: c.target,
            basename: basename(c.target.replace(/\\/g, '/')),
            priorReadSeq: prior.seq,
            priorReadTurn: prior.turn,
            postReadSeq: c.seq,
            postReadTurn: c.turn,
            modifiedInBetween,
          });
        }
      } else if (alias === 'edit' || alias === 'write') {
        editCalls++;
        if (c.status === 'error') editErrors++;
      }
    }

    const summaryUsage = (cp.inputTokens != null && cp.cacheReadTokens != null) ? {
      inputTokens: cp.inputTokens,
      cacheReadTokens: cp.cacheReadTokens,
      cacheWriteTokens: cp.cacheWriteTokens ?? 0,
      uncachedInputTokens: cp.inputTokens + (cp.cacheWriteTokens ?? 0),
      outputTokens: cp.outputTokens ?? null,
      cacheHitRatio: (cp.inputTokens + (cp.cacheWriteTokens ?? 0) + cp.cacheReadTokens) > 0
        ? cp.cacheReadTokens / (cp.inputTokens + (cp.cacheWriteTokens ?? 0) + cp.cacheReadTokens) : null,
    } : null;

    return {
      index,
      seq: cp.seq,
      startSeq: cp.seq,
      turn: cp.turn,
      time: cp.time,
      shadowedTokenCount: null,
      shadowedSeqCount: 0,
      summaryEstimatedTokens: cp.summaryEstTokens,
      precededByPrune: false,
      summaryUsage,
      nextRequestSeq: nextReq?.seq ?? null,
      nextRequestDrop: dropBySeq.get(nextReq?.seq) ?? null,
      postWindow: {
        windowLimit: postCompactionWindow,
        toolCallsObserved: observed,
        readCalls,
        pureReReads,
        modifiedReReads,
        totalReReads: pureReReads + modifiedReReads,
        pureReReadRatio: readCalls > 0 ? pureReReads / readCalls : null,
        editCalls,
        editErrors,
        reReadItems,
      },
    };
  });

  const drops = [...dropBySeq.values()];
  const dropsByCause = {};
  let totalLostCacheTokens = 0;
  for (const d of drops) {
    dropsByCause[d.cause] = (dropsByCause[d.cause] || 0) + 1;
    totalLostCacheTokens += d.lostCacheTokens;
  }
  const totalCacheReadTokens = reqRows.reduce((s, r) => s + r.cacheReadTokens, 0);
  const totalUncachedInputTokens = reqRows.reduce((s, r) => s + r.uncachedInputTokens, 0);
  const totalPrompt = totalCacheReadTokens + totalUncachedInputTokens;
  const postReadCalls = compactions.reduce((s, c) => s + (c.postWindow?.readCalls ?? 0), 0);
  const postPureReReads = compactions.reduce((s, c) => s + (c.postWindow?.pureReReads ?? 0), 0);
  const postModifiedReReads = compactions.reduce((s, c) => s + (c.postWindow?.modifiedReReads ?? 0), 0);

  return {
    thresholds: { minPrevCacheTokens, minLostCacheTokens, minLostCacheRatio, idleTtlSec, postCompactionWindow },
    summary: {
      requestsWithUsage: reqRows.length,
      totalCacheReadTokens,
      totalUncachedInputTokens,
      overallCacheHitRatio: totalPrompt > 0 ? totalCacheReadTokens / totalPrompt : null,
      cacheDrops: drops.length,
      dropsByCause,
      ratioDilutions: ratioDilutions.length,
      totalLostCacheTokens,
      totalExtraCostCny: null,
      pricedDropCount: 0,
      compactions: compactions.length,
      compactionPostReadCalls: postReadCalls,
      compactionPureReReads: postPureReReads,
      compactionModifiedReReads: postModifiedReReads,
      compactionPureReReadRatio: postReadCalls > 0 ? postPureReReads / postReadCalls : null,
      prunePasses: 0,
      rawPruneEvents: 0,
      standalonePrunePasses: 0,
      standalonePruneCacheDrops: 0,
      standalonePruneSavedTokens: 0,
      standalonePruneLostCacheTokens: 0,
      prunedReadFiles: 0,
      prunedReReadFiles: 0,
      prunedPureReReadFiles: 0,
      fsNotObserved: { total: 0, neverReadBefore: 0, afterRestartOnly: 0, afterCompactionOnly: 0, afterBothCompactionAndRestart: 0, readBeforeNeither: 0 },
    },
    requests: reqRows,
    drops,
    ratioDilutions,
    compactions,
    prunePasses: [],
  };
}

function splitUserAndInject(text) {
  const raw = typeof text === 'string' ? text : '';
  const isInject = /^\s*(?:<CONTEXT_SUMMARY>|The following is a <SYSTEM_MESSAGE>|Error:\s*The stream was interrupted\b)/i.test(raw);
  if (isInject) return { userText: '', injectText: raw };
  const metaChunks = [];
  const rest = raw.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, m => { metaChunks.push(m); return ''; })
    .replace(/<\/?USER_REQUEST>/gi, '').trim();
  return { userText: rest, injectText: metaChunks.join('\n') };
}

function pairTurnRecoveries(turn, episodesBySeq) {
  // Calls are stored in source sequence order. The reverse pass keeps the
  // nearest later successful call for each signature in this turn.
  const nextReturned = new Map();
  for (let stepIndex = turn.steps.length - 1; stepIndex >= 0; stepIndex--) {
    const calls = turn.steps[stepIndex].calls;
    for (let index = calls.length - 1; index >= 0; index--) {
      const call = calls[index];
      if (call.status === 'returned') {
        nextReturned.set(call.signature, call);
        continue;
      }
      const episode = episodesBySeq.get(call.seq);
      const next = nextReturned.get(call.signature);
      if (!episode || !next) continue;
      Object.assign(episode, {
        complete: true, confirmedCount: 1, unconfirmedCount: 0,
        resolvedAt: next.end, summary: '同轮同参后续返回成功',
        continuationMs: next.end - call.end,
        pairs: [{ failedSeq: call.seq, successSeq: next.seq, successTime: next.end, successStart: next.start }],
        sequence: [...episode.sequence, { kind: 'success', time: next.end, label: '同参操作成功', seqs: [next.seq] }],
      });
    }
  }
}

export async function buildAntigravityDataset({ dbPath, transcriptPath, conversationId, title } = {}) {
  const trRows = transcriptRows(transcriptPath);
  let nativeUnavailable = false;
  const { steps: dbSteps, parents, requests: requestsRaw } = await readAntigravityDb(dbPath).catch(error => {
    if (!trRows.length) throw error;
    nativeUnavailable = true;
    return emptyNative();
  });
  const trBySeq = new Map(trRows.map(r => [r.step_index, r]));
  const reqBySeq = new Map();
  for (const r of requestsRaw) {
    if (Number.isSafeInteger(r.seq) && r.seq >= 0 && !reqBySeq.has(r.seq)) reqBySeq.set(r.seq, r);
  }

  const allSeqs = [...new Set([...dbSteps.keys(), ...trBySeq.keys(), ...reqBySeq.keys()])].sort((a, b) => a - b);
  const timeBySeq = new Map(allSeqs.map(seq => [
    seq, dbSteps.get(seq)?.createdAt ?? recordedTime(trBySeq.get(seq)?.created_at) ?? recordedTime(reqBySeq.get(seq)?.at),
  ]));
  const firstKnownSeq = allSeqs.find(seq => timeBySeq.get(seq) != null);
  let lastTime = timeBySeq.get(firstKnownSeq) ?? 0;
  const typesBySeq = new Map();
  const turns = [];
  const episodes = [];
  const callFacts = {};
  const fileOperations = [];
  const checkpoints = [];
  const retries = [];
  const usageRows = [];
  const requestObservations = [];
  const contextRequests = [];
  const allCalls = [];
  const argumentsBySeq = new Map();
  const resultsBySeq = new Map();
  const visible = { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0 };
  const isSkillRead = (name, path) => /^(?:read_file|view_file|read)$/i.test(name || '')
    && (/(?:^|[\\/])SKILL\.md$/i.test(path || '') || /[\\/](?:\.agents[\\/]skills|builtin[\\/]skills)[\\/]/i.test(path || ''));

  let currentTurn = null;
  let currentStep = null;
  let declaredCalls = new Map();

  const ensureTurn = (seq, at, startObserved) => {
    if (currentTurn) return currentTurn;
    currentTurn = {
      id: `agy-turn-0`,
      number: 1,
      seq,
      start: at,
      startObserved,
      end: at,
      endSeq: seq,
      endObserved: false,
      reason: { kind: 'completed' },
      title: title || 'Antigravity 会话',
      prompts: [],
      steps: [],
      markers: [],
      retries: [],
      errors: 0,
    };
    turns.push(currentTurn);
    return currentTurn;
  };

  for (const seq of allSeqs) {
    const tr = trBySeq.get(seq);
    const db = dbSteps.get(seq);
    const req = reqBySeq.get(seq);
    const type = tr?.type || stepTypes[db?.stepType] || (db?.toolCall ? 'GENERIC' : req ? 'PLANNER_RESPONSE' : 'OTHER');
    typesBySeq.set(seq, type);
    const observedAt = timeBySeq.get(seq);
    const at = observedAt ?? lastTime;
    lastTime = at;

    if (type === 'USER_INPUT') {
      const prompt = extractUserPrompt(tr?.content || '');
      const { userText, injectText } = splitUserAndInject(tr?.content);
      visible.user += estimateTextTokens(userText);
      visible.inject += estimateTextTokens(injectText);
      currentTurn = {
        id: `agy-turn-${turns.length + 1}`,
        number: turns.length + 1,
        seq,
        start: at,
        startObserved: observedAt != null,
        end: at,
        endSeq: seq,
        endObserved: false,
        reason: { kind: 'completed' },
        title: prompt.slice(0, 100) || `第 ${turns.length + 1} 轮`,
        prompts: prompt ? [{ seq, time: at, ...excerpt(prompt, 2600) }] : [],
        steps: [],
        markers: [],
        retries: [],
        errors: 0,
      };
      turns.push(currentTurn);
      currentStep = null;
      declaredCalls.clear();
      continue;
    }

    if (type === 'SYSTEM_MESSAGE') {
      visible.inject += estimateTextTokens(typeof tr?.content === 'string' ? tr.content : '');
      continue;
    }

    if (type === 'CHECKPOINT') {
      const turnNum = currentTurn?.number ?? 0;
      const sumText = typeof tr?.content === 'string' ? tr.content : '';
      const sumEst = estimateTextTokens(sumText);
      visible.user = 0;
      visible.inject = sumEst;
      visible.skill = 0;
      visible.assistant = 0;
      visible.tool = 0;
      checkpoints.push({
        seq,
        turn: turnNum,
        time: observedAt,
        ...transcriptTokens(tr ?? {}),
        summaryEstTokens: sumText ? sumEst : null,
      });
      continue;
    }

    if (type === 'ERROR_MESSAGE') {
      const turn = ensureTurn(seq, at, observedAt != null);
      const retry = {
        seq,
        time: at,
        turn: turn.number,
        step: currentStep?.number ?? turn.steps.length,
        delayMs: 0,
        failure: { code: 'API_ERROR', message: String(tr?.error || db?.errorText || 'API error').slice(0, 200) },
        started: false,
        responded: false,
      };
      retries.push(retry);
      turn.retries.push(retry);
      continue;
    }

    if (type === 'PLANNER_RESPONSE') {
      const turn = ensureTurn(seq, at, observedAt != null);
      const ttftMs = Number.isFinite(req?.firstTokenSeconds) ? Math.round(req.firstTokenSeconds * 1000) : null;
      const decodeMs = Number.isFinite(req?.streamSeconds) ? Math.round(req.streamSeconds * 1000) : null;
      const modelMs = ttftMs != null && decodeMs != null ? ttftMs + decodeMs : null;
      const measuredEnd = modelMs != null && observedAt != null ? at + modelMs : db?.end;
      const end = measuredEnd != null && measuredEnd >= at ? measuredEnd : at;
      const transcriptUsage = transcriptTokens(tr ?? {});
      const route = transcriptRoute(tr ?? {});
      const inTok = req?.inputTokens ?? transcriptUsage.inputTokens;
      const cacheTok = req?.cacheReadTokens ?? transcriptUsage.cacheReadTokens;
      const writeTok = req?.cacheWriteTokens ?? transcriptUsage.cacheWriteTokens;
      const outTok = req?.outputTokens ?? transcriptUsage.outputTokens;
      const replyText = typeof tr?.content === 'string' ? tr.content.trim() : '';
      const trCalls = Array.isArray(tr?.tool_calls) ? tr.tool_calls.filter(call => typeof call?.name === 'string' && call.name) : [];
      declaredCalls = new Map(trCalls.filter(call => call.id).map(call => [call.id, call]));

      currentStep = {
        number: turn.steps.length + 1,
        seq,
        start: at,
        startObserved: observedAt != null,
        end,
        endSeq: seq,
        endObserved: measuredEnd != null && measuredEnd >= at,
        assistantSeq: seq,
        assistantTime: end,
        reply: replyText ? excerpt(replyText, 2000) : null,
        calls: [],
        ...(trCalls.length ? { declaredTools: trCalls.map(call => call.name) } : {}),
        retries: [],
        markers: [],
        inTok,
        cacheTok,
        outTok,
        model: req?.responseModel || route.responseModel || req?.model || null,
        mode: req?.mode || route.mode,
        timing: { ttftMs, decodeMs, modelMs },
        semanticUnit: 'antigravity-planner-step',
      };
      turn.steps.push(currentStep);
      turn.end = Math.max(turn.end, end);
      turn.endSeq = seq;

      const promptTokens = inTok != null && cacheTok != null ? inTok + cacheTok + (writeTok || 0) : null;
      const visibleTotal = visible.system + visible.tools + visible.user + visible.inject + visible.skill + visible.assistant + visible.tool;
      contextRequests.push({
        turn: turn.number,
        turnId: turn.id,
        step: currentStep.number,
        contextSteps: [currentStep.number],
        seq,
        time: at,
        ...visible,
        total: visibleTotal,
        reportedInput: promptTokens,
        activeMs: modelMs,
        source: 'estimate',
        semanticUnit: 'antigravity-transcript-visible-context',
      });
      const callText = trCalls.map(c => {
        const rawArgs = c?.args ?? c?.arguments;
        return `${c?.name || ''}\n${typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? '')}`;
      });
      const assistantBody = [typeof tr?.content === 'string' ? tr.content : '', ...callText].filter(Boolean).join('\n\n');
      visible.assistant += estimateTextTokens(assistantBody);

      requestObservations.push({
        seq, turn: turn.number, step: currentStep.number, time: observedAt,
        model: currentStep.model, mode: currentStep.mode,
        inputTokens: inTok, cacheReadTokens: cacheTok, cacheWriteTokens: writeTok, outputTokens: outTok,
      });
      if (inTok != null || outTok != null || cacheTok != null) {
        usageRows.push({
          turn: turn.number,
          step: currentStep.number,
          seq,
          time: observedAt,
          provider: 'antigravity',
          model: currentStep.model,
          usage: {
            input: inTok,
            inputTokens: inTok,
            cacheRead: cacheTok,
            cacheReadTokens: cacheTok,
            cacheWrite: writeTok,
            cacheWriteTokens: writeTok,
            output: outTok,
            outputTokens: outTok,
            promptTokens,
          },
        });
      }
      continue;
    }

    const recordedTool = db?.toolCall ?? declaredCalls.get(tr?.tool_call_id ?? tr?.toolCallId);
    if (type === 'GENERIC' && recordedTool?.name) {
      const turn = ensureTurn(seq, at, observedAt != null);
      if (!currentStep) {
        currentStep = {
          number: turn.steps.length + 1, seq, start: at, startObserved: observedAt != null, end: at, endSeq: seq, endObserved: false,
          assistantSeq: null, assistantTime: null, reply: null, calls: [], retries: [], markers: [],
          inTok: null, cacheTok: null, outTok: null, timing: { ttftMs: null, decodeMs: null, modelMs: null },
        };
        turn.steps.push(currentStep);
      }

      const rawName = recordedTool.name;
      const aliasName = canonicalToolAlias(rawName);
      const rawArgs = recordedTool.args ?? recordedTool.arguments;
      const rawArgsStr = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
      const argsObj = parseJsonSafe(rawArgsStr);
      const outputText = typeof tr?.content === 'string' ? tr.content : '';
      const errText = db?.errorText || (typeof tr?.error === 'string' ? tr.error : '');
      const isShell = isShellTool(aliasName);
      const exitCode = isShell ? parseCommandExitCode(outputText) : null;
      const isBackgroundLaunch = isShell && (argsObj?.IsDaemon === true || /Tool is running as a background task with task id:/i.test(outputText));

      let status = 'unknown';
      if (db?.status === 3 || tr?.status === 'DONE') status = 'returned';
      if (db?.status === 7 || tr?.status === 'ERROR' || Boolean(errText)) status = 'error';
      if (db?.status === 6 || db?.status === 12) status = isBackgroundLaunch ? 'returned' : 'error';
      if (exitCode != null && exitCode !== 0 && status === 'returned') {
        // Keep Antigravity's run_command non-zero exit visible as error for Eval & Code Execution
        status = 'error';
      }

      const start = db?.start ?? at;
      const end = Math.max(start, db?.end ?? at);
      const durationMs = db?.start != null && db?.end != null && db.end >= db.start ? Math.round(db.end - db.start) : null;
      const target = extractTarget(argsObj);
      const callId = recordedTool.id || `agy-call-${seq}`;
      const signature = hash([rawName, canonical(argsObj ?? rawArgsStr)]);
      const cleanOutput = stripAntigravityToolWrapper(outputText, isShell);
      const cleanErr = stripAntigravityToolWrapper(errText, isShell);
      const combinedOutput = cleanErr && !cleanOutput.includes(cleanErr) ? `${cleanErr}\n${cleanOutput}`.trim() : cleanOutput;
      if (!currentStep.declaredTools?.length && db?.toolCall) {
        visible.assistant += estimateTextTokens(`${rawName}\n${rawArgsStr}`);
      }
      visible[isSkillRead(rawName, target) ? 'skill' : 'tool'] += estimateTextTokens(outputText || errText);

      const call = {
        id: callId,
        seq,
        startSeq: seq,
        resultSeq: status !== 'unknown' || db?.end != null ? seq : null,
        name: rawName,
        nativeName: rawName,
        signature,
        target,
        args: excerpt(rawArgsStr, 6000),
        result: excerpt(combinedOutput, 8000),
        start,
        end,
        durationMs,
        timingSource: durationMs != null ? 'recorded-interval' : 'unrecorded-start',
        ...(isBackgroundLaunch ? { backgrounded: true } : {}),
        status,
        error: status === 'error' ? {
          code: db?.status === 6 || db?.status === 12 ? 'ABORTED' : exitCode != null && exitCode !== 0 ? `EXIT_${exitCode}` : 'TOOL_ERROR',
          message: (cleanErr || (combinedOutput ? combinedOutput.slice(0, 240) : (exitCode != null && exitCode !== 0 ? `Command exited with code ${exitCode}` : ''))),
        } : null,
        source: db?.toolCall ? 'antigravity-db' : 'antigravity-transcript',
      };

      // Shared tool measure & diagnostics
      call.measure = settleToolMeasure(aliasName, inputToolMeasure(aliasName, argsObj ?? rawArgsStr), combinedOutput, status);
      if (status === 'error') {
        const command = rawName === 'run_command' ? argsObj?.CommandLine : undefined;
        call.attribution = attributeToolFailure({
          status: 'error',
          tool: aliasName,
          output: combinedOutput,
          error: call.error,
          exitCode: exitCode ?? undefined,
          interrupted: db?.status === 6 || db?.status === 12,
          command,
        });
        call.controls = failureControls(call, { host: 'antigravity', error: call.error });
        const fbArgs = feedbackArgs(argsObj ?? rawArgsStr);
        const program = isProgramTool(aliasName);
        const src = program ? fbArgs.code : powerShellScript(argsObj?.CommandLine ?? fbArgs.command, aliasName, argsObj?.shell)?.text;
        call.codeFrames = recordedDiagnostics({ name: aliasName, output: combinedOutput, source: src, program });
      }

      argumentsBySeq.set(seq, rawArgsStr);
      if (status === 'error') resultsBySeq.set(seq, combinedOutput);

      // Call facts + simple subagent presentation + file operations
      const fact = describeCall({ ...call, name: aliasName });
      const op = describeOperation({ ...call, name: aliasName }, argsObj, combinedOutput, null, null);
      if (rawName === 'invoke_subagent' || rawName === 'send_message') {
        const role = argsObj?.Role || argsObj?.TypeName || argsObj?.Recipient || '';
        callFacts[seq] = {
          ...fact,
          title: (rawName === 'invoke_subagent' ? '子代理 · ' : '消息 · ') + (role || rawName),
          detail: 'Antigravity · 子代理委派',
        };
      } else {
        callFacts[seq] = {
          ...fact,
          title: op.family === 'other' ? fact.title : op.title + (op.subject ? ' · ' + op.subject : ''),
          outcome: fact.tone === 'bad' || fact.tone === 'unknown' || op.family === 'other' ? fact.outcome : op.summary,
          operation: { family: op.family, subject: op.subject, metrics: op.metrics, search: op.search || null },
          detail: isBackgroundLaunch ? 'Antigravity · 后台任务' : 'Antigravity · 会话记录',
        };
      }

      if (target && ['read', 'write', 'edit'].includes(aliasName)) {
        fileOperations.push({
          turn: turn.number,
          step: currentStep.number,
          seq,
          resultSeq: seq,
          time: end,
          kind: aliasName === 'read' ? 'read' : 'change',
          path: target,
          tool: rawName,
          status,
          access: aliasName === 'read' ? 'read' : 'write',
          recordedPath: true,
        });
      }

      currentStep.calls.push(call);
      if (end >= currentStep.end) currentStep.endObserved = db?.end != null && db.end >= start || observedAt != null && status !== 'unknown';
      currentStep.end = Math.max(currentStep.end, end);
      currentStep.endSeq = seq;
      if (status === 'error') {
        turn.errors++;
        episodes.push({
          id: `agy-${callId}`,
          turn: turn.number,
          condition: call.attribution?.code || call.error?.code || 'TOOL_ERROR',
          reason: (call.attribution?.label || call.name) + ' 未成功',
          summary: '后续结果待确认',
          steps: [currentStep.number],
          failureSeqs: [seq],
          pairs: [],
          readSeqs: [],
          targets: target ? [target] : [],
          start,
          end,
          firstError: end,
          resolvedAt: null,
          complete: false,
          failedCount: 1,
          confirmedCount: 0,
          unconfirmedCount: 1,
          failedCallMs: durationMs,
          stepMs: currentStep.end - currentStep.start,
          continuationMs: null,
          sequence: [{ kind: 'failure', time: end, label: call.error?.code || 'error', seqs: [seq] }],
          source: call.source,
        });
      }
      turn.end = Math.max(turn.end, end);
      turn.endSeq = seq;
      allCalls.push({ ...call, turn: turn.number, step: currentStep.number });
    }
  }

  // Bound foreground steps at the next model step. Tool durations retain their
  // recorded native start and end even when execution overlaps later steps.
  const flatSteps = turns.flatMap(t => t.steps.map(s => ({ turn: t, step: s })));
  const epByFailureSeq = new Map(episodes.map(e => [e.failureSeqs[0], e]));
  for (let i = 0; i < flatSteps.length; i++) {
    const { step } = flatSteps[i];
    const nextStart = flatSteps[i + 1]?.step.start ?? null;
    const maxCallEnd = step.calls.reduce((m, c) => Math.max(m, c.backgrounded ? c.start : c.end), step.assistantTime ?? step.start);
    step.end = nextStart != null && step.start <= nextStart ? Math.min(maxCallEnd, nextStart) : maxCallEnd;
    for (const c of step.calls) {
      const ep = epByFailureSeq.get(c.seq);
      if (ep) ep.stepMs = Math.max(0, step.end - step.start);
    }
  }
  for (const t of turns) {
    t.end = t.steps.reduce((m, s) => Math.max(m, s.end ?? t.start), t.start);
    t.endObserved = t.steps.at(-1)?.endObserved ?? false;
  }
  for (let i = 1; i < turns.length; i++) {
    const prev = turns[i - 1], curr = turns[i];
    if (curr.start < prev.end) {
      const firstStepStart = curr.steps[0]?.start;
      if (firstStepStart != null && firstStepStart >= prev.end) {
        curr.start = prev.end;
        if (curr.end < curr.start) curr.end = curr.start;
      } else {
        prev.end = Math.max(prev.start, curr.start);
      }
    }
  }
  const turnByNumber = new Map(turns.map(t => [t.number, t]));
  for (const r of contextRequests) {
    const t = turnByNumber.get(r.turn);
    if (t && r.time != null) r.time = Math.max(t.start, Math.min(t.end, r.time));
  }

  for (const turn of turns) {
    turn.calls = turn.steps.reduce((count, step) => count + step.calls.length, 0);
    if (turn.errors) pairTurnRecoveries(turn, epByFailureSeq);
  }

  const cacheCompaction = buildAntigravityCacheCompaction({
    requests: requestObservations,
    checkpoints,
    allCalls,
  });

  // Build Trajectory Tree boundaries from enriched CHECKPOINT compactions
  const boundaries = cacheCompaction.compactions.map(c => {
    const t = turnByNumber.get(c.turn);
    const time = t && c.time != null ? Math.max(t.start, Math.min(t.end, c.time)) : c.time;
    return {
    seq: c.seq,
    time,
    kind: 'compaction',
    turn: c.turn,
    step: null,
    detail: {
      summarySeq: c.seq,
      shadowedTokenCount: c.shadowedTokenCount,
      shadowedSeqCount: c.shadowedSeqCount,
      summaryEstimatedTokens: c.summaryEstimatedTokens,
      precededByPrune: false,
      summaryUsage: c.summaryUsage,
      nextRequestDrop: c.nextRequestDrop,
      postWindow: c.postWindow,
    },
  };
  });

  const latestReq = requestsRaw.at(-1);
  const currentContextTotals = latestReq?.hasPrompt ? projectContext(latestReq, typesBySeq).context.totals : null;
  const totals = {
    turns: turns.length,
    steps: turns.reduce((n, t) => n + t.steps.length, 0),
    calls: turns.reduce((n, t) => n + t.calls, 0),
    errors: episodes.length,
  };
  const lastSeq = allSeqs.at(-1) ?? 0;

  const session = {
    id: conversationId || 'antigravity-session',
    title: title || turns[0]?.title || 'Antigravity 会话',
    parentSession: parents[0] ?? null,
    source: { host: 'antigravity', session: conversationId || 'antigravity-session', file: transcriptPath || dbPath || null },
    firstSeq: allSeqs[0] ?? 0,
    lastSeq,
    eventCount: allSeqs.length,
    diagnostics: { replacementEventsExcluded: 0, unmatchedResults: 0, duplicateResults: 0, unresolvedCalls: 0 },
    turns,
    communications: [],
    totals,
    overview: { rulesVersion: 1, episodes, retries, representatives: episodes.map(e => e.id) },
  };

  const payload = {
    schema: 1,
    host: 'antigravity',
    generatedAt: new Date().toISOString(),
    mainSession: session.id,
    sessions: [session],
    evidence: {
      source: { db: dbPath || null, transcript: transcriptPath || null, nativeUnavailable },
      context: { estimate: true, latestOnly: true },
    },
    officialStats: latestReq?.contextWindow ? {
      context: { pressure: { pressureTokens: latestReq.estimatedTokensUsed ?? latestReq.windowTokens, contextWindow: latestReq.contextWindow } },
    } : null,
    context: {
      source: { kind: currentContextTotals ? 'antigravity-recorded-request' : 'antigravity-transcript-visible-context' },
      boundaries,
      requests: contextRequests,
      usage: usageRows,
      ...(currentContextTotals ? { current: currentContextTotals } : {}),
      callFacts,
      fileOperations,
      retries,
      retryStarted: [],
      supplementSources: [],
      skillEvents: [],
    },
    traceStatus: { context: contextRequests.length || currentContextTotals ? 'ready' : 'unavailable' },
  };

  return {
    host: 'antigravity',
    session,
    payload,
    nativeUnavailable,
    cacheCompaction,
    argumentsBySeq,
    resultsBySeq,
    runtime: createAntigravityRuntime(payload),
  };
}

export function createAntigravityRuntime(payload) {
  const session = payload.sessions[0];
  const usageIn = scopeByTurn(payload.context?.usage ?? []);
  const filesIn = scopeByTurn(payload.context?.fileOperations ?? []);

  return (turns, number) => {
    const select = index => number == null && turns.length !== session.turns.length
      ? turns.flatMap(turn => index(turn.number))
      : index(number);
    const rows = select(usageIn);
    const outputs = rows.map(r => r.usage?.output).filter(v => Number.isFinite(v) && v >= 0);
    const steps = turns.flatMap(t => t.steps);
    const files = select(filesIn);

    const durationKnown = row => row.startObserved && row.endObserved && row.end >= row.start;
    const turnSpans = turns.filter(durationKnown).map(t => t.end - t.start);
    const stepSpans = steps.filter(durationKnown).map(s => s.end - s.start);
    const modelSteps = steps.filter(s => Number.isFinite(s.timing?.modelMs));
    const ttftVals = steps.map(s => s.timing?.ttftMs).filter(Number.isFinite);
    const decodeVals = steps.map(s => s.timing?.decodeMs).filter(Number.isFinite);
    const modelTotal = modelSteps.reduce((sum, s) => sum + s.timing.modelMs, 0);

    // File read-before-write / read-after-write
    const byFile = new Map();
    for (const f of files) {
      const k = normalizePath(f.path);
      if (!k) continue;
      if (!byFile.has(k)) byFile.set(k, { reads: [], writes: [] });
      if (f.access === 'write' && f.status === 'returned') byFile.get(k).writes.push(f.seq);
      else if (f.access === 'read' && f.status === 'returned') byFile.get(k).reads.push(f.seq);
    }
    let pairedWriteFiles = 0, readBeforeFirstWrite = 0, readAfterLastWrite = 0;
    for (const { reads, writes } of byFile.values()) {
      if (!writes.length) continue;
      pairedWriteFiles++;
      const firstW = Math.min(...writes), lastW = Math.max(...writes);
      if (reads.some(r => r < firstW)) readBeforeFirstWrite++;
      if (reads.some(r => r > lastW)) readAfterLastWrite++;
    }

    // Same-turn repeat groups
    const sigCounts = new Map();
    for (const t of turns) for (const s of t.steps) for (const c of s.calls) {
      const k = `${t.number}:${c.signature}`;
      sigCounts.set(k, (sigCounts.get(k) || 0) + 1);
    }
    const repeatGroups = [...sigCounts.values()].filter(v => v >= 2);

    return {
      timing: {
        turns: { total: turns.length, measured: turnSpans.length, ms: turnSpans.length ? turnSpans.reduce((a, b) => a + b, 0) : null },
        steps: { total: steps.length, measured: stepSpans.length, ms: stepSpans.length ? stepSpans.reduce((a, b) => a + b, 0) : null },
        toolSteps: { coveredMs: null, measured: null, total: steps.length },
        recordedModel: ttftVals.length || decodeVals.length ? {
          steps: modelSteps.length,
          total: modelSteps.length ? modelTotal : null,
          firstToken: ttftVals.length ? ttftVals.reduce((a, b) => a + b, 0) : null,
          decode: decodeVals.length ? decodeVals.reduce((a, b) => a + b, 0) : null,
        } : null,
        official: null,
      },
      usage: {
        output: outputs.length ? outputs.reduce((a, b) => a + b, 0) : null,
        coverage: { output: outputs.length },
        requests: rows.length,
      },
      files: { files: byFile.size, pairedWriteFiles, readBeforeFirstWrite, readAfterLastWrite },
      task: { deliveries: null, deliveredFiles: null, workspaceObservations: null, evidence: [] },
      context: { skillLoads: null, childSessions: null },
      repeats: { groups: repeatGroups.length, calls: repeatGroups.reduce((a, b) => a + b, 0) },
    };
  };
}
