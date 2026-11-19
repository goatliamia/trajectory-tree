import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { decodeRequest } from '../plugin/antigravity/sidecars/context_board/request-records.mjs';
import { projectContext, listConversations, buildConversationSnapshot } from '../plugin/antigravity/sidecars/context_board/context-data.mjs';
import { createContextApi } from '../plugin/antigravity/sidecars/context_board/main.mjs';
import { summarizeUsage } from '../plugin/antigravity/sidecars/context_board/usage-data.mjs';
import { installAntigravity, INSTALL_FILES } from './install-antigravity.mjs';

const encode = n => { let v = BigInt.asUintN(64, BigInt(n)); const b = []; do { const byte = Number(v & 127n); v >>= 7n; b.push(byte | (v ? 128 : 0)); } while (v); return Buffer.from(b); };
const field = (n, value) => typeof value === 'number' ? Buffer.concat([encode(n * 8), encode(value)]) : Buffer.concat([encode(n * 8 + 2), encode(Buffer.byteLength(value)), Buffer.from(value)]);
const proto = (...parts) => Buffer.concat(parts);
const message = (source, seq, text, extra = []) => proto(field(2, source), field(18, seq), field(3, text), ...extra);
const duration = value => proto(field(1, Math.floor(value)), field(2, Math.round((value % 1) * 1e9)));
function request({ prompt = true, input = 200, cache = 900, output = 40, seq = 4, capacity, used, stream } = {}) {
  const section = '<skills>Catalog</skills>';
  const window = proto(...[[1, used], [4, capacity]].filter(([,v]) => v != null).map(([k,v]) => field(k,v)));
  const model = proto(field(4, proto(field(2, input), field(5, cache), field(3, output))),
    field(9, proto(field(2, -1), ...(window.length ? [field(10, window)] : []))),
    ...(stream == null ? [] : [field(12, duration(stream))]),
    ...(prompt ? [field(1, 'Identity\n' + section), field(16, proto(field(1, 'skills'), field(2, section), field(6, 1))),
      field(8, proto(field(1, 'read_file'), field(2, 'Read a file'), field(3, '{"type":"object"}'))),
      field(2, message(1, 0, 'Hello')),
      field(2, message(2, 1, 'Visible reply', [field(11, 'PRIVATE_THINKING'), field(12, 'PRIVATE_SIGNATURE'), field(6, proto(field(1, 'call-1'), field(2, 'read_file'), field(3, '{"Path":"/project/skills/example/SKILL.md"}')))])),
      field(2, message(4, 2, 'Skill body', [field(7, 'call-1')])),
      field(2, message(4, 3, 'Unrelated SKILL.md mention', [field(7, 'other-call')]))] : []));
  return proto(field(1, model), field(2, encode(seq)));
}
const conversation = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
test('project, calendar and mode filters count dated requests under their main conversation', () => {
  const now = new Date(2026,10,19,12).getTime(), boundary = new Date(2026,10,13).getTime();
  const row = (requestId, at, mode, responseModel, outputTokens, streamSeconds) => ({requestId,at,mode,responseModel,outputTokens,streamSeconds});
  const first = row('a', boundary, 'Orchestrator (Carbon)','gemini-pro-orchestrator',30,3);
  const chats = [
    {id:'root',title:'Project Alpha',project:'a',parents:[],records:[first,row('old',boundary-1,'X (High)','x',800,2)]},
    {id:'child',parent:'root',parents:['root'],records:[first,row('b',now,'Gemini (Orchestrator)','gemini-flash-worker',90,1),row('unknown',null,'X (High)','x',7,1)]},
    {id:'other',project:'b',parents:[],records:[row('c',now,'X (High)','x',5,1)]}
  ];
  const opts = {group:'mode',days:'7',project:'a',now};
  const scoped = summarizeUsage(chats,'',opts);
  assert.equal(scoped.conversations.length,1); assert.equal(scoped.conversations[0].title,'Project Alpha');
  assert.equal(scoped.conversations[0].children,1); assert.equal(scoped.totals.totalTokens,120);
  assert.equal(scoped.totals.tps,30); assert.equal(scoped.sharedRequests,1); assert.equal(scoped.undatedRequests,1);
  assert.deepEqual(scoped.models,['协作']);assert.equal(scoped.projects.length,2);
  assert.deepEqual(scoped.conversations[0].modelUsage.map(f => [f.name,f.totalTokens,f.modes[0].roles]),[
    ['Carbon',30,['调度']],['Gemini',90,['执行']]]);
  assert.deepEqual(scoped.speeds.map(r=>r.tps).sort((a,b)=>a-b),[10,90]);
  assert.equal(summarizeUsage(chats,'',{...opts,days:0}).totals.totalTokens,927);
  assert.equal(summarizeUsage(chats,'高强度',opts).conversations.length,0);
});

