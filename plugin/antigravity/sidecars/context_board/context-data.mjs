import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { CONTEXT_CATEGORIES } from './native/categories.mjs';
import { readRequests } from './request-records.mjs';

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cache = new Map(), bodies = new WeakMap();
const emptyTotals = () => ({ total: 0, ...Object.fromEntries(CONTEXT_CATEGORIES.map(c => [c.key, 0])) });
const readDir = path => { try { return readdirSync(path); } catch { return []; } };
const stamp = path => {
  const wal = path.endsWith('-wal');
  try { const s = statSync(path); return wal && s.size <= 32 ? 'no-wal' : `${s.mtimeMs}:${s.size}`; }
  catch { return wal ? 'no-wal' : 'missing'; }
};

export function findAppDataDirs(env = process.env, home = homedir()) {
  if (env.ANTIGRAVITY_APP_DATA_DIR) return [env.ANTIGRAVITY_APP_DATA_DIR];
  for (let d = env.ANTIGRAVITY_EXECUTABLE_DATA_DIR; d && d !== dirname(d); d = dirname(d)) {
    if (basename(d) === 'sidecar_data') return [dirname(d)];
  }
  return readDir(join(home, '.gemini')).sort().map(name => join(home, '.gemini', name)).filter(p => existsSync(join(p, 'brain')));
}

export function listConversations(dirs = findAppDataDirs()) {
  return dirs.flatMap(appData => readDir(join(appData, 'brain')).filter(id => ID_RE.test(id)).map(id => {
    const logs = join(appData, 'brain', id, '.system_generated', 'logs');
    const path = join(logs, existsSync(join(logs, 'transcript_full.jsonl')) ? 'transcript_full.jsonl' : 'transcript.jsonl');
    const dbPath = join(appData, 'conversations', id + '.db');
    const mtime = Math.max(...[path, dbPath, dbPath + '-wal'].map(p => { try { const s = statSync(p); return p.endsWith('-wal') && s.size <= 32 ? 0 : s.mtimeMs; } catch { return 0; } }));
    return { id, path, dbPath, mtime };
  })).filter(e => e.mtime > 0).sort((a, b) => b.mtime - a.mtime);
}

export function resolveConversation(id, entries = listConversations()) {
  // An explicit or host-bound session must never fall through to another chat.
  return id && id !== 'auto' && ID_RE.test(id) ? entries.find(e => e.id === id) || null : null;
}

function estimate(text) {
  let cjk = 0;
  for (const ch of text) if (/[\u3400-\u9fff]/u.test(ch)) cjk++;
  return text.length ? Math.max(1, Math.round(cjk * .68 + (text.length - cjk) / 3.8)) : 0;
}
function rowsOf(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).flatMap(line => { try { const row = JSON.parse(line); return row && Number.isInteger(row.step_index) ? [row] : []; } catch { return []; } });
}
function skillCall(call) {
  if (!/^(?:read_file|view_file|read)$/i.test(call.name)) return false;
  let args; try { args = JSON.parse(call.args); } catch { return false; }
  const path = args.Path || args.path || args.file_path || args.AbsolutePath || '';
  return /(?:^|[\\/])SKILL\.md$/i.test(path) || /[\\/](?:\.agents[\\/]skills|builtin[\\/]skills)[\\/]/i.test(path);
}

