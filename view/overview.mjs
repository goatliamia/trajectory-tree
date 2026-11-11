import { createHash } from 'node:crypto';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import { readCodexOverview } from '../analyzers/codex-reader.mjs';
import { loadPortableSource, datasetAtCut } from '../plugin/portable-tools/sources.mjs';
import { projectFindingCalls } from '../plugin/analysis-view/lib/eval/findings.mjs';
import { usageRow, usageSettlements } from '../plugin/portable-tools/usage.mjs';
import { renderOverviewPage } from '../plugin/analysis-view/lib/eval/overview/render.mjs';
import { createOverviewModels, errorsForTurn, overviewCategories, span, valid } from '../plugin/analysis-view/lib/eval/overview/shared.mjs';
import { normalizeLocale } from '../lib/i18n.mjs';

const projectPath = value => {
  if (!value) return { key: '', name: '' };
  const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(value);
  const api = windows ? win32 : posix;
  const full = api.normalize(value).replace(/[\\/]+$/, '') || api.parse(value).root;
  return { key: windows ? full.toLowerCase() : full, name: api.basename(full) || full };
};

const endReasons = new Map([
  ['completed', 'completed'], ['stop', 'completed'], ['failed', 'error'], ['error', 'error'],
  ['aborted', 'aborted'], ['interrupted', 'interrupted'],
]);

function bucket(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const id = key(row);
    if (!result.has(id)) result.set(id, []);
    result.get(id).push(row);
  }
  return result;
}

export function projectPortableOverview(dataset, catalog, { cwd, provider } = {}) {
  const { host, payload } = dataset;
  const source = payload.sessions[0], context = payload.context;
  const usage = bucket(usageSettlements(context.usage ?? []), row => host === 'codex' ? row.turnId : row.turn);
  const episodes = bucket(source.overview?.episodes ?? [], row => row.turn);
  const names = [], toolIds = new Map(), actions = [];
  const turns = [];
  for (const turn of source.turns) {
    if (!valid(turn.start)) continue;
    const steps = new Map(turn.steps.map(step => [step.number, step]));
    const requests = (usage.get(host === 'codex' ? turn.id : turn.number) ?? []).map(row => {
      const step = steps.get(row.step);
      const { input, output } = usageRow(host, row);
      return { seq: row.seq ?? null, line: row.line ?? null, step: row.step ?? null,
        model: catalog.index({ model: row.model ?? step?.model, provider: step?.provider ?? provider }),
        input, output, ttft: null, responseMs: host === 'pi' ? step?.assistantDurationMs ?? null : null,
        type: step ? step.calls.length ? 'tools' : 'direct' : null,
        ...(host === 'codex' && row.window ? { window: row.window } : {}) };
    });
    const replies = new Map(requests.map(row => [row.step, row]));
    const calls = turn.steps.flatMap(step => step.calls.map(call => ({ ...call, step: step.number, name: call.nativeName || call.name })));
    const errors = errorsForTurn(episodes.get(turn.number) ?? [], calls, { portable: true });
    const errorsByResult = new Map(errors.map(error => [error.failed, error]));
    for (const call of calls) {
      if (!toolIds.has(call.name)) { toolIds.set(call.name, names.length); names.push(call.name); }
      const step = steps.get(call.step), request = replies.get(call.step);
      const elapsed = valid(call.durationMs) ? call.durationMs
        : host === 'pi' && call.startSeq != null ? span(call.start, call.end) : null;
      const status = call.status === 'returned' ? 0 : call.status === 'error' ? 1 : 2;
      actions.push([call.seq, request?.seq ?? null, turn.number, call.step, toolIds.get(call.name), status,
        null, null, call.resultSeq, errorsByResult.get(call.resultSeq)?.category ?? null,
        request?.model || catalog.index(step), elapsed]);
    }
    const reason = endReasons.get(turn.reason?.kind) ?? (host === 'pi' ? endReasons.get(turn.steps.at(-1)?.stopReason) : null);
    const end = valid(turn.durationMs) ? turn.durationMs : turn.endObserved ? span(turn.start, turn.end) : null;
    turns.push({ no: turn.number, seq: turn.seq, at: turn.start, end,
      endSeq: reason ? turn.endSeq ?? turn.steps.at(-1)?.endSeq ?? turn.seq : null, reason,
      prompt: turn.prompts[0]?.seq ?? null, model: requests[0]?.model || catalog.index(turn.steps[0]),
      wait: null, calls: calls.length, errors, requests, loops: null, chars: null });
  }
  if (!turns.length) return null;
  const frozen = datasetAtCut(dataset, source.lastSeq);
  return { id: source.id, cut: source.lastSeq, logId: frozen.logId, file: source.source?.file,
    findingCalls: projectFindingCalls(source, { host, turns: turns.map(turn => turn.no) }),
    projectPath: projectPath(cwd), turns, synthetic: dataset.synthetic === true,
    occupancy: { points: [], names, actions, stepEnds: [] }, work: { goals: [], deliveries: [], children: [], compactions: [] } };
}

