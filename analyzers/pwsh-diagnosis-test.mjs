import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFindingCalls, summarizeFindings } from '../plugin/analysis-view/lib/eval/findings.mjs';
import { enrichFindingPowerShell } from '../plugin/analysis-view/lib/eval/pwsh-evidence.mjs';
import { buildDiagnosisDraft } from '../docs/demo/preset-context/diagnosis-review.js';

function sample(command,output,{status='returned',tool='pwsh',error,attribution}={}){
  const call={seq:2,resultSeq:3,name:tool,status,start:0,end:100,error,attribution,result:{text:output}};
  return {session:{turns:[{number:1,steps:[{number:1,calls:[call]}]}],overview:{episodes:[]}},events:[
    {seq:2,type:'tool/call',data:{name:tool,arguments:{command,workdir:'D:/sample'}}},
    {seq:3,type:'tool/result',data:{message:{content:[{type:'text',text:output}],isError:status==='error'},meta:{cwd:'D:/sample'}}},
  ]};
}
const project = fixture => projectFindingCalls(fixture.session,{events:fixture.events});

test('native pwsh nonzero exits contribute execution feedback without changing host failures',()=>{
  const fixture=sample('} | Format-Table','[stderr]\nParserError: \nLine |\n 1 | } | Format-Table\n   | Unexpected token\n[exit code: 1]');
  const before=JSON.stringify(fixture),rows=project(fixture),model=summarizeFindings(rows);
  assert.equal(rows.length,1);assert.equal(rows[0].status,'returned');assert.equal(rows[0].exitCode,1);
  assert.equal(rows[0].code,'COMMAND_SYNTAX');assert.equal(model.groups[0].kind,'command');
  assert.equal(model.observedErrors,0);assert.equal(model.commandFeedback,1);assert.equal(model.groups[0].needsAction,null);
  assert.equal(JSON.stringify(fixture),before);
});

test('exit 1 distinguishes no-match candidates, explicit interruptions and unknown outcomes',()=>{
  const lookup=summarizeFindings(project(sample('rg missing README.md','(no output)\n[exit code: 1]')));
  assert.equal(lookup.groups[0].code,'LOOKUP_NO_MATCH');assert.equal(lookup.groups[0].certainty,'candidate');
  assert.equal(lookup.groups[0].observationOnly,true);assert.deepEqual(lookup.groups[0].directions,[]);
  const stopped=project(sample('rg missing README.md','[stopped: user]\n[exit code: 1]'))[0];
  assert.equal(stopped.code,'ABORTED');assert.equal(stopped.command.feedback.stopped,'user');
  const unknown=summarizeFindings(project(sample('work','[exit code: 1]')));
  assert.equal(unknown.groups.length,0);assert.equal(unknown.unclassified.length,1);
  assert.equal(project(sample('work','Example: [exit code: 1]\nFinished')).length,0);
  assert.equal(project(sample('work','[exit code: 1]',{tool:'read'})).length,0);
});

test('native approval identity takes precedence over text in a rejected invocation',()=>{
  const row=project(sample('rg missing README.md','[exit code: 1]',{status:'error',error:{name:'ApprovalError',code:'APPROVAL_REJECTED'},
    attribution:{code:'APPROVAL_REJECTED',certainty:'confirmed',basis:'native-code'}}))[0];
  assert.equal(row.code,'APPROVAL_REJECTED');assert.equal(row.reportedName,'ApprovalError');
  const result=summarizeFindings([row]);assert.equal(result.observedErrors,1);assert.equal(result.commandFeedback,0);
  assert.equal(result.groups[0].observationOnly,true);
});

test('unconfigured parser preserves command evidence and never labels a snippet as parsed',async()=>{
  const fixture=sample("rg missing README.md; $api_key='private-test-value'",'[exit code: 1]');
  const rows=project(fixture),original=JSON.stringify(rows),result=await enrichFindingPowerShell(rows,fixture.events,{});
  assert.equal(result[0].syntax.state,'not-configured');assert.equal(result[0].status,'returned');
  assert.equal(JSON.stringify(rows),original);assert.ok(!JSON.stringify(result).includes('private-test-value'));
});

test('capability and method drafts keep exact cuts, pwsh method and current-context questions',()=>{
  const fixture=sample('rg missing README.md','[exit code: 1]'),row={...project(fixture)[0],session:'a',cut:9};
  for(const direction of ['capability','knowledge']){
    const draft=buildDiagnosisDraft({group:{label:'命令反馈',code:row.code,entries:[row]},direction,preset:'standard',question:'检查已有指导是否可用'});
    for(const text of ['references/powershell.md','references/code-execution.md','references/disposition.md','context-profile','检查已有指导是否可用'])assert.ok(draft.includes(text));
    assert.ok(draft.includes('"session":"a","cut":9'));assert.ok(draft.includes('"seqs":[2]'));
    assert.ok(!draft.includes('trajectory_command_diagnose('),'DSH does not register the portable-only command tool');
  }
  const draft=buildDiagnosisDraft({group:{label:'范围',entries:[]},direction:'knowledge',sources:[{session:'s',cut:20,turns:[1,3]}]});
  assert.ok(draft.includes('"from":1,"to":1'));assert.ok(draft.includes('"from":3,"to":3'));
  assert.ok(!draft.includes('"from":1,"to":3'),'Time filtering must not reintroduce unselected turns');
});
