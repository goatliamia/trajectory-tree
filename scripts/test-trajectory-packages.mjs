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
    {type:'commandExecution',id:'c1',command:'pwsh.exe -Command Get-Content a.txt',aggregatedOutput:'file body',exitCode:0,status:'completed',durationMs:5},
   ],
  }],
 }}));
 const codexRollout=join(work,'codex.jsonl');
 writeFileSync(codexRollout,[['session_meta',{id:'package-codex'}],['event_msg',{type:'task_started',turn_id:'t1',model_context_window:1000}],
  ['turn_context',{turn_id:'t1',model:'package-model'}],['token_usage_record',{turn_id:'t1',response_id:'p1',usage:{input_tokens:325,output_tokens:42}}],
  ['event_msg',{type:'item_completed',turn_id:'t1',item:{id:'c1',command:['pwsh.exe','-Command','Get-Content a.txt']}}]]
  .map(([type,payload])=>JSON.stringify({timestamp:claudeBase.timestamp,type,payload})).join('\n')+'\n');
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
  assert.match(readFileSync(view.output,'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.ok(readFileSync(view.output,'utf8').includes('__bindDiagnosisGesture'),'Trace selection is included in the actual package');
  const frozen=JSON.parse(readFileSync(view.evidenceFile,'utf8')).data;
  const frozenQuery=run('trajectory-query.mjs',['--host',host,'--evidence',view.evidenceFile,'--tool','trajectory_inspect','--args',JSON.stringify({view:'overview',cut:frozen.cut,logId:frozen.logId,samples:false})]);
  assert.equal(frozenQuery.logId,frozen.logId,'Exported evidence is readable through the packaged CLI');
  const evaluation=run('trajectory-view.mjs',[...source,'--eval','--lang','en','--out',join(directory,'eval.html')]);
  assert.equal(evaluation.view,'eval');assert.equal(evaluation.host,host);
  const evalHtml=readFileSync(evaluation.output,'utf8');
  assert.ok(evalHtml.includes('installUi("en", false)')&&evalHtml.includes('id="diagnosis-editor"'));
  assert.ok(evalHtml.includes('Code execution analysis')&&evalHtml.includes('references/code-execution.md'),'Packaged Eval includes code execution and its diagnosis method');
  assert.ok(evalHtml.includes('id="eval-findings"')&&readFileSync(join(skillRoot,'trace-analysis/SKILL.md'),'utf8').includes('references/disposition.md'),'Signals remain in Eval; disposition methods are discovered through the skill');
  assert.match(evalHtml, /SIL OPEN FONT LICENSE Version 1\.1/);
  const code=run('trajectory-view.mjs',[...source,'--code','--lang','en','--out',join(directory,'code.html')]);
  assert.equal(code.view,'eval');assert.equal(code.session,evaluation.session);assert.equal(code.cut,evaluation.cut);
  assert.ok(readFileSync(code.output,'utf8').includes('window.__trajectoryEvalInitialSection = "code";'),'Each host can open code execution directly');
  const overviewSource=host==='codex'?[...source.filter(arg=>arg!=='--api-only'),'--rollout',codexRollout]:source;
  for(const locale of ['en','zh-CN']){
   const overview=run('trajectory-view.mjs',[...overviewSource,'--overview','--lang',locale,'--out',join(directory,'overview-'+locale+'.html')]);
   assert.equal(overview.view,'overview');assert.equal(overview.host,host);assert.equal(overview.sessions,1);assert.equal(overview.projects,1);
   const html=readFileSync(overview.output,'utf8');
   assert.ok(html.includes('installUi('+JSON.stringify(locale)+', false)'));
   assert.ok(html.includes('id="overview-findings"')&&!html.includes('id="session-page"'),'Overview ships signals without a duplicate session view');
   assert.match(html, /SIL OPEN FONT LICENSE Version 1\.1/);
   const data=JSON.parse(html.match(/id="overview-data">([^<]*)<\/script>/)[1]);
   assert.ok(data.projects[0].name && data.sessions[0].occupancy.actions.length);
   if(host==='codex')assert.deepEqual(data.sessions[0].turns[0].requests[0].window,[1000,2]);
  }
  const scope={session:evaluation.session,cut:evaluation.cut,logId:evaluation.logId};
  assert.ok(Number.isSafeInteger(scope.cut)&&scope.logId);
  const scoped=run('trajectory-query.mjs',[...source,'--args',JSON.stringify({view:'io',...scope})]);
  assert.ok(scoped.rows.length>0,host+' can query the exact cut opened in Eval');
  if(host==='codex'){
   const commandSchema=run('trajectory-query.mjs',['--tool','schema','--commands']);
   assert.deepEqual(commandSchema.tools.map(t=>t.name),['trajectory_command_diagnose']);
   const commands=run('trajectory-view.mjs',[...overviewSource,'--commands','--seq','3','--lang','en','--out',join(directory,'commands.html')]);
   assert.equal(commands.view,'commands');assert.equal(commands.calls,1);
   const commandHtml=readFileSync(commands.output,'utf8');
   const commandData=JSON.parse(commandHtml.match(/id="command-data" type="application\/json">([^<]*)<\/script>/)[1]);
   assert.equal(commandData.locale,'en');assert.equal(commandData.rows[0].syntax.rolloutLine,5);
   const report=run('trajectory-query.mjs',[...overviewSource,'--tool','trajectory_command_diagnose','--args',
    JSON.stringify({session:commands.session,cut:commands.cut,logId:commands.logId,seqs:[3]})]);
   assert.equal(report.rows[0].resultSeq,4);assert.equal(report.rows[0].cause.kind,'returned');
  }
  const query=run('trajectory-query.mjs',[...source,'--args','{"view":"overview","format":"data"}']);assert.ok(query.source.snapshot);
  const evalPlan=join(directory,'eval-plan.json'),evalBundle=join(directory,'eval-bundle.json');
  writeFileSync(evalPlan,JSON.stringify({schema:'trajectory-report-plan/1',sources:{
   summary:{evaluation:{source:query.source,table:'summary'}},tools:{evaluation:{from:'summary',table:'tools'}},turns:{evaluation:{from:'summary',table:'turns'}},
  }}));
  const prepared=run('trajectory-report.mjs',['prepare',...source,'--plan',evalPlan,'--bundle',evalBundle]);
  assert.equal(prepared.ok,true);assert.ok(prepared.datasets.summary.examples[0].calls>0);
  const evalMarkdown=join(directory,'eval-report.md');
  writeFileSync(evalMarkdown,'# Eval report\n\n\x60\x60\x60report-figure\n'+JSON.stringify({type:'table',data:'tools',fields:{label:'name'},series:['calls','errors','durationP50Ms']})+'\n\x60\x60\x60\n');
  const evalReport=run('trajectory-report.mjs',['render','--markdown',evalMarkdown,'--bundle',evalBundle,'--output',join(directory,'eval-report.html'),'--lang','en']);
  assert.equal(evalReport.ok,true);assert.equal(evalReport.figures[0].type,'table');
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
 execFileSync(process.execPath,['--test',join(dshInstalled,'request-context-test.mjs')],{cwd:dshInstalled,windowsHide:true});
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
 const {renderOverviewPage}=await import(pathToFileURL(join(dshView,'lib/eval/overview/render.mjs')).href);
 assert.ok(renderOverviewPage({locale:'en'}).includes('installUi("en", false)'));
 const viewPackage=JSON.parse(readFileSync(join(dshView,'package.json'),'utf8'));
 assert.ok(existsSync(join(dshView,viewPackage.main)));
 assert.equal(JSON.parse(readFileSync(join(dshView,'locale/zh.json'),'utf8')).meta.title,'轨迹树');
 assert.equal(JSON.parse(readFileSync(join(dshView,'locale/en.json'),'utf8')).meta.title,'Trajectory Tree');
 assert.match(readFileSync(join(dshView,'lib/trace/fonts/LICENSE.txt'),'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
 execFileSync(process.execPath,[join(dshView,'self-test.mjs')],{cwd:dshView,windowsHide:true});
 execFileSync(process.execPath,[join(dshView,'search-test.mjs')],{cwd:dshView,windowsHide:true});
 execFileSync(process.execPath,['--test',join(dshView,'overview-test.mjs')],{cwd:dshView,windowsHide:true});
 console.log('Five archives passed independent extraction, bilingual overview rendering, native metadata and view assets. Codex/Pi/Claude Eval cuts were verified by the packaged query CLI.');
}finally{
 if(!resolve(work).startsWith(resolve(tmpdir(),'trajectory-package-test-')))throw Error('Unexpected cleanup path');
 rmSync(work,{recursive:true,force:true});
}