test('model columns retain distinct families at the same intensity and aggregate a family across modes', () => {
  const records = [
    ['Alpha (High)','alpha-high',70], ['Alpha (Medium)','alpha-med',10], ['Beta (High)','beta',15],
    [null,'response-only',5], [null,null,null], ['Beta (High)',null,0]
  ].map(([mode,responseModel,outputTokens]) => ({mode,responseModel,outputTokens}));
  const chats = [{id:'one',title:'One',parents:[],records}];
  const all = summarizeUsage(chats,'',{group:'mode'}).conversations[0];
  assert.deepEqual(all.modelUsage.map(m => [m.name,m.totalTokens]), [
    ['Alpha',80],['Beta',15],['response-only',5],['未记录模型',null]]);
  assert.deepEqual(all.modelUsage[0].modes.map(m => [m.name,m.totalTokens]),[['高强度',70],['中强度',10]]);
  const scoped = summarizeUsage(chats,'高强度',{group:'mode'}).conversations[0];
  assert.equal(scoped.allModeTokens,100); assert.equal(scoped.totalTokens,85);
  assert.deepEqual(scoped.modelUsage.map(m => [m.name,m.requests,m.totalTokens]),[['Alpha',1,70],['Beta',2,15]]);
});

test('tool Eval counts execution status and pairs start/completion times on the same native step', async t => {
  const f = fixture(t), db = new DatabaseSync(f.dbPath);
  db.exec('CREATE TABLE steps(idx INTEGER, status INTEGER, metadata BLOB)');
  const put = db.prepare('INSERT INTO steps VALUES (?,?,?)');
  const call = field(4,proto(field(2,'read_file')));
  put.run(2,3,proto(call,field(32,duration(10)),field(8,duration(12))));
  put.run(3,7,proto(call,field(32,duration(20)),field(8,duration(19))));
  put.run(4,6,call); db.close();
  const snap = await createContextApi({dirs:[f.root],conversationId:conversation}).context({});
  const tool = snap.toolEval.all[0];
  assert.deepEqual([tool.calls,tool.done,tool.error,tool.stopped,tool.timed,tool.seconds],[3,1,1,1,1,2]);
  assert.deepEqual(tool.errors,[3]); assert.deepEqual(snap.toolEval.byTurn[1],[tool]);
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'trajectory-antigravity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'brain', conversation, '.system_generated/logs/transcript_full.jsonl');
  mkdirSync(dirname(path), { recursive: true }); mkdirSync(join(root, 'conversations'));
  writeFileSync(path, [{ step_index: 0, type: 'USER_INPUT', content: 'Hello' }, { step_index: 4, type: 'PLANNER_RESPONSE' }].map(r => JSON.stringify(r)).join('\n'));
  const dbPath = join(root, 'conversations', conversation + '.db'), db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB)');
  db.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(0, request()); db.close();
  return { root, path, dbPath };
}

test('native prompt sections, call identities and hidden fields retain their evidence boundaries', () => {
  const decoded = decodeRequest(request(), 0);
  assert.equal(decoded.windowTokens, 1100); assert.equal(decoded.checkpoint, null);
  const { context, fullBodies } = projectContext(decoded);
  assert.ok(context.items.some(i => i.name === 'Skill catalog · 目录'));
  assert.equal(context.items.find(i => i.seq === 2).category, 'skill');
  assert.equal(context.items.find(i => i.seq === 3).category, 'tool');
  assert.equal([...fullBodies.values()].filter(body => body.includes('Catalog')).length, 1);
  assert.doesNotMatch(JSON.stringify([...fullBodies.values()]), /PRIVATE_THINKING|PRIVATE_SIGNATURE/);
  assert.notEqual(context.totals.total, decoded.windowTokens);
  assert.throws(() => decodeRequest(Buffer.from([10, 127]), 0), /Truncated/);
});

