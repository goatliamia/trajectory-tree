// 目标的创建/结束由宿主记录成 goal/change 事件,而 observeSession 返回的
// 事件流里没有它们。缓存复用 trace-cache 的源身份与 revision；
// 未知版本不复用,已知旧版本也不能作为读取失败时的替代数据。
import { persistenceSource, observationSource, sameSource } from './trace-cache.js';

const cache = new Map();
const LIMIT = 4;

export async function readGoalChanges(ctx, sessionId, toSeq, expectedSource) {
  const persistence = ctx.get('sessionPersistence');
  if (!persistence || typeof persistence.open !== 'function') return [];
  const key = sessionId;
  const source = await persistenceSource(ctx, sessionId);
  const withinCut = events => Number.isSafeInteger(toSeq) ? events.filter(event => event.seq <= toSeq) : events;
  const matchesCut = captured => !expectedSource || Number.isSafeInteger(toSeq) || sameSource(expectedSource, captured);
  const hit = cache.get(key);
  if (hit && sameSource(hit.source, source)) return matchesCut(hit.source) ? withinCut(hit.events) : [];
  let handle;
  try {
    handle = await persistence.open(sessionId, 'read');
    const result = await handle.read(0, undefined);
    const events = (result?.events || [])
      .filter(e => e && e.type === 'goal/change' && e.data && e.data.goal)
      .map(e => ({
        seq: e.seq, time: e.time,
        goalId: e.data.goal.id ?? null,
        operation: e.data.operation ?? null,
        phase: e.data.goal.phase ?? null,
        revision: e.data.goal.revision ?? null,
        roundsStarted: Number.isFinite(e.data.roundsStarted) ? e.data.roundsStarted : null,
        maxGoalRounds: Number.isFinite(e.data.goal.maxGoalRounds) ? e.data.goal.maxGoalRounds : null,
        createdAt: e.data.createdAt ?? null,
      }));
    const after = await persistenceSource(ctx, sessionId);
    const captured = observationSource(ctx, result || {}, null)
      || (sameSource(source, after) ? source : null);
    // A slow older read cannot replace a result installed in the meantime.
    if (captured && cache.get(key) === hit) {
      cache.set(key, { source: captured, events });
      while (cache.size > LIMIT) cache.delete(cache.keys().next().value);
    }
    return matchesCut(captured) ? withinCut(events) : [];
  } catch {
    return [];
  } finally {
    try { if (handle && typeof handle.close === 'function') await handle.close(); } catch { /* ignore */ }
  }
}

// 新 revision 到来时让旧缓存失效。
export function invalidateGoalCache(sessionId) {
  if (sessionId) cache.delete(sessionId);
  else cache.clear();
}
