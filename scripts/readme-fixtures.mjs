// Public, deterministic showcase data. No user profiles, transcripts or models.
import {buildTracePayload} from '../plugin/analysis-view/lib/trace-build.js';
import {buildEvalData,diagnosisSource} from '../plugin/analysis-view/lib/eval/data.mjs';
import {createRuntimeMetrics} from '../plugin/analysis-view/lib/eval-evidence.js';
import {createOverviewModels,overviewCategories} from '../plugin/analysis-view/lib/eval/overview/shared.mjs';
import {projectOverviewSession} from '../plugin/analysis-view/lib/eval/overview/data.mjs';
import {renderOverviewPage} from '../plugin/analysis-view/lib/eval/overview/render.mjs';
import {renderEvalPage} from '../plugin/analysis-view/lib/eval/render.mjs';
import {evaluationReportTables} from '../report/evaluation.mjs';
import {renderReport} from '../report/render.mjs';

const epoch=Date.parse('2026-11-07T01:00:00Z');
const pressure={init:()=>({}),apply:(state,row)=>row.type==='request/context'?{...state,contextWindow:row.data.contextWindow}
  :row.type==='assistant/message'?{...state,projectedTokens:row.data.usage.inputTokens+row.data.usage.cacheReadTokens}:state,wire:{view:state=>state}};
const runtime={pressure,stream:{isTokenDelta:chunk=>chunk.type==='text-delta',chunkHasVisibleText:chunk=>Boolean(chunk.text)}};

