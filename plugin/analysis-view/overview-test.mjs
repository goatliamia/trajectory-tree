import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { apply } from './lib/index.js';
import { OverviewService } from './lib/eval/overview/service.mjs';
import { TraceQueue } from './lib/trace-resources.js';

const route = { provider: 'fixture', model: 'flash' };
const event = (seq, type, data) => ({ seq, type, time: 1_700_000_000_000 + seq * 100, data });
const location = { turn: 1, step: 1 };
const events = [
  event(0, 'request/context', { ...route, contextWindow: 1000 }),
  event(1, 'turn/start', { turn: 1 }),
  event(2, 'step/start', location),
  event(3, 'assistant/message', { ...location, message: { source: { kind: 'model', ...route }, content: [] },
    usage: { inputTokens: 200, cacheReadTokens: 100, cacheWriteTokens: 0, outputTokens: 10 } }),
  event(4, 'tool/call', { ...location, callId: 'a', name: 'edit', arguments: '{"path":"a.txt"}' }),
  event(5, 'tool/result', { ...location, message: { toolCallId: 'a', isError: true, content: [] }, error: { code: 'FS_NOT_OBSERVED' } }),
  event(6, 'tool/call', { ...location, callId: 'b', name: 'edit', arguments: '{"path":"a.txt"}' }),
  event(7, 'tool/result', { ...location, message: { toolCallId: 'b', content: [] } }),
  event(8, 'step/end', location),
  event(9, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
];

const pressure = {
  init: () => ({}),
  apply: (state, row) => row.type === 'request/context' ? { contextWindow: row.data.contextWindow }
    : row.type === 'assistant/message' ? { ...state, projectedTokens: 310 } : state,
  wire: { view: state => state },
};

test('overview requires the Web connection owner before reading the registry', async () => {
  let handler, admission = { rejection: 401 };
  const disposers = [];
  const services = { connection: { admit: () => admission }, webServer: { register: route => { handler = route.handler; } },
    workspaceRegistry: { list: () => { throw new Error('must not read the registry'); } } };
  apply({ get: key => services[key], effect: run => disposers.push(run()) });
  const status = async path => {
    const req = Object.assign(new EventEmitter(), { method: 'GET', url: '/analysis-view/' + path, headers: {} });
    const res = Object.assign(new EventEmitter(), { writeHead: code => { res.status = code; }, end: () => {} });
    await handler(req, res);
    return res.status;
  };
  try {
    assert.equal(await status('overview'), 401);
    admission = { peer: { principal: { kind: 'fixture' } } };
    assert.equal(await status('overview-data'), 403);
  } finally { disposers.forEach(dispose => dispose?.()); }
});

test('workspace overview uses the current cut and counts inherited turns once', async () => {
  const records = new Map([['main', events], ['fork', events], ['archived', events]]);
  const registry = { archivedSessionIds: ['archived'], list: () => [
    { id: 'a', path: '/a', title: 'One', sessionIds: ['main', 'fork', 'archived'] },
    { id: 'b', path: '/b', title: 'Two', sessionIds: ['main'] },
  ] };
  const sessions = { get: id => ({ seq: records.get(id).length }) };
  const calls = [], released = [];
  const service = new OverviewService({ get: name => ({ workspaceRegistry: registry, sessions })[name] }, {
    queue: new TraceQueue(1), timeout: (run, _ms, signal) => run(signal), sdk: async () => ({ stream: {}, pressure }),
    observe: async id => {
      calls.push(id);
      const rows = records.get(id);
      return { id, events: rows, source: 'live', cursor: rows.length - 1, inheritedEventCount: id === 'fork' ? events.length : 0 };
    },
    dispose: observation => released.push(observation.id),
  });
  const collect = () => Array.fromAsync(service.stream(service.scope(), new AbortController().signal));
  try {
    const first = await collect();
    assert.equal(first[0].total, 2);
    assert.deepEqual(first[0].projects.map(item => item.name), ['One', 'Two']);
    const main = first.find(row => row.session?.id === 'main').session;
    assert.equal(main.project, 0);
    assert.deepEqual(main.turns[0].requests[0].window, [1000, 0]);
    assert.equal(main.turns[0].requests[0].input, 300);
    assert.deepEqual(main.occupancy.actions[0].slice(5), [1, 310, 1000, 5, 0, 1, 100]);
    assert.equal(main.turns[0].errors[0].returned, 7);
    assert.equal(main.findingCalls.length, 1);
    assert.equal(main.findingCalls[0].seq, 4);
    assert.equal(main.findingCalls[0].returned, 6);
    assert.equal(first.filter(row => row.session).length, 1);
    assert.equal(first.at(-1).unread, 0);
    assert.deepEqual([...released].sort(), ['fork', 'main']);
    await collect();
    assert.deepEqual([...calls].sort(), ['fork', 'main']);
    records.set('main', [...events, event(10, 'turn/start', { turn: 2 })]);
    assert.equal((await collect()).find(row => row.session?.id === 'main').session.cut, 10);
    assert.equal(calls.filter(id => id === 'main').length, 2);
    assert.equal(calls.filter(id => id === 'fork').length, 1);
  } finally { service.dispose(); }
});

test('warm summaries bypass queued raw logs and closing the stream cancels unfinished reads', async () => {
  const queue = new TraceQueue(1), controller = new AbortController();
  const sessions = { get: () => ({ seq: events.length }) };
  let active = 0, peak = 0, stopped = false;
  const service = new OverviewService({ get: key => key === 'sessions' ? sessions : null }, {
    queue, timeout: (run, _ms, signal) => run(signal), sdk: async () => ({ stream: {}, pressure }),
    observe: async (id, signal) => {
      active++;peak = Math.max(peak, active);
      try {
        if (id === 'slow') await new Promise((_, reject) => signal.addEventListener('abort', () => { stopped = true;reject(signal.reason); }, { once: true }));
        return { events, source: 'live', cursor: events.length-1 };
      } finally { active--; }
    }, dispose: () => {},
  });
  try {
    await service.session({ id: 'warm', cwd: '/a' }, { stream: {}, pressure }, controller.signal);
    const stream = service.stream({ projects: [], sessions: [{ id: 'slow', cwd: '/a' }, { id: 'warm', cwd: '/a' }] }, controller.signal);
    assert.equal((await stream.next()).value.type, 'start');
    const first = (await stream.next()).value;
    assert.equal(first.session.id, 'warm');
    assert.ok(first.models.length, 'A partial batch includes the model catalog needed for immediate rendering');
    await stream.return();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stopped, true);assert.equal(active, 0);assert.equal(peak, 1);
  } finally { service.dispose();queue.dispose(); }
});

test('a workspace with more than 128 small summaries stays warm within the byte budget', async () => {
  const queue = new TraceQueue(1), ids = Array.from({ length: 160 }, (_, i) => 'session-'+i);
  const sessions = { get: () => ({ seq: events.length }) };
  let reads = 0;
  const service = new OverviewService({ get: key => key === 'sessions' ? sessions : null }, {
    queue, timeout: (run, _ms, signal) => run(signal), sdk: async () => ({ stream: {}, pressure }),
    observe: async () => { reads++;return { events, source: 'live', cursor: events.length-1 }; }, dispose: () => {},
  });
  const scope = { projects: [], sessions: ids.map(id => ({ id, cwd: '/a' })) };
  try {
    await Array.fromAsync(service.stream(scope, new AbortController().signal));
    assert.equal(reads, ids.length);assert.ok(service.bytes < 20*1024*1024);
    await Array.fromAsync(service.stream(scope, new AbortController().signal));
    assert.equal(reads, ids.length, 'Unchanged small sessions are not decompressed again on refresh');
  } finally { service.dispose();queue.dispose(); }
});
