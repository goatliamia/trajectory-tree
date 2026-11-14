import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import * as zlib from 'node:zlib';
import {createPiSample} from '../analyzers/pi-sample.mjs';
import {readCodexSnapshot} from '../analyzers/codex-reader.mjs';
import {readCodexRollout,compactRollout} from '../analyzers/codex-rollout.mjs';
import {parseCodexRollout} from '../analyzers/codex-adapter.mjs';
import {datasetFromNative,loadPortableSource} from '../plugin/portable-tools/sources.mjs';
import {generateTraceView} from './generate.mjs';
import {startViewServer} from './serve.mjs';
import {readBoundedFile} from '../lib/bounded-file.mjs';
import {readEvidenceFile} from '../plugin/portable-tools/evidence-file.mjs';
import {fileService} from '../plugin/portable-tools/runtime.mjs';
import {executeTool} from '../plugin/portable-tools/tools.mjs';
const directory=await mkdtemp(join(tmpdir(),'trajectory-view-test-'));let serving;
try{
 const input=createPiSample({revision:'view-entry-test'}),copy=JSON.stringify(input);
 const view=await generateTraceView({host:'pi',input,output:join(directory,'view.html')});
 assert.equal(JSON.stringify(input),copy,'Generation does not mutate the native session');
 assert.equal(view.synthetic,true);assert.equal(view.session,input.header.id);
 const html=await readFile(view.output,'utf8');assert.ok(html.includes('data:font/woff2;base64,'));assert.ok(!html.includes('url(\'/fonts/'));
 assert.ok(html.includes('id="diagnosis-editor"') && html.includes('__bindDiagnosisGesture'),'Portable trace shares selection and draft editor');
 assert.ok(html.includes('pi:'+input.header.id+':cut:'),'Drafts carry the query identity of the frozen source');
 const evidence=await readEvidenceFile(view.evidenceFile,'pi');
 const queryService=fileService({host:'pi',evidenceFile:view.evidenceFile},{rebuildSnapshots:true});
 try { const inspected=await executeTool(queryService,'trajectory_inspect',{view:'overview',cut:evidence.cut,logId:evidence.logId,samples:false});assert.equal(inspected.logId,evidence.logId); }
 finally {queryService.dispose();}
 await assert.rejects(()=>readEvidenceFile(view.evidenceFile,'codex'),/host mismatch/);
 const english=await generateTraceView({host:'pi',input,locale:'en-US',output:join(directory,'en.html')});
 assert.equal(english.locale,'en');assert.equal(english.capabilities.chatJump,false);assert.equal(english.capabilities.childHistory,'unavailable');
 const englishHtml=await readFile(english.output,'utf8');
 assert.ok(!englishHtml.includes('/analysis-view/trace-data?'),'A snapshot does not ship the DSH data bridge');
 assert.ok(!englishHtml.includes('analysis-trace-jump'),'A snapshot does not ship the DSH conversation action');
 const frozen=JSON.parse(englishHtml.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
 assert.equal(frozen.sessions[0].turns[0].prompts[0].text,input.entries.find(e=>e.message?.role==='user').message.content[0].text,'English UI preserves native source text');
 await assert.rejects(()=>generateTraceView({host:'pi',input,locale:'fr'}),/Language/);
 serving=await startViewServer(view.output);
 const response=await fetch(serving.url);assert.equal(response.status,200);assert.equal(await response.text(),html);
 assert.equal((await fetch(new URL('/other',serving.url))).status,404,'No directory browsing');
 assert.equal((await fetch(serving.url,{method:'POST'})).status,404,'No write route');
 assert.equal(await (await fetch(serving.url,{method:'HEAD'})).text(),'');
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(()=>generateTraceView({host:'pi',input},{signal:cancelled.signal}));
 const samplePath=join(directory,'bounded.txt'),bytes=Buffer.from('轨迹');
 await writeFile(samplePath,bytes);
 const readSample=(maxBytes,signal)=>readBoundedFile(samplePath,{maxBytes,signal,overflow:'Input budget exceeded'});
 assert.deepEqual(await readSample(bytes.length),bytes,'A file of exactly the byte budget is retained');
 await assert.rejects(()=>readSample(bytes.length-1),/Input budget exceeded/);
 await assert.rejects(()=>readSample(bytes.length,cancelled.signal),{name:'AbortError'});
 await assert.rejects(()=>generateTraceView({host:'codex',snapshot:{thread:{id:'one',path:join(directory,'missing')}},rollout:join(directory,'missing')}),/ENOENT/);
 const sessionFile=join(directory,'codex.json'),rolloutFile=join(directory,'codex.jsonl');
 const at='2026-01-01T00:00:00Z',time=Date.parse(at)/1000;
 const encoded='iVBORw0KGgo'+'AB/'.repeat(24*1024),url='data:image/png;base64,'+encoded;
 const source={capturedAt:at,thread:{id:'media',path:rolloutFile,createdAt:time,turns:[{
   id:'turn',startedAt:time,completedAt:time+1,status:'completed',items:[
     {type:'userMessage',id:'user',content:[{type:'text',text:'用户原文\u2028仍在同一条记录'},{type:'image',url}]},
     {type:'imageGeneration',id:'image',status:'completed',result:encoded,savedPath:'/fixture/image.png'},
     {type:'mcpToolCall',id:'tool',server:'fixture',tool:'screen',status:'completed',result:{content:[{type:'text',text:'截图'}, {type:'image',mimeType:'image/png',data:encoded}]}},
   ],
 }]}};
 const rows=[
   {timestamp:at,type:'session_meta',payload:{id:'media'}},
   {timestamp:at,type:'turn_context',payload:{turn_id:'turn',model:'fixture'}},
   {timestamp:at,type:'response_item',payload:{type:'function_call_output',output:[
     {type:'input_text',text:'保留的文本'}, {type:'input_image',image_url:url},
   ]}},
   {timestamp:at,type:'event_msg',payload:{type:'item_completed',item:{id:'image',result:encoded},turn_id:'turn',started_at_ms:time*1000,completed_at_ms:time*1000+1}},
   {timestamp:at,type:'token_usage_record',payload:{turn_id:'turn',response_id:'sample',usage:{input_tokens:1234,output_tokens:98}}},
 ];
 const rawRollout=rows.map(JSON.stringify).join('\r\n');
 assert.ok((await compactRollout([Buffer.from(rawRollout)],undefined,6000)).length < 6000,'Embedded image bytes do not consume the retained-text budget');
 await assert.rejects(()=>compactRollout([Buffer.from('plain text')],undefined,3),/text exceeds/);
 await writeFile(sessionFile,JSON.stringify(source).replaceAll('/','\\/'));
 await writeFile(rolloutFile,rawRollout);
 const stored=await readCodexSnapshot(sessionFile),local=await readCodexRollout(rolloutFile);
 assert.ok(!JSON.stringify(stored).includes(encoded) && !local.includes(encoded));
 assert.equal(local.split('\r\n').length,rows.length,'Physical line anchors survive compaction');
 const projected=parseCodexRollout(local);
 assert.equal(projected.usage[0].line,5);
 assert.equal(projected.usage[0].usage.input_tokens,1234);
 assert.equal(projected.completed.get('image').ordinal,4);
 assert.deepEqual(projected.current,parseCodexRollout(rawRollout).current);
 const fromMemory=datasetFromNative('codex',source,{rollout:rawRollout});
 const fromFile=await loadPortableSource({host:'codex',file:sessionFile});
 assert.equal(fromFile.logId,fromMemory.logId,'Image-bearing evidence has one cut across snapshot and file inputs');
 assert.equal(fromFile.records.find(row=>row.kind==='imageGeneration').body.savedPath,'/fixture/image.png');
 assert.ok(!JSON.stringify(fromFile.records).includes(encoded));
 if(typeof zlib.zstdCompressSync==='function'){
  await writeFile(rolloutFile+'.zst',zlib.zstdCompressSync(Buffer.from(rawRollout)));
  assert.equal(await readCodexRollout(rolloutFile+'.zst'),local);
 }
 console.log('View entry passed: native input preserved, bundled assets, exact-file localhost serving, read-only routes and cancellation.');
}finally{
 serving?.close();
 if(!resolve(directory).startsWith(resolve(tmpdir(),'trajectory-view-test-')))throw Error('Unexpected test cleanup path');
 await rm(directory,{recursive:true,force:true});
}
