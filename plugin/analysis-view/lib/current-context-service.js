import { createHash } from 'node:crypto';
import { readCurrentContext } from './trace/shared/request-context.mjs';
import { traceSource, observationSource, sameSource } from './trace-cache.js';

// A sidebar owns metadata, not another copy of the session journal. Retain only
// two current surfaces, with a byte limit and idle expiry for their lazy bodies.
export class CurrentContextService {
  constructor(ctx, { observe, dispose, queue, now = Date.now, read = readCurrentContext }) {
    Object.assign(this, { ctx, observe, disposeObservation: dispose, queue, now, read });
    this.entries = new Map(); this.timer = null; this.serial = 0; this.closed = false;
  }
  expire() {
    clearTimeout(this.timer);
    for (const [id, entry] of this.entries) if (this.now() - entry.at >= 90000) this.entries.delete(id);
    if (this.entries.size) { this.timer = setTimeout(() => this.expire(), 90000); this.timer.unref?.(); }
  }
  retain(id, entry) {
    this.entries.delete(id); this.entries.set(id, entry);
    let bytes = [...this.entries.values()].reduce((sum, row) => sum + row.bytes, 0);
    for (const [key, row] of this.entries) {
      if (this.entries.size <= 2 && bytes <= 16 * 1024 * 1024) break;
      this.entries.delete(key); bytes -= row.bytes;
    }
    this.expire();
  }
  cachedSnapshot(id, source) {
    const entry = this.entries.get(id);
    if (!entry || this.now() - entry.at >= 90000 || !sameSource(entry.source, source)) return null;
    entry.at = this.now(); return entry.data;
  }
  async snapshot(id, signal) {
    if (this.closed) throw new DOMException('Context view was released', 'AbortError');
    const source = await traceSource(this.ctx, id, signal);
    signal?.throwIfAborted();
    const cached = this.cachedSnapshot(id, source);
    if (cached) return cached;
    return this.queue.run(async () => {
      signal?.throwIfAborted();
      if (this.closed) throw new DOMException('Context view was released', 'AbortError');
      // A preceding request may have populated this revision while we waited.
      const ready = this.cachedSnapshot(id, source);
      if (ready) return ready;
      const observation = await this.observe(id, signal);
      try {
        const surface = await this.read(observation.events ?? [], signal, this.ctx.get('sessions')?.messageProjections ?? []);
        signal?.throwIfAborted();
        if (this.closed) throw new DOMException('Context view was released', 'AbortError');
        if (!surface) return { sessionId: id, available: false, items: [], reason: 'surface-unavailable' };
        const captured = observationSource(this.ctx, observation, source);
        const version = createHash('sha256').update(JSON.stringify([id, captured?.revision ?? ++this.serial, surface.cut])).digest('hex').slice(0, 24);
        const { bodies, ...metadata } = surface;
        const bytes = JSON.stringify(metadata).length * 2 + [...bodies.values()].reduce((sum, body) => sum + body.length * 2, 0);
        const bodyAvailable = bytes <= 16 * 1024 * 1024;
        const data = { ...metadata, sessionId: id, available: true, version, bodyAvailable };
        if (bodyAvailable) this.retain(id, { source: captured, data, bodies, bytes, at: this.now() });
        return data;
      } finally { this.disposeObservation(observation); }
    }, signal);
  }
  body(id, version, itemId) {
    const entry = this.entries.get(id);
    if (!entry || this.now() - entry.at >= 90000 || entry.data.version !== version) return null;
    const body = entry.bodies.get(itemId);
    if (body === undefined) return null;
    entry.at = this.now(); return { text: body, characters: body.length };
  }
  async readBody(id, version, itemId, signal) {
    const entry = this.entries.get(id);
    if (!entry || this.now() - entry.at >= 90000) await this.snapshot(id, signal);
    return this.body(id, version, itemId);
  }
  dispose() { this.closed = true; clearTimeout(this.timer); this.entries.clear(); }
}
