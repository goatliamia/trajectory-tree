import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { piSessionPath } from './pi-adapter.mjs';
import { readBoundedFile } from '../lib/bounded-file.mjs';

// Read native JSONL without opening SessionManager (which can migrate files).
export async function readPiSession(file, { leafId, captureFile, synthetic = false, signal, maxBytes = 128 * 1024 * 1024 } = {}) {
  const path = resolve(file);
  const options = { maxBytes, signal, overflow: 'Pi session exceeds input budget' };
  const bytes = await readBoundedFile(path, options);
  const input = bytes.toString('utf8'), lines = input.split(/\r?\n/), rows = [];
  let incompleteTail = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { rows.push(JSON.parse(lines[i])); }
    catch { if (i === lines.length - 1 && !input.endsWith('\n')) incompleteTail = true; else throw Error('Invalid Pi JSON at line ' + (i + 1)); }
  }
  const [header, ...entries] = rows;
  if (header?.type !== 'session' || header.version !== 3) throw Error('Expected a native Pi Session v3 JSONL file');
  piSessionPath(entries, leafId);
  const capture = captureFile ? (await readBoundedFile(captureFile, options)).toString('utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
  return { header, entries, ...(leafId ? { leafId } : {}), capture, synthetic: synthetic || capture.some(r => r.synthetic === true), capturedAt: new Date().toISOString(), source: { name: 'Pi Session v3 JSONL', file: path, sha256: createHash('sha256').update(bytes).digest('hex'), incompleteTail } };
}
