// One recorded-observation policy for digest, interpretation and offline analysis.
import {incident} from './incident-shape.js';

export function computeIncidents(events) {
  let turns = 0, currentTurn = 0, toolCalls = 0, errors = 0;
  const turnTools = new Map();
  const turnAssistant = new Set();
  const turnStarts = new Map(), errorCallIds = new Set();
  const nameSeq = [];
  const errFirst = [];

  for (const e of events || []) {
    if (!e || typeof e.seq !== "number") continue;
    if (e.type === "turn/start") { turns++; currentTurn++; turnStarts.set(currentTurn, e.seq); continue; }
    if (e.type === "assistant/message" && currentTurn) turnAssistant.add(currentTurn);
    if (e.type === "tool/call") {
      toolCalls++;
      const d = e.data || {};
      const args = typeof d.arguments === "string" ? d.arguments : JSON.stringify(d.arguments);
      nameSeq.push({ name: d.name || "(tool)", args, callId: d.callId, seq: e.seq, turn: currentTurn });
      turnTools.set(currentTurn, (turnTools.get(currentTurn) || 0) + 1);
    } else if (e.type === "tool/result") {
      const d = e.data || {};
      const content = d.message && d.message.content;
      const err = d.error || (d.message && d.message.isError) || (Array.isArray(content) && content[0] && content[0].isError);
      if (err) {
        errors++;
        const callId = d.callId ?? d.message?.source?.callId ?? d.message?.toolCallId;
        if (callId != null) errorCallIds.add(callId);
        const er = d.error; const kind = er ? (er.name && er.code ? er.name + ":" + er.code : (er.name || er.code || "error")) : "error";
        if (errFirst.length < 12) errFirst.push({ kind, seq: e.seq, turn: currentTurn });
      }
    }
  }

  let emptyTurns = 0;
  for (let t = 1; t <= turns; t++) if (!(turnTools.get(t) > 0) && !turnAssistant.has(t)) emptyTurns++;

  const incidents = [];

  // retry-loop v1: same tool + same arguments, consecutive
  let i = 0;
  while (i < nameSeq.length) {
    let j = i;
    while (j < nameSeq.length && nameSeq[j].name === nameSeq[i].name && nameSeq[j].args === nameSeq[i].args) j++;
    if (j - i >= 2) {
      const run = nameSeq.slice(i, j);
      const hasErr = run.some((x) => x.callId != null && errorCallIds.has(x.callId));
      incidents.push(incident({
        type: "retry-loop",
        severity: (j - i) + (hasErr ? 2 : 0),
        title: "连续同参调用",
        detail: "连续 " + (j - i) + ' 次对 "' + run[0].name + '" 的重复调用(同参)',
        cause: run[0].name + " 的工具名与参数文本连续相同" + (hasErr ? "; 关联调用有错误结果记录" : ""),
        runtimeKnew: hasErr ? "关联工具结果带错误标记" : "已记录这些连续调用",
        modelKnew: "模型可见范围未由这些事件确认",
        harness: "是否需要打断及已有处理待核对",
        impact: "记录到 " + (j - i) + " 次连续同参调用；必要性与额外开销待核对",
        seqs: run.map((x) => x.seq)
      }));
    }
    i = j;
  }

  if (errors > 0) {
    const kinds = {};
    for (const f of errFirst) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    incidents.push(incident({
      type: "error",
      severity: errors,
      title: "工具错误结果",
      detail: errors + " 条工具结果带错误标记(" + Object.keys(kinds).join(", ") + ")",
      cause: "工具结果的错误字段或 isError 标记",
      runtimeKnew: "记录中含错误码或错误状态",
      modelKnew: "模型可见范围未由这些事件确认",
      harness: deriveHarnessResponse(kinds),
      impact: "错误后的处理与任务结果待核对",
      seqs: errFirst.map((f) => f.seq)
    }));
  }

  if (emptyTurns > 0) {
    incidents.push(incident({
      type: "noop",
      severity: 1,
      title: "轮次缺少调用或消息记录",
      detail: emptyTurns + " 轮未记录工具调用或助手消息",
      cause: "本次读取范围内未见 tool/call 或 assistant/message",
      runtimeKnew: "-",
      modelKnew: "-",
      harness: "-",
      impact: "推进情况待核对，需结合运行状态、中止和采集边界",
      seqs: [...turnStarts].filter(([turn]) => !(turnTools.get(turn) > 0) && !turnAssistant.has(turn)).map(([, seq]) => seq)
    }));
  }

  incidents.sort((a, b) => b.severity - a.severity);
  return { turns, toolCalls, errors, emptyTurns, incidentCount: incidents.length, incidents };
}

/** Error markers describe recorded handling; they do not prove its absence. */
export function deriveHarnessResponse(kinds) {
  const keys=Object.keys(kinds??{}),guards=keys.filter(key=>/NOT_OBSERVED|BLOCKED|DENIED|GUARD/.test(key));
  if(guards.length)return '结果含拦截标记('+guards.join(', ')+')；后续处理待核对';
  if(keys.some(key=>/UNKNOWN_TOOL/.test(key)))return '结果含未知工具标记；后续处理待核对';
  return '未从这些错误标记确认处理措施';
}

export function incidentInterpretationSystem(log) {
  return '你是轨迹分析助手。给定内容是事件观察和调查线索，不是已判定的根因、任务影响或处置要求。'
    +'连续同参调用不等于冗余；工具错误结果不等于任务目标失败；缺少调用或消息记录不等于未推进。'
    +'核对轮询必要性、后续替代路径、实际任务结果、运行或中止状态及采集边界；未记录不等于未处理，也不能断言模型已收到某段上下文。'
    +'证据不足时明确写未判定；允许无需进一步处置，不强制给出实现改动。severity 仅用于信号排序，不代表任务严重度。'
    +'每条事实性陈述必须引用 (session, seq@'+(log?.id??'log')+')，不得编造 seq。'
    +'输出中文，四段(观察 / 待核对原因 / 已有处理证据 / 影响与处置判断)，合计不超过 200 字。';
}
