import {statSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {configuredPresets,flattenConfiguredRows,winningSkillCandidates} from '../analyzers/preset-current.mjs';
import {disabledSkillNames} from '../../../../skill-policy.js';

const sourceNames={'project-dsh':'项目 Skill','project-agents':'项目 Skill','user-dsh':'个人 Skill','user-agents':'个人 Skill',custom:'预设提供',bundled:'宿主提供',runtime:'插件提供'};

// One provider path for configuration analysis and live management. Management
// omits token measurements and comparisons, but resolves current file winners.
export async function readConfiguredSkills(rows,ownRows,{filesystem,sdk,home,cwd,estimate,name}){
  const skillRows=rows.filter(row=>row.name==='@deepseek-ai/dsh-skill-filesystem'),candidates=[],providers=[],skillIssues=[];
  const skills=[],disabledSkills=[],policy=disabledSkillNames(ownRows);
  try{
    for(const [index,row]of skillRows.entries()){
      const custom=[];
      for(const value of row.config?.customSkillDirs??[]){
        if(typeof value==='string')custom.push(value);
        else if(value?.__jsExpr?.includes("resolve('@deepseek-ai/dsh-agent-preset/package.json')"))custom.push(join(dirname(sdk.resolve('@deepseek-ai/dsh-agent-preset/package.json')),'skills'));
        else skillIssues.push('一个动态 Skill 目录尚未解析');
      }
      const provider=new filesystem.FileSystemSkillProvider({get:()=>undefined,logger:{warn:message=>skillIssues.push(message)}},
        {signal:new AbortController().signal,invalidate:()=>{}},{...row.config,customSkillDirs:custom,dshHome:home,watch:false});
      providers.push(provider);
      const observed=await provider.list({cwd}),list=Array.isArray(observed)?observed:observed.candidates;
      if(!Array.isArray(observed)&&!observed.complete)skillIssues.push('部分目录尚未读取');
      candidates.push(...list.map(candidate=>({...candidate,providerIndex:index})));
    }
    for(const candidate of winningSkillCandidates(candidates,{includeDisabled:true})){
      if(name!=null&&candidate.name!==name)continue;
      const loaded=await providers[candidate.providerIndex].get(candidate,{cwd});if(!loaded)continue;
      const owner=candidate.path?.includes('dsh-agent-preset')?'@deepseek-ai/dsh-agent-preset':null;
      const policyDisabled=policy.has(candidate.name),invocation=policyDisabled?{modelInvocable:false,userInvocable:false}:candidate.invocation;
      const stat=statSync(loaded.path),destination=invocation?.modelInvocable===false?disabledSkills:skills;
      destination.push({name:candidate.name,description:candidate.description,whenToUse:candidate.whenToUse??null,path:loaded.path,
        source:candidate.source,sourceLabel:sourceNames[candidate.source]??candidate.source,package:owner,invocation,policyDisabled,nativeInvocation:candidate.invocation,
        modifiedAt:stat.mtimeMs,bytes:stat.size,...(estimate?{body:loaded.content,
          catalogTokens:estimate(candidate.name+'\n'+candidate.description+(candidate.whenToUse?'\n'+candidate.whenToUse:'')),bodyTokens:estimate(loaded.content)}:{})});
    }
  }finally{await Promise.all(providers.map(provider=>provider.dispose()));}
  return {skills,disabledSkills,skillIssues,skillsEnabled:skillRows.length>0};
}

export async function readManagementSkills({entries,sdk,home,cwd,preset,name}){
  const environment={platform:process.platform,profile:true};
  const filesystem=await import(pathToFileURL(sdk.resolve('@deepseek-ai/dsh-skill-filesystem')).href);
  const host=flattenConfiguredRows(entries,'host',environment).filter(row=>row.status!=='disabled'),presets=[];
  for(const declaration of configuredPresets(entries,environment)){
    if(preset!=null&&declaration.config.id!==preset)continue;
    const own=flattenConfiguredRows(declaration.config.plugins??[],'preset',environment).filter(row=>row.status!=='disabled');
    const names=new Set(own.map(row=>row.name)),rows=[...host.filter(row=>!names.has(row.name)),...own];
    const found=new Map(),skillIssues=[];
    for(const directory of Array.isArray(cwd)?cwd:[cwd]){
      const catalog=await readConfiguredSkills(rows,own,{filesystem,sdk,home,cwd:directory,name});
      skillIssues.push(...catalog.skillIssues);
      for(const skill of [...catalog.skills,...catalog.disabledSkills])if(!found.has(skill.name))found.set(skill.name,skill);
      if(name!=null&&found.has(name))break;
    }
    const available=[...found.values()];
    presets.push({id:declaration.config.id,name:declaration.config.name??declaration.config.id,skillIssues,
      skills:available.filter(s=>s.invocation?.modelInvocable!==false),disabledSkills:available.filter(s=>s.invocation?.modelInvocable===false)});
  }
  return {presets};
}
