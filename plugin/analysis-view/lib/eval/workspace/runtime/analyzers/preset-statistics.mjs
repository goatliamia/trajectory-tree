const sum=rows=>rows.reduce((total,value)=>total+value,0);
const measured=row=>Number.isFinite(row.measuredTokens)&&row.measuredTokens>=0;

export function attachCurrentUsage(preset, history, limit=history?.limit??20) {
  const sessions=(history?.sessions??[]).filter(row=>row.preset===preset.id).sort((a,b)=>b.lastAt-a.lastAt).slice(0,limit);
  for(const kind of ['tools','skills'])for(const current of [...preset[kind],...(kind==='skills'?preset.disabledSkills??[]:[])]){
    const samples=sessions.flatMap(session=>{
      const row=session[kind]?.find(item=>item.name===current.name);if(!row)return [];
      return [{session:session.id,at:session.lastAt,title:session.title,visible:kind==='tools'?row.requests>0:row.catalogs>0,
        count:kind==='tools'?row.calls:row.loads,seq:kind==='tools'?row.firstCall??row.seq:row.loadSeq??row.seq,
        ...(kind==='skills'?{events:(row.loadEvents??[]).map(event=>({...event,session:session.id,sessionTitle:session.title}))}:{})}];
    });
    const visible=samples.filter(row=>row.visible).length,count=sum(samples.map(row=>row.count));
    current.usage={sessions:sessions.length,visibleSessions:visible,usedSessions:samples.filter(row=>row.count>0).length,count,
      lastUsedSessionAt:samples.filter(row=>row.count>0).reduce((latest,row)=>Math.max(latest??0,row.at),null),
      unobserved:!samples.length,unusedCandidate:visible>=3&&count===0,basis:'same-name-within-recorded-preset',samples};
    if(kind==='skills'){
      const events=samples.flatMap(row=>row.events).sort((a,b)=>(a.time??0)-(b.time??0));
      current.usage.events=events;current.usage.lastLoadedAt=events.reduce((max,row)=>row.time==null?max:Math.max(max??0,row.time),null);
      current.usage.untimed=Math.max(0,count-events.filter(row=>row.time!=null).length);
    }
  }
  return {sessions:sessions.length,limit,asOf:history?.generatedAt??null,period:history?.range?.period??null,
    from:sessions.length?Math.min(...sessions.map(row=>row.createdAt)):null,to:sessions.length?Math.max(...sessions.map(row=>row.lastAt)):null};
}

export function summarizeCurrentPreset(preset, history, {estimate,estimateTool,parametersToSchema}={}) {
  for(const tool of preset.tools){
    tool.measuredTokens=null;
    if(tool.staticParameters&&typeof tool.description==='string'){
      try{const parameters=tool.parametersKind==='spec'?parametersToSchema(tool.staticParameters):tool.staticParameters;
        tool.measuredTokens=estimateTool({name:tool.name,description:tool.description,parameters});tool.measureBasis='current-static-schema';
      }catch{tool.measureBasis='requires-runtime-schema';}
    }
  }
  for(const row of preset.system){const literal=row.kind==='persona'?row.body:row.staticText;row.measuredTokens=typeof literal==='string'?estimate(literal):null;row.measureBasis='current-registered-text';}
  for(const row of preset.skills)row.measuredTokens=row.catalogTokens;
  for(const row of preset.instructions)row.measuredTokens=row.tokens;
  // Only literal context registrations can be measured without materializing a live request.
  for(const row of preset.injections)row.measuredTokens=typeof row.staticText==='string'?estimate(row.staticText):null;
  return summarizePresetInventory(preset,history);
}

export function summarizePresetInventory(preset,history){
  const categories=[
    ['system','系统提示'],['instructions','AGENTS.md'],['tools','工具定义'],['skills','Skill 目录'],['injections','环境注入'],
  ].map(([id,label])=>{const rows=preset[id];return {id,label,items:rows.length,measured:rows.filter(measured).length,pending:rows.filter(row=>!measured(row)).length,
    tokens:rows.some(measured)?sum(rows.filter(measured).map(row=>row.measuredTokens)):rows.length?null:0};});
  const total=sum(categories.map(row=>row.tokens??0)),plugins=new Map();
  for(const category of categories)for(const row of preset[category.id]){
    const key=row.package??(category.id==='skills'?row.sourceLabel:'本地文件');
    if(!plugins.has(key))plugins.set(key,{name:key,tokens:0,items:0,measured:0,pending:0,tools:0,skills:0,categories:new Set()});
    const plugin=plugins.get(key);plugin.items++;plugin.tokens+=measured(row)?row.measuredTokens:0;plugin.measured+=Number(measured(row));plugin.pending+=Number(!measured(row));plugin.tools+=Number(category.id==='tools');plugin.skills+=Number(category.id==='skills');plugin.categories.add(category.id);
  }
  return {total,categories:categories.map(row=>({...row,share:total>0&&row.tokens!==null?row.tokens/total:null})),
    measured:sum(categories.map(row=>row.measured)),pending:sum(categories.map(row=>row.pending)),
    plugins:[...plugins.values()].map(row=>({...row,tokens:row.measured?row.tokens:null,categories:[...row.categories],share:total&&row.measured?row.tokens/total:null})).sort((a,b)=>(b.tokens??0)-(a.tokens??0)||b.items-a.items),
    skillBodies:sum(preset.skills.map(row=>row.bodyTokens)),...currentUsageStatistics(preset,history),
    instructions:{files:preset.instructions.length,bytes:sum(preset.instructions.map(row=>row.bytes)),truncated:preset.instructions.filter(row=>row.truncated||row.omitted).length},
  };
}

export function currentUsageStatistics(preset,history){
  const usage=attachCurrentUsage(preset,history);
  const toolsWithHistory=preset.tools.filter(row=>!row.usage.unobserved),skillsWithHistory=preset.skills.filter(row=>!row.usage.unobserved);
  return {usage,
    tools:{current:preset.tools.length,observed:toolsWithHistory.length,used:preset.tools.filter(row=>row.usage.count>0).length,unused:preset.tools.filter(row=>row.usage.unusedCandidate).length,
      count:sum(preset.tools.map(row=>row.usage.count))},
    skills:{current:preset.skills.length,observed:skillsWithHistory.length,used:preset.skills.filter(row=>row.usage.count>0).length,unused:preset.skills.filter(row=>row.usage.unusedCandidate).length,
      count:sum(preset.skills.map(row=>row.usage.count))}};
}
