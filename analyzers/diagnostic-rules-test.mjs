import test from 'node:test';
import assert from 'node:assert/strict';
import {attributeToolFailure} from '../plugin/trajectory-tools/lib/tool-attribution.js';
import {summarizeFindings,projectFindingCalls} from '../plugin/analysis-view/lib/eval/findings.mjs';
import {buildDiagnosisDraft} from '../docs/demo/preset-context/diagnosis-review.js';
import {projectSession} from '../plugin/trajectory-tools/lib/inspect-models/session.js';

const feedback=(output,options={})=>attributeToolFailure({status:'error',tool:'pwsh',exitCode:1,command:'work',output,...options});
const row=(a,seq=1,turn=1)=>({...a,seq,result:seq+1,turn,tool:'pwsh',status:'error',session:'source',cut:100,attributionBasis:a.basis});

test('legacy PowerShell stable identities survive spacing, localization and wrapper messages',()=>{
  for(const text of ['Get-Content : 找不到路径，路径不存在。','Get-Content : Cannot find path because it does not exist.']){
    const a=feedback(text+'\n    + CategoryInfo : ObjectNotFound: (x) [Get-Content], ItemNotFoundException\n    + FullyQualifiedErrorId : PathNotFound,Microsoft.PowerShell.Commands.GetContentCommand');
    assert.equal(a.code,'FS_NOT_FOUND');assert.deepEqual(a.diagnosticIds,['PathNotFound']);
  }
  const a=feedback('Select-String : A parameter cannot be found.\n    + FullyQualifiedErrorId : NamedParameterNotFound,Microsoft.PowerShell.Commands.SelectStringCommand');
  assert.equal(a.code,'COMMAND_ARGUMENT');assert.equal(a.pattern,'NamedParameterNotFound');
});

test('program feedback retains child identity while wrapper-only stderr remains a candidate',()=>{
  assert.equal(feedback("Traceback (most recent call last):\n  File \"a.py\", line 1\nTypeError: bad operation").program,'Python');
  assert.equal(feedback("src/a.ts(1,2): error TS18048: value is possibly undefined").code,'COMMAND_TEST_FAILED');
  assert.equal(feedback("Error: no such column\n  code: 'ERR_SQLITE_ERROR',").program,'SQLite');
  const remote=feedback('ssh : bash: -c: line 2: syntax error: unexpected end of file');
  assert.equal(remote.layer,'remote-shell');assert.equal(remote.program,'bash');
  const wrapper=feedback('git : Cloning into project...\n    + FullyQualifiedErrorId : NativeCommandError');
  assert.equal(wrapper.code,'COMMAND_EXTERNAL_FEEDBACK');assert.equal(wrapper.certainty,'candidate');
  const recorded=summarizeFindings([row(wrapper)]);
  assert.equal(recorded.groups.length,1);assert.deepEqual(recorded.groups[0].directions,[],'wrapper output remains available without implying recovery');
  assert.deepEqual(summarizeFindings([row({code:'COMMAND_EXIT_UNEXPLAINED',certainty:'confirmed'})]).groups[0].directions,[],'an unexplained exit alone does not establish a disposition');
  assert.equal(feedback('src/a.ts(1,2): error TS18048: sample',{status:'returned'}),undefined);
});

test('host setup, job control and missing results remain different observations',()=>{
  assert.equal(feedback('Error: sandbox-local windows-acl temp grant materialization failed and its cleanup also failed').code,'HOST_SANDBOX_SETUP_FAILED');
  assert.equal(feedback('Error: wait aborted',{tool:'job_output'}).code,'JOB_WAIT_ABORTED');
  assert.equal(feedback('Error: unknown job pwsh-x',{tool:'job_output'}).code,'JOB_NOT_FOUND');
  const result=summarizeFindings([row({code:'TOOL_OUTCOME_UNKNOWN',certainty:'unknown'})]);
  assert.equal(result.unclassified.length,0);assert.equal(result.groups[0].focus,'outcome');
  assert.deepEqual(result.groups[0].directions,['recover']);
});

