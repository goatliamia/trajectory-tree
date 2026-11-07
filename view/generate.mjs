import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {readPiSession} from '../analyzers/pi-reader.mjs';
import {adaptPiSession} from '../analyzers/pi-adapter.mjs';
import {readCodexThread} from '../analyzers/codex-reader.mjs';
import {adaptCodexThread} from '../analyzers/codex-adapter.mjs';
import {readClaudeTranscript} from '../analyzers/claude-reader.mjs';
import {projectClaudeTranscript,finalizeClaudeDataset} from '../analyzers/claude-adapter.mjs';
import {writeHostTracePage} from './render.mjs';
import {normalizeLocale} from '../lib/i18n.mjs';
import {readBoundedFile} from '../lib/bounded-file.mjs';

const readBounded=async(file,signal)=>{
 const bytes=await readBoundedFile(file,{maxBytes:128*1024*1024,signal,overflow:'View source exceeds 128 MiB'});
 return bytes.toString('utf8');
};
// Deterministic view generation only. No model call or diagnostic prose.
export async function generateTraceView(spec,{signal}={}){
 signal?.throwIfAborted();const locale=spec.locale==='auto'?'auto':normalizeLocale(spec.locale);let payload;
 if(spec.host==='pi'){
  const input=spec.input||await readPiSession(spec.file,{leafId:spec.leafId,captureFile:spec.captureFile,synthetic:spec.synthetic,signal});
  payload=adaptPiSession(input);
 }else if(spec.host==='claude'){
  const native=spec.input||await readClaudeTranscript(spec.file,{signal}),projected=projectClaudeTranscript(native);
  payload=finalizeClaudeDataset({session:native.sessionId,records:[],payload:adaptPiSession(projected)},native,projected).payload;
 }else if(spec.host==='codex'){
  const thread=spec.thread||process.env.CODEX_THREAD_ID||process.env.CODEX_SESSION_ID;
  if(!spec.file&&!spec.snapshot&&!thread)throw Error('Provide --thread or --file when the current Codex thread ID is unavailable');
  const snapshot=spec.snapshot||(spec.file?JSON.parse(await readBounded(spec.file,signal)):await readCodexThread(thread,{signal}));
  let rollout=null;
  if(!spec.apiOnly){
   const path=spec.rollout||snapshot.thread?.path;
   if(path)try{rollout=await readBounded(path,signal);}catch(error){if(spec.rollout||error.code!=='ENOENT')throw error;}
  }
  if(rollout){const first=JSON.parse(rollout.split(/\r?\n/).find(line=>line.trim()));if(first.type!=='session_meta'||first.payload?.id!==snapshot.thread.id)throw Error('Local rollout identity does not match the selected Codex thread');}
  payload=adaptCodexThread(snapshot,{rollout});
 }else throw Error('View host must be pi, codex or claude');
 signal?.throwIfAborted();const session=payload.sessions[0].id;
 const key=createHash('sha256').update(spec.host+':'+session).digest('hex').slice(0,20);
 const output=resolve(spec.output||join(tmpdir(),'trajectory-tree',key,'view.html'));
 return {...writeHostTracePage(payload,output,{locale}),session,totals:payload.sessions[0].totals};
}
