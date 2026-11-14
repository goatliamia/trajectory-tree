import {summarizePresetInventory} from './preset-statistics.mjs';
const unique=rows=>[...new Map(rows.map(row=>[JSON.stringify(row),row])).values()];
const key=row=>JSON.stringify([row.name,row.path??row.file,row.package,row.entry,row.body??row.staticText??row.description]);
export function mergeWorkspaceConfigurations(snapshots){
  if(!snapshots.length)throw Error('请先在 DSH 中登记工作区');
  const result={...snapshots[0],workspace:{id:'all',name:'全部工作区',path:'',scope:'all'},workspaces:snapshots.map(s=>s.workspace),presets:[]};
  for(const id of new Set(snapshots.flatMap(s=>s.presets.map(p=>p.id)))){
    const sources=snapshots.flatMap(s=>s.presets.filter(p=>p.id===id).map(p=>({preset:p,workspace:s.workspace}))),base=sources[0].preset;
    const preset={...base,scopeAllWorkspaces:true};
    for(const kind of ['system','instructions','tools','injections','modules']){
      const rows=new Map();
      for(const source of sources)for(const row of source.preset[kind]??[]){
        const identity=key(row);if(!rows.has(identity))rows.set(identity,{...row,workspaceIds:[],workspaceNames:[]});
        const entry=rows.get(identity);entry.workspaceIds.push(source.workspace.id);entry.workspaceNames.push(source.workspace.name);
      }
      preset[kind]=[...rows.values()];
    }
    for(const kind of ['skills','disabledSkills']){
      const groups=new Map();
      for(const source of sources)for(const row of source.preset[kind]??[]){
        if(!groups.has(row.name))groups.set(row.name,new Map());const variants=groups.get(row.name),identity=key(row);
        if(!variants.has(identity))variants.set(identity,{...row,workspaceIds:[],workspaceNames:[]});
        const entry=variants.get(identity);entry.workspaceIds.push(source.workspace.id);entry.workspaceNames.push(source.workspace.name);
      }
      preset[kind]=[...groups.values()].map(group=>{
        const variants=[...group.values()],first=variants[0];
        return {...first,variants,workspaceIds:[...new Set(variants.flatMap(v=>v.workspaceIds))],
          modifiedAt:Math.max(...variants.map(v=>v.modifiedAt??0)),
          bodyTokens:variants.reduce((n,v)=>n+(v.bodyTokens??0),0),catalogTokens:variants.reduce((n,v)=>n+(v.catalogTokens??0),0),
          measuredTokens:variants.reduce((n,v)=>n+(v.measuredTokens??0),0),sourceLabel:variants.length>1?variants.length+' 份工作区内容':first.sourceLabel};
      });
    }
    const analyses=sources.map(s=>s.preset.skillManagement),pairs=unique(analyses.flatMap(a=>a.pairs));
    const checks=new Map();
    for(const a of analyses)for(const row of a.repetitions.checks){
      const previous=checks.get(row.name);checks.set(row.name,{...row,matches:unique([...(previous?.matches??[]),...row.matches]),mentionedTools:[...new Set([...(previous?.mentionedTools??[]),...row.mentionedTools])]});
    }
    preset.skillManagement={...base.skillManagement,pairs,descriptions:{...base.skillManagement.descriptions,pairs},
      repetitions:{...base.skillManagement.repetitions,checks:[...checks.values()]},references:unique(analyses.flatMap(a=>a.references)),events:[]};
    preset.statistics=summarizePresetInventory(preset,null);result.presets.push(preset);
  }
  result.capturedAt=Math.max(...snapshots.map(s=>s.capturedAt));
  result.coverage={...result.coverage,workspaceScope:'all',workspaces:snapshots.length};return result;
}

export function usageWindow(period=7,now=Date.now()){
  const days=[1,7,30].includes(Number(period))?Number(period):7,day=86400000,zone=28800000;
  const end=Math.floor((now+zone)/day)*day-zone+day;return {period:days,start:end-days*day,end,asOf:now};
}
export function scopedUsageHistory(data,{workspace='all',period=7,now=Date.now()}={}){
  const range=usageWindow(period,now),project=workspace==='all'?null:data.projects.findIndex(p=>p.id===workspace);
  const sessions=[];
  for(const source of data.sessions){
    if(project!==null&&source.project!==project||!source.presetUsage)continue;
    const turns=(source.turns??[]).filter(t=>t.at>=range.start&&t.at<range.end),numbers=new Set(turns.map(t=>t.no));
    const skills=source.presetUsage.skills.map(skill=>{const loadEvents=(skill.loadEvents??[]).filter(e=>e.time>=range.start&&e.time<range.end);return {...skill,loads:loadEvents.length,loadEvents};});
    if(!turns.length&&!skills.some(s=>s.loads))continue;
    const counts=new Map();for(const row of source.occupancy?.actions??[])if(numbers.has(row[2])){const name=source.occupancy.names[row[4]];counts.set(name,(counts.get(name)??0)+1);}
    const tools=source.presetUsage.tools.map(tool=>({...tool,calls:counts.get(tool.name)??0}));
    sessions.push({...source.presetUsage,tools,skills,createdAt:turns[0]?.at??range.start});
  }
  return {sessions,generatedAt:now,limit:1024,range};
}
