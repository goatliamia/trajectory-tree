import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { decodeZstdSession } from '../experiments/corpus/decode-session.mjs';
import { projectPresetContext, presetContextCategories, contentHash } from '../analyzers/preset-context.mjs';
import { buildSourceInventory, associateSource } from './preset-source-inventory.mjs';
import { buildTracePayload } from '../plugin/analysis-view/lib/trace-build.js';
import { traceContext } from '../plugin/analysis-view/lib/trace-context.js';
import { readRequestContext } from '../plugin/trajectory-tools/lib/request-context.js';
import { readTracePresentation, renderTraceDocument } from '../plugin/analysis-view/lib/trace/presentation.mjs';
import { inlineTraceFonts } from '../plugin/analysis-view/lib/trace/fonts.mjs';

if (!process.argv.includes('--history')) {
  await import('./build-current-preset-demo.mjs');
  process.exit(0);
}

const option = (key, fallback) => { const at=process.argv.indexOf(key);return at<0?fallback:process.argv[at+1]; };
const root=resolve(option('--home',join(homedir(),'.dsh'))), out=resolve(option('--out','.dsh/preset-context-demo'));
const local=createRequire(import.meta.url), dshRoot=dirname(local.resolve('@deepseek-ai/dsh/package.json'));
const sdk=createRequire(join(dshRoot,'package.json'));
const surface=await import(pathToFileURL(sdk.resolve('@deepseek-ai/dsh-session/surface')).href);
const meter=await import(pathToFileURL(sdk.resolve('@deepseek-ai/dsh-token-meter/estimate')).href);
const runtime={...surface,...meter};
const started=performance.now();mkdirSync(join(out,'evidence'),{recursive:true});
const workspace=JSON.parse(readFileSync(join(root,'storages/workspace.json'),'utf8'));
const archived=new Set(workspace.global.archivedSessionIds), wanted=new Map(), files=new Map();
for(const [id,project] of Object.entries(workspace.tables.workspaces))for(const session of project.sessionIds??[])if(!archived.has(session))wanted.set(session,{project:id,cwd:project.path,projectName:project.title||project.path.split(/[\\/]/).at(-1)});
for(const project of readdirSync(join(root,'sessions'),{withFileTypes:true}).filter(item=>item.isDirectory()))for(const session of readdirSync(join(root,'sessions',project.name),{withFileTypes:true}).filter(item=>item.isDirectory()&&wanted.has(item.name))){
  const dir=join(root,'sessions',project.name,session.name);
  const name=readdirSync(dir).filter(name=>/^session\.v\d+\.jsonl\.zstd$/.test(name)).sort((a,b)=>Number(b.match(/v(\d+)/)[1])-Number(a.match(/v(\d+)/)[1]))[0];
  if(name)files.set(session.name,join(dir,name));
}
console.log(JSON.stringify({stage:'source-inventory',registered:wanted.size,files:files.size}));
const inventory=buildSourceInventory({dshRoot,profileRoot:join(root,'profiles/web')});
writeFileSync(join(out,'source-inventory.json'),JSON.stringify(inventory));
console.log(JSON.stringify({stage:'registrations',packages:inventory.packages.length,contributions:inventory.contributions.length,unparsed:inventory.failures.length}));
const read = file => {
  const bytes=readFileSync(file),text=decodeZstdSession(bytes).toString('utf8');
  const rows=text.split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line));
  return {header:rows.find(row=>row.type==='session'),events:rows.filter(row=>Number.isSafeInteger(row.seq)).sort((a,b)=>a.seq-b.seq),fingerprint:contentHash(bytes),bytes:bytes.length};
};
const sessions=[],failures=[],empty=[];let processed=0;
for(const [id,file] of files){
  try{
    const loaded=read(file), result=projectPresetContext(loaded.header,loaded.events,runtime);
    if(!result){empty.push(id);continue;}
    const {session,evidence}=result;Object.assign(session,wanted.get(id),{file,fingerprint:loaded.fingerprint});
    const lookup=new Map(evidence.map(row=>[row.seq,row]));
    for(const item of session.initial.items)item.origin=associateSource(item,inventory,lookup.get(item.seq)?.value?.text??'');
    for(const item of session.tools)item.origin=associateSource({...item,kind:'tool'},inventory);
    const evidenceRoot=join(out,'evidence',id);mkdirSync(evidenceRoot,{recursive:true});
    for(const row of evidence)writeFileSync(join(evidenceRoot,row.seq+'.json'),JSON.stringify(row));
    sessions.push(session);
  }catch(error){failures.push({id,error:error.message});}
  finally{processed++;if(processed%10===0)console.log(JSON.stringify({stage:'sessions',processed,total:files.size,usable:sessions.length}));}
}
sessions.sort((a,b)=>b.lastAt-a.lastAt);
const candidate=sessions.find(session=>session.cwd.toLowerCase().includes('sql event')&&session.compactions.length&&session.initial.available)
  ??sessions.find(session=>session.compactions.length&&session.initial.available);
let trace=null;
if(candidate&&!process.argv.includes('--skip-trace')){
  console.log(JSON.stringify({stage:'trace-preview',session:candidate.id,compactions:candidate.compactions.length}));
  const {events}=read(candidate.file), payload=buildTracePayload(events,candidate.id,{cwd:candidate.cwd});
  payload.context=traceContext(events,payload,await readRequestContext(events));
  payload.compactionSummaries=candidate.compactions.map(item=>({...item,...JSON.parse(readFileSync(join(out,'evidence',candidate.id,item.seq+'.json'),'utf8')).value}));
  const assets=readTracePresentation(), extension=readFileSync(new URL('../docs/demo/preset-context/trace-extension.js',import.meta.url),'utf8');
  writeFileSync(join(out,'trace.html'),renderTraceDocument(payload,assets,{template:inlineTraceFonts(assets.template),locale:'zh-CN',extension}));
  trace={session:candidate.id,title:candidate.title,compaction:candidate.compactions.at(-1)};
}
const data={schema:'preset-context-demo/1',generatedAt:Date.now(),dshVersion:JSON.parse(readFileSync(join(dshRoot,'package.json'),'utf8')).version,
  categories:presetContextCategories.map(([id,name])=>({id,name})),sessions,trace,
  coverage:{registered:wanted.size,available:files.size,usable:sessions.length,empty:empty.length,unread:failures,missing:[...wanted.keys()].filter(id=>!files.has(id)),
    sourcePackages:inventory.packages.length,sourceDeclarations:inventory.contributions.length,unparsedPackages:inventory.failures,
    sourceBasis:'当前安装包的静态注册位置与会话记录匹配；历史运行版本不由当前包反推。'},
  provenance:inventory.contributions.map(({code,fragments,...row})=>row)};
writeFileSync(join(out,'data.json'),JSON.stringify(data));
const template=readFileSync(new URL('../docs/demo/preset-context/index.html',import.meta.url),'utf8');
writeFileSync(join(out,'index.html'),template);
console.log(JSON.stringify({output:out,sessions:sessions.length,presets:[...new Set(sessions.map(s=>s.preset))],startupSamples:sessions.filter(s=>s.initial.available).length,
  failures,bytes:statSync(join(out,'data.json')).size,milliseconds:Math.round(performance.now()-started)}));
