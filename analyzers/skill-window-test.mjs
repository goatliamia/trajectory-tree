import test from 'node:test';
import assert from 'node:assert/strict';
import { skillWindow, selectSkillEvents } from '../docs/demo/preset-context/skill-manager.js';
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