export function projectContext(request, stepTypes = new Map()) {
  const items = [], fullBodies = new Map(), totals = emptyTotals();
  function add(id, category, name, body, seq = null) {
    if (!body) return;
    const tokens = estimate(body);
    items.push({ id, category, name, seq, tokens, preview: body.slice(0, 280) });
    fullBodies.set(id, body); totals[category] += tokens; totals.total += tokens;
  }
  if (request?.hasPrompt) {
    let offset = 0, part = 0;
    // Sections are metadata for the same system string. Split exact ranges;
    // never count both the whole prompt and its sections.
    for (const section of request.sections) {
      const at = section.content ? request.system.indexOf(section.content, offset) : -1;
      if (at < 0) continue;
      add(`system-${part++}`, 'system', '系统提示 · 片段', request.system.slice(offset, at));
      const catalog = section.title === 'skills';
      const category = catalog || section.tokenType === 5 ? 'skill' : [2, 4].includes(section.tokenType) ? 'tools' : 'system';
      add(`system-${part++}`, category, catalog ? 'Skill catalog · 目录' : section.title || '系统提示', section.content);
      offset = at + section.content.length;
    }
    add(`system-${part}`, 'system', '系统提示', request.system.slice(offset));
    request.tools.forEach((t, index) => add(`tool-${index}`, 'tools', t.name || '工具定义', [t.name, t.description, t.schema].filter(Boolean).join('\n')));
    const calls = new Map();
    for (const message of request.messages) for (const call of message.calls) if (call.id) calls.set(call.id, call);
    request.messages.forEach((m, index) => {
      const type = stepTypes.get(m.seq), call = calls.get(m.toolCallId);
      const category = type === 'CHECKPOINT' || type === 'SYSTEM_MESSAGE' || [0, 3, 6].includes(m.source) ? 'inject'
        : m.source === 4 ? (call && skillCall(call) ? 'skill' : 'tool')
          : m.source === 1 ? 'user' : m.source === 5 ? 'system' : 'assistant';
      const label = category === 'tool' || category === 'skill' ? call?.name || '工具输出'
        : category === 'user' ? '用户输入' : category === 'system' ? '系统提示' : category === 'inject' ? (type === 'CHECKPOINT' ? '压缩摘要' : '运行时注入') : '模型输出';
      add(`message-${index}`, category, `${label} · #${m.seq ?? '?'} · ${m.calls.map(c => c.name).join(' · ')}`,
        [m.content, ...m.calls.map(c => `${c.name}\n${c.args}`)].filter(Boolean).join('\n\n'), m.seq);
    });
  }
  return { context: { available: Boolean(request?.hasPrompt), bodyAvailable: true, contextWindow: null, totals, items }, fullBodies };
}

function transcriptRequest(row, index) {
  const reported = row.input_tokens != null || row.cache_read_tokens != null;
  return { index, seq: row.step_index, at: row.created_at || '',
    inputTokens: reported ? Number(row.input_tokens) || 0 : null,
    cacheReadTokens: reported ? Number(row.cache_read_tokens) || 0 : null, cacheWriteTokens: 0,
    outputTokens: row.output_tokens == null ? null : Number(row.output_tokens),
    windowTokens: reported ? (Number(row.input_tokens) || 0) + (Number(row.cache_read_tokens) || 0) : null,
    hasPrompt: false, messages: [], tools: [], sections: [] };
}

