import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

// Check and read the same open file. A file may grow after its size is checked.
export async function readBoundedFile(path, { maxBytes, signal, overflow }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Invalid input byte budget');
  signal?.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('Input must be a regular file');
    if (stat.size > maxBytes) throw new Error(overflow);
    const chunks = [];
    let total = 0;
    for (;;) {
      signal?.throwIfAborted();
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - total + 1));
      const { bytesRead } = await file.read(chunk);
      signal?.throwIfAborted();
      if (!bytesRead) return Buffer.concat(chunks, total);
      total += bytesRead;
      if (total > maxBytes) throw new Error(overflow);
      chunks.push(chunk.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
}
