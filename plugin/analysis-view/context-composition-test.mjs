import assert from 'node:assert/strict';
import test from 'node:test';
import { readContextComposition, readContextContent, summarizeContextFiles } from './lib/trace/models/context-composition.mjs';

const text = value => ({ type: 'text', text: value });
const renderedRead = (path, line) => ['<path>' + path + '</path>', '<type>file</type>', '<content>', '1: ' + line, '</content>'].join('\n');
const message = (role, source, content) => ({ role, source, content });
function fixture() {
  const events = [], messages = new Map();
  const add = (type, data, retained) => {
    const seq = events.length;
    events.push({ seq, type, data });
    if (retained) messages.set(seq, retained);
    return seq;
  };
  const call = (name, callId) => add('tool/call', { name, callId });
  const result = (callId, content, meta) => add('tool/result', { meta }, message('tool', { kind: 'tool', callId }, content));
  const describe = (nodes, timeline) =>
    summarizeContextFiles(events, { nodes, deriveEventMessage: event => messages.get(event.seq) }, timeline, '/repo');
  return { events, messages, add, call, result, describe, summarize: (nodes, timeline) => describe(nodes, timeline).files };
}
const rows = groups => groups.flatMap(group => group.items.map(item => ({ ...item, part: group.part, kind: group.kind, status: group.status })));

test('file evidence separates retained instructions, actual tool content, and path references', () => {
  const f = fixture(), agentPath = '/repo/AGENTS.md';
  const instruction = f.add('user/message', {}, message('user', {
    kind: 'agent-instructions', form: 'instructions', changes: [
      { path: agentPath, scope: 'repo\0AGENTS.md', action: 'set' },
      { path: '/old/AGENTS.md', scope: 'global\0AGENTS.md', action: 'remove' },
    ],
  }, [text('Instructions from: ' + agentPath + '\nRun the tests.')]));
  const attachment = f.add('user/message', {}, message('user', { kind: 'user' },
    [{ type: 'file', attachment: { name: 'inputs.csv' } }]));
  f.call('read', 'read-agents');
  const argument = f.add('assistant/message', {}, message('assistant', { kind: 'model' }, [
    { type: 'reasoning', text: 'Check the instructions.' },
    { type: 'tool-call', id: 'read-agents', name: 'read', arguments: JSON.stringify({ path: agentPath }) },
  ]));
  const returned = f.result('read-agents', [text(renderedRead(agentPath, 'Run the tests.'))]);
  f.call('read', 'dropped');
  f.result('dropped', [text(renderedRead('/repo/dropped.js', 'hidden'))]);
  f.call('read', 'pruned');
  const pruned = f.result('pruned', [text('<path>/repo/pruned.js</path>\n[Pruned]')], { path: '/repo/pruned.js', lines: [1] });
  f.call('skill', 'loaded-skill');
  const skill = f.result('loaded-skill', [text('<skill_content name="validate"><skill_instructions>Validate inputs.</skill_instructions></skill_content>')]);

  const { files: visible, structure } = f.describe([attachment, instruction, argument, returned, pruned, skill],
    { nodes: [{ seq: skill, cat: 'skill' }] });
  assert.equal(structure.history[2].hasReasoning, true);
  assert.deepEqual(structure.history[2].toolInputs, [{ name: 'read', callId: 'read-agents' }]);
  assert.equal(structure.history[3].toolName, 'read');
  assert.equal(structure.history.at(-1).loadedSkill, 'validate');
  const files = rows(visible.groups);
  assert.equal(visible.messageCount, 6);
  assert.deepEqual(files.filter(row => row.path === agentPath).map(row => [row.status, row.part, row.origin, row.logicalPosition]), [
    ['body', 'inject', 'instructions', 2], ['reference', 'assistant', 'argument', 3], ['body', 'tool', 'read', 4],
  ]);
  assert.equal(files.find(row => row.seq === instruction && row.status === 'body').scope, 'repo / AGENTS.md');
  assert.equal(files.find(row => row.path === '/old/AGENTS.md').status, 'reference');
  assert.equal(files.find(row => row.path === 'inputs.csv').status, 'reference');
  assert.deepEqual(files.filter(row => row.kind === 'skill').map(row => [row.part, row.basis, row.path, row.name]),
    [['skill', 'timeline', null, 'validate']]);
  assert.ok(files.every(row => !['/repo/dropped.js', '/repo/pruned.js'].includes(row.path)));
});

