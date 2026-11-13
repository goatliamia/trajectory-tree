// 「执行路径」页面的数据补充:上下文层、重试、文件操作、Skill 与子代理。
// Everything is derived from the recorded log and the host's surface APIs.

import { buildTracePayload } from "./trace-build.js";
import { describeCall } from "./trace/models/step-insight.mjs";
import { describeOperation } from "./trace/models/tool-operation-model.mjs";
import { collectToolResults } from "./trace/models/tool-result-model.mjs";
import { replaySkillEvidence } from "./trace-skill-evidence.js";

const fullCall = (call, native, result) => {
  const args = native?.data?.arguments;
  const blocks = result?.data?.message?.content ?? result?.data?.content;
  return {
    ...call,
    args: args === undefined ? call.args : { text: typeof args === "string" ? args : JSON.stringify(args), omitted: 0 },
    result: Array.isArray(blocks)
      ? { text: blocks.filter(b => b?.type === "text").map(b => b.text || "").join("\n"), omitted: 0 }
      : call.result,
  };
};

export function traceRequestLayer(events, series) {
  // 压缩与裁短分开记:压缩是摘要替换,裁短是工具返回被就地替换。
  const boundaries = events.filter(event => event.type === "compaction/start").map(event => ({
    seq: event.seq, time: event.time, kind: "compaction",
    turn: event.data?.turn ?? null, step: event.data?.step ?? null,
  }));
  const prunes = events.filter(event => event.type === "compaction/prune");
  const bySeq = prunes.length ? new Map(events.map(event => [event.seq, event])) : null;
  const calls = prunes.length ? new Map(events.filter(event => event.type === "tool/call").map(event => [event.data.callId, event])) : null;
  for (const event of prunes) {
    const shadowed = event.data?.shadowedSeqs;
    if (!Array.isArray(shadowed) || !shadowed.length) continue;
    const replaced = shadowed.map(seq => {
      const source = bySeq.get(seq)?.data?.message?.source;
      const call = source?.kind === "tool" ? calls.get(source.callId) : null;
      return { seq, turn: call?.data?.turn ?? null, step: call?.data?.step ?? null, tool: call?.data?.name ?? null };
    });
    boundaries.push({ seq: event.seq, time: event.time, kind: "prune",
      turn: event.data?.turn ?? null, step: event.data?.step ?? null,
      tools: [...new Set(replaced.map(r => r.tool).filter(Boolean))], replaced });
  }
  boundaries.sort((a, b) => a.seq - b.seq);
  return { boundaries, requests: series?.requests.filter(row => Number.isFinite(row.total)) ?? [],
    ...(series?.current ? { current: series.current } : {}), ...(series?.route ? { route: series.route } : {}) };
}