function eventsFor(index){
  const events=[],route={provider:'example',model:index%2?'Model B':'Model A'};
  let clock=epoch+index*86400000,callId=0;
  const add=(type,data,elapsed=30)=>{clock+=elapsed;events.push({seq:events.length,time:clock,type,data});};
  add('request/header',{header:{config:route}});
  add('session/title',{title:index<2?'Invoice export':'Documentation preview'});
  for(let turn=1;turn<=16;turn++){
    clock+=60000+(turn%3)*12000;
    add('request/context',{...route,contextWindow:256000});
    add('turn/start',{turn});add('user/message',{turn,content:[{type:'text',text:turn===1?'Implement the CSV export and verify it.':'Check the recorded change and continue.'}]});
    if(turn===1)add('goal/change',{operation:'create',goal:{id:'export-check',objective:'Verify the CSV export',phase:'active'}});
    const step=(number,name,args,output,error,elapsed=200,ptc=false)=>{
      const id='c'+(++callId),loc={turn,step:number},input=18000+((turn+index)%6)*36000;
      add('step/start',loc);
      add('assistant/live-chunk',{...loc,chunk:{type:'text-delta',text:'Checking the implementation.'}},500+(index%2)*350+(turn%4)*130);
      add('assistant/message',{...loc,message:{source:{kind:'model',...route},content:[{type:'text',text:'Checking the implementation.'},{type:'tool-call',id,name:ptc?'run_code':name}]},
        usage:{inputTokens:Math.round(input*.3),cacheReadTokens:Math.round(input*.7),cacheWriteTokens:0,outputTokens:160+turn*28+number*37},
        stream:[{type:'chunk',time:clock,chunk:{type:'text-delta',text:'Checking the implementation.'}}]},900+(turn%3)*200);
      add('tool/call',{...loc,callId:id,name:ptc?'run_code':name,arguments:ptc?{code:'await tools.pwsh('+JSON.stringify(args)+')'}:args});
      if(ptc){
        add('tool/ptc-dispatch-start',{...loc,rootCallId:id,subCallId:id+'-child',name,arguments:args});
        add('tool/ptc-dispatch',{...loc,rootCallId:id,subCallId:id+'-child',name,arguments:args,isError:Boolean(error),error,
          content:[{type:'text',text:output}]},elapsed);
      }
      add('tool/result',{...loc,callId:id,message:{toolCallId:id,isError:!ptc&&Boolean(error),content:[{type:'text',text:ptc?'Child call returned.':output}]},...(!ptc&&error?{error}:{})},ptc?30:elapsed);
      add('step/end',loc);
    };
    step(1,'read',{path:'src/invoice.ts'},'export function total(rows) { return rows.reduce((n, row) => n + row.amount, 0); }');
    if(turn%4===1){
      step(2,'pwsh',{command:'rg -n total src/{invoice.ts,totals.ts}'},'ParserError:\nLine |\n  1 | rg -n total src/{invoice.ts,totals.ts}\n    | Missing argument in parameter list.',{code:'EXIT_1'});
      step(3,'pwsh',{command:'rg -n total src/invoice.ts src/totals.ts'},'src/invoice.ts:1:export function total(rows) { … }');
    }else if(turn%4===2){
      const args={path:'src/export.ts',oldText:'return rows;',newText:'return encodeCsv(rows);'};
      step(2,'edit',args,'Read the file before editing it.',{code:'FS_NOT_OBSERVED'});
      step(3,'read',{path:'src/export.ts'},'export function exportRows(rows) { return rows; }');
      step(4,'edit',args,'Applied the requested edit.');
      step(5,'pwsh',{command:'node --test test/export.test.mjs'},'tests 8\npass 8\nfail 0',null,1200);
    }else if(turn%4===3){
      step(2,'pwsh',{command:'node --test test/export.test.mjs'},'AssertionError [ERR_ASSERTION]: expected CSV header\n# fail 1',{code:'EXIT_1'},1800);
      step(3,'edit',{path:'src/invoice.ts',oldText:'rows.map(encode)',newText:'[header, ...rows.map(encode)]'},'Applied the requested edit.');
      step(4,'pwsh',{command:'node --test test/export.test.mjs'},'tests 8\npass 8\nfail 0',null,1400);
    }else{
      step(2,'pwsh',{command:'npm run preview -- --port 4173'},'Preview ready at http://localhost:4173',null,35000+(index%2)*8000,true);
      step(3,'pwsh',{command:'node --check src/invoice.ts'},'Syntax check passed.');
    }
    if(turn===16){
      add('goal/change',{operation:'update',goal:{id:'export-check',objective:'Verify the CSV export',phase:index%2?'active':'complete'}});
      add('deliverables/presented',{files:[{path:'/example/billing/src/export.ts'},{path:'/example/billing/test/export.test.mjs'}]});
    }
    add('turn/end',{turn,reason:{kind:turn===13&&index===1?'aborted':turn===9&&index===3?'interrupted':'completed'}});
  }
  return events;
}

