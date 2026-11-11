import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {projectFindingCalls,summarizeFindings,findingsRuntime} from './lib/eval/findings.mjs';
import {datasetFromNative,datasetAtCut} from '../portable-tools/sources.mjs';
import {PortableService} from '../portable-tools/service.mjs';
import {projectPortableOverview} from '../../view/overview.mjs';
import {createOverviewModels} from './lib/eval/overview/shared.mjs';
import {renderOverviewPage} from './lib/eval/overview/render.mjs';

test('native diagnosis fills only a bound source draft and works without a navigation prop',()=>{
  const client=readFileSync(new URL('./lib/client.js',import.meta.url),'utf8');
  const start=client.indexOf('    function receiveDiagnosisDraft('),end=client.indexOf('    function useDiagnosisDraft(',start);
  assert.ok(start>=0&&end>start);
  const calls=[],acks=[],navigations=[],origin='http://localhost:3080';
  const context=vm.createContext({window:{location:{origin}}});
  vm.runInContext(client.slice(start,end),context);
  const sender={postMessage:(message,target)=>acks.push({message,target})},frame={contentWindow:sender};
  const binding={sessionId:'selected'};
  const ctx={sessions:{binding:id=>id==='selected'?binding:null},conversation:{input:{requestDraftInitialization:(...args)=>{calls.push(args);return 'applied';}}}};
  const valid={origin,source:sender,data:{type:'analysis-diagnosis-draft',sessionId:'selected',prompt:'Investigate the selected records'}};
  const apply=(event=valid,id='selected',navigate)=>context.receiveDiagnosisDraft(event,frame,id,ctx,navigate);
  for(const event of [{...valid,origin:'https://other.invalid'},{...valid,source:{}},
    {...valid,data:{...valid.data,sessionId:'other'}},{...valid,data:{...valid.data,prompt:'  '}},
    {...valid,data:{...valid.data,prompt:'x'.repeat(65537)}}])apply(event);
  assert.equal(calls.length,0);assert.equal(acks.length,0);
  apply();
  assert.equal(calls.length,1);assert.equal(calls[0][0],binding);
  assert.equal(calls[0][1].whenDraftExists,'append');
  assert.equal(acks[0].message.applied,true);assert.equal(acks[0].target,origin);
  apply({...valid,data:{...valid.data,sessionId:'unbound'}},'unbound');
  assert.equal(calls.length,1);assert.equal(acks[1].message.applied,false);
  apply(valid,'selected',(...args)=>navigations.push(args));
  assert.deepEqual(navigations,[['chat','']]);
});

test('program findings preserve native outcomes and exact return pairs without claiming resolution',()=>{
  const error={seq:2,resultSeq:3,name:'pwsh',status:'error',start:0,end:40_000,attribution:{code:'COMMAND_SYNTAX',label:'脚本语法错误',certainty:'confirmed',program:'PowerShell'}};
  const changed={seq:4,resultSeq:5,name:'pwsh',status:'returned',start:40_000,end:40_100};
  const session={turns:[{number:1,steps:[{number:1,calls:[error,changed]}]}],overview:{episodes:[{pairs:[]}]}};
  const before=JSON.stringify(session),rows=projectFindingCalls(session);
  assert.equal(rows.length,1);assert.equal(rows[0].returned,null,'A changed command is not inferred to be recovery');
  const signals=summarizeFindings(rows.map(row=>({...row,source:{session:'a',cut:5}})));
  assert.equal(signals.groups.length,2,'A slow failed call contributes both an error and timing signal');
  assert.equal(signals.observedErrors,1);assert.equal(signals.groups.find(row=>row.kind==='wait').count,1);
  assert.ok(!JSON.stringify(signals).includes('resolved'));
  assert.deepEqual(signals.groups.find(row=>row.kind==='error').directions,['repair']);
  session.overview.episodes[0].pairs=[{failedSeq:2,successSeq:4}];
  assert.equal(projectFindingCalls(session)[0].returned,4,'Only an explicit native pair is retained');
  session.overview.episodes[0].pairs=[];assert.equal(JSON.stringify(session),before);
});