test('skill catalogs keep published entries separate from loaded instructions and file reads', () => {
  const f = fixture();
  const entries = [{ name: 'validate', description: 'Check inputs.' }];
  const initial = f.add('user/message', {}, message('user', { kind: 'skill-catalog', entries }, [text('Catalog')]));
  f.call('read', 'ordinary-skill-read');
  const file = f.result('ordinary-skill-read', [text(renderedRead('/repo/validate/SKILL.md', 'Validate inputs.'))]);
  const invoked = f.add('user/message', {}, message('user', { kind: 'skill-invocation', name: 'validate' },
    [text('<skill_content name="validate"><skill_instructions>Validate inputs.</skill_instructions></skill_content>')]));
  const replacement = f.add('user/message', {}, message('user', { kind: 'skill-catalog', entries: [], incomplete: true }, [text('Updated catalog')]));
  const { structure, files } = f.describe([initial, file, invoked, replacement]);
  const [first, read, load, last] = structure.history;
  assert.deepEqual(first.skillCatalog.entries, entries);
  assert.deepEqual(last.skillCatalog, { entries: [], incomplete: true });
  assert.equal(read.loadedSkill, undefined);
  assert.equal(load.loadedSkill, 'validate');
  assert.deepEqual(rows(files.groups).filter(row => row.kind === 'skill').map(row => [row.origin, row.logicalPosition]), [['read', 2], ['skill', 3]]);
});

test('nested tool reads need an outer result and read images have one recorded identity', () => {
  const f = fixture();
  f.call('run_code', 'root');
  const body = renderedRead('/repo/actual.js', 'export const kept = true;');
  const child = f.add('tool/ptc-dispatch', { rootCallId: 'root', name: 'read', content: [text(body)] });
  f.add('tool/ptc-dispatch', { rootCallId: 'root', name: 'read', content: [text(renderedRead('/repo/other.js', 'export const hidden = true;'))] });
  const outer = f.result('root', [text(JSON.stringify({ output: body.slice(0, -10) }))]);
  f.call('read', 'image');
  const image = f.result('image', [{ type: 'image', attachment: { id: 'attachment-id' } }], { path: '/repo/figure.png' });
  f.call('read', 'offloaded-image');
  const offloaded = f.result('offloaded-image', [{ type: 'image', offloaded: true, attachment: { id: 'offloaded-id' } }], { path: '/repo/old.png' });

  const visible = f.summarize([outer, image, offloaded]);
  assert.equal(visible.unconfirmedReads, 1);
  assert.deepEqual(rows(visible.groups).map(row => [row.path, row.origin, row.status, row.seq, row.viaSeq]), [
    ['/repo/actual.js', 'code-mode', 'body', outer, child],
    ['/repo/figure.png', 'read', 'body', image, undefined],
    ['/repo/old.png', 'read', 'reference', offloaded, undefined],
  ]);
});

test('logical order and file locations survive replacements and tool notices stay in history', () => {
  const f = fixture();
  const head = f.add('system/message', {}, message('system', null, [text('Baseline')]));
  const header = f.add('request/header', { header: { tools: [{ name: 'read' }] } });
  const notice = f.add('developer/message', { headerSeq: header, turn: 1 }, message('developer', { kind: 'tool-registry' },
    [{ type: 'tool-addition', toolName: 'read' }]));
  f.call('read', 'old');
  const old = f.result('old', [text(renderedRead('/repo/a.js', 'old result'))]);
  const update = f.add('system/message', { turn: 2 }, message('system', null, [text('Updated system instructions')]));
  const replacement = f.result('old', [text(renderedRead('/repo/a.js', 'replaced result'))]);
  f.events[replacement].data.turn = 1;
  const { structure, files, notifications } = f.describe([head, notice, replacement, update]);
  assert.equal(structure.system.seq, head);
  assert.deepEqual(structure.history.map(slot => [slot.seq, slot.position, slot.role]), [
    [notice, 2, 'developer'], [replacement, 3, 'tool'], [update, 4, 'system'],
  ]);
  assert.deepEqual(structure.layers, [{ turn: 1, start: 0, count: 2 }, { turn: 2, start: 2, count: 1 }]);
  assert.deepEqual(notifications.get('read'), { action: 'add', seq: notice, position: 2, headerSeq: header });
  assert.deepEqual(structure.history[0].toolChanges, [{ action: 'add', name: 'read' }]);
  assert.deepEqual(rows(files.groups).map(row => [row.path, row.seq, row.locations]), [['/repo/a.js', replacement, [3]]]);
  assert.ok(!structure.history.some(slot => slot.seq === old));
});

