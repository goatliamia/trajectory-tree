// Approval/policy evidence is independent of the recorded tool outcome.
// A successful call, escalation request or session mode is never an approval.
const noControls = Object.freeze([]);
const controlCodes = {
  APPROVAL_REJECTED: ['denied', 'approval'],
  APPROVAL_CANCELLED: ['cancelled', 'approval'],
  APPROVAL_UNAVAILABLE: ['unavailable', 'approval'],
  HOST_WORKTREE_GUARD: ['blocked', 'policy', 'worktree-isolation'],
  FS_NOT_OBSERVED: ['blocked', 'policy', 'file-observation'],
  FS_STALE_VERSION: ['blocked', 'policy', 'file-version'],
};
const controlPriority = ['blocked', 'denied', 'cancelled', 'unavailable', 'pending', 'unknown', 'approved'];

export function failureControls(call, { host, error = call.error, output = '' } = {}) {
  if (call.status !== 'error') return noControls;
  const attribution = call.attribution;
  const nativeCode = typeof error?.code === 'string' ? error.code : null;
  const attributedCode = attribution?.certainty === 'confirmed' &&
    (attribution.basis === 'native-code' || attribution.basis === 'claude-tool-result') ? attribution.code : null;
  const code = controlCodes[nativeCode] ? nativeCode : controlCodes[attributedCode] ? attributedCode : null;
  if (code) {
    const [state, kind, reason] = controlCodes[code];
    return [{ state, kind, ...(reason ? { reason } : {}), code, host,
      source: code === nativeCode ? 'native-code' : attribution.basis,
      seq: call.resultSeq ?? call.seq, evidence: String(attribution?.evidence || error?.message || code).slice(0, 1024) }];
  }
  if (host !== 'claude') return noControls;
  const text = String(output).trim();
  const body = text.replace(/^<tool_use_error>/, '').replace(/<\/tool_use_error>$/, '');
  const worktree = body.startsWith('This session is isolated in the worktree ') &&
    /Refusing to run it|Edit the worktree copy of this file instead of the shared-checkout path/.test(body);
  const hook = text.startsWith('PreToolUse:' + call.nativeName + ' hook error: This session is running in an isolated git worktree at ');
  return worktree || hook ? [{ state: 'blocked', kind: 'policy', reason: 'worktree-isolation', host,
    source: 'claude-tool-result', pattern: 'claude:worktree-boundary', seq: call.resultSeq ?? call.seq, evidence: text.slice(0, 1024) }] : noControls;
}

// DSH's durable audit protocol joins asked/decided by request ID, then joins the
// exact callId. Missing or ambiguous identities are counted, never time-matched.
export function applyApprovalControls(calls, events) {
  const byCall = new Map(), asks = new Map(), decisions = new Map();
  for (const call of calls) {
    if (!byCall.has(call.id)) byCall.set(call.id, []);
    byCall.get(call.id).push(call);
  }
  let mode;
  for (const event of events) {
    if (event.surfaceOp) continue;
    const value = event.data || {};
    if (event.type === 'approval/policy') mode = ['ask', 'allow', 'deny'].includes(value.policy) ? value.policy : undefined;
    if (event.type === 'approval/asked' && value.id && !asks.has(value.id)) asks.set(value.id, { event, mode });
    if (event.type === 'approval/decided' && value.id && !decisions.has(value.id)) decisions.set(value.id, event);
  }
  let linked = 0;
  for (const [id, { event: asked, mode }] of asks) {
    const candidates = byCall.get(asked.data.callId) || [];
    if (candidates.length !== 1 || candidates[0].name !== asked.data.toolName) continue;
    const call = candidates[0], decided = decisions.get(id);
    if (decided && decided.seq < asked.seq) continue;
    const outcome = decided?.data.outcome;
    const state = decided ? ({ 'allowed-once': 'approved', rejected: 'denied', cancelled: 'cancelled', unavailable: 'unavailable' })[outcome] || 'unknown' : 'pending';
    const signal = { state, kind: 'approval', host: 'dsh', source: decided ? 'approval/decided' : 'approval/asked',
      requestId: id, ...(mode ? { mode } : {}), ...(outcome ? { outcome } : {}),
      seq: decided?.seq ?? asked.seq, askedSeq: asked.seq, time: decided?.time ?? asked.time,
      evidence: String(asked.data.reason || '').slice(0, 1024) };
    call.controls = [...toolControls(call).filter(item => !(item.kind === 'approval' && !item.requestId && item.state === state)), signal];
    linked++;
  }
  return { requests: asks.size, linked, unlinked: asks.size - linked };
}

export function toolControls(call) {
  return Array.isArray(call.controls) ? call.controls : failureControls(call);
}
export function summarizeControls(calls) {
  const groups = new Map();
  for (const call of calls) for (const signal of toolControls(call)) {
    const key = [signal.state, signal.kind, signal.reason, signal.mode].join(':');
    if (!groups.has(key)) groups.set(key, { ...signal, count: 0 });
    groups.get(key).count++;
  }
  const items = [...groups.values()].sort((a, b) => controlPriority.indexOf(a.state) - controlPriority.indexOf(b.state));
  return items.length ? { primary: items[0], items } : null;
}
export function controlTitle(signal, locale) {
  const en = locale === 'en', index = en ? 1 : 0;
  const labels = { approved: ['已批准', 'Approved'], denied: ['未批准', 'Not approved'],
    blocked: ['策略拦截', 'Policy blocked'], cancelled: ['审批取消', 'Approval cancelled'],
    unavailable: ['审批不可用', 'Approval unavailable'], pending: ['等待审批', 'Awaiting approval'], unknown: ['审批结果未知', 'Approval outcome unknown'] };
  const reasons = { 'worktree-isolation': ['工作区隔离', 'Worktree isolation'], 'file-observation': ['文件观测保护', 'File observation guard'], 'file-version': ['文件版本保护', 'File version guard'] };
  const label = (labels[signal.state] || labels.unknown)[index];
  const reason = reasons[signal.reason]?.[index] || (['allow', 'deny'].includes(signal.mode) ? (en ? 'Automatic policy' : '自动审批策略') : '');
  return label + (reason ? ' · ' + reason : '');
}
export function controlSummaryTitle(summary, locale) {
  return summary.items.map(item => controlTitle(item, locale) + (item.count > 1 ? ' ×' + item.count : '')).join('；');
}
