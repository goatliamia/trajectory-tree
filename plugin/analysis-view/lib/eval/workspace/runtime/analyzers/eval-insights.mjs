import { summarizeFindings } from '../../../findings.mjs';
import { diagnosticSignals } from '../../../diagnostic-rules.mjs';
import { failureCategoryIndex } from '../../../../trace/shared/tool-attribution.mjs';
const DAY=86400000,ZONE=28800000;
export const occupancyBands=Array.from({length:20},(_,i)=>[(i+1)*5,`${i*5}–${(i+1)*5}%`]);
export const quantile=(values,p)=>{const sorted=values.filter(v=>Number.isFinite(v)&&v>=0).sort((a,b)=>a-b);return sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]:null;};
const ratio=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b>0?100*a/b:null;
const caption=code=>code==='FS_NOT_OBSERVED'?'文件保护要求先读取':null;
export function evalScope(data,{preset,period=30,project='all'}={}){
  const end=Math.floor((data.latest+ZONE)/DAY)*DAY-ZONE+DAY,start=period==='all'?-Infinity:end-(Number(period)||30)*DAY;
  const sessions=data.sessions.filter(s=>s.preset===preset&&(project==='all'||s.project===Number(project))).map(s=>({...s,turns:s.turns.filter(t=>t.at>=start&&t.at<end)})).filter(s=>s.turns.length);
  const failureCount=data.failures.filter(s=>s.preset===preset).length;
  return {sessions,start,end,latest:data.latest,failures:failureCount,turns:sessions.reduce((n,s)=>n+s.turns.length,0),projects:data.projects.map((p,index)=>({...p,index})).filter(p=>data.sessions.some(s=>s.preset===preset&&s.project===p.index))};
}
function record(session,turn,row){return {...row,session:session.id,sessionTitle:session.title,cut:session.cut,project:session.project,turn:turn.no,at:turn.at};}
const scopeMeta=scope=>({sessions:scope.sessions.length,turns:scope.turns,latest:scope.latest,failures:scope.failures,projects:scope.projects});
export function diagnosisView(data,options={}){
  const scope=evalScope(data,options),entries=[];
  for(const s of scope.sessions){const turns=new Map(s.turns.map(t=>[t.no,t]));for(const row of s.findingCalls)if(turns.has(row.turn))entries.push({...record(s,turns.get(row.turn),row),source:{session:s.id,cut:s.cut}});}
  const result=summarizeFindings(entries),groups=result.groups.map(g=>({...g,label:caption(g.code)??g.label,category:g.kind==='wait'?null:failureCategoryIndex(g.code),
    priorReads:g.entries.filter(r=>r.priorRead).length,
    fact:g.kind==='wait'?`${g.count} 次调用至少持续 30 秒`:g.kind==='command'?`${g.count} 次工具已返回，正文包含命令执行反馈；后续处理可沿关联记录核对`:g.paired?`${g.paired} / ${g.count} 次随后有同轮、同参数的非报错返回`:'未找到同轮、同参数的后续非报错返回',
    interpretation:g.code==='FS_NOT_OBSERVED'?'工具当时未接受文件观测条件；不能据此断言模型从未读取。':g.focus==='control'?'这是审批决定，不能当作修改实现或重新尝试的理由。':g.focus==='cancellation'?'需结合当时的停止指令和中断来源核对。':g.focus==='lookup'?'未命中可能已经回答了搜索问题。':g.kind==='wait'?'先看调用内容与等待作用，再判断是否影响推进。':g.kind==='command'?'记录来自命令返回正文；工具本身没有报错。需继续核对执行结果及任务目的。':'先核对原始返回和后续处理，再判断是否需要调整。',
    entries:g.entries.slice().sort((a,b)=>b.at-a.at||b.seq-a.seq)}));
  const mode=options.mode??'repeated',family=options.family??'all',chosen=groups.filter(g=>(family==='all'||g.category===Number(family))&&
    (mode==='all'&&g.kind!=='wait'||mode==='review'&&g.kind!=='wait'&&!g.observationOnly||mode==='repeated'&&g.kind!=='wait'&&g.repeated&&!g.observationOnly||mode==='control'&&g.kind!=='wait'&&g.observationOnly||mode==='guard'&&g.focus==='guard'||mode==='wait'&&g.kind==='wait'));
  if(['all','review'].includes(mode)&&(family==='all'||Number(family)===7)&&result.unclassified.length){
    const partitions=new Map();
    for(const row of result.unclassified){const key=JSON.stringify([row.tool,row.command?.feedback?'command':row.reportedCode??'tool']);if(!partitions.has(key))partitions.set(key,[]);partitions.get(key).push(row);}
    for(const own of partitions.values()){
    const paired=own.filter(r=>r.returned!=null).length,command=Boolean(own[0].command?.feedback),unsupported=own[0].reportedCode;
    const group={kind:'unclassified',code:command?'COMMAND_EXIT_UNEXPLAINED':unsupported??own[0].code??'UNCLASSIFIED_OUTPUT',category:7,
      label:command?'命令退出非零，原因待查':unsupported?'错误身份待适配':'工具反馈待识别',tool:own[0].tool,focus:command?'external':'unknown',certainty:'unknown',count:own.length,paired,priorReads:0,
      turns:new Set(own.map(r=>r.session+':'+r.turn)).size,sessions:new Set(own.map(r=>r.session)).size,entries:own.slice().sort((a,b)=>b.at-a.at||b.seq-a.seq),
      fact:command?`${own.length} 条命令返回含退出标记；${own.filter(r=>r.syntax?.state==='parsed').length} 条静态语法通过，${own.filter(r=>r.syntax?.state==='not-selected').length} 条尚未静态解析`:unsupported?'原文记录错误身份 '+unsupported:paired?paired+' 条有同轮同参数的后续返回':'已有工具返回，需沿原文识别具体反馈',
      interpretation:command?'结合子程序、探测目的和中断记录核对退出含义。':unsupported?'错误身份已经保留，当前类型映射尚未覆盖。':'从原始反馈与执行条件继续调查。',causeConfirmed:false,needsAction:null};
    group.signals=diagnosticSignals(group);group.directions=group.signals.map(signal=>signal.direction);chosen.push(group);
    }
  }
  const columns=scope.sessions.slice().sort((a,b)=>a.turns[0].at-b.turns[0].at).map(s=>({id:s.id,title:s.title,project:data.projects[s.project]?.name??'',at:s.turns[0].at}));
  for(const group of chosen)group.cells=columns.map((s,index)=>{const own=group.entries.filter(r=>r.session===s.id);return {column:index,session:s.id,count:own.length,paired:own.filter(r=>r.returned!=null).length,successful:own.filter(r=>r.status==='returned').length};});
  const errors=entries.filter(r=>r.status==='error'||r.command?.feedback),families=new Map();
  for(const r of errors){const id=r.certainty==='unknown'&&r.code!=='TOOL_OUTCOME_UNKNOWN'?7:failureCategoryIndex(r.code);if(!families.has(id))families.set(id,{id,label:data.categories?.[id]??'待识别反馈',count:0});families.get(id).count++;}
  return {view:'diagnosis',scope:{...scopeMeta(scope),sources:scope.sessions.map(s=>({session:s.id,cut:s.cut,turns:s.turns.map(t=>t.no)}))},mode,family,columns,families:[...families.values()].sort((a,b)=>b.count-a.count),groups:chosen,summary:{groups:groups.length,repeated:groups.filter(g=>g.kind!=='wait'&&g.repeated&&!g.observationOnly).length,guard:groups.filter(g=>g.focus==='guard').reduce((n,g)=>n+g.count,0),errors:result.observedErrors,commandFeedback:result.commandFeedback,feedback:errors.length,observations:groups.filter(g=>g.kind!=='wait'&&g.observationOnly).reduce((n,g)=>n+g.count,0),paired:errors.filter(r=>r.returned!=null).length,unclassified:result.unclassified.length,pending:result.pending.length},
    other:[...result.unclassified,...result.pending].slice(0,100)};
}
function samples(scope,mode){
  const result=[];
  for(const s of scope.sessions){const turns=new Map(s.turns.map(t=>[t.no,t]));
    if(mode==='model'){for(const t of s.turns)for(const r of t.requests)result.push(record(s,t,{...r,ratio:r.input!=null&&r.window?.[0]>0?ratio(r.input,r.window[0]):null,capacity:r.window?.[0]??null}));}
    else for(const [launch,request,turnNo,step,name,status,used,capacity,returned,category,model,elapsed] of s.occupancy.actions){
      const t=turns.get(turnNo);if(!t)continue;
      result.push(record(s,t,{seq:launch??returned,request,step,tool:s.occupancy.names[name],status,used,capacity,result:returned,category,model,elapsed,ratio:Number.isFinite(used)&&capacity>0?ratio(used,capacity):null,
        measure:s.occupancy.measures?.[launch??returned]??null,error:status===1?t.errors.find(error=>error.failed===returned)??null:null}));
    }
  }return result;
}
export const windowMetrics={
  ttft:{label:'首 token 等待',stat:'P90',unit:'ms',mode:'model',read:r=>r.ttft},
  output:{label:'输出量',stat:'P50',unit:'tokens',mode:'model',read:r=>r.output},
  toolShare:{label:'发起工具请求',stat:'占比',unit:'%',mode:'model'},
  errors:{label:'工具报错',stat:'占比',unit:'%',mode:'tool'},
  elapsed:{label:'调用耗时',stat:'P90',unit:'ms',mode:'tool',read:r=>r.elapsed},
  returned:{label:'同参后续返回',stat:'占报错',unit:'%',mode:'tool'},
};
function measure(items,key){
  if(key==='toolShare'){const own=items.filter(r=>r.type!=null);return {value:ratio(own.filter(r=>r.type==='tools').length,own.length),n:own.length};}
  if(key==='errors'){const own=items.filter(r=>r.status!==2);return {value:ratio(own.filter(r=>r.status===1).length,own.length),n:own.length};}
  if(key==='returned'){const own=items.filter(r=>r.status===1);return {value:ratio(own.filter(r=>r.error?.returned!=null).length,own.length),n:own.length};}
  const definition=windowMetrics[key],values=items.map(definition.read).filter(v=>Number.isFinite(v)&&v>=0);return {value:quantile(values,key==='output'?.5:.9),n:values.length};
}
export function windowView(data,options={}){
  const scope=evalScope(data,options),mode=options.mode==='tool'?'tool':'model',all=samples(scope,mode),metric=windowMetrics[options.metric]?.mode===mode?options.metric:mode==='model'?'ttft':'errors';
  const routes=[...new Set(all.map(r=>r.model))].map(index=>({index,...data.models[index],count:all.filter(r=>r.model===index).length})).sort((a,b)=>b.count-a.count);
  const model=options.model??'all',tool=options.tool??'all';
  if(model!=='all'&&!routes.some(r=>r.index===Number(model))&&data.models[Number(model)])routes.push({index:Number(model),...data.models[Number(model)],count:0});
  const filtered=all.filter(r=>(model==='all'||r.model===Number(model))&&(mode==='model'||tool==='all'||r.tool===tool));
  const mismatch=filtered.filter(r=>r.ratio!=null&&(!Number.isFinite(r.ratio)||r.ratio<0||r.ratio>100));
  const measurable=filtered.filter(r=>r.ratio!=null&&Number.isFinite(r.ratio)&&r.ratio>=0&&r.ratio<=100&&(mode==='model'||r.status!==2));
  const bins=occupancyBands.map(([upper,label],index)=>{const lower=index?occupancyBands[index-1][0]:0,items=measurable.filter(r=>r.ratio>=lower&&(index===occupancyBands.length-1?r.ratio<=upper:r.ratio<upper));return {index,lower,upper,label,count:items.length,...measure(items,metric),items};});
  const histogram=bins.map(b=>({start:b.lower,end:b.upper,count:b.count}));
  const available=bins.filter(b=>b.count),band=available.some(b=>b.index===Number(options.band))?Number(options.band):available.at(-1)?.index??0,baseline=available.some(b=>b.index===Number(options.baseline))?Number(options.baseline):available[0]?.index??0;
  const chosen=bins[band],base=bins[baseline],metricDefinitions=Object.entries(windowMetrics).filter(([,m])=>m.mode===mode).map(([id,{read,...m}])=>({id,...m}));
  return {view:'window',scope:scopeMeta(scope),mode,metric,metrics:metricDefinitions,model,tool,routes,tools:[...new Set([...all.map(r=>r.tool).filter(Boolean),...(tool==='all'?[]:[tool])])].sort(),band,baseline,
    summary:{total:filtered.length,measured:measurable.length,missing:filtered.filter(r=>r.ratio==null).length,unknown:filtered.filter(r=>r.status===2).length,capacityMismatch:mismatch.length,peak:quantile(measurable.map(r=>r.ratio),1),median:quantile(measurable.map(r=>r.ratio),.5),largestBand:bins.reduce((best,bin)=>bin.count>best.count?bin:best,bins[0]).label},
    histogram,mismatchRecords:mismatch.slice(0,100),
    bins:bins.map(({items,...bin})=>bin),selected:{...chosen,items:undefined,metrics:Object.fromEntries(metricDefinitions.map(m=>[m.id,measure(chosen.items,m.id)]))},
    comparison:{baseline:base.label,current:chosen.label,delta:chosen.value!=null&&base.value!=null?chosen.value-base.value:null},
    records:chosen.items.slice().sort((a,b)=>b.at-a.at||b.seq-a.seq).slice(0,200).map(r=>({...r,modelLabel:data.models[r.model]?.name??'未记录'}))};
}
