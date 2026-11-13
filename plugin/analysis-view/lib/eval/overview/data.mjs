import { buildTracePayload } from '../../trace-build.js';
import { buildRecordedModelTiming, requestUsageEvidence } from '../../trace/shared/request-context.mjs';
import { projectWorkEvidence } from './work-evidence.mjs';
import { projectSessionEval } from './eval-evidence.mjs';
import { errorsForTurn, span, startSeq, valid } from './shared.mjs';
import { projectFindingCalls } from '../findings.mjs';

const replacement = row => row.surfaceOp && typeof row.surfaceOp === 'object';
const isPtc = name => name === 'run_code';
function toolMode(names) {
  if (!names.length) return null;
  if (names.every(isPtc)) return 'ptc';
  return names.some(isPtc) ? 'mixed' : 'native';
}


function firstBody(stream, helpers) {
  for (const row of stream ?? []) {
    if (row.type === 'chunk' && helpers.chunkHasVisibleText?.(row.chunk)) return row.time;
    if (row.type !== 'text-chunks') continue;
    const time = helpers.runFirstVisibleTime?.(row);
    if (time !== undefined) return time;
  }
  return null;
}

const sameRoute = (a, b) => a?.provider === b?.provider && a?.model === b?.model;
function modelRequests(events, modelIndex, helpers) {
  const timing = new Map(buildRecordedModelTiming(events, helpers)
    .flatMap(({ turn, steps }) => steps.map(step => [`${turn}:${step.step}`, step])));
  const groups = new Map();
  let header, route, context;
  for (const row of events) {
    const d = row.data ?? {};
    if (replacement(row)) continue;
    if (row.type === 'request/header') {
      header = { config: d.header?.config, seq: row.seq };
    } else if (['model/selection', 'request/context'].includes(row.type) && d.provider && d.model) {
      route = d;
    }
    if (row.type === 'request/context') context = { data: d, seq: row.seq };
    else if (row.type === 'model/selection' && !sameRoute(d, context?.data)) context = null;
    if (row.type !== 'assistant/message' || !Number.isSafeInteger(d.turn) || !Number.isSafeInteger(d.step)) continue;
    const source = d.message?.source?.kind === 'model' ? d.message.source : null;
    const routeEvidence = source ?? header?.config ?? route;
    const matchedHeader = sameRoute(routeEvidence, header?.config) ? header : null;
    const matchedRoute = sameRoute(routeEvidence, route) ? route : null;
    const content = d.message?.content ?? [];
    const body = content.filter(block => block.type === 'text').map(block => block.text).join('').trim();
    const mode = toolMode(content.filter(block => block.type === 'tool-call').map(block => block.name));
    const usage = requestUsageEvidence(d.usage);
    const capacity = context && sameRoute(routeEvidence, context.data) ? context.data.contextWindow : null;
    const t = timing.get(`${d.turn}:${d.step}`);
    const request = {
      step: d.step, seq: row.seq, header: matchedHeader?.seq ?? null, model: modelIndex(routeEvidence),
      effort: source?.reasoningEffort ?? matchedHeader?.config?.reasoningEffort ?? matchedRoute?.reasoningEffort ?? null,
      input: usage.promptTokens, output: usage.outputTokens, ttft: t?.ttft ?? null,
      ...(Number.isSafeInteger(capacity) && capacity > 0 && usage.promptTokens != null
        ? { window: [capacity, context.seq] } : {}),
      type: mode ? 'tools' : body ? 'direct' : 'other', toolMode: mode,
      body: body ? firstBody(d.stream, helpers) : null,
      chars: body ? Array.from(body).length : 0,
    };
    if (!groups.has(d.turn)) groups.set(d.turn, []);
    groups.get(d.turn).push(request);
  }
  return groups;
}

