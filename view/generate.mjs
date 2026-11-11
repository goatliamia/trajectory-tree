import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {readPiSession} from '../analyzers/pi-reader.mjs';
import {adaptPiSession} from '../analyzers/pi-adapter.mjs';
import {readCodexSnapshot,readCodexThread} from '../analyzers/codex-reader.mjs';
import {omitCodexImageValues} from '../analyzers/codex-images.mjs';
import {adaptCodexThread} from '../analyzers/codex-adapter.mjs';
import {readCodexRollout,validateCodexRollout} from '../analyzers/codex-rollout.mjs';
import {readClaudeTranscript} from '../analyzers/claude-reader.mjs';
import {projectClaudeTranscript,finalizeClaudeDataset} from '../analyzers/claude-adapter.mjs';
import {writeHostTracePage} from './render.mjs';
import {writeHostEvalPage} from './eval.mjs';
import {datasetFromNative} from '../plugin/portable-tools/sources.mjs';
import {commandAttributionDetails} from '../plugin/portable-tools/command-diagnosis.mjs';
import {commandCrOptions} from '../analyzers/cr-pwsh.mjs';
import {normalizeLocale} from '../lib/i18n.mjs';
// Deterministic view generation only. No model call or diagnostic prose.
export async function generateTraceView(spec,{signal}={}){
 signal?.throwIfAborted();const locale=spec.locale==='auto'?'auto':normalizeLocale(spec.locale);let payload, dataset;
 const evaluation=['eval','code'].includes(spec.initialView);
 const cr=evaluation?(spec.cr??commandCrOptions([])):null;
 if(spec.host==='pi'){
  const input=spec.input||await readPiSession(spec.file,{leafId:spec.leafId,captureFile:spec.captureFile,synthetic:spec.synthetic,signal});
  if(evaluation)dataset=datasetFromNative('pi',input);
  payload=dataset?.payload||adaptPiSession(input);
 }else if(spec.host==='claude'){
  const native=spec.input||await readClaudeTranscript(spec.file,{signal});
  if(evaluation){dataset=datasetFromNative('claude',native);payload=dataset.payload;}
  else {const projected=projectClaudeTranscript(native);payload=finalizeClaudeDataset({session:native.sessionId,records:[],payload:adaptPiSession(projected)},native,projected).payload;}
 }else if(spec.host==='codex'){
  const thread=spec.thread||process.env.CODEX_THREAD_ID||process.env.CODEX_SESSION_ID;
  if(!spec.file&&!spec.snapshot&&!thread)throw Error('Provide --thread or --file when the current Codex thread ID is unavailable');
  const snapshot=spec.snapshot||(spec.file?await readCodexSnapshot(spec.file,{signal}):await readCodexThread(thread,{signal}));
  const rollout=spec.apiOnly?null:await readCodexRollout(spec.rollout||snapshot.thread?.path,{required:!!spec.rollout,signal});
  validateCodexRollout(rollout,snapshot.thread.id);
  if(evaluation)dataset=datasetFromNative('codex',snapshot,{rollout,commandDiagnostics:true});
  payload=dataset?.payload||adaptCodexThread(spec.snapshot?omitCodexImageValues(snapshot):snapshot,{rollout});
 }else throw Error('View host must be pi, codex or claude');
 signal?.throwIfAborted();const session=payload.sessions[0].id;
 const key=createHash('sha256').update(spec.host+':'+session).digest('hex').slice(0,20);
 const output=resolve(spec.output||join(tmpdir(),'trajectory-tree',key,evaluation?'eval.html':'view.html'));
 if(dataset){const attributions=await commandAttributionDetails(dataset,cr,signal);return writeHostEvalPage(dataset,output,{locale,attributions,section:spec.initialView==='code'?'code':undefined});}
 return {...writeHostTracePage(payload,output,{locale}),session,totals:payload.sessions[0].totals};
}
