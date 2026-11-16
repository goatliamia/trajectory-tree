import {evalScope,diagnosisView,windowSamples,windowMeasure,windowMetrics,quantile} from './eval-insights.mjs';

const key=row=>JSON.stringify([row.session,row.seq]);
const requestKey=row=>JSON.stringify([row.session,row.request]);
const groupKey=group=>JSON.stringify([group.kind,group.code??null,group.tool??null,group.exception??null]);
const validRatio=row=>Number.isFinite(row?.ratio)&&row.ratio>=0&&row.ratio<=100;
const inRange=(row,range)=>!range||validRatio(row)&&row.ratio>=range.from&&(range.to===100?row.ratio<=100:row.ratio<range.to);
const status=value=>value===1?'error':value===0?'returned':'unpaired';
const rangeOf=options=>{
  if(options.windowFrom==null||options.windowTo==null||options.windowFrom===''||options.windowTo==='')return null;
  const from=Number(options.windowFrom),to=Number(options.windowTo);
  return Number.isFinite(from)&&Number.isFinite(to)&&from>=0&&to<=100&&to>from?{from,to}:null;
};
const windowInfo=(row,basis)=>row?{ratio:row.ratio,used:row.used??row.input,capacity:row.capacity,request:row.request??row.seq,model:row.model,
  state:validRatio(row)?'recorded':row.ratio==null?'missing':'outside-capacity',basis}:{ratio:null,state:'missing',basis};
function windowDistribution(rows,range){
  const bins=Array(20).fill(0),selected=Array(20).fill(0),ratios=[],active=[];let missing=0,mismatch=0;
  for(const row of rows){const window=row.contextWindow;if(!validRatio(window)){if(window?.ratio==null)missing++;else mismatch++;continue;}
    ratios.push(window.ratio);const index=Math.min(19,Math.floor(window.ratio/5));bins[index]++;if(inRange(window,range)){selected[index]++;active.push(window.ratio);}
  }
  return {bins,selected,measured:ratios.length,missing,mismatch,min:quantile(ratios,0),max:quantile(ratios,1),selectedMin:quantile(active,0),selectedMax:quantile(active,1)};
}
function representatives(rows,limit=12){
  const result=[],sessions=new Set();
  for(const row of rows)if(!sessions.has(row.session)){sessions.add(row.session);result.push(row);if(result.length===limit)return result;}
  for(const row of rows)if(!result.includes(row)){result.push(row);if(result.length===limit)break;}
  return result;
}
function sourcesOf(rows){
  const grouped=new Map();
  for(const row of rows){const id=JSON.stringify([row.session,row.cut]);if(!grouped.has(id))grouped.set(id,{session:row.session,cut:row.cut,turns:new Set()});grouped.get(id).turns.add(row.turn);}
  return [...grouped.values()].map(row=>({...row,turns:[...row.turns].sort((a,b)=>a-b)}));
}

