import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { contextOverview } from './context-overview-model.mjs';
import { CONTEXT_CATEGORIES } from './context-model.mjs';
import { baseName, describeOperation, familyOf, fileId, filePath } from './tool-operation-model.mjs';
import { assemblyHistoryGroups } from '../shared/assembly-model.mjs';
import dshCatalog from './dsh-tool-catalog.json' with { type: 'json' };

const categories = CONTEXT_CATEGORIES.map(category => category.key);
const projectionNames = ['contextTimeline', 'contextBreakdown', 'contextPressure', 'contextHeaders'];
const basicKeys = ['systemTokens', 'toolsTokens', 'messageTokens'];
const present = value => typeof value === 'string' && value.length > 0;
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const seqOf = value => Number.isSafeInteger(value) && value >= 0;
const complete = (value, keys) => keys.every(key => numeric(value?.[key]));
const blocksOf = message => Array.isArray(message?.content) ? message.content : [];
const textOf = blocks => blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
const at = (event, message) => ({
  seq: event.seq, turn: event.data?.turn ?? message?.source?.turn ?? null, step: event.data?.step ?? null,
});
async function projectionsAt(ctx, observation, events, sessionId, cut, contiguous, current, signal) {
  const registry = ctx.get('sessionProjections');
  const accepts = snapshot => snapshot?.asOfSeq === cut && snapshot.values;
  if (accepts(observation.projections)) return observation.projections.values;
  try {
    const live = current && ctx.get('sessions')?.get?.(sessionId);
    const snapshot = live && registry?.snapshot?.(live, projectionNames);
    if (accepts(snapshot)) return snapshot.values;
  } catch {
    // A mounted session can close during the read. Fall back to local replay.
  }
  if (!contiguous || cut < 0 || !registry?.restore || !observation.header) return {};
  let checkpoint = {}, snapshot;
  const deadline = performance.now() + 4000;
  try {
    for (let start = 0; start <= cut; start += 1000) {
      signal?.throwIfAborted();
      if (performance.now() > deadline) return {};
      const batch = events.slice(start, start + 1000);
      const restored = registry.restore(checkpoint, batch, start, observation.header, observation.inheritedEventCount ?? 0);
      checkpoint = restored.checkpoint;
      snapshot = restored.snapshot;
      await new Promise(resolve => setImmediate(resolve));
    }
  } catch {
    signal?.throwIfAborted();
  }
  return accepts(snapshot) ? snapshot.values : {};
}

const agentsFile = path => /^agents(?:\.local)?\.md$/i.test(baseName(path));
function fileKind(path) {
  const name = baseName(path).toLowerCase();
  if (agentsFile(path)) return 'agents';
  if (name === 'skill.md') return 'skill';
  if (/\.(?:[cm]?[jt]sx?|py|rs|go|[ch](?:pp|xx)?|cs|java|kt|swift|rb|php|sh|bash|ps1|lua|sql|vue|svelte|css|scss|html|lean|zig)$/.test(name)) return 'code';
  if (/\.(?:md|markdown|rst|txt|adoc|pdf|docx?|rtf)$/.test(name) || /^readme(?:\.|$)/.test(name)) return 'document';
  if (/\.(?:jsonl?|ya?ml|toml|ini|cfg|conf|csv|tsv|xml|env|lock|sqlite)$/.test(name) || /^\.env(?:\.|$)/.test(name)) return 'data';
  if (/\.(?:svg|png|jpe?g|gif|webp|ico|mp[34]|wav|mov|avif)$/.test(name)) return 'media';
  return 'other';
}

function placement(message, projected) {
  if (categories.includes(projected)) return { part: projected, basis: 'timeline' };
  if (['system', 'assistant', 'tool'].includes(message.role)) return { part: message.role, basis: 'role' };
  const source = message.source?.kind;
  if (message.role === 'developer') return { part: 'inject', basis: 'role' };
  if (message.role === 'user' && ['skill-invocation', 'skill-catalog'].includes(source)) return { part: 'skill', basis: 'source' };
  if (message.role === 'user') return { part: source && source !== 'user' ? 'inject' : 'user', basis: source ? 'source' : 'role' };
  return { part: 'unknown', basis: 'unknown' };
}

