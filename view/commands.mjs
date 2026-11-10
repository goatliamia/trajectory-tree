import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { commandBatchLimit } from '../analyzers/cr-pwsh.mjs';
import { normalizeLocale } from '../lib/i18n.mjs';
import { inlineTraceFonts } from '../plugin/analysis-view/lib/trace/fonts.mjs';
import { commandPageCut, commandReport } from '../plugin/portable-tools/command-diagnosis.mjs';
import { datasetAtCut, loadPortableSource } from '../plugin/portable-tools/sources.mjs';

export async function generateCommandView(spec, { signal } = {}) {
  if (spec.host !== 'codex') throw Error('--commands currently requires --host codex');
  const thread = spec.thread || process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID;
  if (!spec.snapshot && !spec.file && !thread) throw Error('Provide --thread or --file for command diagnosis');
  const seqs = spec.seqs?.length ? [...new Set(spec.seqs)] : undefined;
  if (seqs && (seqs.length > commandBatchLimit || seqs.some(seq => !Number.isSafeInteger(seq) || seq < 0))) {
    throw Error('Select at most 12 nonnegative call sequence numbers with --seq');
  }
  const locale = normalizeLocale(spec.locale);
  const source = await loadPortableSource({ ...spec, thread, commandDiagnostics: true }, signal);
  const stableCut = commandPageCut(source);
  const cut = spec.cut ?? (seqs?.some(seq => seq > stableCut) ? source.payload.sessions[0].lastSeq : stableCut);
  const data = datasetAtCut(source, cut);
  const report = await commandReport(data, { seqs, whole: true, cr: spec.cr, signal });
  const key = createHash('sha256').update(data.logId).digest('hex').slice(0, 20);
  const output = resolve(spec.output || join(tmpdir(), 'trajectory-tree', key, 'commands.html'));
  const model = { ...report, locale, selected: seqs?.[0] ?? null };
  const template = readFileSync(new URL('./commands.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('./commands.js', import.meta.url), 'utf8');
  const html = inlineTraceFonts(template.replace('/*__COMMAND_SCRIPT__*/', () => script)
    .replace('/*__COMMAND_DATA__*/', () => JSON.stringify(model).replaceAll('<', '\\u003c')));
  signal?.throwIfAborted();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html, { signal });
  return { output, bytes: Buffer.byteLength(html), host: data.host, locale: locale ?? 'auto', view: 'commands',
    session: data.session, cut, logId: data.logId, calls: report.rows.length,
    failures: report.rows.filter(row => row.status === 'error').length, cr: report.cr };
}
