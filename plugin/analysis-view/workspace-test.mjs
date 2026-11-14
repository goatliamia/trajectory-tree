import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EvalWorkspaceService} from './lib/eval/workspace-service.mjs';
import {summarizeCurrentPreset} from '../../analyzers/preset-statistics.mjs';
import {buildSkillManagement} from '../../analyzers/preset-skill-management.mjs';
import {skillWindow,renderSkills} from '../../docs/demo/preset-context/skill-manager.js';

test('history batches refresh Skill charts and freshness without rebuilding configuration analyses',async t=>{
  const root=await mkdtemp(join(tmpdir(),'trajectory-workspace-'));
  const anchor=join(root,'runtime.json');await writeFile(anchor,'{"version":"fixture"}');
  const now=Date.now(),firstRead=now-2000,modifiedAt=now-1000;
  const preset=id=>{
    const p={id,skills:[{name:'guide',description:'Review configuration',body:'Fixture instructions.',modifiedAt,bodyTokens:4,catalogTokens:2}],
      disabledSkills:[],tools:[],system:[],instructions:[],injections:[]};
    p.statistics=summarizeCurrentPreset(p,null,{estimate:text=>text.length});
    p.skillManagement=buildSkillManagement(p,{capturedAt:now-10000});return p;
  };
  const configuration={presets:[preset('standard'),preset('ptc')],workspace:{path:root},coverage:{}};
  const entry=(id,mode,time)=>({id,project:0,turns:[{no:1,at:time}],presetUsage:{id,preset:mode,createdAt:firstRead-100,lastAt:time,title:id,
    skills:[{name:'guide',loads:1,catalogs:1,loadSeq:8,loadEvents:[{seq:8,time,kind:'skill'}]}],tools:[]}});
  let rows=[entry('first','standard',firstRead),entry('other','ptc',now)],collects=0;
  let resume,firstBatch;const gate=new Promise(resolve=>{resume=resolve;}),published=new Promise(resolve=>{firstBatch=resolve;});
  const overview={scope:()=>({sessions:rows.map(row=>({id:row.id,cwd:root}))}),async *stream(){
    yield {type:'start',projects:[{id:'work'}],latest:now,models:[],categories:[]};
    for(const [index,session]of rows.entries()){
      yield {type:'session',session,done:index+1,unread:0,models:[]};
      if(index===0){firstBatch();await gate;}
    }
    yield {type:'complete',models:[],unread:0};
  }};
  const profile={home:root,dir:root,cwd:root,installAnchor:anchor};
  const ctx={get:key=>key==='workspaceRegistry'?{list:()=>[{id:'work',path:root}]}:undefined};
  const service=new EvalWorkspaceService(ctx,overview,{profile,cacheRoot:join(root,'cache'),collect:async()=>{collects++;return structuredClone(configuration);}});
  t.after(async()=>{resume();service.dispose();await rm(root,{recursive:true,force:true});});
  const before=await service.current('work');assert.equal(skillWindow(before.presets[0]).events.length,0);
  const loading=service.startHistory();await published;
  const partial=await service.current('work'),p=partial.presets[0];
  assert.equal(p.statistics.skills.count,1);
  assert.equal(skillWindow(p).events.length,1,'the visible chart must follow the history batch');
  assert.equal(p.skills[0].freshness.lastLoadedAt,firstRead);
  assert.equal(p.skills[0].freshness.modifiedAfterLastRead,true);
  assert.equal(p.skillManagement.capturedAt,now-10000,'static description checks retain their own capture');
  assert.match(renderSkills(p,partial,{}),/1 次读取/);
  assert.equal(partial.presets[1].skillManagement.events.length,0,'other presets wait for their own records');
  resume();await loading;
  const complete=await service.current('work');assert.equal(complete.presets[1].skillManagement.events.length,1);
  assert.deepEqual(service.configs.get('work').value.presets[0].skillManagement.events,[],'history does not contaminate the cached configuration');
  assert.equal(collects,1);
  rows=[];await service.startHistory({refresh:true});
  const cleared=await service.current('work');
  assert.equal(cleared.presets[0].statistics.skills.count,0);
  assert.deepEqual(cleared.presets[0].skillManagement.events,[]);
  assert.equal(cleared.presets[0].skills[0].freshness.lastLoadedAt,null);
});