export function traceContextDetails(events, payload) {
  const session = payload.sessions[0];
  const bySeq = new Map(events.filter(e => Number.isFinite(e.seq)).map(e => [e.seq, e]));

  const callFacts = {}, fileOperations = [];
  for (const turn of session.turns) for (const step of turn.steps) for (const call of step.calls) {
    const native = bySeq.get(call.seq), result = bySeq.get(call.resultSeq);
    const full = fullCall(call, native, result), fact = describeCall(full);
    let args = native?.data?.arguments;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = null; } }
    const operation = describeOperation(call, args, full.result?.text || '', result?.data?.meta, session.source?.cwd);
    callFacts[call.seq] = { ...fact,
      title: operation.family === 'other' ? fact.title : operation.title + (operation.subject ? ' · ' + operation.subject : ''),
      outcome: fact.tone === 'bad' || fact.tone === 'unknown' || operation.family === 'other' ? fact.outcome : operation.summary,
      operation: { family: operation.family, subject: operation.subject, metrics: operation.metrics,
        search: operation.search ? { total: operation.search.total, shown: operation.search.shown, truncated: operation.search.truncated } : null } };
    // Search only associates actual returned match lines. It does not establish
    // a full-file read or the runtime's fs-observed permission proof.
    for (const file of operation.files) fileOperations.push({
      turn: turn.number, step: step.number, seq: call.seq, resultSeq: call.resultSeq,
      time: call.end ?? call.start, kind: file.access === 'write' ? 'change' : 'read', path: file.path,
      tool: call.name, status: call.status, access: file.access, matchLines: file.lines?.length || 0,
      recordedPath: typeof result?.data?.meta?.path === "string",
    });
  }

  // 重试:llm/retry 只表示安排重试,llm/retry-started 才确认开始。
  const retryStarted = events.filter(e => e.type === "llm/retry-started")
    .map(e => ({ seq: e.seq, time: e.time, ...e.data }));
  const retries = events.filter(e => e.type === "llm/retry").map(e => {
    const start = retryStarted.find(r => r.retryId === e.data.retryId && r.retry === e.data.retry && r.seq > e.seq);
    const responded = Boolean(start && events.some(r => r.type === "assistant/message" && typeof r.surfaceOp !== "object"
      && r.seq > start.seq && r.data?.turn === e.data.turn && r.data?.step === e.data.step));
    return { seq: e.seq, time: e.time, turn: e.data.turn, step: e.data.step, delayMs: e.data.delayMs || 0,
      failure: { code: e.data.failure?.code || "UNKNOWN" }, started: Boolean(start), responded, startedSeq: start?.seq ?? null };
  });

  const supplement = new Map();
  for (const event of events) {
    if (event.type !== "user/message" && event.type !== "developer/message") continue;
    const kind = (event.data.source || event.data.message?.source)?.kind;
    if (!kind || kind === "user" || kind === "skill-catalog" || kind === "skill-invocation") continue;
    supplement.set(kind, (supplement.get(kind) || 0) + 1);
  }
  const supplementSources = [...supplement].map(([kind, count]) => ({ kind, count }));

  const context = { callFacts, fileOperations, retryStarted, retries, supplementSources, skillEvents: skillEvents(events, session) };
  // 目标从工具调用还原:create_goal / get_goal / update_goal 的参数与返回里就有目标字段。
  // 观察事件流不含 goal/change,所以以调用记录为准。
  const goalCalls = [];
  for (const turn of session.turns || []) for (const step of turn.steps || []) for (const call of step.calls || []) {
    if (!call || !['create_goal', 'get_goal', 'update_goal'].includes(call.name)) continue;
    let payloadGoal = null;
    const text = call.result?.text;
    if (typeof text === 'string' && text.trim().startsWith('{')) {
      try { payloadGoal = JSON.parse(text).goal || null; } catch { payloadGoal = null; }
    }
    let args = {};
    if (typeof call.args?.text === 'string') { try { args = JSON.parse(call.args.text); } catch { args = {}; } }
    else if (call.args && typeof call.args === 'object') args = call.args;
    goalCalls.push({ turn: turn.number, step: step.number, seq: call.seq, time: call.start, name: call.name, args, goal: payloadGoal });
  }
  if (goalCalls.length) {
    const withGoal = goalCalls.filter(c => c.goal);
    const last = withGoal.length ? withGoal[withGoal.length - 1].goal : null;
    context.goal = {
      id: last?.id ?? null,
      objective: last?.objective ?? '',
      phase: last?.phase ?? null,
      roundsStarted: Number.isFinite(last?.roundsStarted) ? last.roundsStarted : null,
      maxGoalRounds: Number.isFinite(last?.maxGoalRounds) ? last.maxGoalRounds : null,
      goals: [...new Map(goalCalls.filter(x => x.goal).map(x => [x.goal.id, { id: x.goal.id, objective: x.goal.objective || '', phase: x.goal.phase || null, roundsStarted: x.goal.roundsStarted ?? null, maxGoalRounds: x.goal.maxGoalRounds ?? null }])).values()],
      markers: goalCalls.map(c => ({ seq: c.seq, time: c.time, turn: c.turn, step: c.step, roundsStarted: c.goal?.roundsStarted ?? null, maxGoalRounds: c.goal?.maxGoalRounds ?? null,
        goalId: c.goal?.id ?? c.args.goal_id ?? null, objective: c.goal?.objective ?? null,
        operation: c.name === 'update_goal' ? (c.args.action || 'update') : c.name === 'create_goal' ? 'create' : 'read',
        phase: c.goal?.phase ?? null, revision: c.goal?.revision ?? c.args.revision ?? null })),
    };
  }
  return context;
}

/** The layers the page can derive from recorded events alone. */
export function traceContext(events, payload, series) {
  return { ...traceRequestLayer(events, series), ...traceContextDetails(events, payload) };
}

