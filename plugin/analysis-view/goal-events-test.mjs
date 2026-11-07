import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readGoalChanges, invalidateGoalCache } from './lib/goal-events.js';
import { TraceStages } from './lib/trace-stages.js';
import { TraceResources } from './lib/trace-resources.js';

const goal = (phase, seq = 3) => ({ type: 'goal/change', seq, time: 1000 + seq * 100,
  data: { goal: { id: 'synthetic', phase, revision: phase }, operation: phase } });

function host() {
  const state = { revision: 'r1', events: [goal('active')], opens: 0, closes: 0 };
  const persistence = {
    async stat() { return { revision: state.revision }; },
    async open() {
      state.opens++;
      return { read: async () => state.read ? state.read() : { events: state.events },
        close: async () => { state.closes++; } };
    },
  };
  const sessions = new Map();
  return { state, persistence, sessions, ctx: { get: name => ({ sessionPersistence: persistence, sessions })[name] } };
}

afterEach(() => invalidateGoalCache());

test('same persisted source is shared; a new revision is observed', async () => {
  const { ctx, state } = host();
  assert.equal((await readGoalChanges(ctx, 's'))[0].phase, 'active');
  await readGoalChanges(ctx, 's');
  assert.equal(state.opens, 1);
  state.revision = 'r2'; state.events = [goal('completed')];
  assert.equal((await readGoalChanges(ctx, 's'))[0].phase, 'completed');
  assert.equal(state.opens, 2); assert.equal(state.closes, 2);
});

test('a live cut cannot hide a changed persisted revision', async () => {
  const { ctx, state, sessions } = host();
  sessions.set('s', { seq: 100 });
  await readGoalChanges(ctx, 's');
  state.revision = 'r2'; state.events = [goal('completed')];
  assert.equal((await readGoalChanges(ctx, 's'))[0].phase, 'completed');
  assert.equal(state.opens, 2);
});

test('service identity separates the same session and revision in two hosts', async () => {
  const a = host(), b = host();
  b.state.events = [goal('completed')];
  assert.equal((await readGoalChanges(a.ctx, 's'))[0].phase, 'active');
  assert.equal((await readGoalChanges(b.ctx, 's'))[0].phase, 'completed');
});

test('fresh Cordis proxies retain their owning service identity', async () => {
  const { persistence, state } = host();
  const ctx = { get: name => name === 'sessionPersistence' ? new Proxy(persistence, {
    get: (target, key) => key === Symbol.for('cordis.original') ? target : target[key],
  }) : undefined };
  await readGoalChanges(ctx, 's'); await readGoalChanges(ctx, 's');
  assert.equal(state.opens, 1);
});

test('unknown versions are read again; old data does not replace a failed new read', async () => {
  const { ctx, state, persistence } = host();
  await readGoalChanges(ctx, 's');
  state.revision = 'r2'; state.read = async () => { throw Error('synthetic read failure'); };
  assert.deepEqual(await readGoalChanges(ctx, 's'), []);
  assert.equal(state.closes, 2);
  delete persistence.stat; delete state.read;
  state.events = [goal('completed')];
  assert.equal((await readGoalChanges(ctx, 's'))[0].phase, 'completed');
  await readGoalChanges(ctx, 's'); assert.equal(state.opens, 4);
});

test('cache retains complete observations and projects each requested live cut', async () => {
  const { ctx, state, sessions } = host();
  state.events = [goal('active', 3), goal('completed', 7)];
  const liveCut = { owner: sessions, revision: 'live:6' };
  assert.deepEqual((await readGoalChanges(ctx, 's', 5, liveCut)).map(row => row.phase), ['active']);
  assert.deepEqual((await readGoalChanges(ctx, 's', 10)).map(row => row.phase), ['active', 'completed']);
  assert.equal(state.opens, 1);
});

test('a persisted view uses its actual captured version when no sequence cut is available', async () => {
  const { ctx, state, persistence } = host();
  const cut = { owner: persistence, revision: 'r1' };
  assert.equal((await readGoalChanges(ctx, 's', undefined, cut))[0].phase, 'active');
  state.revision = 'r2'; state.events = [goal('completed')];
  assert.deepEqual(await readGoalChanges(ctx, 's', undefined, cut), []);
  assert.equal((await readGoalChanges(ctx, 's'))[0].phase, 'completed');
});

