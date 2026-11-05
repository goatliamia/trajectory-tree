// 目标的创建/结束由宿主记录成 goal/change 事件,而 observeSession 返回的
// 事件流里没有它们。这里直接从持久化句柄读一次原始日志,按 revision 缓存,
// 同一 revision 的重复请求不再重读——这是"不重复读取"的唯一入口。
const cache = new Map();
const LIMIT = 4;

export async function readGoalChanges(ctx, sessionId) {
  const persistence = ctx.get('sessionPersistence');
  if (!persistence || typeof persistence.open !== 'function') return [];
  const key = sessionId;
  const hit = cache.get(key);
  if (hit && hit.fresh) return hit.events;
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
    cache.set(key, { fresh: true, events });
    while (cache.size > LIMIT) cache.delete(cache.keys().next().value);
    return events;
  } catch {
    return hit ? hit.events : [];
  } finally {
    try { if (handle && typeof handle.close === 'function') await handle.close(); } catch { /* ignore */ }
  }
}

// 新 revision 到来时让旧缓存失效。
export function invalidateGoalCache(sessionId) {
  if (sessionId) cache.delete(sessionId);
  else cache.clear();
}