const normalizedName = name => typeof name === 'string' ? name.toLowerCase() : '';
const isCode = name => /^run_?code$/i.test(name || '');
function toolArgs(input) {
  if (typeof input !== 'string') return input;
  try { return JSON.parse(input); } catch { return null; }
}
const pathArgument = args => args?.file_path ?? args?.path ?? args?.filePath;
const readEnvelope = text => /^<path>([^<\r\n]+)<\/path>\r?\n<type>file<\/type>\r?\n<content>\r?\n((?:[ \t]*\d+:[^\r\n]*\r?\n?)+)/m.exec(text);
const envelopePath = text => /^<path>([^<\r\n]+)<\/path>/m.exec(text)?.[1];
const actualBlock = block => !block?.offloaded && !block?.attachment?.offloaded;

function toolFileContent(name, args, text) {
  if (familyOf(name, args ?? {}) === 'read') {
    const envelope = readEnvelope(text);
    if (envelope) return [{ path: envelope[1], origin: 'read', status: 'body' }];
  }
  if (name === 'grep' && /^Found \d/m.test(text)) {
    return describeOperation({ name, status: 'returned' }, {}, text).files.filter(file => file.lines.length)
      .map(file => ({ path: file.path, origin: 'search', status: 'body' }));
  }
  if (name === 'glob' && /^Found \d+ (?:file|result)s?\b/m.test(text)) {
    return text.split(/\r?\n/).slice(1).filter(line => /^(?:[a-z]:[\\/]|\.{0,2}[\\/]|[^ \t()[\]<>]+[\\/])/i.test(line))
      .map(path => ({ path, origin: 'paths', status: 'reference' }));
  }
  return [];
}

function instructionEvidence(changes, text) {
  const rows = [], byPath = new Map();
  for (const change of changes) {
    if (!present(change?.path)) continue;
    const list = byPath.get(change.path) || [];
    list.push(change);
    byPath.set(change.path, list);
  }
  const markers = [...text.matchAll(/^(?:(?:Additional|Updated) )?Instructions from: ([^\r\n]+)[ \t]*$/gm)]
    .filter(marker => byPath.has(marker[1].trim()));
  const bodies = new Set();
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const body = text.slice(marker.index + marker[0].length, markers[i + 1]?.index).trim();
    if (body) bodies.add(marker[1].trim());
  }
  for (const [path, list] of byPath) for (const change of list) {
    rows.push({ path, origin: 'instructions', scope: present(change.scope) ? change.scope.split('\0').join(' / ') : null,
      action: change.action, status: ['set', 'replace'].includes(change.action) && bodies.has(path) ? 'body' : 'reference' });
  }
  return rows;
}

function skillEvidence(text, source) {
  const match = /^\s*<skill_content\s+name="([^"]+)">[\s\S]*?<skill_instructions>([\s\S]*?)<\/skill_instructions>/m.exec(text);
  if (!match?.[2]?.trim()) return null;
  const path = source?.path;
  const dir = /^Base directory for this skill: ([^\r\n]+)/m.exec(text)?.[1];
  return { kind: 'skill', path: present(path) ? path : null, name: match[1], dir,
    origin: 'skill', status: 'body' };
}

function catalogEvidence(source) {
  const entries = Array.isArray(source.entries) && source.entries.every(entry => present(entry?.name) && typeof entry.description === 'string')
    ? source.entries.map(({ name, description }) => ({ name, description }))
    : null;
  return { entries, incomplete: source.incomplete === true };
}