test('current and historical composition and tool definitions use their own recorded cuts', async () => {
  const categories = { system: 80, tools: 10, user: 8, inject: 6, skill: 4, assistant: 2, tool: 0 };
  const observation = {
    cursor: 3, header: { id: 'fixture' }, events: [
      { seq: 0, type: 'request/header', data: { header: { tools: [{ name: 'read' }] } } },
      { seq: 1, type: 'turn/end', data: { turn: 1 } },
      { seq: 2, type: 'request/header', data: { header: { tools: [{ name: 'read' }, { name: 'write' }] } } },
      { seq: 3, type: 'turn/end', data: { turn: 2 } },
      { seq: 4, type: 'request/header', data: { header: { tools: [{ name: 'future' }] } } },
    ],
    projections: { asOfSeq: 0, values: { contextTimeline: { current: categories } } },
  };
  const snapshot = { asOfSeq: 3, values: {
    contextTimeline: { current: categories },
    contextPressure: { pressureTokens: 120, projectedTokens: 130, contextWindow: 200 },
    contextHeaders: { headers: [
      { seq: 0, tools: [{ name: 'read', plugin: 'other-source', tokens: 8 }] },
      { seq: 2, tools: [{ name: 'read', plugin: 'file-tools', tokens: 10 }, { name: 'write', plugin: 'unknown' }] },
    ] },
  } };
  const replayed = [];
  const ctx = { get: key => key === 'sessions' ? { get: () => ({}) }
    : key === 'sessionProjections' ? { snapshot: () => snapshot, restore(_checkpoint, batch) {
      replayed.push(...batch.map(row => row.seq));
      return { snapshot: { asOfSeq: batch.at(-1).seq, values: {} } };
    } } : undefined };
  const value = await readContextComposition(ctx, observation, 'fixture');
  assert.equal(value.asOfSeq, 3);
  assert.equal(value.composition.source, 'dsh-context');
  assert.equal(value.composition.estimatedTotal, 110);
  assert.equal(value.composition.reportedInput, 120);
  assert.equal(value.composition.percent, 65);
  assert.deepEqual(value.turns.map(point => [point.turn, point.seq]), [[1, 1], [2, 3]]);
  assert.deepEqual(value.tools.items.map(tool => [tool.name, tool.position, tool.plugin, tool.tokens]), [
    ['read', 1, 'file-tools', 10], ['write', 2, null, null],
  ]);

  snapshot.asOfSeq = 4;
  const stale = await readContextComposition(ctx, observation, 'fixture');
  assert.equal(stale.composition.source, null);
  assert.equal(stale.tools.seq, 2);
  assert.equal(stale.tools.items[0].plugin, null);
  replayed.length = 0;
  const earlier = await readContextComposition(ctx, observation, 'fixture', undefined, 1);
  assert.deepEqual(replayed, [0, 1]);
  assert.equal(earlier.asOfSeq, 1);
  assert.equal(earlier.turn, 1);
  assert.deepEqual(earlier.tools.items.map(tool => tool.name), ['read']);
  assert.equal(await readContextComposition(ctx, observation, 'fixture', undefined, 2), null);
  assert.equal(await readContextComposition(ctx, observation, 'fixture', undefined, 4), null);

  assert.equal(await readContextContent(ctx, observation, 1, { tool: 'write' }), null);
  const content = await readContextContent(ctx, observation, 3, { tool: 'write' });
  assert.deepEqual(JSON.parse(content.blocks[0].text), { name: 'write' });
  assert.equal(content.blocks[0].type, 'definition');
  assert.equal(await readContextContent(ctx, observation, 4, { tool: 'future' }), null);
});

async function readOwner(tool, annotation) {
  const snapshot = await readContextComposition({ get() {} }, {
    events: [{ seq: 0, type: 'request/header', data: { header: { tools: [tool] } } }],
    projections: { asOfSeq: 0, values: {
      contextHeaders: { headers: [{ seq: 0, tools: annotation ? [annotation] : [] }] },
    } },
  }, 'fixture');
  const { plugin, pluginBasis } = snapshot.tools.items[0];
  return [plugin, pluginBasis];
}

