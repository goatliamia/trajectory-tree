import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { decodeRequest } from '../plugin/antigravity/sidecars/context_board/request-records.mjs';
import { projectContext, listConversations, buildConversationSnapshot } from '../plugin/antigravity/sidecars/context_board/context-data.mjs';
import { createContextApi } from '../plugin/antigravity/sidecars/context_board/main.mjs';
import { installAntigravity, INSTALL_FILES } from './install-antigravity.mjs';

const encode = n => { let v = BigInt.asUintN(64, BigInt(n)); const b = []; do { const byte = Number(v & 127n); v >>= 7n; b.push(byte | (v ? 128 : 0)); } while (v); return Buffer.from(b); };
const field = (n, value) => typeof value === 'number' ? Buffer.concat([encode(n * 8), encode(value)]) : Buffer.concat([encode(n * 8 + 2), encode(Buffer.byteLength(value)), Buffer.from(value)]);
const proto = (...parts) => Buffer.concat(parts);
const message = (source, seq, text, extra = []) => proto(field(2, source), field(18, seq), field(3, text), ...extra);
function request({ prompt = true, input = 200, cache = 900, output = 40 } = {}) {
  const section = '<skills>Catalog</skills>';
  const model = proto(field(4, proto(field(2, input), field(5, cache), field(3, output))), field(9, field(2, -1)),
    ...(prompt ? [field(1, 'Identity\n' + section), field(16, proto(field(1, 'skills'), field(2, section), field(6, 1))),
      field(8, proto(field(1, 'read_file'), field(2, 'Read a file'), field(3, '{"type":"object"}'))),
      field(2, message(1, 0, 'Hello')),
      field(2, message(2, 1, 'Visible reply', [field(11, 'PRIVATE_THINKING'), field(12, 'PRIVATE_SIGNATURE'), field(6, proto(field(1, 'call-1'), field(2, 'read_file'), field(3, '{"Path":"/project/skills/example/SKILL.md"}')))])),
      field(2, message(4, 2, 'Skill body', [field(7, 'call-1')])),
      field(2, message(4, 3, 'Unrelated SKILL.md mention', [field(7, 'other-call')]))] : []));
  return proto(field(1, model), field(2, encode(4)));
}
const conversation = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
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