/** Skill 的读入记录:目录、显式引用,以及 skill 工具真实返回的正文。 */
export function skillEvents(events, session) {
  const locate = time => {
    const turn = session.turns.find(t => time <= (t.end ?? Infinity)) || session.turns.at(-1);
    const step = turn?.steps.find(s => time <= s.end) || turn?.steps.at(-1);
    return { turn: turn?.number, step: step?.number };
  };
  const records = [];
  for (const event of events) {
    const source = event.data?.source || event.data?.message?.source;
    if (!["skill-catalog", "skill-invocation"].includes(source?.kind)) continue;
    records.push({ id: "skill:" + event.seq, seq: event.seq, time: event.time, ...locate(event.time),
      source: "dsh-record", kind: source.kind === "skill-catalog" ? "catalog" : "explicit-skill-reference",
      name: source.name, entries: (source.entries || []).map(s => ({ name: s.name, description: s.description })) });
  }
  for (const turn of session.turns) for (const step of turn.steps) for (const call of step.calls) {
    if (call.name !== "skill" || call.status !== "returned") continue;
    const name = call.result?.text?.match(/<skill_content\s+name="([^"]+)"/)?.[1];
    if (!name) continue;
    records.push({ id: "skill-tool:" + call.seq, seq: call.seq, resultSeq: call.resultSeq,
      time: call.end ?? call.start, turn: turn.number, step: step.number, name, kind: "skill-tool-load",
      status: "returned", source: "dsh-skill-tool",
      baseDirectory: call.result.text.match(/Base directory for this skill:\s*([^\r\n]+)/)?.[1] || null });
  }
  records.sort((a, b) => a.time - b.time || a.seq - b.seq);
  return records;
}

/**
 * Skill 正文在模型可见历史里的存续区间,以及子代理支线。
 * Child sessions are read through the same Session query service as the main one.
 */
export async function traceActors(events, payload, skillRecords, readEvents, { inheritedEventCount } = {}) {
  const session = payload.sessions[0];
  const until = events.at(-1)?.time ?? Date.now();
  const requestSeqs = events.filter(e => e.type === "request/header").map(e => e.seq);
  let skillAnalysis = null;
  try {
    // 官方 surface 回放只在 Skill 层用到;拿不到安装目录时其余层照常工作。
    const loads = skillRecords.filter(e => e.kind === "skill-tool-load");
    const SurfaceManager = loads.length ? (await import("@deepseek-ai/dsh-session/surface")).SurfaceManager : undefined;
    skillAnalysis = replaySkillEvidence(events, loads, requestSeqs, SurfaceManager);
  } catch {
    skillAnalysis = null;
  }

  const ownCatalogs = (rows, floor) => {
    const firstOwn = Number.isSafeInteger(floor) && floor >= 0 ? floor : (rows.findLast(e => e.type === "session/end-seed")?.seq ?? -1) + 1;
    return rows.filter(e => e.type === "subagent/catalog" && e.seq >= firstOwn
      && typeof e.data?.childId === "string" && /^[a-zA-Z0-9-]+$/.test(e.data.childId));
  };
  const catalogs = ownCatalogs(events, inheritedEventCount);
  const launches = session.turns.flatMap(t => t.steps.flatMap(s =>
    s.calls.filter(c => c.name === "subagent").map(c => ({ t, s, c }))));
  const reads = new Map();
  const branchOf = async catalog => {
    const id = catalog.data?.childId;
    const reports = session.communications
      .filter(c => c.childId === id)
      .map(c => ({ time: c.time, kind: c.kind === "subagent-settled" ? "completed" : "report",
        ...(c.kind === "subagent-settled" ? { stopReason: c.stopReason ?? null } : {}), text: (c.content.text || "").slice(0, 5000) }));
    let child = null, childEvents, childInherited;
    try {
      if (!reads.has(id)) reads.set(id, Promise.resolve().then(() => readEvents(id)));
      const observation = await reads.get(id);
      childEvents = Array.isArray(observation) ? observation : observation?.events;
      childInherited = Array.isArray(observation) ? undefined : observation?.inheritedEventCount;
      if (Array.isArray(childEvents) && childEvents.length) {
        childEvents = childEvents.filter(e => e.time <= until);
        child = buildTracePayload(childEvents, id).sessions[0];
      }
    } catch {
      child = null;
    }
    const childContext = child ? traceContext(childEvents, { sessions: [child] }) : null;
    const childFacts = childContext?.callFacts || {}, childFiles = childContext?.fileOperations || [];
    const results = child ? collectToolResults(child, childFacts, childFiles) : [];
    const launch = launches.find(({ c }) => c.result?.text?.includes(id));
    // 没有匹配到委派调用时,按目录事件的时间落到最近的轮次,不能留一个定位不到的支线。
    const locate = time => {
      const turn = session.turns.find(t => time <= (t.end ?? Infinity)) || session.turns.at(-1);
      const step = turn?.steps.find(s => time <= s.end) || turn?.steps.at(-1);
      return { turn: turn?.number ?? null, step: step?.number ?? null };
    };
    const fallback = launch ? { turn: launch.t.number, step: launch.s.number } : locate(catalog.time);
    const steps = child ? child.turns.flatMap(t => t.steps.map(s => ({
      id: id + ":" + t.number + ":" + s.number, number: s.number, start: s.start, end: s.end,
      label: s.calls.length ? s.calls.map(c => childFacts[c.seq].title).join(" · ") : "整理回复",
      kind: !s.calls.length ? "reply" : /read|grep|glob/.test(s.calls[0].name) ? "read" : /edit|write|patch/.test(s.calls[0].name) ? "write" : /search|query/.test(s.calls[0].name) ? "query" : "run",
      status: s.calls.some(c => c.status === "error") ? "error" : "returned",
      detail: s.calls.map(c => ({ seq: c.seq, name: c.name, target: c.target, status: c.status,
        outcome: childFacts[c.seq].outcome, result: c.result?.text?.slice(0, 1500) })),
    }))) : [];
    const settlement = reports.findLast(r => r.kind === "completed");
    const stopReason = settlement?.stopReason ?? null;
    // A settlement is an ending, not necessarily a successful completion.
    const status = ["completed", "aborted", "max-tokens", "refusal", "error"].includes(stopReason) ? stopReason : "unknown";
    const children = ownCatalogs(Array.isArray(childEvents) ? childEvents : [], childInherited).map(e => ({
      id: e.data.childId, parentId: id, name: e.data.name ?? null, label: e.data.label ?? null,
      mode: e.data.mode ?? null, createdAt: e.data.childCreatedAt ?? e.time, seq: e.seq,
    }));
    return {
      id, name: catalog.data.name || catalog.data.label || "子代理", title: catalog.data.label || catalog.data.name || "子任务",
      parentId: session.id, mode: catalog.data.mode ?? null, catalogVersion: catalog.data.version ?? null, children,
      start: catalog.data.childCreatedAt || catalog.time, end: child?.turns.at(-1)?.end ?? null,
      returnTime: reports.at(-1)?.time ?? null,
      turn: fallback.turn, step: fallback.step, seq: launch?.c.seq ?? catalog.seq,
      status, stopReason,
      steps, results, reports, source: "dsh-record",
    };
  };
  // Limit disk/replay pressure, keep catalog order, and isolate each failure.
  const agentBranches = new Array(catalogs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, catalogs.length) }, async () => {
    while (next < catalogs.length) {
      const index = next++;
      agentBranches[index] = await branchOf(catalogs[index]);
      // Cached observations can resolve entirely in microtasks. Let ready HTTP
      // bodies and priority turn requests run between batches of child folds.
      if (next < catalogs.length) await new Promise(resolve => setImmediate(resolve));
    }
  }));
  return { skillAnalysis, agentBranches };
}

