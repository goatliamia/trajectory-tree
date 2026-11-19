import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDshCacheCompaction } from '../lib/dsh-cache-compaction.mjs';

const T0 = Date.UTC(2026, 10, 18, 2, 0, 0); // 10:00 Beijing weekday (peak)

test('distinguishes ratio dilution from genuine prefix cache drop and attributes prune/summary/reload', () => {
  const events = [
    { seq: 1, time: T0, type: 'request/header', data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-pro' } } } },
    { seq: 2, time: T0 + 1000, type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 2000, cacheReadTokens: 80000, outputTokens: 200 }, message: { role: 'assistant', content: [] } } },
    // Dilution only: cacheRead stays 80k, input jumps to 60k -> ratio drops 97.6% -> 57.1% but NOT a prefix cache drop!
    { seq: 3, time: T0 + 5000, type: 'assistant/message', data: { turn: 1, step: 2, usage: { inputTokens: 60000, cacheReadTokens: 80000, outputTokens: 200 }, message: { role: 'assistant', content: [] } } },
    // Read file A and file B
    { seq: 4, time: T0 + 6000, type: 'tool/call', data: { turn: 1, step: 2, callId: 'r1', name: 'read', arguments: JSON.stringify({ file_path: 'src/a.js' }) } },
    { seq: 5, time: T0 + 6200, type: 'tool/result', data: { turn: 1, step: 2, message: { toolCallId: 'r1', content: [{ type: 'text', text: 'file a' }], isError: false } } },
    { seq: 6, time: T0 + 6300, type: 'tool/call', data: { turn: 1, step: 2, callId: 'r2', name: 'read', arguments: JSON.stringify({ file_path: 'src/b.js' }) } },
    { seq: 7, time: T0 + 6500, type: 'tool/result', data: { turn: 1, step: 2, message: { toolCallId: 'r2', content: [{ type: 'text', text: 'file b' }], isError: false } } },
    // Prune pass (two pruned nodes before next request) -> busts cache 80k -> 5k!
    { seq: 8, time: T0 + 10000, type: 'compaction/prune', data: { shadowedSeqs: [5], shadowedTokenCount: 6000 } },
    { seq: 9, time: T0 + 10001, type: 'compaction/prune', data: { shadowedSeqs: [7], shadowedTokenCount: 4000 } },
    { seq: 10, time: T0 + 15000, type: 'assistant/message', data: { turn: 2, step: 1, usage: { inputTokens: 120000, cacheReadTokens: 5000, outputTokens: 300 }, message: { role: 'assistant', content: [] } } },
    // Edit file B successfully
    { seq: 11, time: T0 + 16000, type: 'tool/call', data: { turn: 2, step: 1, callId: 'e1', name: 'edit', arguments: JSON.stringify({ file_path: 'src/b.js' }) } },
    { seq: 12, time: T0 + 16200, type: 'tool/result', data: { turn: 2, step: 1, message: { toolCallId: 'e1', content: [{ type: 'text', text: 'ok' }], isError: false } } },
    // Cache warms up again
    { seq: 13, time: T0 + 20000, type: 'assistant/message', data: { turn: 2, step: 2, usage: { inputTokens: 1000, cacheReadTokens: 110000, outputTokens: 100 }, message: { role: 'assistant', content: [] } } },
    // Prune followed by Compaction Summary
    { seq: 14, time: T0 + 25000, type: 'compaction/prune', data: { shadowedSeqs: [5], shadowedTokenCount: 2000 } },
    { seq: 15, time: T0 + 25005, type: 'compaction/start', data: { turn: 2, compactionId: 'c1' } },
    { seq: 16, time: T0 + 28000, type: 'compaction/summary', data: {
      compactionId: 'c1', shadowedTokenCount: 95000, shadowedSeqs: [2, 3, 4, 5],
      summary: [{ type: 'text', text: 'Summary of work done on src/a.js and src/b.js.' }],
      usage: { inputTokens: 90000, cacheReadTokens: 10000, outputTokens: 500 },
    } },
    { seq: 17, time: T0 + 30000, type: 'assistant/message', data: { turn: 2, step: 3, usage: { inputTokens: 18000, cacheReadTokens: 6000, outputTokens: 200 }, message: { role: 'assistant', content: [] } } },
    // Post-compaction reads: file A (unmodified -> pure re-read) and file B (modified at seq 11 -> modified re-read)
    { seq: 18, time: T0 + 31000, type: 'tool/call', data: { turn: 2, step: 3, callId: 'r3', name: 'read', arguments: JSON.stringify({ file_path: 'src/a.js' }) } },
    { seq: 19, time: T0 + 31200, type: 'tool/result', data: { turn: 2, step: 3, message: { toolCallId: 'r3', content: [{ type: 'text', text: 'file a' }], isError: false } } },
    { seq: 20, time: T0 + 31300, type: 'tool/call', data: { turn: 2, step: 3, callId: 'r4', name: 'read', arguments: JSON.stringify({ file_path: 'src/b.js' }) } },
    { seq: 21, time: T0 + 31500, type: 'tool/result', data: { turn: 2, step: 3, message: { toolCallId: 'r4', content: [{ type: 'text', text: 'file b updated' }], isError: false } } },
    // Session reload -> FS_NOT_OBSERVED on file A (was read at seq 18 before reload)
    { seq: 22, time: T0 + 40000, type: 'session/end-seed', data: {} },
    { seq: 23, time: T0 + 41000, type: 'tool/call', data: { turn: 3, step: 1, callId: 'e2', name: 'edit', arguments: JSON.stringify({ file_path: 'src/a.js' }) } },
    { seq: 24, time: T0 + 41100, type: 'tool/result', data: { turn: 3, step: 1, message: { toolCallId: 'e2', content: [{ type: 'text', text: 'cannot modify "src/a.js": file has not been read' }], isError: true }, error: { code: 'FS_NOT_OBSERVED' } } },
    // Never-read file C -> FS_NOT_OBSERVED
    { seq: 25, time: T0 + 41200, type: 'tool/call', data: { turn: 3, step: 1, callId: 'e3', name: 'edit', arguments: JSON.stringify({ file_path: 'src/c.js' }) } },
    { seq: 26, time: T0 + 41300, type: 'tool/result', data: { turn: 3, step: 1, message: { toolCallId: 'e3', content: [{ type: 'text', text: 'FS_NOT_OBSERVED' }], isError: true }, error: { code: 'FS_NOT_OBSERVED' } } },
  ];

  const res = analyzeDshCacheCompaction(events);

  assert.equal(res.summary.ratioDilutions, 1);
  assert.equal(res.summary.cacheDrops, 2);
  assert.equal(res.summary.dropsByCause['compaction/prune'], 1);
  assert.equal(res.summary.dropsByCause['compaction/summary'], 1);

  // Prune pass 0: standalone, saved 10k across 2 results, lost 75k cacheRead, peak v4-pro extra cost = 75k/1e6 * (9 - 0.3) = 0.6525 CNY
  assert.equal(res.prunePasses.length, 2);
  assert.equal(res.prunePasses[0].followedBySummary, false);
  assert.equal(res.prunePasses[0].prunedCount, 2);
  assert.equal(res.prunePasses[0].shadowedTokenCount, 10000);
  assert.equal(res.prunePasses[0].nextRequestDrop.lostCacheTokens, 75000);
  assert.ok(Math.abs(res.prunePasses[0].nextRequestDrop.extraCostCny - 0.6525) < 1e-6);
  assert.equal(res.prunePasses[0].prunedReadFiles.length, 2);
  assert.equal(res.prunePasses[0].prunedReadFiles[0].reReadCount, 1);
  assert.equal(res.prunePasses[0].prunedReadFiles[0].modifiedBeforeReRead, false);
  assert.equal(res.prunePasses[0].prunedReadFiles[1].modifiedBeforeReRead, true);

  // Compaction summary: preceded by prune, pureReReads = 1 (a.js), modifiedReReads = 1 (b.js)
  assert.equal(res.compactions.length, 1);
  assert.equal(res.compactions[0].precededByPrune, true);
  assert.equal(res.compactions[0].summaryUsage.cacheReadTokens, 10000);
  assert.equal(res.compactions[0].postWindow.pureReReads, 1);
  assert.equal(res.compactions[0].postWindow.modifiedReReads, 1);

  // FS_NOT_OBSERVED: 1 afterRestartOnly (a.js), 1 neverReadBefore (c.js), 0 afterCompactionOnly
  assert.equal(res.fsNotObserved.total, 2);
  assert.equal(res.fsNotObserved.afterRestartOnly, 1);
  assert.equal(res.fsNotObserved.neverReadBefore, 1);
  assert.equal(res.fsNotObserved.afterCompactionOnly, 0);
});

