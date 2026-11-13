import test from 'node:test';
import assert from 'node:assert/strict';
import { inputToolMeasure, settleToolMeasure, diagnosticFrame, recordedDiagnostics, renderDiagnosticFrames, renderDiagnosticSummary, renderToolMeasure, toolFeedbackRuntime } from '../lib/tool-feedback.mjs';
import { projectSession } from '../plugin/analysis-view/lib/trace-build.js';
import vm from 'node:vm';

test('line measures match official empty/trailing-newline and bounded replacement conventions',()=>{
  assert.equal(inputToolMeasure('write',{content:'a\nb\n'}).added,2);
  assert.equal(inputToolMeasure('write',{content:''}).added,0);
  const edit=inputToolMeasure('edit',{old_string:'same\nold\ntail',new_string:'same\nnew\nextra\ntail'});
  assert.equal(edit.added,2);assert.equal(edit.removed,1);
  assert.equal(inputToolMeasure('apply_patch',{patch:'*** Begin Patch'}),null,'No invented count for a different patch format');
  const huge=inputToolMeasure('edit',{old_string:'a\n'.repeat(401),new_string:'b\n'.repeat(403)});assert.equal(huge.approximate,true);
  const failed=settleToolMeasure('edit',edit,'denied','error');assert.match(renderToolMeasure(failed),/计划/);assert.doesNotMatch(renderToolMeasure(failed),/tt-measure-added/);
  assert.equal(settleToolMeasure('read',null,'a\nb\n','returned').lines,2);
  assert.equal(settleToolMeasure('grep',null,'x'.repeat(10000),'returned').chars,10000);
});

test('Pi and Claude multi-edit shapes retain per-replacement changes',()=>{
  const single=inputToolMeasure('edit',{oldText:'before',newText:'after\nextra'});
  assert.equal(single.added,2);assert.equal(single.removed,1);
  const multi=inputToolMeasure('edit',{edits:[{oldText:'a',newText:'a\nb'},{old_string:'old',new_string:'new'}]});
  assert.equal(multi.added,2);assert.equal(multi.removed,1);
});

test('code frame has real coordinates, bounded context, redaction and escaped markup',()=>{
  const source="$api_key='private-value'\nWrite-Output '<img onerror=alert(1)>'\nif (\n";
  const frame=diagnosticFrame(source,{line:3,column:5,id:'MissingEndParenthesis',message:'Missing closing )'});
  assert.equal(frame.lines.find(r=>r.error).number,3);assert.equal(frame.lines.find(r=>r.error).column,5);
  assert.ok(!JSON.stringify(frame).includes('private-value'));assert.match(renderDiagnosticFrames([frame]),/第 3 行/);
  assert.doesNotMatch(renderDiagnosticFrames([frame]),/<img onerror/);assert.match(renderDiagnosticFrames([frame]),/&lt;img/);
  assert.equal(diagnosticFrame(source,{line:99,message:'outside'}).lines.length,0);
  assert.equal(diagnosticFrame(null,{message:'No native coordinates'}).line,null);
  const context={};vm.runInNewContext(toolFeedbackRuntime(),context);assert.equal(context.__trajectoryDiagnosticFrames([frame]),renderDiagnosticFrames([frame]));
});

test('native PowerShell output produces a line and reason without reparsing or execution',()=>{
  const source='Write-Output ok\nif (\n';
  const output='ParserError:\nLine |\n   2 | if (\n     |     ~\n     | Missing closing ) in expression.\n[exit code: 1]';
  const [frame]=recordedDiagnostics({name:'pwsh',source,output});
  assert.equal(frame.line,2);assert.match(frame.message,/Missing closing/);assert.ok(frame.lines.some(r=>r.error));
  const [external]=recordedDiagnostics({name:'pwsh',source,output:'src/a.ts(9,3): error TS1005: Expected a closing brace.'});
  assert.equal(external.line,9);assert.equal(external.lines.length,0,'Compiler file coordinates must not highlight the shell script');
  const wrapped='ssh : bash: -c: line 2: syntax error: unexpected end of file\nAt line:5 char:1\n+ ssh remote command\n+ ~~~\n + CategoryInfo : NotSpecified\n + FullyQualifiedErrorId : NativeCommandError';
  const remote=recordedDiagnostics({name:'pwsh',source,output:wrapped});assert.equal(remote.length,1);assert.equal(remote[0].kind,'remote-syntax');assert.equal(remote[0].line,2);assert.equal(remote[0].lines.length,0);
  assert.deepEqual(recordedDiagnostics({name:'pwsh',source,output:wrapped.replace('ssh : bash: -c: line 2: syntax error: unexpected end of file',"git : Cloning into '.'...")}),[]);
});

test('PTC syntax, runtime and child-tool failures stay distinct, wrapper coordinates are not guessed',()=>{
  const source='const a = 1;\nconst =';
  const [syntax]=recordedDiagnostics({name:'run_code',source,output:'code run failed (exception): SyntaxError: Unexpected token\n/work/ptc-program.js:2\nconst =\n      ^\n'});
  assert.equal(syntax.kind,'ptc-syntax');assert.equal(syntax.line,2);assert.ok(syntax.lines.some(r=>r.error));
  const [runtime]=recordedDiagnostics({name:'run_code',source,output:'code run failed (exception): TypeError: bad input\n    at main (/work/helper.ts:18:5)\n'});
  assert.equal(runtime.kind,'ptc-runtime');assert.equal(runtime.line,18);assert.equal(runtime.lines.length,0);
  assert.match(renderDiagnosticSummary([runtime]),/helper\.ts:18:5/,'External stack locations identify their file, not a submitted-code line');
  const [child]=recordedDiagnostics({name:'run_code',source,output:'code run failed (exception): ToolCallError: edit failed'});
  assert.equal(child.kind,'ptc-tool');assert.equal(child.line,null);
  assert.equal(recordedDiagnostics({name:'run_code',output:'code run failed (exception): ToolCallError: SyntaxError in child'})[0].kind,'ptc-tool');
  const [spoof]=recordedDiagnostics({name:'run_code',source,output:'code run failed (exception): Error: failed\nCaptured output:\n/work/ptc-program.js:2\nconst =\n      ^\n'});
  assert.equal(spoof.line,null,'Captured logs cannot supply a runtime error location');
});

test('raw DSH events carry counts through PTC without counting its successful wrapper twice',()=>{
  const event=(seq,type,data)=>({seq,time:seq,type,data});
  const rows=[{type:'session',version:4,id:'feedback-fixture'},event(0,'turn/start',{turn:1}),event(1,'step/start',{turn:1,step:1}),
    event(2,'tool/call',{turn:1,step:1,callId:'root',name:'run_code',arguments:{code:'await tools.write({path:"x",content:"a\\nb\\n"})'}}),
    event(3,'tool/ptc-dispatch-start',{rootCallId:'root',subCallId:'child',name:'write',arguments:{path:'x',content:'a\nb\n'}}),
    event(4,'tool/ptc-dispatch',{rootCallId:'root',subCallId:'child',name:'write',arguments:{path:'x',content:'a\nb\n'},content:[{type:'text',text:'written'}]}),
    event(5,'tool/result',{turn:1,step:1,callId:'root',message:{content:[{type:'text',text:'done'}]}}),event(6,'step/end',{turn:1,step:1}),event(7,'turn/end',{turn:1})];
  const session=projectSession(rows),calls=session.turns[0].steps[0].calls;
  assert.equal(calls.length,1);assert.equal(calls[0].name,'write');assert.equal(calls[0].measure.added,2);assert.equal(calls[0].rootSeq,2);
});