test('official catalog only fills missing ownership for a matching definition', async () => {
  const official = {
    name: 'get_goal',
    description: 'Read the current session goal, including the id and revision that update_goal requires.',
    parameters: { properties: {}, type: 'object' },
  };
  assert.deepEqual(await readOwner(official), ['@deepseek-ai/dsh-tool-goal', 'dsh-tool-catalog']);
  assert.deepEqual(await readOwner({ ...official, parameters: { type: 'object', properties: { project: { type: 'string' } } } }), [null, null]);
  assert.deepEqual(await readOwner({ ...official, plugin: 'local-goals' }), ['local-goals', 'header']);
  assert.deepEqual(await readOwner(official, { name: official.name, plugin: 'local-goals' }), ['local-goals', 'context-headers']);
});

test('glob recognizes both official over-cap modes and configured limits', async () => {
  const tool = {
    name: 'glob',
    description: 'Find files, not directories, whose paths match a glob pattern, including hidden and ignored files. Returns up to 250 paths in modification-time order; a larger result keeps the first paths and reports where the complete list was saved.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern to match file paths against (e.g. "**/*.ts", "src/**/*.test.js"). A pattern with no "/" matches the basename at any depth, so "*" and "*.ts" both search the whole tree; include a separator to anchor the depth.' },
        path: { type: 'string', description: 'Directory to search in. Defaults to the session workspace; a relative path resolves against it.' },
      },
      required: ['pattern'],
    },
  };
  const expected = ['@deepseek-ai/dsh-tool-fs-search', 'dsh-tool-catalog'];
  assert.deepEqual(await readOwner(tool), expected);
  assert.deepEqual(await readOwner({ ...tool, description: tool.description.replace('keeps the first paths', 'is sampled across top-level entries') }), expected);
  assert.deepEqual(await readOwner({ ...tool, description: tool.description.replace('modification-time order', 'alphabetical order') }), [null, null]);
});

test('the official edit definition can also advertise permission requests', async () => {
  const tool = {
    name: 'edit',
    description: 'Edit an existing UTF-8 text file by replacing literal text.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to edit, resolved by the filesystem backend. Provide `file_path` before `old_string` and `new_string` in the arguments.' },
        old_string: { type: 'string', description: 'Literal text to replace.' },
        new_string: { type: 'string', description: 'Literal replacement text. Use an empty string to delete the match.' },
        replace_all: { type: 'boolean', description: 'Replace all matches. Defaults to false; when false, old_string must appear exactly once.' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  };
  const owner = ['@deepseek-ai/dsh-tool-fs', 'dsh-tool-catalog'];
  assert.deepEqual(await readOwner(tool), owner);
  tool.parameters.properties.sandbox_permissions = {
    type: 'string',
    description: 'The narrowest wider sandbox mode for a one-shot retry of the exact operation the sandbox just denied; the retry asks the user for approval.',
    enum: ['workspace-write', 'danger-full-access'],
  };
  tool.parameters.properties.justification = {
    type: 'string',
    description: 'Required with sandbox_permissions: one sentence for the user explaining why this exact file operation needs the wider access. Use the language of the user’s current request.',
  };
  assert.deepEqual(await readOwner(tool), owner);
  tool.parameters.properties.sandbox_permissions.enum.push('custom-mode');
  assert.deepEqual(await readOwner(tool), [null, null]);
});

test('a framework annotation leaves room for a verified plugin definition', async () => {
  const tool = {
    name: 'trajectory_graph',
    description: '关系链:事件的替换/引用/派生,或会话谱系(祖先/子会话/子代理)。',
    parameters: {
      type: 'object',
      properties: {
        session: { type: 'string', description: '会话 id' },
        seq: { type: 'integer', description: '事件 seq;省略=会话谱系' },
        full: { type: 'boolean', description: 'true=给完整数组,默认只给计数与首尾' },
      },
      required: ['session'],
    },
  };
  const annotation = plugin => ({ name: tool.name, plugin });
  const expected = ['dsh-trajectory-tools', 'plugin-tool-catalog'];
  assert.deepEqual(await readOwner(tool, annotation('@deepseek-ai/cordis')), expected);
  assert.deepEqual(await readOwner(tool, annotation('<unknown-plugin>')), expected);
  assert.deepEqual(await readOwner(tool, annotation('another-plugin')), ['another-plugin', 'context-headers']);
  assert.deepEqual(await readOwner({ ...tool, description: 'Local wrapper' }, annotation('@deepseek-ai/cordis')), [null, null]);
});
