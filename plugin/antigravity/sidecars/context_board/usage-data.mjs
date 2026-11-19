import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { setImmediate as yieldToHost } from 'node:timers/promises';
import { conversationVersion, listConversations, transcriptRoute, transcriptTokens } from './context-data.mjs';
import { outputRate, readUsageRecords, requestRoute } from './request-records.mjs';

const tokenKeys = ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens'];

async function readTranscriptUsage(path) {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const steps = new Map();
  try {
    for await (const line of lines) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row?.type !== 'PLANNER_RESPONSE' || !Number.isInteger(row.step_index)) continue;
      steps.set(row.step_index, { seq: row.step_index, at: Date.parse(row.created_at) || null, ...transcriptRoute(row), ...transcriptTokens(row) });
    }
  } finally { lines.close(); stream.destroy(); }
  return [...steps.values()];
}

async function loadConversation(entry) {
  let retry = false;
  if (existsSync(entry.dbPath)) {
    try {
      const native = await readUsageRecords(entry.dbPath);
      if (native.records.length) {
        if (native.records.some(r => r.at == null) && existsSync(entry.path)) {
          try {
            const times = new Map((await readTranscriptUsage(entry.path)).map(r => [r.seq, r.at]));
            for (const r of native.records) r.at ??= times.get(r.seq) ?? null;
          } catch { retry = true; }
        }
        return { ...native, source: 'database', retry };
      }
    } catch { retry = true; }
  }
  if (existsSync(entry.path)) {
    try { return { records: await readTranscriptUsage(entry.path), parents: [], source: 'transcript', retry }; }
    catch { retry = true; }
  }
  return { records: [], parents: [], source: retry ? 'unavailable' : 'empty', retry };
}

export async function conversationCatalog(dirs) {
  const { DatabaseSync } = await import('node:sqlite');
  const titles = new Map();
  for (const dir of dirs) {
    const path = join(dir, 'conversation_summaries.db');
    if (!existsSync(path)) continue;
    let db;
    try {
      db = new DatabaseSync(path, { readOnly: true });
      const columns = new Set(db.prepare('PRAGMA table_info(conversation_summaries)').all().map(r => r.name));
      const extra = ['project_id', 'workspace_uris', 'parent_conversation_id'].filter(key => columns.has(key));
      const names = new Map();
      for (const row of db.prepare('SELECT ' + ['conversation_id','substr(title,1,160) AS title',...extra].join(',') + ' FROM conversation_summaries').iterate()) {
        let workspace = '';
        try { workspace = JSON.parse(row.workspace_uris || '[]')[0] || ''; } catch {}
        const project = row.project_id || workspace;
        if (project && !names.has(project)) {
          let label;
          if (/^[a-f0-9-]{36}$/i.test(row.project_id || '')) {
            try { label = JSON.parse(readFileSync(join(dirname(dir),'config/projects',row.project_id + '.json'),'utf8')).name; } catch {}
          }
          try { label ||= basename(decodeURIComponent(new URL(workspace).pathname)); } catch {}
          names.set(project, label || project);
        }
        titles.set(join(dir, row.conversation_id), {title: row.title || '', project, projectName: names.get(project), parent:row.parent_conversation_id || ''});
      }
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_parents'").get()) {
        for (const row of db.prepare('SELECT conversation_id,parent_id FROM conversation_parents').iterate()) {
          const key = join(dir,row.conversation_id), info = titles.get(key) || {};
          if (!info.parent) titles.set(key,{ ...info, parent:row.parent_id });
        }
      }
    } catch { /* Older or busy title indices can still show short conversation IDs. */ }
    finally { db?.close(); }
  }
  return titles;
}

// A fork can contain a byte-for-byte copy of its parent's requests. Attribute a
// shared provider response to its parent first, even when the child is newer.
function parentFirst(conversations) {
  const byId = new Map(conversations.map(chat => [chat.id, chat]));
  const seen = new Set(), ordered = [];
  function visit(chat) {
    if (!chat || seen.has(chat.id)) return;
    seen.add(chat.id);
    for (const id of [chat.parent,...chat.parents]) visit(byId.get(id));
    ordered.push(chat);
  }
  for (const id of [...byId.keys()].sort()) visit(byId.get(id));
  return ordered;
}

function counters() {
  return { requests: 0, completeRequests: 0, inputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
    outputTokens: null, timedRequests: 0, timedTokens: 0, streamSeconds: 0, firstRequests: 0, firstSeconds: 0, responseModels: new Set() };
}