function projectTurns(session, events, modelIndex, helpers) {
  const requests = modelRequests(events, modelIndex, helpers);
  const launches = new Map(), formalReturns = new Map(), formalTimes = new Map();
  const callKey = (turn, step, id) => JSON.stringify([turn, step, id]);
  for (const row of events) {
    if (replacement(row)) continue;
    const { turn, step, message, callId } = row.data ?? {};
    if (row.type === 'tool/call') {
      if (!launches.has(turn)) launches.set(turn, []);
      launches.get(turn).push(row);
    } else if (row.type === 'tool/result') {
      const key = `${turn}:${step}`;
      if (!formalReturns.has(key)) formalReturns.set(key, row.seq);
      const id = message?.toolCallId ?? message?.source?.callId ?? callId;
      const resultKey = callKey(turn, step, id);
      if (id != null && !formalTimes.has(resultKey)) formalTimes.set(resultKey, row.time);
    }
  }
  const episodes = new Map();
  for (const episode of session.overview.episodes) {
    if (!episodes.has(episode.turn)) episodes.set(episode.turn, []);
    episodes.get(episode.turn).push(episode);
  }
  return session.turns.map(turn => {
    const own = requests.get(turn.number) ?? [];
    const calls = turn.steps.flatMap(step => step.calls);
    const directCalls = launches.get(turn.number) ?? [];
    const programs = directCalls.filter(row => isPtc(row.data.name));
    const firstProgram = programs[0];
    const programTimes = programs.map(row =>
      span(row.time, formalTimes.get(callKey(turn.number, row.data.step, row.data.callId)))).filter(Number.isFinite);
    const coveredRoots = new Set(calls.filter(call => call.inner).map(call => call.rootSeq));
    const first = own.filter(row => span(turn.start, row.body) != null)
      .sort((a, b) => a.body - b.body)[0];
    const firstCall = calls.filter(call => !coveredRoots.has(call.seq) && startSeq(call) != null && span(turn.start, call.start) != null)
      .sort((a, b) => a.start - b.start || startSeq(a) - startSeq(b))[0];
    const loops = turn.steps.slice(0, -1).filter((step, index) => {
      const result = formalReturns.get(`${turn.number}:${step.number}`);
      return result != null && result < turn.steps[index + 1].seq;
    }).length;
    const bodyChars = own.reduce((sum, row) => sum + row.chars, 0);
    return {
      no: turn.number, seq: turn.seq, endSeq: turn.endSeq, at: turn.start,
      prompt: turn.prompts[0]?.seq ?? null, end: span(turn.start, turn.end),
      reason: turn.reason?.kind ?? null,
      model: own[0]?.model ?? 0, mixed: new Set(own.map(row => row.model).filter(Boolean)).size > 1,
      wait: first ? span(turn.start, first.body) : null, bodySeq: first?.seq ?? null,
      firstTool: firstCall ? span(turn.start, firstCall.start) : null,
      toolSeq: firstCall ? startSeq(firstCall) : null, tool: firstCall?.name ?? null,
      toolMode: toolMode(directCalls.map(row => row.data.name)),
      ptc: firstProgram ? {
        seq: firstProgram.seq, wait: span(turn.start, firstProgram.time),
        programs: programs.length, measured: programTimes.length,
        elapsed: programTimes.length ? programTimes.reduce((sum, ms) => sum + ms, 0) : null,
        calls: calls.filter(call => call.inner).length,
      } : null,
      loops, chars: bodyChars, calls: turn.calls, errors: errorsForTurn(episodes.get(turn.number) ?? [], calls),
      requests: own.map(({ body, chars, ...request }) => request),
    };
  }).filter(turn => valid(turn.at));
}

export function projectOverviewSession(id, events, { cwd, inherited = 0 } = {}, catalog, runtime) {
  if (!events.some(event => event.type === 'turn/start' && event.seq >= inherited)) return null;
  const { sessions: [trace] } = buildTracePayload(events, id, { cwd });
  const turns = projectTurns(trace, events, catalog.index, runtime.stream).filter(turn => turn.seq >= inherited);
  if (!turns.length) return null;
  const occupancy = projectSessionEval(events, trace, turns, cwd, runtime.pressure, catalog.index);
  if (inherited) {
    const prior = occupancy.points.findLastIndex(point => point[0] < turns[0].seq);
    if (prior > 0) occupancy.points = occupancy.points.slice(prior);
  }
  const work = projectWorkEvidence(inherited ? events.filter(event => event.seq >= inherited) : events, turns);
  return { id, cut: trace.lastSeq, turns, occupancy, work,
    findingCalls: projectFindingCalls(trace, { turns: turns.map(turn => turn.no), events }) };
}