async function recentFiles(directory, limit, activeFile) {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = await Promise.all(entries.filter(entry => entry.isFile() && /\.jsonl$/i.test(entry.name)).map(async entry => {
    const path = join(directory, entry.name);
    if (path === activeFile) return null;
    try { return { path, mtime: (await stat(path)).mtimeMs }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
  }));
  const sorted = candidates.filter(Boolean).sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
  return { files: sorted.slice(0, limit).map(entry => entry.path), more: sorted.length > limit };
}

export async function generateOverviewView(spec, { signal } = {}) {
  const { host, directory, input, threads = [], limit = 20 } = spec;
  const files = [...new Set((spec.files ?? []).map(file => resolve(file)))];
  if (!['pi', 'codex', 'claude'].includes(host)) throw Error('Overview host must be pi, codex or claude');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error('Overview limit must be 1..100');
  if (files.length + threads.length > 100) throw Error('Select at most 100 explicit sources');
  if ((host !== 'codex' && threads.length) || (host === 'codex' && directory)) throw Error('Overview source does not match the host');
  if (directory && files.length) throw Error('Choose --dir or explicit --file sources');
  if (spec.rollout && (host !== 'codex' || files.length !== 1 || threads.length)) throw Error('--rollout requires one Codex snapshot');
  if (host !== 'codex' && !directory && !input && !files.length) throw Error('Provide --dir or one or more --file sources');
  const locale = spec.locale === 'auto' ? 'auto' : normalizeLocale(spec.locale);
  const catalog = createOverviewModels(), sessions = [], projects = [], seen = new Set(), projectIds = new Map();
  let unread = 0, more = false;
  async function add(source, meta = {}) {
    signal?.throwIfAborted();
    const dataset = await loadPortableSource({ host, apiOnly: spec.apiOnly, synthetic: spec.synthetic, ...source }, signal);
    if (seen.has(dataset.session)) return;
    seen.add(dataset.session);
    const recorded = dataset.payload.sessions[0].source;
    const cwd = meta.cwd ?? source.input?.header?.cwd ?? recorded?.cwd;
    const projected = projectPortableOverview(dataset, catalog, { cwd, provider: meta.provider ?? recorded?.provider });
    if (!projected) return;
    const { projectPath: { key, name }, ...session } = projected;
    if (!projectIds.has(key)) { projectIds.set(key, projects.length); projects.push({ name }); }
    sessions.push({ ...session, project: projectIds.get(key) });
  }
  if (input) await add({ input });
  let selection = files;
  if (directory) ({ files: selection, more } = await recentFiles(resolve(directory), limit - Number(Boolean(input)),
    input?.source?.file ? resolve(input.source.file) : undefined));
  for (const file of selection) {
    if (input?.source?.file && resolve(input.source.file) === file) continue;
    try { await add({ file, rollout: spec.rollout }); }
    catch (error) { signal?.throwIfAborted(); if (!directory) throw error; unread++; }
  }
  if (host === 'codex' && (threads.length || !files.length)) {
    const result = await readCodexOverview({ cwd: spec.project, threads, limit, signal,
      visit: snapshot => add({ snapshot }, { cwd: snapshot.thread.cwd, provider: snapshot.thread.modelProvider }) });
    unread += result.unread;
    more ||= result.more;
  }
  const latest = sessions.reduce((last, session) => session.turns.reduce((time, turn) => Math.max(time, turn.at), last), 0) || Date.now();
  const key = createHash('sha256').update(JSON.stringify([host, sessions.map(row => row.id), spec.project, directory])).digest('hex').slice(0, 20);
  const output = resolve(spec.output || join(tmpdir(), 'trajectory-tree', key, 'overview.html'));
  const html = renderOverviewPage({ locale, data: { host, latest, projects, sessions, models: catalog.models,
    categories: overviewCategories, unread, more } });
  signal?.throwIfAborted();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html, { signal });
  return { output, bytes: Buffer.byteLength(html), host, locale: locale || 'auto', view: 'overview', projects: projects.length,
    sessions: sessions.length, unread, more };
}
