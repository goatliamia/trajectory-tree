import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readCodexThread } from '../../analyzers/codex-reader.mjs';
import { createPiSample } from '../../analyzers/pi-sample.mjs';
import piExtension from './pi.mjs';

const temp = await mkdtemp(join(tmpdir(), 'trajectory-transports-'));
assert.equal(dirname(resolve(temp)), resolve(tmpdir())); assert.ok(basename(temp).startsWith('trajectory-transports-'));
const root = dirname(fileURLToPath(import.meta.url)), input = createPiSample({ version: '1.4.0' });
let client;
try {
  const appData = join(temp, 'appdata');
  const appServer = join(appData, 'npm/node_modules/@openai/codex/bin/codex.js');
  const search = '搜索结果\u2028第二行\u2029下一段';
  const encoded = 'iVBORw0KGgo' + 'A'.repeat(64 * 1024);
  await mkdir(dirname(appServer), { recursive: true });
  await writeFile(appServer, `
const { createInterface } = require('node:readline');
const search = ${JSON.stringify(search)};
const encoded = ${JSON.stringify(encoded)};
const responses = {
  initialize: {},
  'thread/read': { thread: { id: 'fixture', historyMode: 'paginated' } },
  'thread/turns/list': { data: [{ id: 'turn' }] },
  'thread/items/list': { data: [
    { turnId: 'turn', item: { id: 'item', type: 'webSearch', query: search } },
    { turnId: 'turn', item: { id: 'image', type: 'imageGeneration', status: 'completed', result: encoded } },
  ] },
};
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method } = JSON.parse(line);
  if (id == null) return;
  const response = Buffer.from(JSON.stringify({ id, result: responses[method] }) + '\\r\\n');
  const split = response.indexOf(Buffer.from('\\u2028'));
  if (split === -1) { process.stdout.write(response); return; }
  process.stdout.write(response.subarray(0, split + 1));
  setTimeout(() => process.stdout.write(response.subarray(split + 1)), 10);
});
`);
  const previousAppData = process.env.APPDATA;
  try {
    process.env.APPDATA = appData;
    const snapshot = await readCodexThread('fixture', { executable: process.execPath });
    const [searchItem, image] = snapshot.thread.turns[0].items;
    assert.equal(searchItem.query, search, 'Codex JSONL preserves Unicode separators, even across UTF-8 chunks');
    assert.equal(image.id, 'image');
    assert.equal(image.status, 'completed');
    assert.match(image.result, /^\[inline image omitted image\/png \d+B [a-f0-9]{64}\]$/);
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
  }

  const file = join(temp, 'native.jsonl'), capture = join(temp, 'capture.jsonl');
  await writeFile(file, [input.header, ...input.entries].map(JSON.stringify).join('\n') + '\n');
  await writeFile(capture, input.capture.map(JSON.stringify).join('\n') + '\n');
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'mcp.mjs'), '--host', 'pi', '--file', file, '--capture', capture, '--synthetic'], stderr: 'pipe' });
  client = new Client({ name: 'trajectory-integration-test', version: '1.0.0' }); await client.connect(transport);
  const tools = await client.listTools(); assert.equal(tools.tools.length, 4); assert.ok(tools.tools.every(t => t.annotations.readOnlyHint));
  const report = JSON.parse((await client.callTool({ name: 'trajectory_inspect', arguments: { view: 'overview' } })).content[0].text);
  assert.equal(report.summary.calls, 12); assert.equal(report.synthetic, true);
  const failure = await client.callTool({ name: 'trajectory_inspect', arguments: { view: 'bad' } }); assert.equal(failure.isError, true);
  const io = JSON.parse((await client.callTool({ name: 'trajectory_inspect', arguments: { snapshot: report.snapshot, view: 'io' } })).content[0].text); assert.ok(io.rows.length);
  await client.close(); client = null;

  const commandFile = join(temp, 'command.json');
  await writeFile(commandFile, JSON.stringify({ thread: { id: 'command-session', createdAt: 1767225600, turns: [{
    id: 'turn', startedAt: 1767225600, status: 'completed', completedAt: 1767225601, items: [{
      id: 'cmd', type: 'commandExecution', command: 'pwsh.exe -Command rg broken src',
      status: 'failed', exitCode: 1, aggregatedOutput: 'rg: regex parse error:',
    }],
  }] } }));
  const commandTransport = new StdioClientTransport({ command: process.execPath, args: [
    join(root, 'mcp.mjs'), '--commands', '--host', 'codex', '--file', commandFile, '--api-only',
  ], stderr: 'pipe' });
  client = new Client({ name: 'command-diagnosis-test', version: '1.0.0' }); await client.connect(commandTransport);
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['trajectory_command_diagnose']);
  const diagnosis = await client.callTool({ name: 'trajectory_command_diagnose', arguments: { seqs: [2] } });
  const row = JSON.parse(diagnosis.content[0].text).rows[0];
  assert.equal(row.cause.kind, 'pattern'); assert.equal(row.syntax.state, 'no-source');
  await client.close(); client = null;

  const cli = args => JSON.parse(execFileSync(process.execPath, [resolve(root, '../../scripts/trajectory-query.mjs'), '--host', 'pi', '--file', file, '--synthetic', ...args], { encoding: 'utf8', windowsHide: true }));
  const first = cli(['--args', '{"limit":2}']), second = cli(['--args', JSON.stringify({ cursor: first.cursor, snapshot: first.snapshot })]);
  assert.equal(second.rows[0].turn, 3, 'CLI rebuilds only an identical frozen cut');
  const { tool: readTool, linked, ...readArgs } = first.rows[0].read;
  const nativeRead = cli(['--tool', readTool, '--args', JSON.stringify(readArgs)]); assert.ok(nativeRead.native.entryId, 'native session ID in a pointer works across CLI processes');

  const hooks = new Map(), registered = new Map(), commands=new Map();
  const pi = { registerCommand:(name,command)=>commands.set(name,command), on: (event, handler) => hooks.set(event, handler), registerTool: tool => registered.set(tool.name, tool), getActiveTools: () => ['read'], getAllTools: () => [{ name: 'read', description: 'Read files', parameters: { type: 'object' }, exposure: 'inline' }, { name: 'rare_but_needed', description: 'Recover a missing resource', parameters: { type: 'object' }, exposure: 'deferred' }] };
  piExtension(pi); assert.equal(registered.size, 4);
  assert.ok(commands.has('trajectory'),'Pi has a native /trajectory command');
  let notice;await commands.get('trajectory').handler('--unknown',{ui:{notify:text=>{notice=text;}}});assert.ok(notice.startsWith('用法：/trajectory'));
  const ctx = { cwd: input.header.cwd, model: { id: 'pi-demo-model', provider: 'synthetic-provider', contextWindow: 200000 }, getSystemPrompt: () => 'Current assembled system prompt', sessionManager: { getSessionId: () => input.header.id, getSessionFile: () => file, getEntries: () => input.entries, getLeafId: () => input.entries.at(-1).id } };
  const handler = commands.get('trajectory').handler;
  let editorText = '', writes = 0;
  const draftCtx = { ...ctx, mode: 'tui', hasUI: true, ui: {
    notify: text => { notice = text; }, getEditorText: () => editorText,
    setEditorText: text => { editorText = text; writes++; },
  } };
  const command = (session, prompt) => '--draft ' + Buffer.from(JSON.stringify({ session, prompt })).toString('base64url');
  const prompt = '请检查第 2 轮的工具调用。\n先核对原始记录。';
  const draft = command(input.header.id, prompt);
  await handler('--draft invalid', draftCtx);
  assert.match(notice, /无效/);
  await handler(command('other-session', prompt), draftCtx);
  assert.match(notice, /另一个/);
  await handler(command(input.header.id, '长'.repeat(2800)), draftCtx);
  assert.match(notice, /无效/);
  await handler(draft, { ...draftCtx, mode: 'rpc' });
  assert.match(notice, /复制提示词/);
  assert.equal(writes, 0);
  await handler(draft, draftCtx);
  assert.equal(editorText, prompt);
  assert.equal(writes, 1);
  await handler(command(input.header.id, '替换'), draftCtx);
  assert.match(notice, /已保留/);
  assert.equal(editorText, prompt);
  assert.equal(writes, 1);
  for (const row of input.capture) if (hooks.has(row.event.type)) hooks.get(row.event.type)(row.event, ctx);
  const result = await registered.get('trajectory_inspect').execute('analysis', { view: 'cost', groupBy: 'definition' }, undefined, undefined, ctx), native = JSON.parse(result.content[0].text);
  assert.equal(native.rows.length, 2); assert.equal(native.rows.find(r => r.tool === 'rare_but_needed').active, false); assert.equal(native.scope.configuredTools, 2);
  assert.equal(native.scope.activeTools, 1); assert.equal(native.latestRecordedInput.contextWindow, 200000);
  const abort = new AbortController(); abort.abort(); await assert.rejects(registered.get('trajectory_inspect').execute('cancel', {}, abort.signal, undefined, ctx));
  hooks.get('session_shutdown')();
} finally { if (client) await client.close(); await rm(temp, { recursive: true, force: true }); }
console.log('Transport tests passed: Codex JSONL framing, real MCP stdio handshake and four tools, native Pi registration/context/timing callbacks, CLI snapshot continuation and cancellation.');
