import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildConversationSnapshot, findAppDataDirs, listConversations, readContextBody, resolveConversation, turnRequests } from './context-data.mjs';
import { conversationCatalog, createUsageOverview } from './usage-data.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const STATIC = {
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
  '/fonts/Geist-Variable.woff2': ['fonts/Geist-Variable.woff2', 'font/woff2'],
  '/fonts/GeistMono-Variable.woff2': ['fonts/GeistMono-Variable.woff2', 'font/woff2'],
};

export function createContextApi({ dirs = findAppDataDirs(), conversationId = '' } = {}) {
  function resolve(data) {
    const entries = listConversations(dirs);
    const id = data?.session || data?.conversationId || conversationId;
    return { target: resolveConversation(id, entries), entries };
  }
  return {
    usage: createUsageOverview(dirs),
    async context(data) {
      const { target, entries } = resolve(data);
      const catalog = await conversationCatalog(dirs);
      const info = e => catalog.get(join(e.appData,e.id)) || {};
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
