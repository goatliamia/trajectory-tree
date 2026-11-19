// Deterministic DSH KV-cache drop and compaction/prune sequelae analyzer.
// Pure functions over recorded DSH SessionEvent arrays; no I/O, no model calls.

import { DEEPSEEK_PRICES, isPeakTime } from '../docs/demo/layout-review/context-cost-model.mjs';

function extraCacheMissCost(lostCacheTokens, { provider, model, time }) {
  if (!Number.isFinite(lostCacheTokens) || lostCacheTokens <= 0) return { cny: null, reason: 'zero' };
  if (typeof provider !== 'string' || !provider.startsWith('deepseek')) return { cny: null, reason: 'provider' };
  const table = Object.hasOwn(DEEPSEEK_PRICES, model) ? DEEPSEEK_PRICES[model] : undefined;
  if (!table) return { cny: null, reason: 'model' };
  if (typeof time !== 'number' || !Number.isFinite(time)) return { cny: null, reason: 'time' };
  const slot = isPeakTime(time) ? 1 : 0;
  const deltaPerM = table.cacheMiss[slot] - table.cacheHit[slot];
  return {
    cny: (lostCacheTokens / 1e6) * deltaPerM,
    reason: null,
    peak: slot === 1,
    deltaPerM,
  };
}

function isReplacement(event) {
  return Boolean(event?.surfaceOp && typeof event.surfaceOp === 'object');
}

function parseArgs(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

function normalizePath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const path = trimmed.replace(/\\/g, '/');
  const normalized = path.replace(/\/+/g, '/');
  return /^[a-z]:\//i.test(path) || trimmed.startsWith('\\\\') ? normalized.toLowerCase() : normalized;
}

// File histories are appended in observation order, including overlapping calls.
function beforeObservation(rows, seq) {
  let low = 0, high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((rows[mid].resultSeq ?? rows[mid].seq) < seq) low = mid + 1;
    else high = mid;
  }
  return low;
}

function lastObservedBefore(rows = [], seq) {
  return rows[beforeObservation(rows, seq) - 1];
}

function baseName(value) {
  if (typeof value !== 'string' || !value) return '';
  const cleaned = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = cleaned.lastIndexOf('/');
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function extractFilePath(rawArgs) {
  const args = parseArgs(rawArgs);
  if (!args || typeof args !== 'object') return null;
  const raw = args.file_path ?? args.path ?? args.filePath ?? args.target ?? args.file;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return { raw: raw.trim(), norm: normalizePath(raw), base: baseName(raw.trim()) };
}

function isReadTool(name) {
  const lower = String(name || '').toLowerCase();
  return lower === 'read' || lower === 'read_file' || lower.endsWith(':read');
}

function isWriteOrEditTool(name) {
  const lower = String(name || '').toLowerCase();
  return lower === 'edit' || lower === 'write' || lower === 'apply_patch'
    || lower === 'str_replace_editor' || lower === 'delete'
    || lower.endsWith(':edit') || lower.endsWith(':write');
}

function readResultOutcome(event) {
  const d = event?.data ?? {};
  const msg = d.message ?? {};
  const code = d.error?.code ?? d.errorCode ?? msg.errorCode ?? '';
  const isErr = Boolean(d.isError || msg.isError || d.error || code || d.outcome?.kind === 'error');
  if (!isErr) return { isErr: false, code: '', text: '' };
  let text = '';
  const content = msg.content ?? d.content;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content.map(b => (typeof b === 'string' ? b : b?.text || '')).join('\n');
  }
  if (!text && typeof d.error?.message === 'string') text = d.error.message;
  return { isErr, code, text };
}

function classifyEditError(code, text) {
  const c = String(code || '');
  const t = String(text || '');
  if (c === 'FS_NOT_OBSERVED' || t.includes('FS_NOT_OBSERVED') || t.includes('has not been read')) return 'FS_NOT_OBSERVED';
  if (c === 'FS_STALE_VERSION' || t.includes('FS_STALE_VERSION') || t.includes('modified since')) return 'FS_STALE_VERSION';
  if (c === 'FS_EDIT_NOT_FOUND' || t.includes('not found') || t.includes('No match') || t.includes('did not match') || t.includes('old_str')) return 'MATCH_OR_NOT_FOUND';
  if (t.includes('multiple') || t.includes('unique')) return 'NOT_UNIQUE';
  return c || 'OTHER';
}