// PTC dispatches are log-only. Credit a child read only if the current outer
// result still contains its recorded response or an identifiable first line.
function nestedFileContent(child, outerText) {
  const data = child.data, name = normalizedName(data.name), args = toolArgs(data.arguments);
  if (data.isError || data.error || !Array.isArray(data.content) || !['read', 'search'].includes(familyOf(name, args ?? {}))) return [];
  const text = textOf(data.content), envelope = readEnvelope(text);
  const prefix = envelope && envelope[0].slice(0, envelope[0].indexOf(envelope[2]) + envelope[2].split(/\r?\n/, 1)[0].length);
  const contains = value => value && (outerText.includes(value) || outerText.includes(JSON.stringify(value).slice(1, -1)));
  if (!contains(text) && !contains(prefix)) return [];
  return toolFileContent(name, args, text).map(file => ({ ...file, origin: 'code-mode', viaSeq: child.seq }));
}

export function summarizeContextFiles(events, surface, timeline, cwd, signal) {
  const calls = new Map(), nested = new Map(), positions = new Map(), rows = new Map(), notifications = new Map();
  const slots = [];
  const categoryBySeq = new Map((Array.isArray(timeline?.nodes) ? timeline.nodes : []).map(node => [node.seq, node.cat]));
  let turn = null, step = null, unconfirmedReads = 0, messageCount = 0;
  for (const event of events) {
    const data = event.data;
    if (event.type === 'turn/start') { turn = data?.turn ?? null; step = null; }
    if (event.type === 'step/start') { turn = data?.turn ?? turn; step = data?.step ?? null; }
    positions.set(event.seq, { turn: data?.turn ?? turn, step: data?.step ?? step });
    if (event.type === 'tool/call' && data?.callId) calls.set(data.callId, event);
    if (event.type === 'tool/ptc-dispatch' && data?.rootCallId && data.name && !data.isError && !data.error) {
      const family = familyOf(normalizedName(data.name), toolArgs(data.arguments) ?? {});
      if (family !== 'read' && family !== 'search') continue;
      const list = nested.get(data.rootCallId) || [];
      list.push({ event, family });
      nested.set(data.rootCallId, list);
    }
  }
  for (const seq of surface.nodes) {
    signal?.throwIfAborted();
    const event = events[seq], message = surface.deriveEventMessage(event);
    if (!message) continue;
    messageCount++;
    const source = message.source, blocks = blocksOf(message), position = positions.get(seq);
    const where = placement(message, categoryBySeq.get(seq));
    const call = message.role === 'tool' && source?.kind === 'tool' ? calls.get(source.callId) : null;
    const slot = { seq, position: messageCount, part: where.part, role: message.role, ...position,
      source: source?.kind, callId: call?.data?.callId, toolName: call?.data?.name };
    if (message.role === 'user' && source?.kind === 'skill-catalog') slot.skillCatalog = catalogEvidence(source);
    slots.push(slot);
    const toolName = normalizedName(call?.data?.name), args = toolArgs(call?.data?.arguments);
    const validResult = call && !message.isError && !event.data?.isError && !event.data?.error && !source.isError;
    const readResult = validResult && familyOf(toolName, args ?? {}) === 'read';
    const needsText = readResult || validResult && (['grep', 'glob', 'skill'].includes(toolName) || isCode(toolName))
      || ['agent-instructions', 'skill-invocation'].includes(source?.kind);
    const text = needsText ? textOf(blocks) : '';
    const record = row => {
      if (!present(row.path) && !present(row.name)) return;
      const kind = row.kind || fileKind(row.path);
      const groupKey = [kind, where.part, row.status].join(':');
      const group = rows.get(groupKey) || { kind, part: where.part, status: row.status, entries: new Map() };
      rows.set(groupKey, group);
      const identity = row.path ? fileId(filePath(row.path, cwd)) : [row.name, row.dir].join('\0');
      const key = [identity, row.scope, row.origin, row.action].join('\0');
      const before = group.entries.get(key);
      const locations = before?.locations ?? [];
      if (locations.at(-1) !== messageCount) locations.push(messageCount);
      group.entries.delete(key);
      group.entries.set(key, { ...row, ...position, seq, logicalPosition: messageCount,
        basis: where.basis, locations, occurrences: (before?.occurrences || 0) + 1 });
    };

    if (source?.kind === 'agent-instructions' && source.form === 'instructions' && Array.isArray(source.changes)) {
      for (const row of instructionEvidence(source.changes, text)) record(row);
    }
    if (source?.kind === 'skill-invocation' || validResult && toolName === 'skill') {
      const loaded = skillEvidence(text, source);
      if (loaded) {
        slot.loadedSkill = loaded.name;
        record({ ...loaded, callId: call?.data?.callId });
      }
    }
    if (message.role === 'developer') {
      for (const block of blocks) {
        if (!['tool-addition', 'tool-removal'].includes(block.type) || !present(block.toolName)) continue;
        const action = block.type === 'tool-addition' ? 'add' : 'remove';
        (slot.toolChanges ??= []).push({ action, name: block.toolName });
        if ((notifications.get(block.toolName)?.seq ?? -1) <= seq) {
          notifications.set(block.toolName, { action, seq, position: messageCount, headerSeq: event.data?.headerSeq });
        }
      }
    }
    for (const block of blocks) {
      if (block.type !== 'image' && block.type !== 'file') continue;
      const image = block.type === 'image';
      const readPath = image && readResult ? envelopePath(text) || event.data?.meta?.path : null;
      const path = readPath || block.attachment?.path || block.attachment?.name;
      const name = !path ? block.attachment?.id ?? block.attachment?.uri : null;
      record({ path, name, kind: image ? 'media' : null, origin: readPath ? 'read' : 'attachment',
        callId: readPath ? source.callId : undefined, status: image && actualBlock(block) ? 'body' : 'reference' });
    }
    if (message.role === 'assistant') {
      for (const block of blocks) {
        if (block.type === 'reasoning' && present(block.text)) slot.hasReasoning = true;
        if (block.type !== 'tool-call') continue;
        const callId = block.id ?? block.callId ?? block.toolCallId;
        const call = calls.get(callId)?.data;
        const recordedName = block.name || call?.name;
        if (present(recordedName)) (slot.toolInputs ??= []).push({ name: recordedName, callId });
        const name = normalizedName(recordedName);
        const input = toolArgs(block.arguments ?? block.input);
        const path = pathArgument(input);
        if (!['read', 'write'].includes(familyOf(name, input ?? {})) || !present(path)) continue;
        record({ path, origin: 'argument', status: 'reference', callId: call?.callId });
      }
    }
    if (!validResult) continue;
    for (const row of toolFileContent(toolName, args, text)) record({ ...row, callId: source.callId });
    if (isCode(toolName)) for (const child of nested.get(source.callId) || []) {
      const verified = nestedFileContent(child.event, text);
      if (!verified.length && child.family === 'read') unconfirmedReads++;
      for (const row of verified) record({ ...row, callId: source.callId });
    }
  }
  const groups = [...rows.values()].map(({ entries, ...group }) => ({
    ...group, count: entries.size, occurrences: [...entries.values()].reduce((sum, row) => sum + row.occurrences, 0),
    items: [...entries.values()].reverse(),
  }));
  // A leading system message is the baseline. Later system updates retain their
  // actual message positions; the tool header is independent of this sequence.
  const system = slots[0]?.role === 'system' ? slots.shift() : null;
  const layers = assemblyHistoryGroups(slots, slot => slot.turn, 18).map(({ key, start, ids }) => ({
    turn: key === 'unknown' ? null : key, start, count: ids.length,
  }));
  return { files: { groups, messageCount, unconfirmedReads }, structure: { system, history: slots, layers }, notifications };
}