export async function buildConversationSnapshot(entry) {
  const version = `${entry.id}:${[entry.path, entry.dbPath, entry.dbPath + '-wal'].map(stamp).join(':')}`;
  const prior = cache.get(entry.path);
  if (prior?.version === version) return prior;
  const rows = rowsOf(entry.path), bySeq = new Map(rows.map(r => [r.step_index, r]));
  const stepTypes = new Map(rows.map(r => [r.step_index, r.type]));
  const turns = new Map(); let turn = 0;
  for (const row of rows) { if (row.type === 'USER_INPUT') turn++; turns.set(row.step_index, turn); }
  let requests = [], sourceError = '';
  if (existsSync(entry.dbPath)) {
    try { requests = await readRequests(entry.dbPath); }
    catch { sourceError = '请求数据库暂不可读；仅展示 transcript 已记录用量。'; }
  }
  if (!requests.length) requests = rows.filter(r => r.type === 'PLANNER_RESPONSE').map(transcriptRequest);
  const current = requests.at(-1), projected = projectContext(current, stepTypes);
  projected.context.version = version;
  const currentRow = bySeq.get(current?.seq);
  const checkpointRow = rows.findLast(r => r.type === 'CHECKPOINT' && r.step_index <= (current?.seq ?? Infinity));
  const beforeCP = checkpointRow && requests.findLast(r => r.seq < checkpointRow.step_index);
  const afterCP = checkpointRow && requests.find(r => r.seq > checkpointRow.step_index);
  const series = requests.map(r => {
    const row = bySeq.get(r.seq), tools = (Array.isArray(row?.tool_calls) ? row.tool_calls : []).map(c => c.name).filter(Boolean);
    return { ...Object.fromEntries(['index', 'seq', 'at', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'windowTokens'].map(k => [k, r[k]])),
      turn: turns.get(r.seq) || 0, checkpoint: row?.type === 'CHECKPOINT',
      label: row?.type === 'CHECKPOINT' ? '压缩请求' : tools.length ? tools.join(' · ') : `请求 #${r.seq ?? r.index}` };
  });
  series.forEach((r, i) => {
    r.deltaTokens = i && r.windowTokens != null && series[i - 1].windowTokens != null ? r.windowTokens - series[i - 1].windowTokens : null;
    r.deltaBySource = r.deltaTokens == null ? null : Object.fromEntries(['inputTokens', 'cacheReadTokens', 'cacheWriteTokens'].map(key => [key, r[key] - series[i - 1][key]]));
  });
  const intervals = series.map((r, i) => ({ s: r.seq, cat: 'assistant', t: r.turn, at: r.at, w: r.windowTokens, o: r.outputTokens,
    d: i && r.windowTokens != null && series[i - 1].windowTokens != null ? r.windowTokens - series[i - 1].windowTokens : null,
    tl: r.label, retained: projected.context.items.some(item => item.seq === r.seq) }));
  const sum = key => requests.some(r => r[key] != null) ? requests.reduce((n, r) => n + (r[key] ?? 0), 0) : null;
  const totalIn = sum('inputTokens'), totalCache = sum('cacheReadTokens'), totalWrite = sum('cacheWriteTokens');
  const stride = Math.max(1, Math.ceil(series.length / 160));
  const data = {
    version, etag: version, conversationId: entry.id, shortId: entry.id.slice(0, 8),
    cutSeq: rows.at(-1)?.step_index ?? current?.seq ?? 0, turns: turn, plannerSteps: requests.length,
    currentWindow: current?.windowTokens ?? null, currentCached: current?.cacheReadTokens ?? null,
    currentUncached: current?.inputTokens ?? null, currentWrite: current?.cacheWriteTokens ?? null,
    usageSeq: current?.seq ?? null, usageAt: current?.at || currentRow?.created_at || '',
    peakWindow: requests.some(r => r.windowTokens != null) ? Math.max(0, ...requests.map(r => r.windowTokens || 0)) : null,
    checkpoint: checkpointRow ? { step: checkpointRow.step_index, beforeWindow: beforeCP?.windowTokens ?? null, afterWindow: afterCP?.windowTokens ?? null } : null,
    totalIn, totalCache, totalWrite, totalOut: requests.some(r => r.outputTokens != null) ? sum('outputTokens') : null,
    cacheHitRate: totalIn + totalCache + totalWrite > 0 ? +(totalCache / (totalIn + totalCache + totalWrite) * 100).toFixed(1) : null,
    currentContext: projected.context,
    source: { kind: current?.hasPrompt ? 'recorded-request' : 'unavailable', error: sourceError,
      note: current?.hasPrompt ? `最近请求 #${current.seq ?? current.index} 的可见来源文本 · 面积为文本估算，不含思考、媒体与服务商封装。` : sourceError || '最新请求未保留完整提示；用量来自已记录请求。' },
    trendSeries: series.filter((r, i) => i % stride === 0 || i === series.length - 1 || r.checkpoint || series[i + 1]?.checkpoint),
    comparison: series.length ? { before: series.find(r => r.seq > (checkpointRow?.step_index ?? -1)) || series[0], after: series.at(-1) } : null,
    topSteps: intervals.filter(r => r.d > 0).sort((a, b) => b.d - a.d).slice(0, 8),
    recentSteps: intervals.slice(-60).reverse(),
  };
  bodies.set(data, projected.fullBodies);
  cache.delete(entry.path); cache.set(entry.path, data);
  while (cache.size > 4) cache.delete(cache.keys().next().value);
  return data;
}

export function readContextBody(snapshot, itemId, version) {
  if (version !== snapshot.version) return { status: 409, error: '内容快照已更新，请刷新后重试。' };
  const text = bodies.get(snapshot)?.get(itemId);
  return text === undefined ? { status: 404, error: '未找到该片段正文' } : { text };
}