test('preserves legacy summaries and does not compare cache across missing usage', () => {
  const observed = (seq, cacheReadTokens) => ({ seq, type: 'assistant/message', data: { usage: { inputTokens: 100, cacheReadTokens } } });
  const result = analyzeDshCacheCompaction([
    observed(1, 20_000),
    { seq: 2, type: 'compaction/start', data: { compactionId: 'first', turn: 1 } },
    { seq: 3, type: 'compaction/start', data: { compactionId: 'second', turn: 1 } },
    { seq: 4, type: 'compaction/summary', data: { compactionId: 'first' } },
    { seq: 5, type: 'compaction/prune', data: { shadowedTokenCount: 25 } },
    { seq: 6, type: 'assistant/message', data: { turn: 1 } },
    observed(7, 1_000),
  ]);
  assert.equal(result.compactions[0].startSeq, 2);
  assert.equal(result.compactions[0].nextRequestSeq, 6);
  assert.equal(result.prunePasses[0].nextRequestSeq, 6);
  assert.deepEqual(result.drops, []);

  const legacy = analyzeDshCacheCompaction([{ seq: 1, type: 'compaction/summary', data: { summary: 'retained' } }]);
  assert.equal(legacy.compactions[0].startSeq, null);
  assert.ok(legacy.compactions[0].summaryEstimatedTokens > 0);
});

