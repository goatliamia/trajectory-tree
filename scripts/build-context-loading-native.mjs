// Local preview bridge. Native transcript content stays under ignored .dsh/.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { buildInjectionIndex } from '../analyzers/context-evidence.mjs';

const root = new URL('../', import.meta.url);
const demo = new URL('docs/demo/context-loading/', root);
const input = new URL('.dsh/diagnostic-pilot/repair/', root);
const output = new URL('.dsh/context-loading-native/', root);
const meta = JSON.parse(readFileSync(new URL('meta.json', input), 'utf8'));
const events = readFileSync(new URL('events.jsonl', input), 'utf8').trim().split('\n').map(JSON.parse);
const require = createRequire(import.meta.url);
const sdk = createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
const { SurfaceManager } = await import(pathToFileURL(sdk.resolve('@deepseek-ai/dsh-session/surface')).href);
const firstModel = events.find(e => e.type === 'assistant/message');
const header = events.find(e => e.type === 'request/header' && e.seq < firstModel.seq);
const cut = events.findLast(e => e.type === 'request/context' && e.seq < firstModel.seq)?.seq ?? header.seq;
const index = at => buildInjectionIndex({ session: meta.session, events, SurfaceManager, asOfSeq: at });
const last = index(cut);
const linkedQueues = last.records.flatMap(r => r.queued ? [r.queued.seq] : []);
const start = Math.min(...linkedQueues, ...last.slots.map(s => s.seq));
const firstTime = events[start].time;
const text = m => (m?.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
const labels = { 'system-prompt': '系统提示', 'user-approval': '审批策略变更', user: '用户消息', 'agent-instructions': '工作区指令', 'runtime-context': '运行环境', 'skill-catalog': 'Skill 目录', 'time-context': '时间上下文' };
const fragments = {};
const describe = (message, seq = null) => {
  const key = message.id || 'seq:' + seq;
  if (!fragments[key]) {
    const source = message.source || {}, body = text(message);
    fragments[key] = { id: key, label: labels[source.kind] || source.kind || message.role, role: message.role, producer: source.kind || null, text: body,
      characters: body.length, admittedSeq: seq, sections: source.sections?.map(s => ({ name: s.name, text: s.text })),
      entries: source.entries?.map(s => ({ name: s.name, description: s.description })),
      paths: source.changes?.map(c => c.path).filter(Boolean) };
  }
  if (seq != null) fragments[key].admittedSeq = seq;
  return key;
};
const queues = { 'next-step': [], 'next-turn': [] }, claimed = [], origins = new Map();
const frames = [];
let turn = null, step = null;
for (const event of events.slice(0, cut + 1)) {
  const d = event.data || {};
  if (event.type === 'turn/start') {turn = d.turn;step = null;}
  if (event.type === 'step/start') {turn = d.turn;step = d.step;}
  let fragment = null;
  if (event.type === 'agent/inbox/spliced') {
    const ids = (d.inserted || []).map(m => describe(m));
    for (const id of ids) origins.set(id, { target: d.target, seq: event.seq });
    const removed = queues[d.target].splice(d.start, d.removedCount || 0, ...ids);
    if (d.outcome !== 'canceled') for (const id of removed) claimed.push(id);
    fragment = ids[0] || removed[0] || null;
  }
  if (['system/message', 'developer/message', 'user/message'].includes(event.type)) {
    const message = event.type === 'user/message' ? d : d.message;
    fragment = describe(message, event.seq);
    const i = claimed.indexOf(fragment);
    if (i !== -1) claimed.splice(i, 1);
  }
  if (event.seq < start) continue;
  if (!['agent/inbox/spliced', 'system/message', 'developer/message', 'user/message', 'turn/start', 'step/start', 'request/header', 'request/context'].includes(event.type)) continue;
  const injection = index(event.seq), slots = injection.slots.map(slot => {
    const sourceEvent = events[slot.seq], message = sourceEvent.type === 'user/message' ? sourceEvent.data : sourceEvent.data.message;
    return { id: describe(message, slot.seq), seq: slot.seq, ordinal: slot.ordinal, role: slot.role };
  });
  const pending = Object.entries(queues).flatMap(([target, ids]) => ids.map(id => ({ id, target, state: 'queued' })));
  pending.push(...claimed.map(id => ({ id, target: origins.get(id)?.target ?? null, state: 'claimed' })));
  pending.sort((a, b) => origins.get(a.id).seq - origins.get(b.id).seq);
  frames.push({ seq: event.seq, time: event.time, elapsedMs: event.time - firstTime, type: event.type, fragment,
    operation: event.surfaceOp || null, target: d.target || null, removedCount: d.removedCount || 0,
    turn, step, slots, pending,
    tools: event.seq >= header.seq, configured: event.type === 'request/context' });
}
const data = { schema: 'context-native-assembly/1', source: { host: 'DSH', session: meta.session, fixture: 'repair', cut, firstModelSeq: firstModel.seq,
    log: '.dsh/diagnostic-pilot/repair/events.jsonl', sourceHash: meta.sourceHash, sourceStart: start,
    toolsHeaderSeq: header.seq, model: events[cut].data.model, timezone: 'Asia/Shanghai' },
  fragments, frames, tools: header.data.header.tools,
  coverage: { positions: 'Official SurfaceManager logical message order, before provider adaptation.',
    time: 'Native event time and sequence; playback intervals are normalized for readability.',
    system: 'One recorded system/message; internal section assembly timing is not recorded.',
    request: 'Pre-response context cut; request/context is configuration metadata, not a send event.',
    sizes: 'Fragment heights serve readability; they do not encode tokens or elapsed time.' } };

// Check the data properties which matter to this study, against the native view.
assert.deepEqual(frames.at(-1).slots.map(s => s.seq), last.slots.map(s => s.seq));
assert(frames.every((f, i) => !i || f.seq > frames[i - 1].seq));
assert(frames.every(f => f.slots.every(s => s.seq <= f.seq)));
assert(frames.filter(f => f.seq < header.seq).every(f => !f.tools));
assert.deepEqual(frames.at(-1).pending, []);
const pendingCounts = frames.map(f => f.pending.length);
assert(pendingCounts.some(n => n > 0), 'The preview must retain the queue-to-surface transition');
const serialized = JSON.stringify(data).replaceAll('<', '\\u003c');
const dataJS = 'window.CONTEXT_NATIVE = ' + serialized + ';\n';
mkdirSync(output, { recursive: true });
writeFileSync(new URL('native-data.js', output), dataJS);
const html = readFileSync(new URL('native.html', demo), 'utf8');
const css = readFileSync(new URL('native.css', demo), 'utf8').replaceAll('../layout-review/fonts/', '../../docs/demo/layout-review/fonts/');
const js = readFileSync(new URL('native.js', demo), 'utf8');
const standalone = html.replace('<link rel="stylesheet" href="native.css">', '<style>' + css + '</style>')
  .replace('<script src="native-data.js" defer></script>', '<script>' + dataJS + '</script>')
  .replace('<script src="native.js" defer></script>', '<script>' + js.replace(/<\/script/gi, '<\\/script') + '</script>');
writeFileSync(new URL('index.html', output), standalone);
console.log(JSON.stringify({ output: '.dsh/context-loading-native/index.html', frames: frames.length, seq: [start, cut],
  messages: last.slots.length, tools: data.tools.length, sha256: createHash('sha256').update(serialized).digest('hex') }));