// Runtime feedback, occupancy and comparisons share recorded identities. Current
// on-disk configuration remains a separate, explicitly dated source of evidence.
export function diagnosisWorkspace(data,options={}){
  const scope=evalScope(data,options),allTools=windowSamples(scope,'tool'),allRequests=windowSamples(scope,'model');
  const toolsByKey=new Map(allTools.map(row=>[key(row),row])),requestsByKey=new Map(allRequests.map(row=>[key(row),row]));
  const metric=Object.hasOwn(windowMetrics,options.metric)?options.metric:'elapsed',definition=windowMetrics[metric],subject=definition.mode;
  const model=options.model??'all',tool=options.tool??'all',range=rangeOf(options);
  const routeMatches=row=>model==='all'||row?.model===Number(model);
  const matchingTools=allTools.filter(row=>routeMatches(row)&&(tool==='all'||row.tool===tool));
  const metricSamples=rows=>[...new Map(rows.map(row=>subject==='tool'?toolsByKey.get(key(row)):requestsByKey.get(requestKey(row))).filter(Boolean).map(row=>[key(row),row])).values()];
  const baseSamples=metricSamples(matchingTools);
  const requestRecord=row=>{const parent=requestsByKey.get(requestKey(row));return parent?{...parent,recordType:'request',modelLabel:data.models[parent.model]?.name??'未记录',contextWindow:windowInfo(parent,'请求输入记录')}:undefined;};
  const entriesByKey=new Map(),sessions=scope.sessions.map(session=>({...session,findingCalls:session.findingCalls.flatMap(row=>{
    const sample=toolsByKey.get(JSON.stringify([session.id,row.seq])),request=sample?requestsByKey.get(requestKey(sample)):null;
    if(tool!=='all'&&row.tool!==tool||!routeMatches(sample??request))return [];
    const enriched={...row,model:sample?.model??request?.model,request:sample?.request,
      contextWindow:windowInfo(sample,'调用前记录'),requestRecord:sample?requestRecord(sample):undefined};
    entriesByKey.set(JSON.stringify([session.id,row.seq]),enriched);
    return [{...enriched}];
  })}));
  const enrichedData={...data,sessions},mode=['review','repeated','wait','control','all'].includes(options.mode)?options.mode:'review';
  const unfiltered=diagnosisView(enrichedData,{...options,project:'all',mode});
  const filteredData=range?{...enrichedData,sessions:sessions.map(session=>({...session,findingCalls:session.findingCalls.filter(row=>inRange(row.contextWindow,range))}))}:enrichedData;
  const feedback=range?diagnosisView(filteredData,{...options,project:'all',mode}):unfiltered;
  const waits=mode==='wait'?feedback:diagnosisView(filteredData,{...options,project:'all',mode:'wait'});
  const currentGroups=new Map(feedback.groups.map(group=>[groupKey(group),group]));
  const groups=unfiltered.groups.map(group=>{
    const current=currentGroups.get(groupKey(group)),entries=current?.entries??[];
    const allMetricSamples=metricSamples(group.entries),selectedMetricSamples=metricSamples(entries);
    return {...group,...current,key:groupKey(group),baseCount:group.entries.length,allEntries:group.entries,entries,count:entries.length,
      baseDirections:group.directions??[],baseTurns:group.turns,baseSessions:group.sessions,window:windowDistribution(group.entries,range),
      baseCells:group.cells,
      observation:{selected:windowMeasure(selectedMetricSamples,metric),all:windowMeasure(allMetricSamples,metric),max:definition.unit==='%'?100:quantile(allMetricSamples.map(definition.read),1)},
      paired:current?.paired??0,signals:current?.signals??[],directions:current?.directions??[],
      cells:current?.cells??group.cells.map(cell=>({...cell,count:0,paired:0,successful:0})),
      turns:new Set(entries.map(row=>JSON.stringify([row.session,row.turn]))).size,sessions:new Set(entries.map(row=>row.session)).size};
  }).sort((a,b)=>b.baseCount-a.baseCount);
  const requested=options.focus??'auto';
  const chosen=requested==='all'?null:groups.find(group=>group.key===requested)??groups.find(group=>group.count>0)??null;
  const focusSession=options.focusSession??'',selectedEntries=chosen?chosen.entries.filter(row=>!focusSession||row.session===focusSession):[];
  const focusKeys=chosen?new Set(chosen.allEntries.filter(row=>!focusSession||row.session===focusSession).map(key)):null;
  const feedbackKeys=focusKeys??new Set(groups.flatMap(group=>group.allEntries).map(key));
  const highlighted=matchingTools.filter(row=>feedbackKeys.has(key(row)));
  const selectedFindings=chosen?selectedEntries:[...new Map(groups.filter(group=>group.kind!=='wait').flatMap(group=>group.entries).map(row=>[key(row),row])).values()];
  const selectedRows=chosen?selectedEntries:matchingTools.filter(row=>inRange(row,range)).map(row=>{
    const original=entriesByKey.get(key(row));
    return {...row,...original,status:original?.status??status(row.status),durationMs:original?.durationMs??row.elapsed,contextWindow:windowInfo(row,'调用前记录'),requestRecord:requestRecord(row)};
  });
  const selectedSamples=metricSamples(selectedRows);
  selectedRows.sort((a,b)=>b.at-a.at||b.seq-a.seq);
  const bins=Array.from({length:20},(_,index)=>{
    const from=index*5,to=from+5,interval={from,to},all=matchingTools.filter(row=>inRange(row,interval)),selected=highlighted.filter(row=>inRange(row,interval));
    return {index,from,to,label:`${from}–${to}%`,count:all.length,selected:selected.length,...windowMeasure(metricSamples(all),metric)};
  });
  const baselineValue=String(options.baseline??'other'),baselineIndex=/^(?:[0-9]|1[0-9])$/.test(baselineValue)?Number(baselineValue):null;
  const baselineKeys=baselineIndex==null?null:new Set(metricSamples(matchingTools.filter(row=>inRange(row,{from:baselineIndex*5,to:baselineIndex*5+5}))).map(key));
  const selectedKeys=new Set(selectedSamples.map(key)),pairs=new Map();
  for(const row of selectedSamples){const pair=JSON.stringify([subject==='tool'?row.tool:null,row.model]);if(!pairs.has(pair))pairs.set(pair,{tool:subject==='tool'?row.tool:null,model:row.model,rows:[]});pairs.get(pair).rows.push(row);}
  const comparisons=[...pairs.values()].map(pair=>{
    const control=Number.isFinite(pair.model)?baseSamples.filter(row=>row.model===pair.model&&(subject!=='tool'||row.tool===pair.tool)&&
      (baselineIndex==null?!selectedKeys.has(key(row)):baselineKeys.has(key(row)))) : [];
    const own=windowMeasure(pair.rows,metric),base=windowMeasure(control,metric);
    return {tool:pair.tool,model:pair.model,modelLabel:[data.models[pair.model]?.name,data.models[pair.model]?.provider].filter(Boolean).join(' · ')||'模型未记录',
      selected:own,baseline:base,delta:own.value!=null&&base.value!=null?own.value-base.value:null};
  }).sort((a,b)=>b.selected.n-a.selected.n);
  const representativeRows=representatives(selectedRows),sources=sourcesOf(selectedRows),pageSize=30,
    offset=Math.max(0,Math.min(Math.floor(Number(options.offset)||0),Math.max(0,Math.floor((selectedRows.length-1)/pageSize)*pageSize)));
  const contextSelection={metric,metricLabel:definition.label+' '+definition.stat,subject,range,windowBasis:'调用前窗口',model,modelLabel:model==='all'?'全部模型':[data.models[Number(model)]?.name,data.models[Number(model)]?.provider].filter(Boolean).join(' · ')||'模型未记录',tool,records:selectedRows.length,samples:windowMeasure(selectedSamples,metric).n};
  const selectionGroup=chosen?{...chosen,allEntries:undefined,entries:representativeRows,recordCount:selectedRows.length,count:selectedRows.length,
    turns:new Set(selectedRows.map(row=>JSON.stringify([row.session,row.turn]))).size,sessions:sources.length,
    fact:focusSession?`所选会话内 ${selectedRows.length} 条${chosen.kind==='wait'?'至少持续 30 秒的调用':'反馈'}`:chosen.fact,contextSelection}:
    {kind:'scope',label:range?`窗口 ${range.from}–${range.to}% 的记录`:'当前记录选区',count:selectedRows.length,recordCount:selectedRows.length,
      turns:new Set(selectedRows.map(row=>JSON.stringify([row.session,row.turn]))).size,sessions:sources.length,entries:representativeRows,
      fact:`当前选区包含 ${selectedRows.length} 条工具调用。`,contextSelection};
  const valid=matchingTools.filter(validRatio),knownFindings=selectedFindings.filter(row=>validRatio(row.contextWindow));
  return {view:'investigation',scope:{sessions:scope.sessions.length,turns:scope.turns,failures:scope.failures,latest:scope.latest,sources},mode,metric,subject,model,tool,range,
    columns:feedback.columns,family:feedback.family,families:feedback.families,
    matrix:{records:groups.reduce((sum,group)=>sum+group.count,0),totalRecords:groups.reduce((sum,group)=>sum+group.baseCount,0),groups:groups.filter(group=>group.count>0).length,totalGroups:groups.length},
    metrics:Object.entries(windowMetrics).map(([id,{read,...rest}])=>({id,...rest})),
    routes:[...new Set([...allTools,...allRequests].map(row=>row.model).filter(Number.isFinite))].map(index=>({index,...data.models[index]})),
    tools:[...new Set(allTools.map(row=>row.tool))].sort(),
    summary:{...feedback.summary,calls:matchingTools.filter(row=>inRange(row,range)).length,requests:new Set(matchingTools.filter(row=>inRange(row,range)&&requestsByKey.has(requestKey(row))).map(requestKey)).size,waits:waits.groups.reduce((sum,group)=>sum+group.count,0),
      clues:groups.length,measured:valid.length,missing:matchingTools.filter(row=>row.ratio==null).length,mismatch:matchingTools.filter(row=>row.ratio!=null&&!validRatio(row)).length,
      peak:quantile(valid.map(row=>row.ratio),1)},
    histogram:bins,baseline:baselineIndex==null?'other':String(baselineIndex),comparisons:comparisons.slice(0,16),comparisonCount:comparisons.length,
    groups:groups.slice(0,200).map(({allEntries,entries,...group})=>({...group,powerShell:allEntries.some(row=>row.powerShell),successful:entries.filter(row=>row.status==='returned').length})),groupCount:groups.filter(group=>group.count>0).length,baseGroupCount:groups.length,
    selection:{key:chosen?.key??'all',group:selectionGroup,total:selectedRows.length,offset,pageSize,
      records:selectedRows.slice(offset,offset+pageSize),sources,metric:windowMeasure(selectedSamples,metric),
      window:{measured:selectedRows.filter(row=>validRatio(row.contextWindow)).length,missing:selectedRows.filter(row=>row.contextWindow?.ratio==null).length,
        min:quantile(selectedRows.filter(row=>validRatio(row.contextWindow)).map(row=>row.contextWindow.ratio),0),max:quantile(selectedRows.filter(row=>validRatio(row.contextWindow)).map(row=>row.contextWindow.ratio),1)},
      feedback:chosen?chosen.count:knownFindings.length}};
}
