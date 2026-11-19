import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildConversationSnapshot, conversationVersion, findAppDataDirs, listConversations, readContextBody, resolveConversation, turnRequests } from './context-data.mjs';
import { conversationCatalog, createUsageOverview } from './usage-data.mjs';
import { buildAntigravityDataset } from './native/antigravity-adapter.mjs';
import { readTracePresentation, renderTraceDocument } from './native/trace/presentation.mjs';
import { buildEvalData, EVAL_DETAIL_TURNS } from './native/eval/data.mjs';
import { renderEvalPage } from './native/eval/render.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const STATIC = {
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
  '/fonts/Geist-Variable.woff2': ['fonts/Geist-Variable.woff2', 'font/woff2'],
  '/fonts/GeistMono-Variable.woff2': ['fonts/GeistMono-Variable.woff2', 'font/woff2'],
};

let traceAssetsCache = null;
function traceAssets() {
  return traceAssetsCache ??= readTracePresentation();
}
function hostExtension() {
  return readFileSync(join(root, 'native/antigravity-host.js'), 'utf8');
}
function emptyHtml(message) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;font:13px/1.6 Geist,-apple-system,sans-serif;color:#52627a;background:transparent}</style></head><body>${message}</body></html>`;
}

export function createContextApi({ dirs = findAppDataDirs(), conversationId = '' } = {}) {
  let viewSnapshot;
  function resolve(data) {
    const entries = listConversations(dirs);
    const id = data?.session || data?.conversationId || conversationId;
    return { target: resolveConversation(id, entries), entries };
  }
  async function nativeViewData(data) {
    const { target } = resolve(data);
    if (!target) return null;
    const catalog = await conversationCatalog(dirs);
    const title = catalog.get(join(target.appData, target.id))?.title || '未命名对话';
    const version = conversationVersion(target);
    if (viewSnapshot?.path === target.path && viewSnapshot.version === version && viewSnapshot.title === title) return viewSnapshot.pending;
    const pending = buildAntigravityDataset({
      dbPath: target.dbPath, transcriptPath: target.path, conversationId: target.id, title,
    });
    const snapshot = { path: target.path, version, title, pending };
    viewSnapshot = snapshot;
    const discard = () => { if (viewSnapshot === snapshot) viewSnapshot = undefined; };
    pending.then(dataset => { if (dataset.nativeUnavailable) discard(); }, discard);
    return pending;
  }
  return {
    usage: createUsageOverview(dirs),
    async context(data) {
      const { target, entries } = resolve(data);
      const catalog = await conversationCatalog(dirs);
      const info = e => catalog.get(join(e.appData, e.id)) || {};
      const ids = new Set(entries.map(e => e.id));
      const roots = entries.filter(e => !ids.has(info(e).parent));
      const recent = data?.list === 'all' ? roots : roots.slice(0, 8);
      if (target && !recent.includes(target)) recent.push(target);
      const conversations = recent.map(e => ({ id: e.id, shortId: e.id.slice(0, 8), title: info(e).title || '未命名对话' }));
      if (!target) return { empty: true, conversationId: null, conversations };
      const snap = await buildConversationSnapshot(target);
      const turn = /^\d+$/.test(data?.turn) ? Number(data.turn) : null;
      const selected = snap.turnSeries.some(bucket => bucket.turn === turn);
      const etag = selected ? snap.etag + '/turn/' + turn : snap.etag;
      if (data?.etag === etag) return { unchanged: true, conversationId: target.id, etag, conversations };
      return { ...snap, etag, conversations, ...(selected ? { turnDetail: { turn, rows: turnRequests(snap, turn) } } : {}) };
    },
    async currentContext(data) {
      const { target } = resolve(data);
      return target ? (await buildConversationSnapshot(target)).currentContext : { available: false };
    },
    async body(data) {
      const { target } = resolve(data);
      if (!target) return { status: 404, error: '会话不存在' };
      return readContextBody(await buildConversationSnapshot(target), data?.item, data?.version);
    },
    async traceHtml(data) {
      const ds = await nativeViewData(data);
      if (!ds) return emptyHtml('当前会话暂无轨迹记录，请先在顶部选择一个对话。');
      const assets = traceAssets();
      const template = assets.template
        .replace(/<title>[^<]*<\/title>/, '<title>Antigravity · 执行路径</title>')
        .replaceAll('/analysis-view/trace/fonts/', '/fonts/')
        .replace('<span class="geist-edition">02</span>', '<span class="geist-edition">Antigravity</span>');
      return renderTraceDocument(ds.payload, assets, {
        template,
        locale: data?.lang === 'en' ? 'en' : 'zh-CN',
        extension: hostExtension(),
      });
    },
    async evalHtml(data) {
      const ds = await nativeViewData(data);
      if (!ds) return emptyHtml('当前会话暂无运行评估记录，请先在顶部选择一个对话。');
      const evalData = buildEvalData(ds.session, ds.runtime, {
        host: 'antigravity',
        turnLimit: EVAL_DETAIL_TURNS,
        argumentsBySeq: ds.argumentsBySeq,
        resultsBySeq: ds.resultsBySeq,
        cacheCompaction: ds.cacheCompaction,
      });
      return renderEvalPage(evalData, {
        integrated: true,
        mode: 'antigravity',
        fontPath: '/fonts/',
        locale: data?.lang === 'en' ? 'en' : 'zh-CN',
      });
    },
  };
}

export async function startSidecar() {
  const { SidecarApp, Response } = await import('sidecar_sdk');
  const app = new SidecarApp();
  const api = createContextApi({ conversationId: app.config?.conversationId || process.env.ANTIGRAVITY_CONVERSATION_ID });
  app.page('/', () => readFileSync(join(root, 'index.html'), 'utf8'));
  for (const [route, [file, type]] of Object.entries(STATIC)) {
    app.api(route, () => existsSync(join(root, file))
      ? new Response(readFileSync(join(root, file)), { contentType: type, headers: { 'Cache-Control': 'no-cache' } })
      : new Response('not found', { status: 404 }), 'GET');
  }
  app.api('/trace', async data => new Response(await api.traceHtml(data), {
    contentType: 'text/html; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
  }), 'GET');
  app.api('/eval', async data => new Response(await api.evalHtml(data), {
    contentType: 'text/html; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
  }), 'GET');
  app.api('/api/context', api.context, 'GET');
  app.api('/api/usage', api.usage, 'GET');
  app.api('/api/current-context', api.currentContext, 'GET');
  app.api('/api/current-context/body', async data => {
    const result = await api.body(data);
    return result.error ? new Response(JSON.stringify({ error: result.error }), { status: result.status, contentType: 'application/json' }) : result;
  }, 'GET');
  await app.run();
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await startSidecar();
