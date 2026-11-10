import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { observationSource, sameSource, traceSource } from '../../trace-cache.js';
import { projectOverviewSession } from './data.mjs';
import { createOverviewModels, overviewCategories } from './shared.mjs';

function resolveSdk(name) {
  const local = createRequire(import.meta.url);
  if (isAbsolute(process.argv[1] ?? '')) {
    try { return createRequire(process.argv[1]).resolve(name); }
    catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  return local.resolve(name);
}

let runtime;
function loadRuntime() {
  const sdk = async name => import(pathToFileURL(resolveSdk(name)).href);
  async function pressureProjection() {
    const root = dirname(resolveSdk('@deepseek-ai/dsh-token-meter/package.json'));
    const module = await import(pathToFileURL(join(root, 'lib/types/usage-projection.js')).href);
    return module.contextPressureProjectionDefinition;
  }
  return runtime ??= Promise.all([
    sdk('@deepseek-ai/dsh-llm').catch(() => ({})),
    sdk('@deepseek-ai/dsh-llm/assistant-stream').catch(() => ({})),
    pressureProjection().catch(() => null),
  ]).then(([llm, stream, pressure]) => ({ stream: { ...llm, ...stream }, pressure }));
}

const CACHE_BYTES = 20 * 1024 * 1024;
const CACHE_SESSIONS = 128;

export class OverviewService {
  constructor(ctx, { observe, dispose, timeout, queue, sdk = loadRuntime }) {
    Object.assign(this, { ctx, observe, release: dispose, timeout, queue, sdk });
    this.catalog = createOverviewModels();
    this.cache = new Map();
    this.bytes = 0;
    this.controller = new AbortController();
  }

  scope() {
    const registry = this.ctx.get('workspaceRegistry');
    if (typeof registry?.list !== 'function') return null;
    const archived = new Set(registry.archivedSessionIds);
    const projects = [], sessions = [], seen = new Set();
    for (const workspace of registry.list()) {
      const project = projects.length;
      projects.push({ id: workspace.id, name: workspace.title || basename(workspace.path) });
      for (const id of workspace.sessionIds) {
        if (archived.has(id) || seen.has(id)) continue;
        seen.add(id);
        sessions.push({ id, cwd: workspace.path, project });
      }
    }
    return { projects, sessions };
  }

  async session({ id, cwd }, sdk, signal) {
    return this.queue.run(async () => {
      const source = await this.timeout(stop => traceSource(this.ctx, id, stop), 1500, signal).catch(error => {
        if (signal.aborted) throw error;
        return null;
      });
      const cached = this.cache.get(id);
      if (cached && sameSource(cached.source, source) && cached.cwd === cwd) {
        this.cache.delete(id);
        this.cache.set(id, cached);
        return cached.data;
      }
      this.forget(id);
      const observation = await this.timeout(stop => this.observe(id, stop), 8000, signal);
      let data, captured;
      try {
        signal.throwIfAborted();
        data = projectOverviewSession(id, observation.events ?? [], {
          cwd, inherited: observation.inheritedEventCount ?? 0,
        }, this.catalog, sdk);
        captured = observationSource(this.ctx, observation, source);
      } finally { this.release(observation); }
      if (captured) {
        const bytes = data ? Buffer.byteLength(JSON.stringify(data)) : 0;
        if (bytes <= CACHE_BYTES) {
          this.cache.set(id, { source: captured, cwd, data, bytes });
          this.bytes += bytes;
          while (this.cache.size > CACHE_SESSIONS || this.bytes > CACHE_BYTES) this.forget(this.cache.keys().next().value);
        }
      }
      return data;
    }, signal, 2);
  }

  forget(id) {
    this.bytes -= this.cache.get(id)?.bytes ?? 0;
    this.cache.delete(id);
  }

  async *stream(scope, requestSignal) {
    const signal = AbortSignal.any([this.controller.signal, requestSignal]);
    yield { type: 'start', projects: scope.projects, total: scope.sessions.length, latest: Date.now() };
    const sdk = await this.sdk();
    let done = 0, unread = 0;
    for (const entry of scope.sessions) {
      signal.throwIfAborted();
      let data;
      try { data = await this.session(entry, sdk, signal); }
      catch (error) {
        if (signal.aborted) throw error;
        unread++;
      }
      yield { type: 'session', done: ++done, ...(data ? { session: { ...data, project: entry.project } } : {}) };
      await setImmediate(undefined, { signal });
    }
    yield { type: 'complete', models: this.catalog.models, categories: overviewCategories, unread };
  }

  dispose() {
    this.controller.abort();
    this.cache.clear();
    this.bytes = 0;
  }
}