test('a read-reported version supplies the missing stat observation', async () => {
  const { ctx, persistence, state } = host();
  delete persistence.stat;
  state.read = async () => ({ events: state.events, revision: 'r1' });
  assert.equal((await readGoalChanges(ctx, 's', undefined, { owner: persistence, revision: 'r1' }))[0].phase, 'active');
});

test('an older in-flight result cannot replace a newer installed observation', async () => {
  const { ctx, state } = host();
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  state.read = async () => { started(); await wait; return { events: [goal('active')], revision: 'r1' }; };
  const old = readGoalChanges(ctx, 's');
  await ready;
  state.revision = 'r2'; state.read = async () => ({ events: [goal('completed')], revision: 'r2' });
  await readGoalChanges(ctx, 's'); release(); await old;
  assert.equal((await readGoalChanges(ctx, 's'))[0].phase, 'completed');
  assert.equal(state.opens, 2);
});

test('the actual details stage reads and applies persisted goal markers', async () => {
  const { ctx, state } = host();
  state.events = [
    { type: 'goal/change', seq: 3, time: 1300, data: { operation: 'create', goal: { id: 'a', objective: 'First goal', phase: 'active', revision: 1 } } },
    { type: 'goal/change', seq: 8, time: 1500, data: { operation: 'clear', cleared: { id: 'a', revision: 2 } } },
    { type: 'goal/change', seq: 12, time: 1900, data: { operation: 'create', goal: { id: 'b', objective: 'Second goal', phase: 'active', revision: 1 } } },
  ];
  const rows = [
    { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } },
    { type: 'user/message', seq: 1, time: 1100, data: { turn: 1, source: { kind: 'user' }, content: [{ type: 'text', text: 'synthetic' }] } },
    { type: 'step/start', seq: 2, time: 1200, data: { turn: 1, step: 1 } },
    { type: 'step/end', seq: 4, time: 1400, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 5, time: 1500, data: { turn: 1 } },
    { type: 'turn/start', seq: 9, time: 1700, data: { turn: 2 } },
    { type: 'step/start', seq: 11, time: 1800, data: { turn: 2, step: 1 } },
    { type: 'step/end', seq: 13, time: 2000, data: { turn: 2, step: 1 } },
    { type: 'turn/end', seq: 14, time: 2100, data: { turn: 2 } },
  ];
  const resources = new TraceResources();
  const stages = new TraceStages(ctx, {
    observe: async () => ({ events: rows, revision: 'r1', source: 'prepared' }), dispose() {}, resources,
    timeout: (fn, ms, signal) => fn(signal || new AbortController().signal),
  });
  try {
    const entry = await stages.load('s', 'synthetic-assets', new AbortController().signal);
    const payload = await stages.stage(entry, 'details');
    const selected = payload.context.goal;
    assert.equal(selected.id, 'b');
    assert.equal(selected.objective, 'Second goal');
    assert.deepEqual(selected.goals.map(row => [row.id, row.objective]), [['a', 'First goal'], ['b', 'Second goal']]);
    assert.deepEqual(selected.markers.map(row => [row.seq, row.goalId, row.operation, row.turn, row.step, row.source]), [
      [3, 'a', 'create', 1, 1, 'event'], [8, 'a', 'clear', null, undefined, 'event'], [12, 'b', 'create', 2, 1, 'event'],
    ]);
    assert.equal(state.opens, 1); assert.equal(state.closes, 1);
  } finally { stages.dispose(); resources.dispose(); }
});

test('the actual npm file set can load the staged trace module', async () => {
  const directory = dirname(fileURLToPath(import.meta.url));
  const temporary = await mkdtemp(join(tmpdir(), 'trajectory-pack-'));
  assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
  try {
    const windows = process.platform === 'win32';
    const packed = spawnSync(windows ? 'cmd.exe' : 'npm', windows
      ? ['/d', '/s', '/c', 'npm pack --dry-run --ignore-scripts --json']
      : ['pack', '--dry-run', '--ignore-scripts', '--json'],
      { cwd: directory, encoding: 'utf8', env: { ...process.env, NPM_CONFIG_CACHE: join(temporary, '.npm-cache') } });
    assert.equal(packed.status, 0, packed.stderr);
    const [manifest] = JSON.parse(packed.stdout);
    for (const file of manifest.files) {
      const destination = resolve(temporary, file.path);
      assert.ok(destination.startsWith(resolve(temporary) + sep));
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(directory, file.path), destination);
    }
    const exported = await import(pathToFileURL(join(temporary, 'lib/trace-stages.js')).href);
    assert.equal(typeof exported.TraceStages, 'function');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
