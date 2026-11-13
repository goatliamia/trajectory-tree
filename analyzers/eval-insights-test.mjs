import test from 'node:test';
import assert from 'node:assert/strict';
import { windowView, diagnosisView, evalScope } from './eval-insights.mjs';
const at=Date.parse('2026-11-12T10:00:00+08:00');
const source=()=>({latest:at,failures:[],projects:[{id:'p',name:'project'}],models:[{name:'one',provider:'p'}],sessions:[{id:'a',title:'session',cut:50,preset:'cordis',project:0,findingCalls:[],turns:[{no:1,at,errors:[],requests:[
  {seq:2,model:0,input:100,window:[1000,1],ttft:100,output:40,type:'tools'},
  {seq:4,model:0,input:500,window:[1000,1],ttft:300,output:80,type:'direct'},
  {seq:6,model:0,input:700,window:[1000,1],ttft:null,output:null,type:'direct'},
  {seq:8,model:0,input:100,ttft:50,output:20,type:'direct'},
]}],occupancy:{names:['edit'],actions:[[3,2,1,1,0,0,100,1000,4,null,0,20],[5,4,1,2,0,1,100,1000,6,0,0,40],[7,6,1,3,0,2,100,1000,null,null,0,null]]}}]});
test('window metrics use recorded denominators and preserve missing values',()=>{
  const data=source(),v=windowView(data,{preset:'cordis',mode:'model',metric:'ttft',band:'14'});
  assert.equal(v.summary.total,4);assert.equal(v.summary.measured,3);assert.equal(v.bins[14].value,null);assert.equal(v.bins[14].n,0);
  assert.equal(v.bins[2].value,100);assert.equal(v.bins[10].value,300);assert.equal(v.bins[19].value,null);
  const tools=windowView(data,{preset:'cordis',mode:'tool',metric:'errors'});
  assert.equal(tools.summary.unknown,1);assert.equal(tools.bins[2].count,2);assert.equal(tools.bins[2].value,50);
  assert.deepEqual(tools.histogram.map(h=>h.count),tools.bins.map(b=>b.count));
});
test('same-name preset and project filters do not mix another population',()=>{
  const data=source();data.sessions.push({...data.sessions[0],id:'b',preset:'minimal'});
  assert.equal(evalScope(data,{preset:'cordis'}).sessions.length,1);
  assert.equal(evalScope(data,{preset:'cordis',project:'1'}).sessions.length,0);
});
test('diagnostic grouping keeps guard evidence and never equates no pair with unresolved',()=>{
  const data=source(),s=data.sessions[0];s.turns.push({...s.turns[0],no:2});
  const row={seq:11,result:12,turn:1,tool:'edit',status:'error',code:'FS_NOT_OBSERVED',certainty:'confirmed',attributionBasis:'native-code',reportedCode:'FS_NOT_OBSERVED',priorRead:{seq:1,turn:0,result:2},returned:15};
  s.findingCalls=[row,{...row,seq:22,turn:2,returned:null}];
  const view=diagnosisView(data,{preset:'cordis'}),g=view.groups[0];
  assert.equal(g.priorReads,2);assert.equal(g.paired,1);assert.equal(g.label,'文件保护要求先读取');
  assert.equal(g.needsAction,null);assert.equal(g.causeConfirmed,false);assert.ok(!JSON.stringify(g).includes('未恢复'));
});

test('100% is inside capacity; values outside 0–100% are separated, never clipped into valid bins',()=>{
  const data=source();data.sessions[0].turns[0].requests.push(
    {seq:10,model:0,input:1000,window:[1000,1],ttft:500,type:'direct'},
    {seq:12,model:0,input:1050,window:[1000,1],ttft:5000,type:'direct'},
    {seq:14,model:0,input:-1,window:[1000,1],ttft:6000,type:'direct'},
    {seq:16,model:0,input:0,window:[1000,1],ttft:10,type:'direct'});
  const view=windowView(data,{preset:'cordis'});
  assert.equal(view.bins.length,20);assert.ok(view.bins.every(b=>b.upper<=100&&b.upper-b.lower===5));
  assert.equal(view.bins.at(-1).count,1);assert.equal(view.summary.capacityMismatch,2);
  assert.equal(view.summary.peak,100);assert.equal(view.summary.measured,5);
  assert.equal(view.bins.reduce((sum,b)=>sum+b.count,0),5);
  assert.equal(view.histogram.reduce((sum,b)=>sum+b.count,0),5);
  assert.deepEqual(view.mismatchRecords.map(r=>r.seq),[12,14]);
});

test('matrix cells partition each feedback group by session with exact return counts',()=>{
  const data=source(),s=data.sessions[0];s.turns.push({...s.turns[0],no:2});
  const row={seq:11,result:12,turn:1,tool:'edit',status:'error',code:'FS_NOT_OBSERVED',certainty:'confirmed',returned:15};
  s.findingCalls=[row,{...row,seq:21,turn:2,returned:null}];
  data.sessions.push({...s,id:'b',findingCalls:[{...row,returned:null}]});
  const view=diagnosisView(data,{preset:'cordis'}),g=view.groups[0];
  assert.equal(view.columns.length,2);assert.deepEqual(g.cells.map(c=>c.count),[2,1]);
  assert.equal(g.cells.reduce((sum,c)=>sum+c.paired,0),g.paired);
  assert.equal(view.families.reduce((sum,f)=>sum+f.count,0),view.summary.errors);
});

test('unclassified feedback can be selected without mixing in successful long calls',()=>{
  const data=source();data.sessions[0].findingCalls=[{seq:3,result:4,turn:1,tool:'exec',status:'error',code:'UNCLASSIFIED_OUTPUT',certainty:'unknown',returned:null},{seq:7,result:8,turn:1,tool:'exec',status:'returned',durationMs:40000}];
  const view=diagnosisView(data,{preset:'cordis',mode:'all',family:'7'});
  assert.equal(view.groups.length,1);assert.equal(view.groups[0].kind,'unclassified');assert.equal(view.groups[0].count,1);
});

test('control and probe observations leave the investigation view without changing raw counts',()=>{
  const data=source(),base={seq:3,result:4,turn:1,tool:'pwsh',status:'error',certainty:'confirmed'};
  data.sessions[0].findingCalls=[{...base,code:'APPROVAL_REJECTED'},
    {...base,seq:5,code:'TOOL_CONTEXT_UNAVAILABLE'},
    {...base,seq:7,status:'returned',certainty:'candidate',code:'LOOKUP_NO_MATCH',command:{feedback:{exitCode:1}}},
    {...base,seq:9,status:'returned',code:'COMMAND_SYNTAX',command:{feedback:{exitCode:1}}}];
  const v=diagnosisView(data,{preset:'cordis',mode:'review'});
  assert.deepEqual(v.groups.map(g=>g.code).sort(),['COMMAND_SYNTAX','TOOL_CONTEXT_UNAVAILABLE']);
  assert.equal(v.summary.errors,2);assert.equal(v.summary.commandFeedback,2);assert.equal(v.summary.feedback,4);
  const controls=diagnosisView(data,{preset:'cordis',mode:'control'});
  assert.deepEqual(controls.groups.map(g=>g.code).sort(),['APPROVAL_REJECTED','LOOKUP_NO_MATCH']);
  assert.deepEqual(v.scope.sources,[{session:'a',cut:50,turns:[1]}]);
});
