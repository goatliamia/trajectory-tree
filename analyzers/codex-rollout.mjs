import * as zlib from 'node:zlib';
import { promisify } from 'node:util';
import { readBoundedFile } from '../lib/bounded-file.mjs';

const maxBytes = 128 * 1024 * 1024;
const decompress = typeof zlib.zstdDecompress === 'function' ? promisify(zlib.zstdDecompress) : null;

export function validateCodexRollout(text, threadId) {
  if (!text) return;
  const first = JSON.parse(text.trimStart().split(/\r?\n/, 1)[0]);
  if (first.type !== 'session_meta' || first.payload?.id !== threadId) throw Error('Local rollout identity does not match the selected Codex thread');
}

// The app server may advertise the .jsonl path even after that file was
// archived as .jsonl.zst. Both the view and the query service use this reader.
export async function readCodexRollout(file, { signal, required = false } = {}) {
  if (!file) return null;
  const paths = /\.zst$/i.test(file) ? [file] : [file, file + '.zst'];
  let missing;
  for (const path of paths) {
    let bytes;
    try {
      bytes = await readBoundedFile(path, { maxBytes, signal, overflow: 'Codex rollout exceeds 128 MiB' });
    } catch (error) {
      if (error.code === 'ENOENT') { missing ??= error; continue; }
      throw error;
    }
    if (/\.zst$/i.test(path)) {
      if (!decompress) {
        if (!required) return null;
        throw Error('Reading a Zstandard rollout requires a Node runtime with zstd support');
      }
      bytes = await decompress(bytes, { maxOutputLength: maxBytes });
    }
    signal?.throwIfAborted();
    return bytes.toString('utf8');
  }
  if (required) throw missing;
  return null;
}