test('directions are investigation hints; filtering updates repeated signals and knowledge candidates',()=>{
  const row={seq:2,result:3,turn:1,step:1,tool:'pwsh',status:'error',code:'COMMAND_NOT_FOUND',certainty:'confirmed',label:'命令未找到'};
  const entries=[{...row,source:{session:'one',cut:5}},{...row,turn:2,source:{session:'two',cut:7}}];
  const group=summarizeFindings(entries).groups[0];
  assert.equal(group.sessions,2);assert.equal(group.turns,2);assert.deepEqual(group.directions,['repair','capability','knowledge']);
  assert.equal(group.count,2,'Equal local sequence numbers from two sessions remain distinct');
  assert.deepEqual(summarizeFindings(entries.slice(0,1)).groups[0].directions,['repair','capability']);
  assert.ok(!('install' in group)&&!('repairApplied' in group)&&!('knowledgeSaved' in group));
  const unknown={...row,code:'UNCLASSIFIED_OUTPUT',certainty:'unknown'};
  const pending={...row,status:'unknown'};
  const result=summarizeFindings([unknown,pending]);
  assert.equal(result.groups.length,0);assert.equal(result.unclassified.length,1);assert.equal(result.pending.length,1);
  const lookup=summarizeFindings([{...row,code:'LOOKUP_NO_MATCH',certainty:'candidate'}]).groups[0];
  assert.deepEqual(lookup.directions,[],'No match may answer the probe and does not imply a repair');
});

test('browser and server group exactly the same source populations',()=>{
  const rows=[{seq:3,turn:1,tool:'run_code',status:'error',certainty:'confirmed',code:'CODE_TIMEOUT',runtimeKind:'timeout',durationMs:30_000,source:{session:'x'}},
    {seq:3,turn:1,tool:'run_code',status:'error',certainty:'confirmed',code:'CODE_TIMEOUT',runtimeKind:'timeout',source:{session:'y'}}];
  const context=vm.createContext({});vm.runInContext(findingsRuntime(),context);
  assert.equal(JSON.stringify(context.__trajectorySummarizeFindings(rows)),JSON.stringify(summarizeFindings(rows)));
});

test('overview program entries resolve through the existing exact-cut portable query',async()=>{
  const at=Date.parse('2026-01-01T00:00:00Z')/1000;
  const data=datasetFromNative('codex',{thread:{id:'findings-native',cwd:'/sample',createdAt:at,turns:[{id:'t1',startedAt:at,completedAt:at+1,status:'completed',items:[
    {type:'commandExecution',id:'c1',command:'pwsh.exe -Command sample',aggregatedOutput:'ParserError: expected expression',exitCode:1,status:'failed',durationMs:25},
  ]}]}});
  const model=createOverviewModels(),projected=projectPortableOverview(data,model);
  assert.equal(projected.findingCalls.length,1);
  const row=projected.findingCalls[0],service=new PortableService({load:async()=>data});
  try{
    const result=await service.call('trajectory_inspect',{session:projected.id,cut:projected.cut,logId:projected.logId,view:'io',seqs:[row.seq],format:'data',samples:false,includeSelf:true});
    assert.equal(result.rows.length,1);assert.equal(result.source.log,projected.logId);
    assert.equal(datasetAtCut(data,projected.cut).logId,projected.logId);
    const html=renderOverviewPage({locale:'en',data:{host:'codex',sessions:[projected],models:model.models,projects:[{name:'sample'}],categories:[]}});
    assert.ok(html.includes('id="overview-findings"'));
    assert.ok(!html.includes('id="session-page"')&&!html.includes('mountSessionEval'));
    assert.ok(html.includes('diagnosis-editor')&&html.includes('references/disposition.md'));
    for(const [,script] of html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script);
  }finally{service.dispose();}
});