test('specific repeated constraints produce graph leads and shared diagnosis factors',()=>{
  const a=feedback('Error: invalid arguments: missing required property "description"',{error:{code:'INVALID_ARGS'}});
  const group=summarizeFindings([row(a,1,1),row(a,5,2)]).groups[0];
  assert.deepEqual(group.directions,['repair','knowledge']);
  const signal=group.signals.find(s=>s.direction==='knowledge');assert.equal(signal.rule,'D-K1');assert.equal(signal.state,'lead');
  assert.equal(group.causeConfirmed,false);assert.equal(group.needsAction,null);
  const draft=buildDiagnosisDraft({group,direction:'knowledge'});assert.ok(draft.includes(signal.factors[0]));
  assert.ok(!summarizeFindings([row(a)]).groups[0].directions.includes('knowledge'));
  const other=feedback('Error: invalid arguments: missing required property "path"',{error:{code:'INVALID_ARGS'}});
  const different=summarizeFindings([row(a,1,1),row(other,5,2)]).groups;
  assert.equal(different.length,2);assert.ok(different.every(g=>!g.directions.includes('knowledge')));
});

test('availability yields a capability lead with questions rather than an installation decision',()=>{
  const group=summarizeFindings([row({code:'UNKNOWN_TOOL',certainty:'confirmed'})]).groups[0];
  assert.ok(group.signals.find(s=>s.direction==='capability').factors.some(s=>s.includes('已加载')));
  assert.equal(group.needsAction,null);
  const refused=summarizeFindings([row({code:'APPROVAL_REJECTED',certainty:'confirmed'})]).groups[0];
  assert.deepEqual(refused.signals,[]);assert.equal(refused.observationOnly,true);
});

test('Claude tool-result guards and worktree isolation map to explicit controls and recovery leads',()=>{
  const unv=attributeToolFailure({status:'error',tool:'Edit',output:'<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>'});
  assert.equal(unv.code,'FS_NOT_OBSERVED');assert.equal(unv.basis,'claude-tool-result');
  const stale=attributeToolFailure({status:'error',tool:'Edit',output:'<tool_use_error>File has been modified since read, either by the user or by a linter.</tool_use_error>'});
  assert.equal(stale.code,'FS_STALE_VERSION');assert.equal(stale.basis,'claude-tool-result');
  const hook=attributeToolFailure({status:'error',tool:'Edit',output:'PreToolUse:Edit hook error: This session is running in an isolated git worktree at /tmp/wt'});
  assert.equal(hook.code,'HOST_WORKTREE_GUARD');assert.equal(hook.pattern,'claude:worktree-boundary');
  const group=summarizeFindings([row(hook)]).groups[0];
  assert.deepEqual(group.directions,['recover']);
  assert.equal(group.signals[0].rule,'D-O1');

  const dshEvents=[
    {type:'session',id:'s1',version:4,cwd:'D:/'},
    {seq:1,time:10,type:'turn/start',data:{turn:1}},
    {seq:2,time:10,type:'step/start',data:{turn:1,step:1}},
    {seq:3,time:15,type:'tool/call',data:{turn:1,step:1,callId:'c1',name:'edit',arguments:JSON.stringify({file_path:'D:/a.js',old_string:'a',new_string:'b\nc'})}},
    {seq:4,time:18,type:'approval/asked',data:{id:'req-1',callId:'c1',toolName:'edit',reason:'Needs write approval'}},
    {seq:5,time:20,type:'approval/decided',data:{id:'req-1',outcome:'rejected'}},
    {seq:6,time:22,type:'tool/result',data:{turn:1,step:1,callId:'c1',error:{code:'APPROVAL_REJECTED',message:'Approval not granted'},message:{isError:true,content:[{type:'text',text:'Approval not granted'}]}}},{seq:7,time:25,type:'step/end',data:{turn:1,step:1}},
    {seq:8,time:26,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}},
  ];
  const session=projectSession(dshEvents,{cwd:'D:/'});
  const call=session.turns[0].steps[0].calls[0];
  assert.equal(call.measure?.kind,'change');
  assert.equal(call.controls?.[0]?.state,'denied');
  assert.equal(call.controls?.[0]?.requestId,'req-1');
  const finding=projectFindingCalls(session)[0];
  assert.equal(finding.controls?.[0]?.requestId,'req-1');
});
