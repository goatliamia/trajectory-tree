import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createPiSample} from '../analyzers/pi-sample.mjs';
const {values:{dir}}=parseArgs({options:{dir:{type:'string'}}});
const root=fileURLToPath(new URL('../',import.meta.url)),work=mkdtempSync(join(tmpdir(),'trajectory-package-test-'));
const release=dir?resolve(dir):join(root,'.dsh/releases');
const version=JSON.parse(readFileSync(join(root,'plugin/codex/plugin.json'),'utf8')).version;
const markdownFiles=path=>readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?markdownFiles(join(path,e.name)):e.name.endsWith('.md')?[join(path,e.name)]:[]);
function unpack(name,version){
 const archive=join(release,name+'-'+version+'.tgz');
 const entries=execFileSync('tar',['-tzf',archive],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/);
 assert.ok(entries.every(p=>p.startsWith('package/')&&!p.includes('\\')&&
   !p.split('/').some(part=>['..','.dsh','.git','.agents','.codex','fixtures','logs','experiments'].includes(part)||/^\.env(?:\.|$)/.test(part))),name+' contains only public package paths');
 const directory=join(work,name);mkdirSync(directory);
 execFileSync('tar',['-xzf',archive,'-C',directory],{windowsHide:true});
 const installed=join(directory,'package');
 assert.equal(JSON.parse(readFileSync(join(installed,'package.json'),'utf8')).version,version);
 return installed;
}
function checkLinks(skillRoot){
 assert.ok(!existsSync(join(skillRoot,'trace-analysis/references/overview.md')),'Comprehensive diagnosis lives in the skill body');
 for(const file of markdownFiles(skillRoot))for(const match of readFileSync(file,'utf8').matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g))if(!/^https?:/.test(match[1]))assert.ok(existsSync(resolve(file,'..',match[1])),'Packaged skill link: '+file+' -> '+match[1]);
}
try{
 const sample=createPiSample({revision:'package-test'}),native=join(work,'session.jsonl');
 writeFileSync(native,[sample.header,...sample.entries].map(JSON.stringify).join('\n')+'\n');
 const claudeNative=join(work,'claude.jsonl'),claudeBase={sessionId:'package-claude',timestamp:'2026-01-01T00:00:00Z',cwd:work};
 writeFileSync(claudeNative,[{...claudeBase,type:'user',message:{content:'inspect'}},{...claudeBase,type:'assistant',uuid:'a1',message:{id:'m1',usage:{input_tokens:7,output_tokens:3,cache_read_input_tokens:8,cache_creation_input_tokens:2},content:[{type:'tool_use',id:'c1',name:'Read',input:{file_path:'a.txt'}}]}},{...claudeBase,type:'user',message:{content:[{type:'tool_result',tool_use_id:'c1',content:'file body'}]}}].map(JSON.stringify).join('\n')+'\n');
 const codexNative=join(work,'codex.json'),start=Date.parse(claudeBase.timestamp)/1000;
 writeFileSync(codexNative,JSON.stringify({capturedAt:claudeBase.timestamp,thread:{
  id:'package-codex',cwd:work,createdAt:start,turns:[{
   id:'t1',startedAt:start,completedAt:start+1,status:'completed',items:[
    {type:'userMessage',id:'u1',content:[{type:'text',text:'Read a file'}]},
    {type:'commandExecution',id:'c1',command:'Get-Content a.txt',aggregatedOutput:'file body',exitCode:0,status:'completed',durationMs:5},
   ],
  }],
 }}));
 const sources={
  codex:['--host','codex','--file',codexNative,'--api-only'],
  pi:['--host','pi','--file',native,'--synthetic'],
  claude:['--host','claude','--file',claudeNative],
 };
 for(const host of ['codex','pi','claude']){
  const name='trajectory-tree-'+host,installed=unpack(name,version),directory=join(work,name);
  assert.ok(existsSync(join(installed,'node_modules/typebox/package.json')));
  assert.ok(!existsSync(join(installed,'plugin/trajectory-tools/lib/inspect-methods.js')),'No stale tool-owned methods in a clean package');
  const skillRoot=host!=='pi'?join(installed,'skills'):join(installed,'plugin/portable-tools/skills');
  checkLinks(skillRoot);
  const run=(script,args)=>JSON.parse(execFileSync(process.execPath,[join(installed,'scripts',script),...args],{encoding:'utf8',cwd:directory,windowsHide:true}));
  const source=sources[host];
  const schema=run('trajectory-query.mjs',['--tool','schema']);assert.equal(schema.tools.length,4);
  const view=run('trajectory-view.mjs',[...source,'--out',join(directory,'view.html')]);assert.equal(view.ok,true);assert.equal(view.host,host);
  const evaluation=run('trajectory-view.mjs',[...source,'--eval','--lang','en','--out',join(directory,'eval.html')]);
  assert.equal(evaluation.view,'eval');assert.equal(evaluation.host,host);
  const evalHtml=readFileSync(evaluation.output,'utf8');
  assert.ok(evalHtml.includes('installUi("en", false)')&&evalHtml.includes('id="diagnosis-editor"'));
  const scope={session:evaluation.session,cut:evaluation.cut,logId:evaluation.logId};
  assert.ok(Number.isSafeInteger(scope.cut)&&scope.logId);
  const scoped=run('trajectory-query.mjs',[...source,'--args',JSON.stringify({view:'io',...scope})]);
  assert.ok(scoped.rows.length>0,host+' can query the exact cut opened in Eval');
  const query=run('trajectory-query.mjs',[...source,'--args','{"view":"overview","format":"data"}']);assert.ok(query.source.snapshot);
  if(host==='claude'){
   assert.equal(view.host,'claude');assert.ok(readFileSync(view.output,'utf8').includes('Claude Code · 会话分析'));
   const overview=run('trajectory-query.mjs',[...source,'--args','{"view":"overview"}']);
   assert.equal(overview.summary.unit,'assistant-record');assert.equal(overview.summary.usage.input,17);assert.equal(overview.summary.calls,1);
   const io=run('trajectory-query.mjs',[...source,'--args','{"view":"io"}']);assert.equal(io.rows[0].tool,'Read');
   const manifest=JSON.parse(readFileSync(join(installed,'.claude-plugin/plugin.json'),'utf8'));
   assert.equal(manifest.name,'trajectory-tree');assert.equal(manifest.version,version);
   const hook=JSON.parse(execFileSync(process.execPath,[join(installed,'scripts/bind-session.mjs')],{input:JSON.stringify({hook_event_name:'SessionStart',session_id:'package-claude',transcript_path:claudeNative}),encoding:'utf8',windowsHide:true}));
   assert.equal(hook.hookSpecificOutput.hookEventName,'SessionStart');
  }
  const bundle=join(directory,'bundle.json');writeFileSync(bundle,JSON.stringify({schema:'trajectory-report-bundle/1',datasets:{steps:query},figures:{}}));
  const markdown=join(directory,'report.md');writeFileSync(markdown,'# Independent package\n\nReport renderer asset check.\n');
  const report=run('trajectory-report.mjs',['render','--markdown',markdown,'--bundle',bundle,'--output',join(directory,'report.html')]);assert.equal(report.ok,true);
 }
 const dshVersion=JSON.parse(readFileSync(join(root,'plugin/trajectory-tools/package.json'),'utf8')).version;
 const dshInstalled=unpack('dsh-trajectory-tools',dshVersion);checkLinks(join(dshInstalled,'skills'));
 assert.ok(!existsSync(join(dshInstalled,'lib/inspect-methods.js')));
 const {loadDiagnosticSkills,SKILL_BODY}=await import(pathToFileURL(join(dshInstalled,'lib/skill.js')).href);
 assert.ok(SKILL_BODY.includes('原文位置'));
 assert.deepEqual(loadDiagnosticSkills().map(s=>s.name),['trace-analysis','context-profile']);
 for(const skill of loadDiagnosticSkills()){
  assert.equal(skill.source,'runtime');assert.equal(skill.resourceBase.kind,'directory');
  assert.ok(existsSync(join(skill.resourceBase.path,'SKILL.md')));
  assert.ok(!skill.content.startsWith('---'));
 }
 const dshViewVersion=JSON.parse(readFileSync(join(root,'plugin/analysis-view/package.json'),'utf8')).version;
 const dshView=unpack('dsh-analysis-view',dshViewVersion);
 const {renderEvalPage}=await import(pathToFileURL(join(dshView,'lib/eval/render.mjs')).href);
 assert.ok(renderEvalPage({},{locale:'zh-CN',diagnosis:{session:'package-dsh'},mode:'dsh'}).includes('id="diagnosis-editor"'));
 console.log('Five archives passed independent extraction, resource allowlists, native metadata and view assets. Codex/Pi/Claude Eval cuts were verified by the packaged query CLI.');
}finally{
 if(!resolve(work).startsWith(resolve(tmpdir(),'trajectory-package-test-')))throw Error('Unexpected cleanup path');
 rmSync(work,{recursive:true,force:true});
}
