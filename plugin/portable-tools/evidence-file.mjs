import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {readBoundedFile} from '../../lib/bounded-file.mjs';
const digest = text => createHash('sha256').update(text).digest('hex');
export async function writeEvidenceFile(data, output) {
  const text = JSON.stringify(data), sha256 = digest(text);
  // Same budget as the query service, which retains a working copy.
  if (Buffer.byteLength(text) * 2 > 128 * 1024 * 1024) throw Error('Exported evidence exceeds query budget');
  const file = resolve(output + '.' + sha256.slice(0,16) + '.evidence.json');
  await mkdir(dirname(file),{recursive:true});
  await writeFile(file,JSON.stringify({schema:'trajectory-evidence/1',sha256,data}));
  return file;
}
export async function readEvidenceFile(file, host, signal) {
  const raw = await readBoundedFile(file,{maxBytes:64*1024*1024,signal,overflow:'Exported evidence exceeds query budget'});
  const value = JSON.parse(raw);
  if (value.schema !== 'trajectory-evidence/1' || value.data?.host !== host || !Array.isArray(value.data.records) ||
      value.data.payload?.sessions?.[0]?.id !== value.data.session || digest(JSON.stringify(value.data)) !== value.sha256) throw Error('Invalid exported evidence or host mismatch');
  return value.data;
}