test('API binds exact sessions and rejects stale bodies without selecting a different chat', async t => {
  const f = fixture(t), api = createContextApi({ dirs: [f.root] });
  assert.equal((await api.context({})).empty, true);
  assert.equal((await api.context({ conversationId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' })).empty, true);
  const snap = await api.context({ conversationId: conversation });
  assert.equal(snap.source.kind, 'recorded-request'); assert.equal(snap.currentWindow, 1100);
  assert.equal((await api.context({ conversationId: conversation, etag: snap.etag })).unchanged, true);
  assert.equal((await api.body({ session: conversation, version: 'stale', item: 'message-0' })).status, 409);
  assert.equal((await api.body({ session: conversation, version: snap.version, item: 'message-0' })).text, 'Hello');
  const db = new DatabaseSync(f.dbPath); db.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(1, request({ prompt: false, input: 100 })); db.close();
  const time = new Date(Date.now() + 1000); utimesSync(f.dbPath, time, time);
  const updated = await api.context({ conversationId: conversation });
  assert.equal(updated.currentWindow, 1000); assert.equal(updated.currentContext.available, false);
  assert.deepEqual(updated.currentContext.items, []);
  assert.equal((await api.body({ session: conversation, version: snap.version, item: 'message-0' })).status, 409);
});

test('WAL updates invalidate a cached snapshot before a checkpoint reaches the database file', async t => {
  const f = fixture(t), db = new DatabaseSync(f.dbPath); db.exec('PRAGMA journal_mode=WAL');
  try {
    const entry = listConversations([f.root])[0], first = await buildConversationSnapshot(entry);
    db.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(1, request({ input: 500 }));
    const second = await buildConversationSnapshot(entry);
    assert.notEqual(second.version, first.version); assert.equal(second.currentWindow, 1400);
  } finally { db.close(); }
});

test('transcript fallback includes cache writes in request totals, deltas and cache hit rate', async t => {
  const f = fixture(t);
  const entry = { id: conversation, path: f.path, dbPath: join(f.root, 'absent.db') };
  writeFileSync(f.path, [
    { step_index: 0, type: 'USER_INPUT' },
    { step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 100, cache_read_tokens: 50, cache_write_tokens: 25 },
    { step_index: 2, type: 'PLANNER_RESPONSE', cache_write_tokens: 40 },
  ].map(JSON.stringify).join('\n'));
  const snap = await buildConversationSnapshot(entry);
  assert.deepEqual(snap.trendSeries.map(r => r.windowTokens), [175, 40]);
  assert.equal(snap.currentWrite, 40);
  assert.equal(snap.totalWrite, 65);
  assert.equal(snap.cacheHitRate, 23.3);
  assert.equal(snap.trendSeries[1].deltaTokens, -135);
});

test('an unchanged database can recover after a transient read lock', async t => {
  const f = fixture(t), api = createContextApi({ dirs: [f.root], conversationId: conversation });
  const db = new DatabaseSync(f.dbPath);
  let fallback;
  try {
    db.exec('BEGIN EXCLUSIVE');
    fallback = await api.context({});
    assert.equal(fallback.currentContext.available, false);
    assert.ok(fallback.source.error);
    db.exec('ROLLBACK');
  } finally { db.close(); }
  const restored = await api.context({ etag: fallback.etag });
  assert.equal(restored.currentContext?.available, true);
  assert.equal(restored.currentWindow, 1100);
  assert.equal((await api.context({ etag: restored.etag })).unchanged, true);
});

const secondChat = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
function usageRecord(id, model, counts, stream, first, responseModel) {
  return field(1, proto(...(model ? [field(21, model)] : []), ...(responseModel ? [field(19, responseModel)] : []),
    field(4, proto(field(11, id), ...counts.map(([k, n]) => field(k, n)))),
    ...(stream == null ? [] : [field(12, duration(stream))]), ...(first == null ? [] : [field(11, duration(first))])));
}

test('turns use all requests, retain intra-turn peaks and missing boundaries, and serve the exact selected turn', async t => {
  const f = fixture(t), db = new DatabaseSync(f.dbPath);
  writeFileSync(f.path, [10, 200, 200, 300, 400].map(step_index => JSON.stringify({ type: 'USER_INPUT', step_index })).join('\n') +
    '\n' + JSON.stringify({type: 'CHECKPOINT', step_index: 81}));
  try {
    db.exec('BEGIN; DELETE FROM gen_metadata');
    const insert = db.prepare('INSERT INTO gen_metadata VALUES (?, ?)');
    for (let seq = 5; seq <= 205; seq++) {
      insert.run(seq, request({ seq, input: seq === 82 ? 12000 : seq === 205 ? 10 : seq, cache: 0, prompt: false }));
    }
    insert.run(402, request({ seq: 402, input: 500, cache: 0, prompt: false }));
    db.exec('COMMIT');
  } finally { db.close(); }
  const api = createContextApi({ dirs: [f.root], conversationId: conversation });
  const snap = await api.context({});
  assert.equal(snap.turns, 4);
  assert.deepEqual(snap.turnSeries.map(r => [r.turn, r.requests]), [[0,5],[1,190],[2,6],[3,0],[4,1]]);
  assert.equal(snap.turnSeries[1].peak, 12000);
  assert.equal(snap.turnSeries[1].windowTokens, 199);
  assert.equal(snap.turnSeries[1].deltaTokens, null);
  assert.equal(snap.turnSeries[2].deltaTokens, -189);
  assert.equal(snap.turnSeries[1].checkpoints, 1);
  assert.equal(snap.turnSeries[3].windowTokens, null); assert.equal(snap.turnSeries[4].deltaTokens, null);
  assert.equal(snap.recentSteps.length, 60); assert.ok(snap.trendSeries.length < snap.plannerSteps);
  assert.equal(snap.turnDetail, undefined);
  const first = await api.context({ turn: '1', etag: snap.etag });
  assert.equal(first.version, snap.version); assert.notEqual(first.etag, snap.etag);
  assert.equal(first.turnDetail.rows.length, 190); assert.equal(first.turnDetail.rows[0].seq, 10);
  assert.equal(first.turnDetail.rows.at(-1).seq, 199);
  assert.doesNotMatch(JSON.stringify(first.turnDetail), /PRIVATE_|messagePrompts|system_prompt/);
  assert.equal((await api.context({ turn: '1', etag: first.etag })).unchanged, true);
  assert.equal((await api.context({ turn: '2', etag: first.etag })).turnDetail.rows.length, 6);
  assert.equal((await api.context({ turn: '0' })).turnDetail.rows.length, 5);
  assert.equal((await api.context({ turn: '99' })).turnDetail, undefined);
});

test('single-chat speed and occupancy use paired measurements, handle zero and do not borrow an earlier capacity', async t => {
  const f = fixture(t), api = createContextApi({ dirs: [f.root], conversationId: conversation });
  const db = new DatabaseSync(f.dbPath);
  try {
    db.exec('PRAGMA journal_mode=WAL; DELETE FROM gen_metadata');
    const put = (seq, data) => db.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(seq,request({ seq, prompt: false, ...data }));
    put(1, { input: 100, cache: 0, output: 80, stream: 2, capacity: 2000, used: 600 });
    put(2, { input: 150, cache: 100, output: 40, stream: .25, capacity: 1000, used: 400 });
    let snap = await api.context({});
    assert.deepEqual(snap.occupancy, {used:400,capacity:1000,basis:'host-estimate',percent:40});
    assert.equal(snap.currentWindow, 250); assert.equal(snap.currentTps, 160);
    assert.equal(snap.averageTps, 120/2.25); assert.equal(snap.timedRequests, 2);
    put(3, { input: 25, cache: 25, stream: 0, capacity: 500 });
    snap = await api.context({});
    assert.deepEqual(snap.occupancy, {used:50,capacity:500,basis:'reported-input',percent:10});
    assert.equal(snap.currentTps, null); assert.equal(snap.averageTps, 120/2.25);
    put(4, { capacity: 800, used: 0, output: 0, stream: 1 });
    snap = await api.context({}); assert.equal(snap.currentTps, 0); assert.equal(snap.occupancy.percent, 0);
    put(5, {}); snap = await api.context({}); assert.equal(snap.occupancy, null);
  } finally { db.close(); }
});

test('mode heatmap separates host modes sharing a response model and keeps the all-mode denominator under filtering', async t => {
  const f = fixture(t), db = new DatabaseSync(f.dbPath);
  try {
    db.exec('DELETE FROM gen_metadata');
    const insert = db.prepare('INSERT INTO gen_metadata VALUES (?, ?)');
    insert.run(0, usageRecord('a', 'Family (High)', [[2,70],[3,10]], .5, 1, 'runtime-a'));
    insert.run(1, usageRecord('b', 'Family (Medium)', [[2,10],[3,10]], 1, 1, 'runtime-a'));
    insert.run(2, usageRecord('c', null, [], null, null, 'runtime-b'));
    insert.run(3, usageRecord('b', 'Family (Medium)', [[2,10],[3,10]], 1, 1, 'runtime-a'));
  } finally { db.close(); }
  const api = createContextApi({ dirs: [f.root] });
  const all = await api.usage(), chat = all.conversations[0];
  assert.equal(all.sharedRequests, 1); assert.equal(chat.allModeTokens, 100);
  assert.deepEqual(chat.byMode.map(m => [m.name,m.totalTokens,m.responseModels]), [
    ['Family (High)',80,['runtime-a']], ['Family (Medium)',20,['runtime-a']], ['未记录模式',null,['runtime-b']] ]);
  const filtered = await api.usage({mode:'Family (Medium)'});
  assert.equal(filtered.conversations[0].totalTokens,20); assert.equal(filtered.conversations[0].allModeTokens,100);
  assert.equal(filtered.conversations[0].byMode.length,1); assert.equal(filtered.totals.tps,10);
  assert.equal((await api.usage({model:'Family (Medium)'})).etag,filtered.etag);
});

test('all-history overview counts forked responses once and weights throughput by timed output and streaming seconds', async t => {
  const f = fixture(t), parent = new DatabaseSync(f.dbPath);
  const shared = usageRecord('response-one', 'Model A', [[2, 100], [3, 100], [4, 20], [5, 200]], 0.5, 0.25);
  parent.prepare('UPDATE gen_metadata SET data = ? WHERE idx = 0').run(shared); parent.close();
  const fork = new DatabaseSync(join(f.root, 'conversations', secondChat + '.db'));
  fork.exec('CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY, data BLOB); CREATE TABLE parent_references(data BLOB)');
  fork.prepare('INSERT INTO parent_references VALUES (?)').run(field(6, conversation));
  const insert = fork.prepare('INSERT INTO gen_metadata VALUES (?, ?)');
  insert.run(0, shared);
  insert.run(1, usageRecord('response-two', 'Model B', [[2, 10], [3, 60]], 1.5, 0.75));
  insert.run(2, usageRecord('response-three', 'Model A', [[2, 20], [3, 500]], 0, null));
  insert.run(3, usageRecord('no-counters', 'Model B', [], null, null));
  insert.run(4, field(7, 'injected step'));
  fork.close();
  const catalog = new DatabaseSync(join(f.root, 'conversation_summaries.db'));
  catalog.exec('CREATE TABLE conversation_summaries(conversation_id TEXT, title TEXT)');
  catalog.prepare('INSERT INTO conversation_summaries VALUES (?, ?)').run(secondChat, 'Fork title'); catalog.close();
  const api = createContextApi({ dirs: [f.root], conversationId: secondChat });
  const [a, b] = await Promise.all([api.usage({}), api.usage({ model: 'Model A' })]);
  assert.equal(a.totals.requests, 4); assert.equal(a.totals.completeRequests, 3); assert.equal(a.sharedRequests, 1);
  assert.equal(a.totals.totalTokens, 1010); assert.equal(a.totals.tps, 80); assert.equal(a.totals.timedRequests, 2);
  assert.equal(a.totals.firstTokenSeconds, 0.5); assert.equal(a.totals.firstRequests, 2);
  assert.equal(a.conversations.find(c => c.id === conversation).totalTokens, 420);
  assert.equal(a.conversations.find(c => c.title === 'Fork title').totalTokens, 590);
  assert.equal(b.totals.requests, 2); assert.equal(b.totals.outputTokens, 600); assert.equal(b.totals.tps, 200);
  assert.equal(b.byModel.length, 1); assert.deepEqual(b.models, ['Model A', 'Model B']);
  assert.doesNotMatch(JSON.stringify(a), /response-one|PRIVATE_|Skill body|requestId/);
  assert.equal((await api.usage({ etag: a.etag })).unchanged, true);
  // An archived DB without a brain directory remains selectable for detail.
  assert.equal((await api.context({ conversationId: secondChat })).conversationId, secondChat);
});

test('overview spans the whole catalog and keeps transcript-only, zero and unknown metrics distinct', async t => {
  const f = fixture(t);
  for (let i = 0; i < 10; i++) {
    const id = 'cccccccc-cccc-cccc-cccc-' + String(i).padStart(12, '0');
    const path = join(f.root, 'brain', id, '.system_generated/logs/transcript.jsonl');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', cache_write_tokens: 8, output_tokens: 0, created_at: '2026-11-01T00:00:00Z' }));
  }
  const api = createContextApi({ dirs: [f.root] });
  assert.equal((await api.context({})).conversations.length, 8);
  const all = await api.usage();
  assert.equal(all.conversations.length, 11); assert.equal(all.transcriptChats, 10);
  assert.equal(all.totals.totalTokens, 1220); assert.equal(all.totals.outputTokens, 40);
  assert.equal(all.totals.tps, null); assert.equal(all.totals.firstTokenSeconds, null);
  const db = new DatabaseSync(f.dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  try {
    db.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(1, usageRecord('new', 'New model', [[3, 20]], 0.5, 0));
    const update = await api.usage({ etag: all.etag });
    assert.equal(update.totals.totalTokens, 1240); assert.equal(update.totals.tps, 40);
    assert.equal(update.totals.firstTokenSeconds, 0);
    const selected = await api.usage({ model: 'New model' });
    assert.equal(selected.totals.inputTokens, null); assert.equal(selected.totals.outputTokens, 20);
  } finally { db.close(); }
  const none = await createContextApi({ dirs: [] }).usage();
  assert.equal(none.totals.totalTokens, null); assert.equal(none.conversations.length, 0);
});

test('overview retries a locked native database and replaces provisional transcript numbers', async t => {
  const f = fixture(t), api = createContextApi({ dirs: [f.root] });
  const db = new DatabaseSync(f.dbPath);
  try {
    db.exec('BEGIN EXCLUSIVE');
    const fallback = await api.usage();
    assert.equal(fallback.transcriptChats, 1); assert.equal(fallback.totals.totalTokens, null);
    db.exec('ROLLBACK');
    const recovered = await api.usage({ etag: fallback.etag });
    assert.equal(recovered.transcriptChats, 0); assert.equal(recovered.totals.totalTokens, 1140);
  } finally { db.close(); }
});

test('800k estimated tokens stay out of list payloads while the body remains readable', () => {
  const decoded = decodeRequest(request(), 0), body = 'x'.repeat(3_040_000);
  decoded.messages = [{ seq: 1, source: 4, content: body, calls: [] }];
  const { context, fullBodies } = projectContext(decoded);
  assert.ok(context.totals.total >= 800_000);
  assert.ok(JSON.stringify(context).length < 10_000);
  assert.equal(fullBodies.get('message-0'), body);
});

test('install contains only frontend runtime files and removes its own legacy skill', t => {
  const root = mkdtempSync(join(tmpdir(), 'trajectory-antigravity-install-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'skills/ctx'), { recursive: true }); writeFileSync(join(root, 'skills/ctx/SKILL.md'), 'sidecar://trajectory-tree/context_board/');
  installAntigravity(root);
  for (const file of INSTALL_FILES) assert.ok(existsSync(join(root, file)), file);
  assert.equal(existsSync(join(root, 'skills/ctx/SKILL.md')), false);
  assert.equal(existsSync(join(root, 'mcp_config.json')), false);
  assert.doesNotMatch(readFileSync(join(root, 'plugin.json'), 'utf8'), /\/ctx|trace-analysis|context-profile/);
});