const definitionsOf = event => {
  const tools = event?.data?.header?.tools;
  return Array.isArray(tools) ? tools : [];
};

const recordedOwner = value => present(value) && !/^(?:unknown(?:-boot-tool)?|<unknown-plugin>|[?])$/i.test(value);
const catalogTools = new Map(Object.entries(dshCatalog.tools));
const sortKeys = (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
  : value;

function declarationOwner(tool, annotation) {
  if (recordedOwner(tool.plugin)) return { plugin: tool.plugin, pluginBasis: 'header' };
  const annotatedPlugin = annotation?.plugin;
  // The Context projection can pick up the Cordis registration wrapper in its stack trace.
  if (recordedOwner(annotatedPlugin) && annotatedPlugin !== '@deepseek-ai/cordis') {
    return { plugin: annotatedPlugin, pluginBasis: 'context-headers' };
  }
  const signatures = catalogTools.get(tool.name);
  if (signatures && tool.parameters != null) {
    let description = tool.description ?? '';
    // The official glob description interpolates the configured result cap.
    if (tool.name === 'glob' && typeof description === 'string') {
      description = description.replace(/Returns up to [1-9]\d*(?= paths in modification-time order; a larger result )/, 'Returns up to 100');
    }
    const shape = JSON.stringify([description, tool.parameters], sortKeys);
    const hash = createHash('sha256').update(shape).digest('hex');
    const match = signatures.find(([signature]) => signature === hash);
    if (match) return { plugin: match[1], pluginBasis: match[2] ?? 'dsh-tool-catalog' };
  }
  return { plugin: null, pluginBasis: null };
}

function declarations(header, projection, notifications, events) {
  if (!header || typeof header.data?.header !== 'object' || header.data.header === null) return null;
  const toolDefinitions = header.data.header.tools ?? [];
  if (!Array.isArray(toolDefinitions)) return null;
  const annotatedHeader = Array.isArray(projection?.headers) ? projection.headers.find(item => item.seq === header.seq) : null;
  const annotations = new Map((Array.isArray(annotatedHeader?.tools) ? annotatedHeader.tools : []).map(tool => [tool.name, tool]));
  return { ...at(header), count: toolDefinitions.length, items: toolDefinitions.flatMap((tool, index) => {
    if (!present(tool?.name)) return [];
    const annotation = annotations.get(tool.name);
    const change = notifications.get(tool.name);
    const sourceHeader = change?.action === 'add' && seqOf(change.headerSeq) && change.headerSeq < change.seq
      ? events[change.headerSeq] : null;
    const added = sourceHeader?.type === 'request/header' && definitionsOf(sourceHeader).find(definition => definition?.name === tool.name);
    const notice = added && isDeepStrictEqual(added, tool) ? change : null;
    return [{ name: tool.name, position: index + 1, deferred: tool.deferLoading === true, ...declarationOwner(tool, annotation),
      tokens: numeric(annotation?.tokens) ? annotation.tokens : null,
      noticeSeq: notice?.seq ?? null, noticePosition: notice?.position ?? null }];
  }) };
}

async function contextSurface(ctx, events) {
  const { SurfaceManager } = await import('@deepseek-ai/dsh-session/surface');
  const definitions = ctx.get('sessions')?.messageProjections;
  return new SurfaceManager(events, 0, Array.isArray(definitions) ? definitions : []);
}

function contentBlocks(message) {
  return blocksOf(message).flatMap(block => {
    if (['text', 'reasoning'].includes(block.type) && present(block.text)) return [{ type: block.type, text: block.text }];
    if (block.type === 'tool-call') {
      const input = block.arguments ?? block.input;
      return [{ type: block.type, name: block.name, text: typeof input === 'string' ? input : JSON.stringify(input, null, 2) ?? '' }];
    }
    if (['file', 'image'].includes(block.type)) return [{ type: block.type, text: block.attachment?.path ?? block.attachment?.name ?? '' }];
    return [];
  });
}

function previewContextBlocks(blocks) {
  const preview = [];
  let remaining = 48000;
  for (const block of blocks.slice(0, 60)) {
    const text = block.text.slice(0, remaining);
    preview.push({ ...block, text, truncated: text.length < block.text.length });
    remaining -= text.length;
    if (!remaining) break;
  }
  return { blocks: preview, truncated: preview.length < blocks.length };
}

export async function readContextContent(ctx, observation, cut, target, signal) {
  const log = observation.events || [];
  const head = observation.cursor ?? log.at(-1)?.seq ?? -1;
  if (cut > head || !seqOf(cut)) return null;
  if (target.tool != null) {
    const header = log.findLast(event => event.seq <= cut && event.type === 'request/header');
    const tool = definitionsOf(header).find(definition => definition?.name === target.tool);
    if (!tool) return null;
    const { name, description, parameters } = tool;
    return previewContextBlocks([{ type: 'definition', text: JSON.stringify({ name, description, parameters }, null, 2) }]);
  }
  if (!seqOf(target.seq) || target.seq > cut) return null;
  const events = log.slice(0, cut + 1);
  if (events.length !== cut + 1 || events.some((event, index) => event.seq !== index)) return null;
  signal?.throwIfAborted();
  const surface = await contextSurface(ctx, events);
  if (!surface.nodes.includes(target.seq)) return null;
  signal?.throwIfAborted();
  const message = surface.deriveEventMessage(events[target.seq]);
  if (!message) return null;
  const type = target.view === 'reasoning' ? 'reasoning' : target.view === 'io' && message.role === 'assistant' ? 'tool-call' : null;
  const blocks = contentBlocks(message);
  return previewContextBlocks(type ? blocks.filter(block => block.type === type) : blocks);
}

export async function readContextComposition(ctx, observation, sessionId, signal, turnEndSeq = null) {
  const log = observation.events || [];
  const head = observation.cursor ?? log.at(-1)?.seq ?? -1;
  const current = turnEndSeq === null;
  const cut = turnEndSeq ?? head;
  const events = log.at(-1)?.seq > cut ? log.slice(0, log.findLastIndex(event => event.seq <= cut) + 1) : log;
  const last = events.at(-1);
  if (!current && (cut > head || last?.seq !== cut || last.type !== 'turn/end')) return null;
  const turns = current ? events.filter(event => event.type === 'turn/end' && Number.isSafeInteger(event.data?.turn))
    .map(event => ({ turn: event.data.turn, seq: event.seq })) : undefined;
  const contiguous = cut === events.length - 1 && events.every((event, index) => event.seq === index);
  const values = await projectionsAt(ctx, observation, events, sessionId, cut, contiguous, current, signal);
  signal?.throwIfAborted();
  const timeline = values.contextTimeline?.ok === false || values.contextTimeline?.unsupported ? null : values.contextTimeline;
  const pressure = values.contextPressure, breakdown = values.contextBreakdown;
  const overview = contextOverview(pressure, complete(breakdown, basicKeys) ? breakdown : null, timeline?.current);
  const header = events.findLast(event => event.type === 'request/header' && event.seq <= cut);
  const recordedRoute = header?.data?.header?.config;
  const provider = recordedRoute?.provider ?? timeline?.provider ?? null;
  const model = recordedRoute?.model ?? timeline?.model ?? null;
  let evidence = null;
  if (contiguous) {
    try {
      const surface = await contextSurface(ctx, events);
      evidence = summarizeContextFiles(events, surface, timeline, observation.header?.cwd, signal);
    } catch {
      signal?.throwIfAborted();
    }
  }
  return {
    sessionId, asOfSeq: cut,
    turn: (current ? events.findLast(event => event.type === 'turn/start') : last)?.data?.turn ?? null,
    turns,
    composition: { ...overview, source: overview.detailed ? 'dsh-context' : complete(breakdown, basicKeys) ? 'token-meter' : null,
      reportedInput: numeric(pressure?.pressureTokens) ? pressure.pressureTokens : null,
      projectedInput: numeric(pressure?.projectedTokens) ? pressure.projectedTokens : null },
    route: provider || model ? { provider, model } : null,
    structure: evidence?.structure ?? null, files: evidence?.files ?? null,
    tools: declarations(header, values.contextHeaders, evidence?.notifications ?? new Map(), events),
  };
}
