import * as zlib from 'node:zlib';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';
import { readBoundedChunks, readBoundedFile } from '../lib/bounded-file.mjs';
import { jsonlFrames } from '../lib/jsonl-frames.mjs';
import { omitCodexImages } from './codex-images.mjs';

const maxBytes = 128 * 1024 * 1024;
const maxSourceBytes = 512 * 1024 * 1024;
const decompress = typeof zlib.zstdDecompress === 'function' ? promisify(zlib.zstdDecompress) : null;

export async function compactRollout(chunks, signal, retainedLimit = maxBytes) {
  const decoder = new StringDecoder('utf8');
  const lines = []; let retainedBytes = 0;
  const frames = jsonlFrames((line, ending) => {
    const compact = omitCodexImages(line);
    retainedBytes += Buffer.byteLength(compact) + Buffer.byteLength(ending);
    if (retainedBytes > retainedLimit) throw Error('Codex rollout text exceeds 128 MiB after image omission');
    lines.push(compact, ending);
  });
  for await (const bytes of chunks) {
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
      signal?.throwIfAborted();
      frames.push(decoder.write(bytes.subarray(offset, offset + 64 * 1024)));
    }
  }
  frames.push(decoder.end());
  frames.finish();
  signal?.throwIfAborted();
  return lines.join('');
}

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
  const options = { maxBytes:maxSourceBytes, signal, overflow: 'Codex rollout source exceeds 512 MiB' };
  let missing;
  for (const path of paths) {
    try {
      if (!/\.zst$/i.test(path)) return await compactRollout(readBoundedChunks(path, options), signal);
      const compressed = await readBoundedFile(path, options);
      if (!decompress) {
        if (!required) return null;
        throw Error('Reading a Zstandard rollout requires a Node runtime with zstd support');
      }
      const bytes = await decompress(compressed, { maxOutputLength: maxSourceBytes });
      signal?.throwIfAborted();
      return await compactRollout([bytes], signal);
    } catch (error) {
      if (error.code === 'ENOENT') { missing ??= error; continue; }
      throw error;
    }
  }
  if (required) throw missing;
  return null;
}
