import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attributeToolFailure} from '../trajectory-tools/lib/tool-attribution.js';
import {buildTracePayload} from './lib/trace-build.js';
import {codeExecutionData} from './lib/eval/code-data.mjs';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {datasetFromNative} from '../portable-tools/sources.mjs';
import {createPiSample} from '../../analyzers/pi-sample.mjs';
import {writeHostEvalPage} from '../../view/eval.mjs';

test('PTC native runtime kinds stay separate and captured logs cannot impersonate a failure', () => {
  const kinds={exception:'CODE_EXCEPTION',timeout:'CODE_TIMEOUT',abort:'CODE_ABORTED','worker-exit':'CODE_WORKER_EXIT',
    'invalid-output':'CODE_INVALID_OUTPUT','output-limit':'CODE_OUTPUT_LIMIT',protocol:'CODE_PROTOCOL','sandbox-unavailable':'CODE_SANDBOX_UNAVAILABLE'};
  for(const [kind,code] of Object.entries(kinds)){
    const row=attributeToolFailure({status:'error',tool:'run_code',error:{code:'CODE_RUN_FAILED',message:`code run failed (${kind}): something happened`},output:'Captured output:\nParserError: unrelated log'});
    assert.equal(row.code,code);assert.equal(row.runtimeKind,kind);assert.equal(row.certainty,'confirmed');
  }
  const syntax=attributeToolFailure({status:'error',tool:'run_code',error:{code:'CODE_RUN_FAILED',message:'code run failed (exception): SyntaxError: unexpected token'}});
  assert.equal(syntax.code,'CODE_SYNTAX');assert.equal(syntax.exception,'SyntaxError');
  const nativeText=attributeToolFailure({status:'error',tool:'run_code',error:{code:'CODE_RUN_FAILED'},output:'Error: code run failed (exception): ToolCallError: old_string was not found\nCaptured output:\nhello'});
  assert.equal(nativeText.code,'CODE_EXCEPTION');assert.equal(nativeText.exception,'ToolCallError');
  const generic=attributeToolFailure({status:'error',tool:'run_code',error:{code:'CODE_RUN_FAILED'},output:'Some output\ncode run failed (timeout): copied text'});
  assert.equal(generic.certainty,'unknown');
  const located=attributeToolFailure({status:'error',tool:'run_code',error:{code:'CODE_RUN_FAILED'},output:'Error: code run failed (exception): TypeError: expected string\n    at helper (file:///work/helper.ts:19:7)'});
  assert.deepEqual(located.site,{file:'file:///work/helper.ts',line:19,column:7,source:'runtime-stack'});
});

test('PTC wrapper and dispatched PowerShell retain original counts, code and explicit relations', () => {
  const events=[],add=(type,data)=>events.push({type,data,seq:events.length,time:events.length*10});
  add('turn/start',{turn:1});add('step/start',{turn:1,step:1});
  add('tool/call',{turn:1,step:1,callId:'root',name:'run_code',arguments:{code:'await tools.pwsh({command: "rg n x/{a,b}"})'}});
  add('tool/ptc-dispatch-start',{turn:1,step:1,rootCallId:'root',subCallId:'child',name:'pwsh',arguments:{command:'rg n x/{a,b}'}});
  add('tool/ptc-dispatch',{turn:1,step:1,rootCallId:'root',subCallId:'child',name:'pwsh',arguments:{command:'rg n x/{a,b}'},isError:true,content:[{type:'text',text:'ParserError:\nLine |\n 1 | rg n x/{a,b}\n | Missing argument in parameter list.'}]});
  add('tool/result',{turn:1,step:1,error:{code:'CODE_RUN_FAILED',message:'code run failed (exception): ToolCallError: pwsh failed'},message:{toolCallId:'root',isError:true,content:[{type:'text',text:'code run failed (exception): ToolCallError: pwsh failed'}]}});
  add('step/end',{turn:1,step:1});add('turn/end',{turn:1,reason:{kind:'completed'}});
  const session=buildTracePayload(events,'code-fixture').sessions[0],before=JSON.stringify(session);
  const data=codeExecutionData(session);
  assert.equal(data.rows.length,2);assert.equal(data.counts.reduce((n,row)=>n+row.errors,0),2);
  const child=data.rows.find(row=>row.executor==='PowerShell'),root=data.rows.find(row=>row.executor==='PTC');
  assert.equal(child.phase,'syntax');assert.equal(child.root.seq,root.seq);assert.equal(child.root.resultSeq,root.resultSeq);
  assert.equal(child.startSeq,3);assert.equal(child.seq,4);assert.equal(child.attribution.site.line,1);
  assert.equal(root.attribution.exception,'ToolCallError');assert.equal(root.phase,'program');
  assert.equal(root.source.text,'await tools.pwsh({command: "rg n x/{a,b}"})');
  assert.equal(JSON.stringify(session),before,'Analysis does not change native calls or outcomes');
});

