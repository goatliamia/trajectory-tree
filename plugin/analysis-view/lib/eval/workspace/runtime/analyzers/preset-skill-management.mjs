import { contentHash } from './preset-context.mjs';
import { analyzeSkillDescriptions } from './skill-description-candidates.mjs';

function mentions(body,name){return String(body??'').includes('`'+name+'`');}
export const descriptionOverlap=skills=>analyzeSkillDescriptions(skills).pairs;
export function skillReferences(skills){
  const references=[];
  for(const from of skills)for(const to of skills){
    if(from.name===to.name||from.provenance?.origin==='official'&&to.provenance?.origin==='official')continue;
    const body=String(from.body??''),positions=['`'+to.name+'`','/'+to.name+'/SKILL.md','['+to.name+']('].map(mark=>body.indexOf(mark)).filter(index=>index>=0);
    if(!positions.length)continue;
    const at=Math.min(...positions),lineStart=body.lastIndexOf('\n',at)+1,lineEnd=body.indexOf('\n',at);
    references.push({from:from.name,to:to.name,kind:'body-reference',excerpt:body.slice(lineStart,lineEnd<0?body.length:lineEnd).slice(0,600)});
  }
  return references;
}
const normalize=text=>String(text??'').toLowerCase().replace(/[`*_]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function statements(tool){
  const result=[];if(tool.description)result.push({kind:'description',text:tool.description});
  const visit=value=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value))if(key==='description'&&typeof child==='string')result.push({kind:'parameter',text:child});else if(typeof child==='object')visit(child);};
  visit(tool.staticParameters);
  return result.flatMap(row=>row.text.split(/(?<=[.!?。！？])\s+/).map(text=>({...row,text:text.trim(),normalized:normalize(text)}))).filter(row=>row.normalized.length>=65);
}
export function skillToolRepetition(skills,tools){
  const available=tools.map((tool,index)=>({tool,index,statements:statements(tool)})).filter(row=>row.statements.length);
  const checks=skills.map(skill=>{
    const body=normalize(skill.body),matches=[];
    for(const {tool,index,statements:sentences}of available)for(const sentence of sentences){
      if(!body.includes(sentence.normalized))continue;
      matches.push({tool:tool.name,toolIndex:index,package:tool.package,kind:sentence.kind,excerpt:sentence.text.slice(0,420),basis:'exact-normalized-statement'});
    }
    const unique=[...new Map(matches.map(row=>[row.tool+':'+row.excerpt,row])).values()].slice(0,8);
    return {name:skill.name,matches:unique,mentionedTools:tools.filter(tool=>mentions(skill.body,tool.name)).map(tool=>tool.name)};
  });
  return {checks,comparedTools:available.length,totalTools:tools.length,basis:'shared-long-statements',guidance:'每项事实说明一次；保留关键约束、适用场景和工作流程。'};
}
export function buildSkillManagement(preset,{capturedAt=Date.now()}={}){
  for(const skill of preset.skills){
    skill.contentHash=contentHash(skill.body);
    skill.freshness={modifiedAt:skill.modifiedAt,lastLoadedAt:skill.usage?.lastLoadedAt??null,
      modifiedAfterLastRead:skill.usage?.lastLoadedAt!=null&&skill.modifiedAt>skill.usage.lastLoadedAt,
      basis:'file-time-and-same-name-records'};
  }
  const repetitions=skillToolRepetition(preset.skills,preset.tools),descriptions=analyzeSkillDescriptions(preset.skills);
  return {schema:'skill-management/3',capturedAt,pairs:descriptions.pairs,descriptions,repetitions,references:skillReferences(preset.skills),
    loadBasis:'successful-skill-load-or-body-read',features:'sparse-local-terms',embeddings:false,modelsDownloaded:false,
    events:[...preset.skills,...preset.disabledSkills??[]].flatMap(skill=>(skill.usage?.events??[]).map(event=>({...event,name:skill.name}))).sort((a,b)=>(a.time??0)-(b.time??0))};
}
