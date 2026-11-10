import path from 'node:path';
import { eventTurnIndex } from '../../eval-evidence.js';

const span = (start, end) => Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
const replacement = event => event.surfaceOp && typeof event.surfaceOp === 'object';
const goalPhases = new Set(['active', 'complete', 'paused', 'blocked']);

export function projectWorkEvidence(events, turns) {
  const turnOf = eventTurnIndex(events);
  const pointer = event => ({ seq: event.seq, at: event.time, turn: turnOf.get(event.seq) ?? null });
  const goals = new Map(), deliveries = [], children = new Map(), compactions = new Map();
  for (const event of events) {
    if (replacement(event)) continue;
    const d = event.data ?? {};
    if (event.type === 'goal/change') {
      const id = d.goal?.id ?? d.cleared?.id;
      if (typeof id !== 'string') continue;
      const phase = d.operation === 'clear' ? 'cleared' : goalPhases.has(d.goal?.phase) ? d.goal.phase : 'other';
      const change = { ...pointer(event), phase, operation: d.operation ?? null };
      if (!goals.has(id) && d.operation === 'create') goals.set(id, { ...change, changes: [] });
      const goal = goals.get(id);
      if (goal) {
        goal.phase = phase;
        goal.changes.push(change);
      }
    } else if (event.type === 'deliverables/presented') {
      const files = Array.isArray(d.files) ? d.files : [];
      const names = files.map(file => typeof file?.path === 'string' ? path.win32.basename(file.path) : '')
        .filter(Boolean).slice(0, 8);
      deliveries.push({ ...pointer(event), files: files.length, names });
    } else if (event.type === 'subagent/catalog' && typeof d.childId === 'string') {
      if (!children.has(d.childId)) children.set(d.childId, { ...pointer(event), report: null, reports: 0 });
    } else if (event.type === 'user/message' && d.source?.kind === 'subagent-settled') {
      const child = children.get(d.source.senderSessionId);
      if (child) {
        child.report ??= pointer(event);
        child.reports++;
      }
    } else if (event.type === 'compaction/start' && typeof d.compactionId === 'string') {
      if (!compactions.has(d.compactionId)) {
        compactions.set(d.compactionId, { ...pointer(event), end: null, summary: null, error: false });
      }
    } else if (event.type === 'compaction/summary' || event.type === 'compaction/end') {
      const compaction = compactions.get(d.compactionId);
      if (!compaction) continue;
      if (event.type === 'compaction/summary') compaction.summary ??= pointer(event);
      if (event.type === 'compaction/end' && !compaction.end) {
        compaction.end = pointer(event);
        compaction.error = Boolean(d.error);
      }
    }
  }

  const requests = turns.flatMap(turn => turn.requests.map(request => ({
    seq: request.seq, turn: turn.no, input: request.input, model: request.model,
  }))).sort((a, b) => a.seq - b.seq);
  const windows = new Map();
  for (const action of compactions.values()) {
    const prior = requests.findLastIndex(request => request.seq < action.seq);
    const before = requests[prior] ?? null;
    const after = action.end ? requests.find(request => request.seq > action.end.seq) ?? null : null;
    const comparable = !action.error && before?.model > 0 && before.model === after?.model
      && after === requests[prior + 1] && Number.isFinite(before.input) && Number.isFinite(after.input);
    const key = comparable ? `${before.seq}:${after.seq}` : String(action.seq);
    if (!windows.has(key)) {
      windows.set(key, { seq: action.seq, at: action.at, turn: action.turn, before, after, comparable, actions: [] });
    }
    windows.get(key).actions.push({ ...action, elapsed: span(action.at, action.end?.at) });
  }
  return {
    goals: [...goals.values()], deliveries,
    children: [...children.values()].map(child => ({ ...child, elapsed: span(child.at, child.report?.at),
      parentReplies: child.report ? requests.filter(request => request.seq > child.seq && request.seq < child.report.seq).length : null })),
    compactions: [...windows.values()],
  };
}