function estimateTextTokens(blocks) {
  if (!blocks) return null;
  let text = '';
  if (typeof blocks === 'string') text = blocks;
  else if (Array.isArray(blocks)) {
    text = blocks.map(b => (typeof b === 'string' ? b : b?.text || '')).join('\n');
  }
  if (!text) return 0;
  // Lightweight heuristic matching common 1 token ≈ 3.2–4 chars mixed prose/code.
  let ascii = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) < 128) ascii++;
  }
  const nonAscii = text.length - ascii;
  return Math.ceil(ascii / 4 + nonAscii / 1.6);
}

function extractUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const count = value => Number.isFinite(value) && value >= 0 ? value : null;
  const inputTokens = count(usage.inputTokens ?? usage.input);
  const cacheReadTokens = count(usage.cacheReadTokens ?? usage.cacheRead);
  const cacheWriteTokens = count(usage.cacheWriteTokens ?? usage.cacheWrite ?? 0);
  const outputTokens = count(usage.outputTokens ?? usage.output);
  if (inputTokens === null || cacheReadTokens === null || cacheWriteTokens === null) return null;
  const totalInputTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
  const uncachedInputTokens = inputTokens + cacheWriteTokens;
  return {
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    uncachedInputTokens,
    outputTokens,
    totalInputTokens,
    cacheHitRatio: totalInputTokens > 0 ? cacheReadTokens / totalInputTokens : null,
  };
}

/**
 * Analyze DSH session events for:
 * 1) Prefix KV-cache drops (absolute cacheReadTokens regression, not ratio dilution) + cause attribution + extra CNY cost.
 * 2) Compaction summary & ToolResultPruner pass sequelae (net reduction, summarizer own cache hit, pure vs post-edit re-reads, prune saved vs lost cache).
 * 3) FS_NOT_OBSERVED attribution (never-read vs session reload/end-seed vs compaction).
 */
