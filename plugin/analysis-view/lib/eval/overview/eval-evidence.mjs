import { describeOperation, fileId } from '../../trace/models/tool-operation-model.mjs';

const invocation = call => call.inner ? call.startSeq : call.seq;
const lookupTools = new Set(['read', 'read_file', 'glob', 'grep', 'search_files', 'read_text_file']);
const fileTools = new Set([...lookupTools, 'str_replace_editor', 'edit', 'write', 'write_file', 'apply_patch', 'multi_edit']);
const shells = new Set(['pwsh', 'bash', 'exec_command', 'shell']);
const check = /^\s*(?:&\s*)?(?:git\s+diff\s+--check\b|node\s+--(?:test|check)\b|(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b|(?:python\s+-m\s+)?pytest\b|(?:npx\s+)?playwright\s+test\b|(?:go|cargo)\s+test\b)[^;&|\r\n]*\s*$/i;
const recorded = Number.isSafeInteger;
const routeKey = route => route?.provider && route?.model ? route.provider + '/' + route.model : null;
const isReplacement = event => event.surfaceOp && typeof event.surfaceOp === 'object';

function group(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  return groups;
}

function readOccupancy(events, projection, modelIndex) {
  const points = [], beforeCall = new Map();
  if (!projection) return { points, beforeCall };
  let state = projection.init(), route = null, selected = null, lastRoute = null, prior = null, model = 0;
  for (const event of events) {
    const d = event.data ?? {};
    if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') beforeCall.set(event.seq, prior);
    state = projection.apply(state, event);
    if (event.type === 'model/selection') selected = routeKey(d) ?? selected;
    if (event.type === 'request/context') {
      selected = route = routeKey(d);
      model = modelIndex(d);
    }
    if (event.type === 'assistant/message' && !isReplacement(event)
        && (d.usage || d.stream?.some(record => record.type === 'chunk' && record.chunk?.type === 'usage'))) {
      lastRoute = routeKey(d.message?.source) ?? lastRoute;
    }
    const view = projection.wire.view(state), used = view.projectedTokens ?? view.pressureTokens;
    const measured = route != null && route === selected && route === lastRoute
      && view.contextWindow > 0 && Number.isFinite(used);
    const next = measured ? [used, view.contextWindow, model] : null;
    if (next?.[0] !== prior?.[0] || next?.[1] !== prior?.[1] || next?.[2] !== prior?.[2]) {
      points.push([event.seq, next?.[0] ?? null, next?.[1] ?? null]);
    }
    prior = next;
  }
  return { points, beforeCall };
}

function parseArgs(value) {
  if (typeof value !== 'string') return value ?? {};
  try { return JSON.parse(value) ?? {}; } catch { return {}; }
}

function observe(call, bySeq, cwd) {
  const args = parseArgs(bySeq.get(call.seq)?.data?.arguments);
  const start = invocation(call), end = call.resultSeq;
  const op = fileTools.has(call.name) ? describeOperation(call, args, call.result?.text ?? '',
    bySeq.get(end)?.data?.meta, cwd) : null;
  const files = call.status === 'returned' && recorded(end) ? (op?.files ?? [])
    .filter(file => file.path).map(file => ({ path: fileId(file.path), access: file.access, start, end, seq: call.seq, step: call.step })) : [];
  return { ...call, launch: start, lookup: lookupTools.has(call.name) || op?.family === 'read',
    files, check: recorded(end) && shells.has(call.name) && check.test(args.command ?? args.cmd ?? '') };
}

function behaviorOf(request, own, later, files, checks, errors, requestsByStep, steps) {
  const paired = own.filter(call => recorded(call.launch) && recorded(call.resultSeq) && call.end >= call.start);
  const overlaps = paired.some((call, i) => paired.slice(i + 1).some(next => call.start < next.end && next.start < call.end));
  const data = { actions: own.length, overlap: overlaps || (paired.length === own.length ? false : null) };
  if (own.some(call => call.lookup)) {
    const evidence = own.flatMap(call => call.files.filter(file => file.access !== 'write'));
    const paths = new Set(evidence.map(file => file.path));
    const match = evidence.flatMap(read => (files.get(read.path) ?? []).filter(file =>
      file.access === 'write' && recorded(file.start) && file.start > read.end)
      .map(write => [read.end, write.end, write.step - read.step])).sort((a, b) => a[1] - b[1])[0];
    data.lookup = { files: paths.size, linked: match ?? null,
      refs: [...new Set(own.filter(call => call.lookup).map(call => call.resultSeq ?? call.seq))].slice(0, 5) };
  }
  const writes = group(own.flatMap(call => call.files.filter(file => file.access === 'write' && recorded(file.start))), file => file.path);
  if (writes.size) {
    let before = 0, after = 0;
    const refs = [];
    const lastWrite = Math.max(...[...writes.values()].flatMap(rows => rows.map(file => file.end)));
    for (const [path, changes] of writes) {
      const early = Math.min(...changes.map(file => file.start)), late = Math.max(...changes.map(file => file.end));
      const prior = files.get(path)?.findLast(file => file.access === 'read' && file.end < early);
      const following = files.get(path)?.find(file => file.access === 'read' && recorded(file.start) && file.start > late);
      before += Number(Boolean(prior));
      after += Number(Boolean(following));
      refs.push(changes[0].end);
      if (following) refs.push(following.end);
    }
    const checked = checks.find(call => recorded(call.launch) && call.launch > lastWrite);
    data.change = { files: writes.size, before, after, check: checked?.resultSeq ?? null, refs: [...new Set(refs)].slice(0, 5) };
  }
  const failed = own.filter(call => call.status === 'error' && errors.has(call.resultSeq));
  if (failed.length) data.feedback = [...group(failed, call => errors.get(call.resultSeq).category)]
    .map(([category, calls]) => {
      const last = Math.max(...calls.map(call => call.resultSeq));
      const next = later.find(row => row.step !== request.step && steps.get(row.step)?.seq > last);
      const nextCalls = requestsByStep.get(next?.seq) ?? [];
      const recovered = calls.map(call => errors.get(call.resultSeq).returned).filter(recorded);
      const reads = nextCalls.find(call => call.status === 'returned' && call.target && lookupTools.has(call.name)
        && calls.some(failed => failed.target === call.target) && call.files.some(file => file.access === 'read'));
      const same = nextCalls.find(call => calls.some(failed => failed.signature === call.signature));
      const changed = nextCalls.find(call => calls.some(failed => failed.name === call.name));
      const kind = reads ? 'read' : same ? 'same' : changed ? 'changed' : nextCalls.length ? 'other' : next ? 'reply' : 'ended';
      const action = reads ?? same ?? changed ?? nextCalls[0];
      return { category, errors: calls.length, first: calls[0].resultSeq, kind, next: next?.seq ?? null,
        action: action?.resultSeq ?? action?.seq ?? null, returned: recovered[0] ?? null };
    });
  return data;
}

export function projectSessionEval(events, trace, turns, cwd, pressureProjection, modelIndex) {
  const { points, beforeCall } = readOccupancy(events, pressureProjection, modelIndex);
  const bySeq = new Map(events.map(event => [event.seq, event]));
  const projected = new Map(turns.map(turn => [turn.no, turn]));
  const names = [], nameIndices = new Map(), actions = [], stepEnds = [],measures={};
  for (const turn of trace.turns) {
    const target = projected.get(turn.number);
    if (!target) continue;
    for (const step of turn.steps) {
      if (recorded(step.endSeq)) stepEnds.push([step.endSeq, turn.number, step.number]);
    }
    const requests = group(target.requests, row => row.step), steps = new Map(turn.steps.map(step => [step.number, step]));
    const errors = new Map(target.errors.map(error => [error.failed, error]));
    const all = turn.steps.flatMap(step => step.calls.map(call => observe({ ...call, step: step.number }, bySeq, cwd)))
      .sort((a, b) => (a.launch ?? a.seq) - (b.launch ?? b.seq));
    const related = new Map();
    for (const call of all) {
      const anchor = call.inner ? call.rootSeq ?? call.launch : call.seq;
      const request = requests.get(call.step)?.findLast(row => row.seq < anchor);
      if (request) {
        if (!related.has(request.seq)) related.set(request.seq, []);
        related.get(request.seq).push(call);
      }
      if (!nameIndices.has(call.name)) {
        nameIndices.set(call.name, names.length);
        names.push(call.name);
      }
      const pressure = beforeCall.get(call.launch), error = errors.get(call.resultSeq);
      if(call.measure&&Number.isSafeInteger(call.launch??call.resultSeq))measures[call.launch??call.resultSeq]=call.measure;
      const elapsed = recorded(call.launch) && recorded(call.resultSeq) && Number.isFinite(call.start)
        && Number.isFinite(call.end) && call.end >= call.start ? call.end - call.start : null;
      // launch, reply, turn, step, tool, status, used, capacity, result, error category, model, elapsed
      actions.push([call.launch, request?.seq ?? null, turn.number, call.step, nameIndices.get(call.name),
        call.status === 'returned' ? 0 : call.status === 'error' ? 1 : 2,
        pressure?.[0] ?? null, pressure?.[1] ?? null, call.resultSeq, error?.category ?? null,
        pressure?.[2] ?? request?.model ?? 0, elapsed]);
    }
    const files = group(all.flatMap(call => call.files), file => file.path);
    const checks = all.filter(call => call.check);
    for (const request of target.requests) {
      const calls = related.get(request.seq);
      if (!calls?.length) continue;
      const evidence = behaviorOf(request, calls, target.requests.filter(row => row.seq > request.seq),
        files, checks, errors, related, steps);
      if (evidence.lookup || evidence.change || evidence.feedback) request.behavior = evidence;
    }
  }
  stepEnds.sort((a, b) => a[0] - b[0]);
  return { points, names, actions, stepEnds,measures };
}