export function publicEvalShowcase(locale='zh-CN'){
  const en=locale==='en',say=(zh,english)=>en?english:zh,catalog=createOverviewModels();
  const sources=Array.from({length:4},(_,index)=>({id:'showcase-session-'+(index+1),events:eventsFor(index),project:index<2?0:1}));
  const sessions=sources.map(({id,events,project})=>({...projectOverviewSession(id,events,{cwd:project?'/example/docs':'/example/billing'},catalog,runtime),project,synthetic:true}));
  if(sessions.some(session=>session.turns.some(turn=>turn.requests.some(request=>request.input==null||!request.window))))throw Error('Public window comparison requires paired request usage and capacity');
  const latest=Math.max(...sessions.flatMap(session=>session.turns.map(turn=>turn.at)));
  const overview=renderOverviewPage({locale,data:{host:'dsh',projects:[{name:'billing-api'},{name:'docs-preview'}],sessions,models:catalog.models,categories:overviewCategories,latest}});
  const selected=sources[0],trace=buildTracePayload(selected.events,selected.id,{cwd:'/example/billing'}).sessions[0];
  const args=new Map(selected.events.filter(row=>row.type==='tool/call'||row.type==='tool/ptc-dispatch').map(row=>[row.seq,row.data.arguments]));
  const data=buildEvalData(trace,createRuntimeMetrics(trace,{events:selected.events}),{argumentsBySeq:args});
  const evaluation=renderEvalPage(data,{mode:'dsh',locale,integrated:true,diagnosis:diagnosisSource(trace,data)});
  const source={host:'dsh',session:trace.id,snapshot:'public-showcase-20261111',log:'synthetic-readme',cut:trace.lastSeq};
  const tables=evaluationReportTables(trace,data,sessions[0],catalog.models,source);
  const calls=trace.turns.find(turn=>turn.number===2).steps.flatMap(step=>step.calls).slice(1);
  const records={schema:'trajectory-data/1',id:'recovery',kind:'records',source,columns:{text:{label:'原文摘录',unit:'text',basis:'verbatim'}},
    rows:calls.map((call,i)=>({id:'record:'+i,text:call.result.text,evidence:[{session:source.session,log:source.log,seq:call.resultSeq}]}))};
  const labels=[say('修改被读取保护拦截','Edit blocked by read guard'),say('读取同一目标文件','Read the same target file'),say('原参数修改成功','Same-input edit returned'),say('原测试全部通过','Recorded tests passed')];
  const flow={type:'flow',data:'recovery',title:say('从拦截到验收，四条记录串起结果','Four records connect the guard to verification'),
    nodes:labels.map((label,i)=>({id:'step'+i,row:'record:'+i,label,outcome:i?'returned':'error'})),
    edges:labels.slice(1).map((_,i)=>({from:'step'+i,to:'step'+(i+1),kind:'sequence',label:say('后续记录','Later record'),evidence:['record:'+i,'record:'+(i+1)]}))};
  const figures={flow,windows:{type:'donut',data:'window-bands',title:say('请求分布在什么窗口区间','Request distribution by window occupancy'),fields:{label:'name',value:'requests'}},
    errors:{type:'bar',data:'error-types',title:say('失败信号与次数','Recorded failure signals'),fields:{label:'name',value:'errors'},sort:'descending'},
    tools:{type:'table',data:'tools',title:say('工具结果与耗时','Tool outcomes and timing'),fields:{label:'name'},series:['calls','errors','durationP50Ms']}};
  const markdown=en?
    '# The guarded edit recovered; the recorded tests passed\n\nPublic synthetic example · This report and its charts share one frozen session cut. Model A and Model B are illustrative routes.\n\n## The original edit has a recorded result\n\nThe read guard rejected the edit. A subsequent read of the same target was followed by the same-input edit returning successfully and all eight recorded tests passing. These observations establish this local verification result.\n\n[[figure:flow]]\n\n## Window occupancy is a comparison dimension\n\nRequests are counted once in their recorded occupancy bands. The distribution describes this sample; it is not a model quality ranking.\n\n[[figure:windows]]\n\n## Different feedback requires different investigation\n\nThe syntax error, read guard and failed assertion remain separate signals. They are not converted into permanent instructions.\n\n[[figure:errors]]\n\n[[figure:tools]]':
    '# 读取保护后的修改已成功，原测试已通过\n\n公开合成案例 · 报告与图表共用同一会话切点，Model A / Model B 仅为演示路由。\n\n## 原修改已有后续结果\n\n读取保护拦截修改后，记录显示先读取同一目标，再以原参数修改成功，随后八项测试全部通过。这些记录确认了这次局部修改的验收结果。\n\n[[figure:flow]]\n\n## 窗口占用是对照维度\n\n每个请求只计入一个已记录的占用区间。这里展示样本分布，不据此排名模型能力。\n\n[[figure:windows]]\n\n## 不同反馈保留不同调查方向\n\n脚本语法、读取保护与断言失败分别呈现，不把每一次失败改写为永久指导。\n\n[[figure:errors]]\n\n[[figure:tools]]';
  const report=renderReport({locale,markdown,datasets:{...tables,recovery:records},figures,template:'diagnostic'}).html;
  return {overview,evaluation,report,sessions:sessions.length,turns:sessions.reduce((n,session)=>n+session.turns.length,0)};
}
