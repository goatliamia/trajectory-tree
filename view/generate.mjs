import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {readPiSession} from '../analyzers/pi-reader.mjs';
import {readCodexSnapshot,readCodexThread} from '../analyzers/codex-reader.mjs';
import {omitCodexImageValues} from '../analyzers/codex-images.mjs';
import {readCodexRollout,validateCodexRollout} from '../analyzers/codex-rollout.mjs';
import {readClaudeTranscript} from '../analyzers/claude-reader.mjs';
import {writeHostTracePage} from './render.mjs';
import {writeHostEvalPage,portableDiagnosis} from './eval.mjs';
import {datasetFromNative,compactPortableDataset,datasetAtCut} from '../plugin/portable-tools/sources.mjs';
import {writeEvidenceFile} from '../plugin/portable-tools/evidence-file.mjs';
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
  dataset=datasetFromNative('pi',input,{presentation:!evaluation}); payload=dataset.payload;
 }else if(spec.host==='claude'){
  const native=spec.input||await readClaudeTranscript(spec.file,{signal});
  dataset=datasetFromNative('claude',native,{presentation:!evaluation});payload=dataset.payload;
 }else if(spec.host==='codex'){
  const thread=spec.thread||process.env.CODEX_THREAD_ID||process.env.CODEX_SESSION_ID;
  if(!spec.file&&!spec.snapshot&&!thread)throw Error('Provide --thread or --file when the current Codex thread ID is unavailable');
  const snapshot=spec.snapshot||(spec.file?await readCodexSnapshot(spec.file,{signal}):await readCodexThread(thread,{signal}));
  const rollout=spec.apiOnly?null:await readCodexRollout(spec.rollout||snapshot.thread?.path,{required:!!spec.rollout,signal});
  validateCodexRollout(rollout,snapshot.thread.id);
  dataset=datasetFromNative('codex',spec.snapshot?omitCodexImageValues(snapshot):snapshot,{rollout,commandDiagnostics:evaluation,presentation:!evaluation});payload=dataset.payload;
 }else throw Error('View host must be pi, codex or claude');
 signal?.throwIfAborted();const session=payload.sessions[0].id;
 const key=createHash('sha256').update(spec.host+':'+session).digest('hex').slice(0,20);
 const output=resolve(spec.output||join(tmpdir(),'trajectory-tree',key,evaluation?'eval.html':'view.html'));
 const evidenceFile=await writeEvidenceFile(compactPortableDataset(datasetAtCut(dataset,payload.sessions[0].lastSeq)),output);
 if(evaluation){const attributions=await commandAttributionDetails(dataset,cr,signal);return {...writeHostEvalPage(dataset,output,{locale,attributions,evidenceFile,section:spec.initialView==='code'?'code':undefined}),evidenceFile};}
 return {...writeHostTracePage(payload,output,{locale,diagnosis:{...portableDiagnosis(dataset),evidenceFile}}),evidenceFile,session,totals:payload.sessions[0].totals};
}