function add(c, row) {
  c.requests++;
  if (row.responseModel) c.responseModels.add(row.responseModel);
  if (row.inputTokens != null && row.outputTokens != null) c.completeRequests++;
  for (const key of tokenKeys) if (row[key] != null) c[key] = (c[key] ?? 0) + row[key];
  if (outputRate(row.outputTokens, row.streamSeconds) != null) {
    c.timedRequests++;
    c.timedTokens += row.outputTokens;
    c.streamSeconds += row.streamSeconds;
  }
  if (row.firstTokenSeconds > 0 || (row.firstTokenSeconds === 0 && row.outputTokens != null)) {
    c.firstRequests++; c.firstSeconds += row.firstTokenSeconds;
  }
}

function metrics(c) {
  const tokens = Object.fromEntries(tokenKeys.map(k => [k, c[k]]));
  const totalTokens = tokenKeys.some(k => c[k] != null) ? tokenKeys.reduce((n, k) => n + (c[k] ?? 0), 0) : null;
  return { ...tokens, totalTokens, requests: c.requests, completeRequests: c.completeRequests,
    tps: outputRate(c.timedTokens, c.streamSeconds), timedRequests: c.timedRequests, responseModels: [...c.responseModels].sort(),
    firstTokenSeconds: c.firstRequests ? c.firstSeconds / c.firstRequests : null, firstRequests: c.firstRequests };
}

const modeName = row => (Object.hasOwn(row, 'mode') ? row.mode : row.model) || '未记录模式';
const orderedModes = ['协作','高强度','中强度','低强度'];
function compareMode(a,b) {
  const rank = value => orderedModes.includes(value) ? orderedModes.indexOf(value) : orderedModes.length;
  return rank(a) - rank(b) || a.localeCompare(b);
}

function addModelUsage(families, route, row) {
  if (!families.has(route.modelName)) families.set(route.modelName, { counts:counters(), modes:new Map() });
  const family = families.get(route.modelName);
  if (!family.modes.has(route.mode)) family.modes.set(route.mode, { counts:counters(), roles:new Set() });
  const mode = family.modes.get(route.mode);
  add(family.counts,row);
  add(mode.counts,row);
  if (route.role) mode.roles.add(route.role);
}

function modelUsageRows(families) {
  return [...families].map(([name, family]) => ({ name, ...metrics(family.counts),
    modes: [...family.modes].map(([name, mode]) => ({name, roles:[...mode.roles].sort(), ...metrics(mode.counts)}))
      .sort((a,b) => compareMode(a.name,b.name)) }));
}

