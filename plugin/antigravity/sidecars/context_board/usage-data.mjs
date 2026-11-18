import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setImmediate as yieldToHost } from 'node:timers/promises';
import { conversationVersion, listConversations, transcriptTokens } from './context-data.mjs';
import { readUsageRecords } from './request-records.mjs';

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
      const model = typeof row.model === 'string' && row.model.trim() || '未记录模型';
      steps.set(row.step_index, { model, ...transcriptTokens(row) });
    }
  } finally { lines.close(); stream.destroy(); }
  return [...steps.values()];
}

async function loadConversation(entry) {
  let retry = false;
  if (existsSync(entry.dbPath)) {
    try {
      const native = await readUsageRecords(entry.dbPath);
      if (native.records.length) return { ...native, source: 'database', retry };
    } catch { retry = true; }
  }
  if (existsSync(entry.path)) {
    try { return { records: await readTranscriptUsage(entry.path), parents: [], source: 'transcript', retry }; }
    catch { retry = true; }
  }
  return { records: [], parents: [], source: retry ? 'unavailable' : 'empty', retry };
}

async function conversationTitles(dirs) {
  const { DatabaseSync } = await import('node:sqlite');
  const titles = new Map();
  for (const dir of dirs) {
    const path = join(dir, 'conversation_summaries.db');
    if (!existsSync(path)) continue;
    let db;
    try {
      db = new DatabaseSync(path, { readOnly: true });
      for (const row of db.prepare("SELECT conversation_id, substr(title,1,160) AS title FROM conversation_summaries WHERE title <> ''").iterate()) {
        titles.set(join(dir, row.conversation_id), row.title);
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
    for (const id of chat.parents) visit(byId.get(id));
    ordered.push(chat);
  }
  for (const id of [...byId.keys()].sort()) visit(byId.get(id));
  return ordered;
}

function counters() {
  return { requests: 0, completeRequests: 0, inputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
    outputTokens: null, timedRequests: 0, timedTokens: 0, streamSeconds: 0, firstRequests: 0, firstSeconds: 0 };
}

function add(c, row) {
  c.requests++;
  if (row.inputTokens != null && row.outputTokens != null) c.completeRequests++;
  for (const key of tokenKeys) if (row[key] != null) c[key] = (c[key] ?? 0) + row[key];
  if (row.streamSeconds > 0 && row.outputTokens != null) {
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
    tps: c.timedRequests ? c.timedTokens / c.streamSeconds : null, timedRequests: c.timedRequests,
    firstTokenSeconds: c.firstRequests ? c.firstSeconds / c.firstRequests : null, firstRequests: c.firstRequests };
}

export function summarizeUsage(chats, requestedModel) {
  const models = [...new Set(chats.flatMap(chat => [...new Set(chat.records.map(r => r.model))]))].sort();
  const model = models.includes(requestedModel) ? requestedModel : '';
  const seen = new Set(), speeds = new Map(), conversations = [], total = counters();
  let sharedRequests = 0;
  for (const chat of parentFirst(chats)) {
    const own = counters();
    let shared = 0;
    for (const row of chat.records) {
      const duplicate = row.requestId && seen.has(row.requestId);
      if (row.requestId) seen.add(row.requestId);
      if (model && model !== row.model) continue;
      if (duplicate) { shared++; continue; }
      if (!speeds.has(row.model)) speeds.set(row.model, counters());
      add(total, row); add(own, row); add(speeds.get(row.model), row);
    }
    sharedRequests += shared;
    if (!model || own.requests || shared) conversations.push({ id: chat.id, title: chat.title, shared, ...metrics(own) });
  }
  conversations.sort((a, b) => (b.totalTokens ?? -1) - (a.totalTokens ?? -1) || a.id.localeCompare(b.id));
  const byModel = [...speeds].map(([name, counts]) => ({ name, ...metrics(counts) }))
    .sort((a, b) => (b.tps ?? -1) - (a.tps ?? -1) || a.name.localeCompare(b.name));
  return { model, models, totals: metrics(total), byModel, conversations, sharedRequests,
    transcriptChats: chats.filter(c => c.source === 'transcript').length,
    unavailableChats: chats.filter(c => c.source === 'unavailable').length,
    staleChats: chats.filter(c => c.stale).length };
}

export function createUsageOverview(dirs) {
  const cache = new Map();
  let loading;
  async function load() {
    const entries = listConversations(dirs), titles = await conversationTitles(dirs);
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
      chats.push({ ...data, id: entry.id, title: titles.get(join(entry.appData, entry.id)) || '' });
    }
    return chats;
  }
  return async function overview(data = {}) {
    loading ??= load().finally(() => { loading = null; });
    const result = summarizeUsage(await loading, data.model);
    const etag = createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0, 24);
    return data.etag === etag ? { etag, unchanged: true } : { ...result, etag };
  };
}