export function analyzeDshCacheCompaction(events, options = {}) {
  const minPrevCacheTokens = options.minPrevCacheTokens ?? 4000;
  const minLostCacheTokens = options.minLostCacheTokens ?? 4000;
  const minLostCacheRatio = options.minLostCacheRatio ?? 0.25;
  const idleTtlSec = options.idleTtlSec ?? 300;
  const postCompactionWindow = options.postCompactionWindow ?? 15;

  const list = Array.isArray(events) ? events : [];
  const callById = new Map();
  const toolResultBySeq = new Map();
  const readHistory = new Map(); // normPath -> [{ seq, turn, time, rawPath }]
  const modifyHistory = new Map(); // normPath -> [{ seq, turn, kind }]
  const compactionStarts = new Map();
  const compactionEvents = [];
  const rawPrunes = [];
  const restartSeqs = [];

  // Track active route for pricing
  let currentRoute = { provider: null, model: null };

  // First pass: collect calls, results, reads, edits, compactions, prunes, restarts, and LLM requests
  const requests = [];
  const requestBoundaries = [];
  const ratioDilutions = [];
  let prevReq = null;
  const requestInterval = () => ({
    compactions: [],
    pruneSeqs: [],
    restartSeqs: [],
    headerSeqs: [],
    systemSeqs: [],
  });
  let between = requestInterval();

  const fsNotObserved = {
    total: 0,
    neverReadBefore: 0,
    afterRestartOnly: 0,
    afterCompactionOnly: 0,
    afterBothCompactionAndRestart: 0,
    readBeforeNeither: 0,
    byTool: {},
    samples: [],
  };

  let seenFirstRequest = false;

  for (let i = 0; i < list.length; i++) {
    const ev = list[i];
    if (!ev || typeof ev !== 'object') continue;
    const seq = Number.isFinite(ev.seq) ? ev.seq : i;
    const type = ev.type;
    const d = ev.data ?? {};
    const time = Number.isFinite(ev.time) ? ev.time : null;
    const replaced = isReplacement(ev);

    if (type === 'request/header') {
      const cfg = d.header?.config ?? d.config;
      if (cfg?.provider || cfg?.model) {
        currentRoute = {
          provider: cfg.provider ?? currentRoute.provider,
          model: cfg.model ?? currentRoute.model,
        };
      }
      between.headerSeqs.push(seq);
    } else if (type === 'model/selection' || type === 'request/context') {
      if (d.provider || d.model) {
        currentRoute = {
          provider: d.provider ?? currentRoute.provider,
          model: d.model ?? currentRoute.model,
        };
      }
      if (type === 'model/selection') between.headerSeqs.push(seq);
    } else if (type === 'system/message' || type === 'developer/message') {
      between.systemSeqs.push(seq);
    } else if (type === 'session/end-seed') {
      // Only treat end-seed after the session has already produced requests as a reload/restart boundary
      if (seenFirstRequest) {
        restartSeqs.push({ seq, idx: i, time });
        between.restartSeqs.push(seq);
      }
    } else if (type === 'compaction/start') {
      if (d.compactionId != null) compactionStarts.set(d.compactionId, { seq, turn: d.turn ?? null });
    } else if (type === 'compaction/summary') {
      const start = compactionStarts.get(d.compactionId);
      compactionStarts.delete(d.compactionId);
      const summaryUsage = extractUsage(d.usage);
      const summaryEst = estimateTextTokens(d.summary);
      const shadowedTokenCount = typeof d.shadowedTokenCount === 'number' ? d.shadowedTokenCount : null;
      const comp = {
        index: compactionEvents.length,
        seq,
        idx: i,
        startSeq: start?.seq ?? null,
        turn: start?.turn ?? d.turn ?? null,
        time,
        compactionId: d.compactionId ?? null,
        provider: d.provider ?? currentRoute.provider,
        model: d.model ?? currentRoute.model,
        shadowedTokenCount,
        shadowedSeqCount: Array.isArray(d.shadowedSeqs) ? d.shadowedSeqs.length : 0,
        summaryEstimatedTokens: summaryEst,
        netTokenReduction: shadowedTokenCount != null && summaryEst != null ? shadowedTokenCount - summaryEst : null,
        summaryUsage,
        precededByPrune: between.pruneSeqs.length > 0,
        precedingPruneSeqs: [...between.pruneSeqs],
        nextRequestSeq: null,
        nextRequestDrop: null,
        postWindow: null,
      };
      compactionEvents.push(comp);
      between.compactions.push(comp);
    } else if (type === 'compaction/prune') {
      const shadowedSeqs = Array.isArray(d.shadowedSeqs) ? d.shadowedSeqs : [];
      const shadowedTokenCount = typeof d.shadowedTokenCount === 'number' ? d.shadowedTokenCount : 0;
      rawPrunes.push({
        seq,
        idx: i,
        time,
        turn: d.turn ?? null,
        shadowedSeqs,
        shadowedTokenCount,
      });
      between.pruneSeqs.push(seq);
    } else if (type === 'workspace/changes') {
      // Record externally observed file modifications so we don't misclassify post-change reads as pure amnesia
      const paths = [];
      for (const bucket of ['changed', 'modified', 'created', 'added', 'deleted', 'files']) {
        const arr = d[bucket];
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          const p = typeof item === 'string' ? item : item?.path ?? item?.file;
          const norm = normalizePath(p);
          if (norm) paths.push(norm);
        }
      }
      for (const norm of paths) {
        if (!modifyHistory.has(norm)) modifyHistory.set(norm, []);
        modifyHistory.get(norm).push({ seq, turn: d.turn ?? null, kind: 'workspace/changes' });
      }
    }

    if (type === 'tool/call' && !replaced) {
      const id = d.callId ?? d.id;
      const name = d.name ?? d.toolName ?? '';
      const fp = extractFilePath(d.arguments ?? d.input);
      if (id != null) {
        callById.set(String(id), {
          id: String(id),
          name,
          seq,
          idx: i,
          turn: d.turn ?? null,
          step: d.step ?? null,
          time,
          file: fp,
        });
      }
    } else if (type === 'tool/result' && !replaced) {
      const id = d.callId ?? d.message?.toolCallId ?? d.message?.source?.callId;
      const call = id != null ? callById.get(String(id)) : null;
      const outcome = readResultOutcome(ev);
      if (call) {
        toolResultBySeq.set(seq, { call, seq, turn: d.turn ?? call.turn, time, outcome });
        if (isReadTool(call.name) && !outcome.isErr && call.file?.norm) {
          if (!readHistory.has(call.file.norm)) readHistory.set(call.file.norm, []);
          readHistory.get(call.file.norm).push({
            seq: call.seq,
            resultSeq: seq,
            turn: d.turn ?? call.turn,
            time,
            rawPath: call.file.raw,
            base: call.file.base,
          });
        } else if (isWriteOrEditTool(call.name)) {
          if (!outcome.isErr && call.file?.norm) {
            if (!modifyHistory.has(call.file.norm)) modifyHistory.set(call.file.norm, []);
            modifyHistory.get(call.file.norm).push({
              seq: call.seq,
              resultSeq: seq,
              turn: d.turn ?? call.turn,
              kind: call.name,
            });
          } else if (outcome.isErr) {
            const errKind = classifyEditError(outcome.code, outcome.text);
            if (errKind === 'FS_NOT_OBSERVED') {
              fsNotObserved.total++;
              const toolKey = String(call.name || '').toLowerCase();
              fsNotObserved.byTool[toolKey] = (fsNotObserved.byTool[toolKey] || 0) + 1;
              const lastRead = lastObservedBefore(readHistory.get(call.file?.norm), call.seq);
              let cause = 'never_read';
              if (!lastRead) {
                fsNotObserved.neverReadBefore++;
              } else {
                const hadComp = compactionEvents.some(c => c.seq > lastRead.resultSeq && c.seq < call.seq);
                const hadRestart = restartSeqs.some(r => r.seq > lastRead.resultSeq && r.seq < call.seq);
                if (hadComp && hadRestart) {
                  fsNotObserved.afterBothCompactionAndRestart++;
                  cause = 'compaction_and_restart';
                } else if (hadComp) {
                  fsNotObserved.afterCompactionOnly++;
                  cause = 'compaction_only';
                } else if (hadRestart) {
                  fsNotObserved.afterRestartOnly++;
                  cause = 'restart_only';
                } else {
                  fsNotObserved.readBeforeNeither++;
                  cause = 'other';
                }
              }
              if (fsNotObserved.samples.length < 20) {
                fsNotObserved.samples.push({
                  seq: call.seq,
                  resultSeq: seq,
                  turn: d.turn ?? call.turn,
                  tool: call.name,
                  file: call.file?.base ?? null,
                  lastReadSeq: lastRead?.seq ?? null,
                  cause,
                });
              }
            }
          }
        }
      }
    } else if (type === 'assistant/message' && !replaced) {
      // Also capture any tool-calls embedded in assistant/message in case tool/call wasn't emitted
      const content = d.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && (block.type === 'tool-call' || block.type === 'tool_use')) {
            const id = block.id ?? block.callId;
            if (id != null && !callById.has(String(id))) {
              callById.set(String(id), {
                id: String(id),
                name: block.name ?? '',
                seq,
                idx: i,
                turn: d.turn ?? null,
                step: d.step ?? null,
                time,
                file: extractFilePath(block.arguments ?? block.input),
              });
            }
          }
        }
      }

      const usage = extractUsage(d.usage);
      const turn = Number.isSafeInteger(d.turn) ? d.turn : null;
      let request = null;
      let drop = null;
      seenFirstRequest = true;
      if (usage) {
        const source = d.message?.source?.kind === 'model' ? d.message.source : null;
        const provider = source?.provider ?? currentRoute.provider;
        const model = source?.model ?? currentRoute.model;
        const step = Number.isSafeInteger(d.step) ? d.step : null;

        if (prevReq) {
          const gapSec = (time != null && prevReq.time != null) ? Math.max(0, (time - prevReq.time) / 1000) : null;
          const lostCacheTokens = prevReq.cacheReadTokens - usage.cacheReadTokens;
          const lostRatio = prevReq.cacheReadTokens > 0 ? lostCacheTokens / prevReq.cacheReadTokens : 0;
          const routeChanged = (provider && prevReq.provider && provider !== prevReq.provider)
            || (model && prevReq.model && model !== prevReq.model);

          if (prevReq.cacheReadTokens >= minPrevCacheTokens
            && lostCacheTokens >= minLostCacheTokens
            && lostRatio >= minLostCacheRatio) {
            let cause = 'unexplained';
            let boundarySeq = null;
            if (between.compactions.length > 0) {
              cause = 'compaction/summary';
              boundarySeq = between.compactions.at(-1).seq;
            } else if (between.pruneSeqs.length > 0) {
              cause = 'compaction/prune';
              boundarySeq = between.pruneSeqs[0];
            } else if (between.restartSeqs.length > 0) {
              cause = 'session/reload';
              boundarySeq = between.restartSeqs[between.restartSeqs.length - 1];
            } else if (routeChanged || between.headerSeqs.length > 0 || between.systemSeqs.length > 0) {
              cause = 'header/system';
              boundarySeq = between.headerSeqs[0] ?? between.systemSeqs[0] ?? null;
            } else if (gapSec !== null && gapSec >= idleTtlSec) {
              cause = 'idle-ttl';
            }
            const costInfo = routeChanged ? { cny: null, reason: 'route-change' } : extraCacheMissCost(lostCacheTokens, { provider, model, time });
            drop = {
              seq,
              prevSeq: prevReq.seq,
              turn,
              step,
              cause,
              boundarySeq,
              prevCacheRead: prevReq.cacheReadTokens,
              currCacheRead: usage.cacheReadTokens,
              lostCacheTokens,
              lostRatio,
              prevHitRatio: prevReq.cacheHitRatio,
              currHitRatio: usage.cacheHitRatio,
              gapSec: gapSec !== null ? Math.round(gapSec) : null,
              extraCostCny: costInfo.cny,
              extraCostReason: costInfo.reason,
              hadPruneBeforeSummary: cause === 'compaction/summary' && between.pruneSeqs.length > 0,
              betweenCompactionSeqs: between.compactions.map(comp => comp.seq),
              betweenPruneSeqs: [...between.pruneSeqs],
            };
          } else if (prevReq.cacheHitRatio !== null && usage.cacheHitRatio !== null
            && (prevReq.cacheHitRatio - usage.cacheHitRatio) >= 0.30
            && lostCacheTokens < minLostCacheTokens) {
            // Track ratio-only dilution separately so we never confuse it with prefix invalidation
            ratioDilutions.push({
              seq,
              turn,
              step,
              prevHitRatio: prevReq.cacheHitRatio,
              currHitRatio: usage.cacheHitRatio,
              prevCacheRead: prevReq.cacheReadTokens,
              currCacheRead: usage.cacheReadTokens,
              inputTokens: usage.inputTokens,
            });
          }
        }

        request = {
          index: requests.length,
          seq,
          turn,
          step,
          time,
          provider,
          model,
          ...usage,
          hadCompactionBefore: between.compactions.length > 0,
          hadPruneBefore: between.pruneSeqs.length > 0,
          hadReloadBefore: between.restartSeqs.length > 0,
          drop,
        };
        requests.push(request);
      }
      for (const comp of between.compactions) {
        comp.nextRequestSeq = seq;
        comp.nextRequestDrop = drop;
        comp.turn ??= turn;
      }
      requestBoundaries.push({ seq, idx: i, turn, drop });
      prevReq = request;
      between = requestInterval();
    }
  }

  // Group rawPrunes into prunePasses (all prunes occurring before the same next LLM request, or before a compaction)
  const prunePasses = [];
  if (rawPrunes.length > 0) {
    let pass = null;
    let requestIndex = 0, compactionIndex = 0;
    for (const pr of rawPrunes) {
      while (requestBoundaries[requestIndex]?.idx <= pr.idx) requestIndex++;
      while (compactionEvents[compactionIndex]?.idx <= pr.idx) compactionIndex++;
      const nextReq = requestBoundaries[requestIndex];
      const candidate = compactionEvents[compactionIndex];
      const nextComp = candidate && (!nextReq || candidate.idx < nextReq.idx) ? candidate : null;
      const bucketKey = `${nextReq?.seq ?? 'end'}:${nextComp?.seq ?? 'none'}`;
      if (!pass || pass._key !== bucketKey) {
        pass = {
          _key: bucketKey,
          index: prunePasses.length,
          seq: pr.seq,
          endSeq: pr.seq,
          turn: nextReq?.turn ?? pr.turn,
          time: pr.time,
          prunedCount: 0,
          shadowedTokenCount: 0,
          followedBySummary: Boolean(nextComp),
          summarySeq: nextComp?.seq ?? null,
          nextRequestSeq: nextReq?.seq ?? null,
          nextRequestDrop: nextReq?.drop ?? null,
          prunedReadFiles: [],
          _seenReadPaths: new Set(),
        };
        prunePasses.push(pass);
      }
      pass.endSeq = pr.seq;
      pass.prunedCount += 1;
      pass.shadowedTokenCount += pr.shadowedTokenCount;
      for (const sseq of pr.shadowedSeqs) {
        const tr = toolResultBySeq.get(sseq);
        if (tr && isReadTool(tr.call.name) && tr.call.file?.norm) {
          const norm = tr.call.file.norm;
          if (!pass._seenReadPaths.has(norm)) {
            pass._seenReadPaths.add(norm);
            const laterReads = (readHistory.get(norm) || []).filter(r => r.seq > pr.seq);
            const modification = laterReads.length ? lastObservedBefore(modifyHistory.get(norm), laterReads[0].seq) : null;
            pass.prunedReadFiles.push({
              path: tr.call.file.raw,
              basename: tr.call.file.base,
              originalSeq: tr.call.seq,
              originalResultSeq: sseq,
              reReadCount: laterReads.length,
              firstReReadSeq: laterReads[0]?.seq ?? null,
              firstReReadTurn: laterReads[0]?.turn ?? null,
              modifiedBeforeReRead: Boolean(modification && (modification.resultSeq ?? modification.seq) > sseq),
            });
          }
        }
      }
    }
    for (const p of prunePasses) {
      delete p._key;
      delete p._seenReadPaths;
    }
  }

  // Evaluate post-compaction window for each compaction summary
  for (const comp of compactionEvents) {
    let toolCallsSeen = 0;
    let readCalls = 0;
    let pureReReads = 0;
    let modifiedReReads = 0;
    let editCalls = 0;
    let editErrors = 0;
    const editErrorKinds = {};
    const reReadItems = [];

    for (let j = comp.idx + 1; j < list.length && toolCallsSeen < postCompactionWindow; j++) {
      const ev = list[j];
      if (!ev) continue;
      if (ev.type === 'compaction/summary') break;
      if (ev.type !== 'tool/result' || isReplacement(ev)) continue;
      const tr = toolResultBySeq.get(Number.isFinite(ev.seq) ? ev.seq : j);
      if (!tr || tr.call.idx <= comp.idx) continue;
      toolCallsSeen++;
      const { call, outcome } = tr;

      if (isReadTool(call.name)) {
        readCalls++;
        const prior = outcome.isErr ? null : lastObservedBefore(readHistory.get(call.file?.norm), comp.seq);
        if (prior) {
          const modification = lastObservedBefore(modifyHistory.get(call.file.norm), call.seq);
          const modifiedInBetween = Boolean(modification && (modification.resultSeq ?? modification.seq) > prior.resultSeq);
          if (modifiedInBetween) modifiedReReads++;
          else pureReReads++;
          reReadItems.push({
            path: call.file.raw,
            basename: call.file.base,
            priorReadSeq: prior.seq,
            priorReadTurn: prior.turn,
            postReadSeq: call.seq,
            postReadTurn: tr.turn,
            modifiedInBetween,
          });
        }
      } else if (isWriteOrEditTool(call.name)) {
        editCalls++;
        if (outcome.isErr) {
          editErrors++;
          const kind = classifyEditError(outcome.code, outcome.text);
          editErrorKinds[kind] = (editErrorKinds[kind] || 0) + 1;
        }
      }
    }

    comp.postWindow = {
      windowLimit: postCompactionWindow,
      toolCallsObserved: toolCallsSeen,
      readCalls,
      pureReReads,
      modifiedReReads,
      totalReReads: pureReReads + modifiedReReads,
      pureReReadRatio: readCalls > 0 ? pureReReads / readCalls : null,
      totalReReadRatio: readCalls > 0 ? (pureReReads + modifiedReReads) / readCalls : null,
      editCalls,
      editErrors,
      editErrorKinds,
      reReadItems,
    };
  }

  // Aggregate session-level summary
  const drops = requests.filter(r => r.drop).map(r => r.drop);
  const dropsByCause = {};
  let totalLostCacheTokens = 0;
  let totalExtraCostCny = 0;
  let pricedDropCount = 0;
  for (const d of drops) {
    dropsByCause[d.cause] = (dropsByCause[d.cause] || 0) + 1;
    totalLostCacheTokens += d.lostCacheTokens;
    if (typeof d.extraCostCny === 'number') {
      totalExtraCostCny += d.extraCostCny;
      pricedDropCount++;
    }
  }

  let totalCacheRead = 0;
  let totalUncachedInput = 0;
  for (const r of requests) {
    totalCacheRead += r.cacheReadTokens;
    totalUncachedInput += r.uncachedInputTokens ?? (r.inputTokens + (r.cacheWriteTokens ?? 0));
  }
  const totalPromptInput = totalCacheRead + totalUncachedInput;

  const postReadCalls = compactionEvents.reduce((s, c) => s + (c.postWindow?.readCalls ?? 0), 0);
  const postPureReReads = compactionEvents.reduce((s, c) => s + (c.postWindow?.pureReReads ?? 0), 0);
  const postModifiedReReads = compactionEvents.reduce((s, c) => s + (c.postWindow?.modifiedReReads ?? 0), 0);

  const allPrunedReads = prunePasses.flatMap(p => p.prunedReadFiles);
  const prunedReReadFiles = allPrunedReads.filter(f => f.reReadCount > 0);
  const prunedPureReReadFiles = prunedReReadFiles.filter(f => !f.modifiedBeforeReRead);
  const standalonePrunePasses = prunePasses.filter(p => !p.followedBySummary);
  const standalonePruneDrops = standalonePrunePasses.filter(p => p.nextRequestDrop?.cause === 'compaction/prune');
  const summarizerCalls = compactionEvents.filter(c => c.summaryUsage);
  const summarizerPrecededByPrune = summarizerCalls.filter(c => c.precededByPrune);

  const summary = {
    requestsWithUsage: requests.length,
    totalCacheReadTokens: totalCacheRead,
    totalUncachedInputTokens: totalUncachedInput,
    overallCacheHitRatio: totalPromptInput > 0 ? totalCacheRead / totalPromptInput : null,
    cacheDrops: drops.length,
    dropsByCause,
    ratioDilutions: ratioDilutions.length,
    totalLostCacheTokens,
    totalExtraCostCny: pricedDropCount > 0 ? totalExtraCostCny : null,
    pricedDropCount,
    compactions: compactionEvents.length,
    compactionPostReadCalls: postReadCalls,
    compactionPureReReads: postPureReReads,
    compactionModifiedReReads: postModifiedReReads,
    compactionPureReReadRatio: postReadCalls > 0 ? postPureReReads / postReadCalls : null,
    compactionTotalReReadRatio: postReadCalls > 0 ? (postPureReReads + postModifiedReReads) / postReadCalls : null,
    summarizerCallsWithUsage: summarizerCalls.length,
    summarizerPrecededByPrune: summarizerPrecededByPrune.length,
    prunePasses: prunePasses.length,
    rawPruneEvents: rawPrunes.length,
    standalonePrunePasses: standalonePrunePasses.length,
    standalonePruneCacheDrops: standalonePruneDrops.length,
    standalonePruneSavedTokens: standalonePrunePasses.reduce((s, p) => s + p.shadowedTokenCount, 0),
    standalonePruneLostCacheTokens: standalonePruneDrops.reduce((s, p) => s + (p.nextRequestDrop?.lostCacheTokens ?? 0), 0),
    prunedReadFiles: allPrunedReads.length,
    prunedReReadFiles: prunedReReadFiles.length,
    prunedPureReReadFiles: prunedPureReReadFiles.length,
    prunedReReadRatio: allPrunedReads.length > 0 ? prunedReReadFiles.length / allPrunedReads.length : null,
    fsNotObserved: {
      total: fsNotObserved.total,
      neverReadBefore: fsNotObserved.neverReadBefore,
      afterRestartOnly: fsNotObserved.afterRestartOnly,
      afterCompactionOnly: fsNotObserved.afterCompactionOnly,
      afterBothCompactionAndRestart: fsNotObserved.afterBothCompactionAndRestart,
      readBeforeNeither: fsNotObserved.readBeforeNeither,
    },
  };

  return {
    thresholds: { minPrevCacheTokens, minLostCacheTokens, minLostCacheRatio, idleTtlSec, postCompactionWindow },
    summary,
    requests,
    drops,
    ratioDilutions,
    compactions: compactionEvents,
    prunePasses,
    fsNotObserved,
  };
}
