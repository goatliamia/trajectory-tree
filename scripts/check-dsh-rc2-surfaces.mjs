// Replay rc.2's published message/catalog constructors through our consumers.
// This invokes no agents, approvals, tools, or model requests.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { buildTracePayload } from '../plugin/analysis-view/lib/trace-build.js';
import { traceActors } from '../plugin/analysis-view/lib/trace-context.js';
import { attributeToolFailure } from '../plugin/trajectory-tools/lib/tool-attribution.js';

const require=createRequire(import.meta.url),sdk=createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
const packageRoot=path.dirname(sdk.resolve('@deepseek-ai/dsh-subagent/package.json'));
const sources=['catalog','continuation-messages'].map(name=>path.join(packageRoot,'lib/types',name+'.js'));
const {establishCatalogChild}=await import(pathToFileURL(sources[0]));
const {createSettlementMessage}=await import(pathToFileURL(sources[1]));
const event=(type,seq,data)=>({type,seq,time:1000+seq,data});
function catalog(id,name,label,seq){let result;establishCatalogChild({append:(type,data)=>result=event(type,seq,data)},{id,createdAt:1000+seq},{mode:'continuable',label},name);return result;}
const base=[event('turn/start',0,{turn:1}),event('step/start',1,{turn:1,step:1}),event('step/end',2,{turn:1,step:1}),event('turn/end',3,{turn:1})];
const goals=[];
const sessionSource=sdk.resolve('@deepseek-ai/dsh-session');sources.push(sessionSource);
const {Session}=await import(pathToFileURL(sessionSource));
const detached=Session.create('rc2-compat-batch');
const single=detached.append('turn/start',{turn:1});
const batch=detached.append([['step/start',{turn:1,step:1}],['step/end',{turn:1,step:1}],['turn/end',{turn:1}]]);
goals.push({id:'session-append-overloads',expected:{single:'turn/start',batch:['step/start','step/end','turn/end'],contiguous:true},actual:{single:single.type,batch:batch.map(e=>e.type),contiguous:batch.every((e,i)=>e.seq===single.seq+i+1)}});
const batchTrace=buildTracePayload(detached.snapshotEvents(),'rc2-compat-batch');
goals.push({id:'batch-event-consumer',expected:{turns:1,steps:1},actual:{turns:batchTrace.sessions[0].totals.turns,steps:batchTrace.sessions[0].totals.steps}});
const attachmentRoot=path.dirname(sdk.resolve('@deepseek-ai/dsh-attachment/package.json'));
const attachmentSource=path.join(attachmentRoot,'lib/types/error.js');sources.push(attachmentSource);
const {AttachmentError}=await import(pathToFileURL(attachmentSource));
const attachmentCodes=['TOO_MANY_IMAGES','IMAGES_TOO_LARGE','UNSUPPORTED_IMAGE_TYPE','INVALID_IMAGE_BASE64','INVALID_IMAGE','IMAGE_TYPE_MISMATCH','IMAGE_TOO_LARGE','IMAGE_TOO_MANY_PIXELS','IMAGE_DIMENSION_TOO_LARGE','INVALID_FILE_BASE64','INVALID_ATTACHMENT_REF','ATTACHMENT_CORRUPT','ATTACHMENT_WRITE_FAILED','ATTACHMENT_NOT_FOUND','ATTACHMENT_READ_FAILED','ATTACHMENT_PROJECTION_UNSUPPORTED','ATTACHMENT_FILES_UNSUPPORTED'];
for(const code of attachmentCodes){const native=new AttachmentError('Fixture attachment failure',code),record={name:native.name,code:native.code};const found=attributeToolFailure({status:'error',tool:'read_image',output:native.message,error:record});goals.push({id:'attachment-'+code,expected:{code:record.code,certainty:'confirmed'},actual:{code:found.code,certainty:found.certainty}});}
async function observe(id,entries,childEvents=base){
  const payload=buildTracePayload(entries,'main');
  const result=await traceActors(entries,payload,[],async()=>childEvents);
  return {payload,branch:result.agentBranches.find(b=>b.id===id)};
}
const named=catalog('child-1','review','Review the patch',4),nested=catalog('grandchild-1','verify','Verify the result',5);
const own=await observe('child-1',[...base,named,event('turn/start',12,{turn:2})],[...base,nested,catalog('future-child','later','After this cut',20)]);
goals.push({id:'catalog-name-and-task',expected:{name:named.data.name,title:named.data.label,parentId:'main',mode:named.data.mode},actual:{name:own.branch.name,title:own.branch.title,parentId:own.branch.parentId??null,mode:own.branch.mode??null}});
goals.push({id:'catalog-marker-identity',expected:{name:named.data.name,mode:named.data.mode,version:named.data.version},actual:{name:own.payload.sessions[0].turns[0].markers[0].name??null,mode:own.payload.sessions[0].turns[0].markers[0].mode??null,version:own.payload.sessions[0].turns[0].markers[0].catalogVersion??null}});
goals.push({id:'direct-child-hierarchy-at-cut',expected:[{id:nested.data.childId,name:nested.data.name,parentId:'child-1'}],actual:(own.branch.children??[]).map(c=>({id:c.id,name:c.name,parentId:c.parentId}))});
for(const reason of ['completed','aborted','max-tokens','refusal','error','future-reason',undefined]){
  const message=createSettlementMessage('child-1','review',{stopReason:reason,output:[]});
  const result=await observe('child-1',[...base,named,event('user/message',6,message)]);
  goals.push({id:'settlement-'+(reason??'missing'),expected:{reason:message.source.stopReason??null,status:['completed','aborted','max-tokens','refusal','error'].includes(reason)?reason:'unknown'},actual:{reason:result.branch.stopReason??null,status:result.branch.status}});
}
const first=createSettlementMessage('child-1','review',{stopReason:'completed',output:[]}),last=createSettlementMessage('child-1','review',{stopReason:'aborted',output:[]});
const latest=await observe('child-1',[...base,named,event('user/message',6,first),event('user/message',7,last)]);
goals.push({id:'latest-settlement-wins',expected:'aborted',actual:latest.branch.status});
const legacy=await observe('legacy',[...base,event('subagent/catalog',4,{childId:'legacy',label:'Legacy task'})]);
goals.push({id:'legacy-catalog-keeps-label',expected:'Legacy task',actual:legacy.branch.name});
const seeded=await observe('own',[...base,catalog('ancestor','inherited','Ancestor child',4),event('session/end-seed',5,{}),catalog('own','mine','Own child',6)]);
goals.push({id:'inherited-catalog-is-not-owned',expected:['own'],actual:(await traceActors([...base,catalog('ancestor','inherited','Ancestor child',4),event('session/end-seed',5,{}),catalog('own','mine','Own child',6)],seeded.payload,[],async()=>base)).agentBranches.map(b=>b.id)});
const mixedSeed=[...base,catalog('ancestor','inherited','Ancestor child',4),event('session/end-seed',5,{}),catalog('ancestor-later','old','Later inherited child',6),catalog('own','mine','Own child',8)];
const explicit=await traceActors(mixedSeed,buildTracePayload(mixedSeed,'main'),[],async()=>base,{inheritedEventCount:8});
goals.push({id:'authoritative-parent-inheritance-floor',expected:['own'],actual:explicit.agentBranches.map(b=>b.id)});
const childSeed=[...base,catalog('inherited-nested','old','Inherited nested child',4),event('session/end-seed',5,{}),catalog('own-nested','verify','Own nested child',7)];
const childObservation=await traceActors([...base,named,event('turn/start',12,{turn:2})],own.payload,[],async()=>({events:childSeed,inheritedEventCount:7}));
goals.push({id:'authoritative-child-inheritance-floor',expected:['own-nested'],actual:childObservation.agentBranches[0].children?.map(b=>b.id)??[]});
const fingerprints=files=>files.map(file=>({file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
const report={runtime:JSON.parse(fs.readFileSync(sdk.resolve('@deepseek-ai/dsh/package.json'),'utf8')).version,scope:'Published catalog/settlement and attachment constructors, isolated Session.append, and actual trace consumers; no running agents or whole-host UI.',sources:fingerprints(sources),consumers:fingerprints(['plugin/analysis-view/lib/trace-build.js','plugin/analysis-view/lib/trace-context.js','plugin/analysis-view/lib/trace-stages.js','plugin/trajectory-tools/lib/tool-attribution.js']),goals:goals.map(g=>({...g,passed:JSON.stringify(g.expected)===JSON.stringify(g.actual)}))};
report.passed=report.goals.every(g=>g.passed);
const at=process.argv.indexOf('--out');if(at>=0){const out=path.resolve(process.argv[at+1]);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,goals:goals.length,failed:report.goals.filter(g=>!g.passed).map(g=>g.id)}));
if(process.argv.includes('--assert')&&!report.passed)process.exitCode=1;
