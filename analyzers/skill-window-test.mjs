import test from 'node:test';
import assert from 'node:assert/strict';
import { skillWindow, selectSkillEvents } from '../docs/demo/preset-context/skill-manager.js';
import {skillModifiedAfterRead} from '../docs/demo/preset-context/skill-visuals.js';
test('date selection uses actual event time and an exclusive next-day boundary',()=>{
  const start=Date.parse('2026-11-11T00:00:00+08:00'),end=start+86400000;
  const preset={statistics:{usage:{asOf:end+1000}},skillManagement:{events:[
    {name:'a',kind:'skill',time:start-1},{name:'a',kind:'skill',time:start},
    {name:'b',kind:'read',time:end-1},{name:'c',kind:'skill',time:end},
    {name:'untimed',kind:'read',time:null},{name:'future',kind:'skill',time:end+2000},
  ]}};
  const window=skillWindow(preset,30),range={start,end};
  assert.equal(window.events.length,4);
  assert.deepEqual(selectSkillEvents(window,{skillRange:range}).map(row=>row.name),['a','b']);
  assert.deepEqual(selectSkillEvents(window,{skillRange:range,skillKind:'read'}).map(row=>row.name),['b']);
  assert.equal(selectSkillEvents(window,{}).length,4);
  assert.equal(skillWindow(preset,30,new Set(['b'])).events.length,1);
});

test('visible usage follows current records even when the cached analysis is empty or stale',()=>{
  const now=Date.now(),skill={name:'guide',modifiedAt:now-500,usage:{lastLoadedAt:now-1000,events:[{kind:'skill',time:now-1000,seq:3}]},freshness:{modifiedAfterLastRead:false}};
  const preset={skills:[skill],statistics:{usage:{asOf:now}},skillManagement:{events:[]}};
  assert.equal(skillWindow(preset).events.length,1);
  assert.equal(skillModifiedAfterRead(skill),true);
  preset.skillManagement.events=skillWindow(preset).events;
  skill.usage={lastLoadedAt:null,events:[]};
  assert.equal(skillWindow(preset).events.length,0,'an empty refreshed result must not fall back to stale events');
  assert.equal(skillModifiedAfterRead(skill),false);
});

test('today shows hourly readings rather than a single daily point',()=>{
  const now=Date.parse('2026-11-14T12:30:00+08:00'),preset={statistics:{usage:{asOf:now,period:1}},skills:[{name:'guide',usage:{events:[{time:now-1000,kind:'skill'}]}}]};
  const result=skillWindow(preset);
  assert.equal(result.bins.length,24);assert.equal(result.bins[12].total,1);assert.equal(result.hourly,true);
});