test('post-compaction rereads require successful matching reads on either side', () => {
  const call = (seq, id, path) => ({ seq, type: 'tool/call', data: { callId: id, name: 'read', arguments: { path } } });
  const result = (seq, id, isError = false) => ({ seq, type: 'tool/result', data: { callId: id, isError, content: 'FS_NOT_OBSERVED literal' } });
  const cache = analyzeDshCacheCompaction([
    call(1, 'case', '/project/File.js'), result(2, 'case'),
    call(3, 'valid', '/project/valid.js'), result(4, 'valid'),
    call(5, 'late', '/project/late.js'),
    { seq: 6, type: 'compaction/start', data: { compactionId: 'c' } },
    { seq: 7, type: 'compaction/summary', data: { compactionId: 'c' } },
    result(8, 'late'),
    call(9, 'failed', '/project/valid.js'), result(10, 'failed', true),
    call(11, 'different', '/project/file.js'), result(12, 'different'),
    call(13, 'later', '/project/late.js'), result(14, 'later'),
    call(15, 'reread', '/project/valid.js'), result(16, 'reread'),
  ]);
  assert.equal(cache.compactions[0].postWindow.pureReReads, 1);
  assert.deepEqual(cache.compactions[0].postWindow.reReadItems.map(item => item.postReadSeq), [15]);
});

test('pruned read failures do not count as discarded file observations', () => {
  const call = (seq, id, path) => ({ seq, type: 'tool/call', data: { callId: id, name: 'read', arguments: { path } } });
  const result = (seq, id, isError = false) => ({ seq, type: 'tool/result', data: { callId: id, isError } });
  const cache = analyzeDshCacheCompaction([
    call(1, 'failed', '/project/missing.js'), result(2, 'failed', true),
    call(3, 'read', '/project/seen.js'), result(4, 'read'),
    { seq: 5, type: 'compaction/prune', data: { shadowedSeqs: [2, 4], shadowedTokenCount: 100 } },
    call(6, 'first-success', '/project/missing.js'), result(7, 'first-success'),
    call(8, 'reread', '/project/seen.js'), result(9, 'reread'),
  ]);
  assert.deepEqual(cache.prunePasses[0].prunedReadFiles.map(row => [row.originalResultSeq, row.firstReReadSeq]), [[4, 8]]);
  assert.equal(cache.summary.prunedReadFiles, 1);
  assert.equal(cache.summary.prunedReReadFiles, 1);
});
