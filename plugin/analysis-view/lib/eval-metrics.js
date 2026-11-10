import { summarizeToolOutcomes } from './trace/shared/io-outcome.mjs';
import { callDurationMs, callTimingSummary } from './trace/shared/tool-intervals.mjs';
import { createRuntimeMetrics } from './eval-evidence.js';
import { scopeByTurn } from './trace/shared/scope-index.mjs';

function summarizeToolTiming(locations) {
  const groups = new Map();
  for (const { call, turn } of locations.values()) {
    const name = typeof call.name === 'string' ? call.name : '';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({
      startSeq: call.inner ? call.startSeq : call.seq,
      resultSeq: call.resultSeq,
      start: call.start,
      end: call.end,
      callId: call.inner ? null : call.id ?? null,
      turn: turn.number,
      turnStartSeq: turn.seq,
    });
  }

  const byTool = [...groups].map(([name, calls]) => {
    const rows = calls.flatMap(call => {
      const durationMs = callDurationMs(call);
      return durationMs === null ? [] : [{
        durationMs, turn: call.turn, startSeq: call.turnStartSeq,
        record: { seq: call.startSeq, callId: call.callId },
        resultSeq: call.resultSeq,
      }];
    }).sort((a, b) => b.durationMs - a.durationMs || b.record.seq - a.record.seq).slice(0, 3);
    return { name, ...callTimingSummary(calls), rows };
  }).sort((a, b) => (b.cumulativeMs ?? -1) - (a.cumulativeMs ?? -1) || a.name.localeCompare(b.name));

  const calls = locations.size;
  const pairedCalls = byTool.reduce((total, tool) => total + tool.pairedCalls, 0);
  return { calls, pairedCalls, missingCalls: calls - pairedCalls, coverage: calls ? pairedCalls / calls : null, byTool };
}

function summarizeToolExecution(turns, episodes) {
  const calls = [], locations = new Map();
  for (const turn of turns) {
    for (const step of turn.steps) for (const call of step.calls) {
      calls.push(call);
      locations.set(call.seq, { call, turn });
    }
  }

  // The trajectory owns error classification and retry pairing. Count failed
  // calls here so an episode that contains multiple attempts does not hide them.
  const groups = new Map();
  for (const episode of episodes) {
    const code = episode.condition.startsWith('TOOL_ERROR:') ? 'TOOL_ERROR' : episode.condition;
    if (!groups.has(code)) groups.set(code, { code, calls: 0, matched: 0, tools: new Map(), failures: [] });
    const group = groups.get(code);
    const retries = new Map(episode.pairs.map(pair => [pair.failedSeq, pair.successSeq]));
    for (const seq of episode.failureSeqs) {
      const { call } = locations.get(seq);
      group.calls++;
      group.matched += Number(retries.has(seq));
      group.tools.set(call.name, (group.tools.get(call.name) || 0) + 1);
      group.failures.push({ seq, retrySeq: retries.get(seq) });
    }
  }
  const record = seq => {
    const call = locations.get(seq)?.call;
    return { seq, callId: call && !call.inner ? call.id : null };
  };
  const errorsByCondition = [...groups.values()].map(({ tools, failures, ...group }) => ({
    ...group,
    tools: [...tools].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    rows: failures.sort((a, b) => b.seq - a.seq).slice(0, 8).map(({ seq, retrySeq }) => {
      const { call, turn } = locations.get(seq);
      return { tool: call.name, turn: turn.number, startSeq: turn.seq, failure: record(seq),
        retry: retrySeq === undefined ? null : record(retrySeq) };
    }),
  })).sort((a, b) => b.calls - a.calls || a.code.localeCompare(b.code));
  const recovery = {
    episodes: episodes.length,
    allSameInputReturned: episodes.filter(episode => episode.complete).length,
    partiallyMatched: episodes.filter(episode => !episode.complete && episode.pairs.length).length,
    noSameInputReturn: episodes.filter(episode => !episode.pairs.length).length,
  };
  return { ...summarizeToolOutcomes(calls), errorsByCondition, timing: summarizeToolTiming(locations), recovery };
}

export function summarizeTrajectoryEval(session, evidence) {
  const episodesIn = scopeByTurn(session.overview?.episodes ?? []);
  const runtime = evidence ? createRuntimeMetrics(session, evidence) : null;
  return { cut: session.lastSeq ?? null, execution: summarizeToolExecution(session.turns, episodesIn(null)),
    ...(runtime ? { metrics: runtime(session.turns, null) } : {}),
    turns: session.turns.slice(-40).map(turn => ({
      turn: turn.number, label: turn.prompts[0]?.text.slice(0, 90) ?? null,
      execution: summarizeToolExecution([turn], episodesIn(turn.number)),
      ...(runtime ? { metrics: runtime([turn], turn.number) } : {}),
    })) };
}
