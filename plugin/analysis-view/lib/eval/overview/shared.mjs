import { failureCategories, failureCategoryIndex, failureCondition } from '../../trace/shared/tool-attribution.mjs';

export const valid = value => Number.isFinite(value) && value >= 0;
export const span = (start, end) => valid(start) && valid(end) && end >= start ? end - start : null;
export const startSeq = call => call.inner ? call.startSeq : call.seq;

export function createOverviewModels() {
  const routes = new Map(), models = [{ provider: '', name: '未记录路由' }];
  const index = source => {
    if (!source?.model) return 0;
    const provider = source.provider ?? '';
    const key = JSON.stringify([provider, source.model]);
    if (!routes.has(key)) {
      routes.set(key, models.length);
      models.push({ provider, name: source.model });
    }
    return routes.get(key);
  };
  return { models, index };
}

export const overviewCategories = failureCategories.map(([name]) => name);

export function errorsForTurn(episodes, calls, { portable = false } = {}) {
  const bySeq = new Map(calls.map(call => [call.seq, call]));
  const starts = calls.filter(call => startSeq(call) != null).sort((a, b) => startSeq(a) - startSeq(b));
  const episodeByFailure = new Map(), returns = new Map();
  for (const episode of episodes) {
    for (const seq of episode.failureSeqs) episodeByFailure.set(seq, episode);
    for (const pair of episode.pairs) returns.set(pair.failedSeq, pair.successSeq);
  }
  return calls.filter(call => call.status === 'error').map(call => {
    const episode = episodeByFailure.get(call.seq);
    const returned = bySeq.get(returns.get(call.seq));
    const next = !portable && starts.find(row => startSeq(row) > call.resultSeq);
    const code = failureCondition(call.attribution, episode?.condition ?? call.error?.code);
    const recovery = portable ? episode?.failureSeqs.length === 1 ? episode.continuationMs ?? null : null
      : span(call.end, returned?.end);
    return {
      category: failureCategoryIndex(code), code: code === 'TOOL_ERROR' ? null : code,
      tool: call.name, failed: call.resultSeq ?? call.seq, attribution: call.attribution,
      returned: returned?.resultSeq ?? null, recovery: returned ? recovery : null,
      next: next ? { seq: startSeq(next), name: next.name,
        kind: next.signature === call.signature ? 'same' : next.name === call.name ? 'changed' : 'other' } : null,
    };
  }).sort((a, b) => a.failed - b.failed);
}
