import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeWorkspaceConfigurations,scopedUsageHistory,usageWindow} from './workspace-presets.mjs';
import {summarizePresetInventory,currentUsageStatistics} from './preset-statistics.mjs';
import {buildSkillManagement,currentSkillUsage} from './preset-skill-management.mjs';
import {contextOverlap} from './context-overlap.mjs';

const now=Date.parse('2026-11-14T12:00:00+08:00'),DAY=86400000;
function configuration(id){
  const skill=(name,path,body)=>({name,path,body,description:body,bodyTokens:40,catalogTokens:4,measuredTokens:4,modifiedAt:now-500});
  const p={id:'custom-research',skills:[skill('shared','/home/skills/shared.md','Shared guidance'),skill('project','/'+id+'/SKILL.md','Project '+id)],
    disabledSkills:[],system:[],tools:[],injections:[],modules:[],instructions:[{name:'AGENTS.md',path:'/'+id+'/AGENTS.md',body:'Keep the project configuration and review evidence together. '.repeat(4),measuredTokens:20,bytes:60}]};
  p.statistics=summarizePresetInventory(p,null);p.skillManagement=buildSkillManagement(p);
  return {capturedAt:now,defaultPreset:p.id,workspace:{id,name:id,path:'/'+id},presets:[p],coverage:{}};
}
test('all-workspace inventory keeps preset policy global and preserves distinct sources',()=>{
  const first=configuration('one'),second=configuration('two'),data=mergeWorkspaceConfigurations([first,second]),p=data.presets[0];
  assert.equal(data.workspace.id,'all');assert.equal(data.defaultPreset,'custom-research');
  assert.equal(p.skills.length,2);assert.equal(p.skills[0].variants.length,1);assert.equal(p.skills[1].variants.length,2);
  assert.equal(p.statistics.skillBodies,120,'shared source is counted once; two project files remain distinct');
  assert.deepEqual(p.skills[0].workspaceIds,['one','two']);assert.equal(first.presets[0].scopeAllWorkspaces,undefined);
  const overlap=contextOverlap(data,p.id);
  assert.equal(overlap.pairs.filter(pair=>[pair.left,pair.right].every(id=>overlap.items.find(i=>i.id===id)?.kind==='instructions')).length,0,'files from unrelated workspaces are not co-loaded');
});

function session(id,project,time){
  return {id,project,turns:[{no:1,at:now-20*DAY},{no:2,at:time}],occupancy:{names:['read'],actions:[[0,0,1,0,0],[0,0,2,0,0]]},
    presetUsage:{id,preset:'custom-research',createdAt:now-20*DAY,lastAt:time,tools:[{name:'read',requests:2,calls:2}],skills:[{name:'shared',catalogs:2,loads:2,loadEvents:[{time:now-20*DAY,kind:'skill'},{time,kind:'read'}]}]}};
}
test('global period applies to events within old conversations and includes every selected workspace',()=>{
  const data={projects:[{id:'one'},{id:'two'}],sessions:[session('a',0,now-2*DAY),session('b',1,now-1000)]};
  const seven=scopedUsageHistory(data,{now}),today=scopedUsageHistory(data,{now,period:1}),thirty=scopedUsageHistory(data,{now,period:30});
  assert.equal(seven.sessions.length,2);assert.equal(today.sessions.length,1);assert.equal(today.sessions[0].id,'b');
  assert.equal(seven.sessions[0].tools[0].calls,1);assert.equal(seven.sessions[0].skills[0].loads,1);
  assert.equal(thirty.sessions[0].tools[0].calls,2);assert.equal(thirty.sessions[0].skills[0].loads,2);
  assert.equal(scopedUsageHistory(data,{now,workspace:'one'}).sessions.length,1);
  assert.equal(scopedUsageHistory(data,{now,workspace:'missing'}).sessions.length,0);
  assert.equal(data.sessions[0].presetUsage.skills[0].loads,2,'the cached source stays intact');
});
test('Shanghai calendar boundaries and history selection do not silently cap at twenty sessions',()=>{
  const range=usageWindow(1,now);assert.equal(range.start,Date.parse('2026-11-14T00:00:00+08:00'));assert.equal(range.end-range.start,DAY);
  assert.equal(usageWindow(999,now).period,7);
  const p=configuration('one').presets[0],data={projects:[{id:'one'}],sessions:Array.from({length:25},(_,i)=>session(String(i),0,now-1000))};
  const stats=currentUsageStatistics(p,scopedUsageHistory(data,{now}));
  assert.equal(stats.usage.sessions,25);assert.equal(stats.skills.count,25);
});
test('file freshness matches the read source, not another workspace with the same Skill name',()=>{
  const p=mergeWorkspaceConfigurations([configuration('one'),configuration('two')]).presets[0],skill=p.skills.find(s=>s.name==='project');
  skill.variants[1].modifiedAt=now-2000;
  skill.usage={lastLoadedAt:now-1000,events:[{path:'/two/SKILL.md',time:now-1000}]};currentSkillUsage(p);
  assert.equal(skill.freshness.modifiedAfterLastRead,false);assert.equal(skill.variants[0].freshness.lastLoadedAt,null);
  skill.usage.events.push({path:'/one/SKILL.md',time:now-1000});currentSkillUsage(p);
  assert.equal(skill.freshness.modifiedAfterLastRead,true);
});