/** 把宿主记录的 goal/change 事件并进 context.goal:事件优先,工具调用补轮次。 */
export function applyGoalEvents(payload, events) {
  if (!Array.isArray(events) || !events.length) return;
  const session = payload.sessions?.[0];
  if (!session || !payload.context) return;
  const locate = (spans, event) => spans.find(span => Number.isSafeInteger(span.seq) && Number.isSafeInteger(span.endSeq)
    ? event.seq >= span.seq && event.seq <= span.endSeq
    : event.time >= span.start && event.time <= (span.end ?? Infinity));
  const fromEvents = events.filter(e => Number.isFinite(e.time)).map(e => {
    const turn = locate(session.turns || [], e), step = locate(turn?.steps || [], e);
    return { ...e, turn: turn?.number ?? null, ...(step ? { step: step.number } : {}) };
  });
  if (!fromEvents.length) return;
  const existing = payload.context.goal || { markers: [] };
  const bySeq = new Map((existing.markers || []).map(m => [m.seq, m]));
  for (const e of fromEvents) {
    const prev = bySeq.get(e.seq) || {};
    bySeq.set(e.seq, { ...prev, ...e, source: 'event' });
  }
  const markers = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const goals = new Map((existing.goals || []).map(goal => [goal.id, goal]));
  for (const marker of markers) {
    if (marker.goalId == null) continue;
    const known = goals.get(marker.goalId);
    goals.set(marker.goalId, { id: marker.goalId,
      objective: marker.objective ?? known?.objective ?? '', phase: marker.phase ?? known?.phase ?? null,
      roundsStarted: marker.roundsStarted ?? known?.roundsStarted ?? null,
      maxGoalRounds: marker.maxGoalRounds ?? known?.maxGoalRounds ?? null });
  }
  const current = goals.get(markers.findLast(marker => marker.source === 'event' && marker.goalId != null)?.goalId);
  payload.context.goal = { ...existing, ...current, goals: [...goals.values()], markers };
}