test('a verified Codex script stays distinct from the rendered command and is bounded', () => {
  const script='rg n ' + 'x'.repeat(4000),call={id:'c1',seq:2,resultSeq:3,name:'commandExecution',nativeName:'commandExecution',status:'error',
    args:{text:JSON.stringify({command:'"pwsh.exe" -Command "rendered text"'})},result:{text:'ParserError:',omitted:0},
    attribution:{code:'COMMAND_SYNTAX',label:'脚本语法错误',certainty:'confirmed',program:'PowerShell'}};
  const session={id:'codex-fixture',lastSeq:5,turns:[{number:1,steps:[{number:1,calls:[call]}]}]};
  const plain=codeExecutionData(session,{host:'codex'});assert.equal(plain.rows[0].source.exact,false);
  const verified=codeExecutionData(session,{host:'codex',commandScripts:{c1:{text:script,edition:'Core'}}});
  assert.equal(verified.rows[0].source.exact,true);assert.equal(verified.rows[0].source.text.length,2800);
  assert.equal(verified.rows[0].source.omitted,script.length-2800);assert.equal(verified.rows[0].executor,'PowerShell');
  assert.equal(verified.counts[0].executor,'PowerShell');
});

test('portable code views hydrate bounded native feedback after query excerpts are compacted', () => {
  const directory=mkdtempSync(join(tmpdir(),'trajectory-code-feedback-'));
  const timestamp='2026-01-01T00:00:00Z',time=Date.parse(timestamp)/1000;
  const codexOutput='ParserError: '+ 'x'.repeat(2400);
  const claudeOutput='Command not found: sample';
  const base={sessionId:'feedback-claude',timestamp,cwd:directory};
  const cases=[
    {host:'codex',native:{capturedAt:timestamp,thread:{id:'feedback-codex',createdAt:time,turns:[{id:'t1',startedAt:time,completedAt:time+1,status:'completed',items:[
      {type:'commandExecution',id:'c1',command:'pwsh.exe -Command sample',status:'failed',exitCode:1,aggregatedOutput:codexOutput},
    ]}]}},output:codexOutput},
    {host:'pi',native:createPiSample({revision:'code-feedback'}),output:'FAIL format amount'},
    {host:'claude',native:{sessionId:base.sessionId,source:{sha256:'code-feedback'},rows:[
      {...base,type:'user',message:{content:'Run a check'}},
      {...base,type:'assistant',uuid:'a1',message:{id:'m1',content:[{type:'tool_use',id:'c1',name:'Bash',input:{command:'sample'}}]}},
      {...base,type:'user',message:{content:[{type:'tool_result',tool_use_id:'c1',is_error:true,content:[{type:'text',text:claudeOutput},{type:'image',data:'unused-image-data'}]}]}},
    ]},output:claudeOutput},
  ];
  try {
    for (const sample of cases) {
      const dataset=datasetFromNative(sample.host,sample.native);
      const before=JSON.stringify(dataset.payload);
      const page=writeHostEvalPage(dataset,join(directory,sample.host+'.html'),{locale:'en'});
      const html=readFileSync(page.output,'utf8');
      const data=JSON.parse(html.match(/id="eval-data">([^<]*)<\/script>/)[1]);
      const row=data.codeExecution.rows.find(row=>row.output?.text.startsWith(sample.output.slice(0,40)));
      assert.ok(row,sample.host+' keeps native failure feedback in the code view');
      assert.ok(row.output.text.length<=2200);
      if(sample.host==='codex')assert.equal(row.output.omitted,codexOutput.length-2200);
      assert.ok(!JSON.stringify(data.codeExecution).includes('unused-image-data'));
      assert.equal(JSON.stringify(dataset.payload),before,'Preview hydration preserves source calls and counts');
    }
  } finally {
    if(!resolve(directory).startsWith(resolve(tmpdir(),'trajectory-code-feedback-')))throw Error('Unexpected cleanup path');
    rmSync(directory,{recursive:true,force:true});
  }
});