export function summarizeUsage(chats, requestedMode, options = {}) {
  const grouped = options.group === 'mode';
  const groupName = row => grouped ? requestRoute(modeName(row), row.responseModel).mode : modeName(row);
  const days = Number(options.days);
  const now = new Date(options.now ?? Date.now()), start = new Date(now);
  start.setHours(0,0,0,0);
  start.setDate(start.getDate() - (days - 1));
  const dated = [1,7,30].includes(days);
  const projects = new Map(), assignments = new Map();
  let ordered = parentFirst(chats);
  if (grouped) {
    const owners = new Map(), roots = [];
    for (const chat of ordered) {
      const owner = owners.get(chat.parent || (!chat.title && chat.parents[0]));
      if (owner) {
        owners.set(chat.id,owner);
        for (const record of chat.records) owner.records.push(record);
        owner.children++;
      } else {
        const root = {...chat, records:[...chat.records], children:0};
        roots.push(root); owners.set(chat.id,root);
      }
    }
    ordered = roots;
  }
  for (const chat of ordered) {
    const inherited = chat.parents.map(id => assignments.get(id)).find(p => p && p !== 'unknown');
    const project = chat.project || inherited || 'unknown';
    assignments.set(chat.id, project);
    projects.set(project, chat.projectName || projects.get(project) || (project === 'unknown' ? '未归属项目' : project));
  }
  const inProject = chat => !options.project || assignments.get(chat.id) === options.project;
  const inTime = row => !dated || (row.at != null && row.at >= start.getTime() && row.at <= now.getTime());
  const available = new Set();
  for (const chat of ordered.filter(inProject)) for (const row of chat.records) if (inTime(row)) available.add(groupName(row));
  const models = [...available].sort(grouped ? compareMode : undefined), model = requestedMode || '';
  const seen = new Set(), speeds = new Map(), conversations = [], total = counters();
  const routes = new Map();
  let sharedRequests = 0, undatedRequests = 0;
  for (const chat of ordered) {
    const all = counters(), modes = new Map(), families = new Map();
    let shared = 0;
    for (const row of chat.records) {
      const duplicate = row.requestId && seen.has(row.requestId);
      if (row.requestId) seen.add(row.requestId);
      if (!inProject(chat)) continue;
      const name = groupName(row);
      if (!inTime(row)) { if (!duplicate && row.at == null && (!model || name === model)) undatedRequests++; continue; }
      if (duplicate) { if (!model || model === name) shared++; continue; }
      add(all, row);
      if (model && model !== name) continue;
      if (!speeds.has(name)) speeds.set(name, counters());
      if (!modes.has(name)) modes.set(name, counters());
      add(total, row); add(modes.get(name), row); add(speeds.get(name), row);
      if (grouped) {
        const route = requestRoute(modeName(row), row.responseModel);
        addModelUsage(families, route, row);
        const key = JSON.stringify([name,route.label]);
        if (!routes.has(key)) routes.set(key, { mode:name, label:route.label, counts:counters(), raw:new Set() });
        const bucket = routes.get(key);
        add(bucket.counts,row); bucket.raw.add(modeName(row));
      }
    }
    sharedRequests += shared;
    if (inProject(chat) && (modes.size || shared || (!dated && !model))) {
      const full = metrics(all);
      conversations.push({ id: chat.id, title: chat.title || '未命名对话', children:chat.children || 0, shared, ...(model ? metrics(modes.get(model) ?? counters()) : full),
        allModeTokens: full.totalTokens, ...(grouped ? {modelUsage:modelUsageRows(families)} : {}),
        byMode: [...modes].map(([name, counts]) => ({ name, ...metrics(counts) })) });
    }
  }
  conversations.sort((a, b) => (b.totalTokens ?? -1) - (a.totalTokens ?? -1) || a.id.localeCompare(b.id));
  const byModel = [...speeds].map(([name, counts]) => ({ name, ...metrics(counts) }))
    .sort((a, b) => (b.tps ?? -1) - (a.tps ?? -1) || a.name.localeCompare(b.name));
  const scopeChats = ordered.filter(inProject);
  return { model, models, totals: metrics(total), byModel, conversations, sharedRequests, undatedRequests,
    projects: [...projects].map(([id,name]) => ({id,name})).sort((a,b) => a.name.localeCompare(b.name)), project: options.project || '',
    speeds: [...routes.values()].map(r => ({mode:r.mode,label:r.label,raw:[...r.raw],...metrics(r.counts)}))
      .sort((a,b) => compareMode(a.mode,b.mode) || a.label.localeCompare(b.label)),
    transcriptChats: scopeChats.filter(c => c.source === 'transcript').length,
    unavailableChats: scopeChats.filter(c => c.source === 'unavailable').length,
    staleChats: scopeChats.filter(c => c.stale).length };
}

export function createUsageOverview(dirs) {
  const cache = new Map();
  let loading;
  async function load() {
    const entries = listConversations(dirs), titles = await conversationCatalog(dirs);
    const present = new Set(entries.map(e => e.dbPath));
    for (const path of cache.keys()) if (!present.has(path)) cache.delete(path);
    const chats = [];
    for (const entry of entries) {
      const version = conversationVersion(entry);
      let data = cache.get(entry.dbPath);
      if (!data || data.version !== version || data.path !== entry.path) {
        await yieldToHost();
        const fresh = await loadConversation(entry);
        if (fresh.retry && data?.source === 'database') {
          data = { ...data, stale: true };
        } else {
          data = fresh;
          if (!data.retry) cache.set(entry.dbPath, { ...data, path: entry.path, version });
          else cache.delete(entry.dbPath);
        }
      }
      chats.push({ ...data, id: entry.id, title: '', ...titles.get(join(entry.appData, entry.id)) });
    }
    return chats;
  }
  return async function overview(data = {}) {
    loading ??= load().finally(() => { loading = null; });
    const result = summarizeUsage(await loading, data.mode ?? data.model, {group:data.group, project:data.project, days:data.days});
    const etag = createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0, 24);
    return data.etag === etag ? { etag, unchanged: true } : { ...result, etag };
  };
}
