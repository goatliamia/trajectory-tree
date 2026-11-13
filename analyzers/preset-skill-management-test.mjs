import test from 'node:test';
import assert from 'node:assert/strict';
import { descriptionOverlap, skillToolRepetition, buildSkillManagement, skillReferences } from './preset-skill-management.mjs';
import { projectPresetContext } from './preset-context.mjs';
import { attachCurrentUsage } from './preset-statistics.mjs';

test('successful loads carry event times, do not count PTC start/result twice or infer a date from session end',()=>{
  const events=[],add=(type,time,data)=>events.push({seq:events.length,type,time,data});
  add('assistant/message',1,{message:{role:'assistant',content:[]}});
  add('tool/ptc-dispatch-start',10,{rootCallId:'r',subCallId:'a',name:'skill',arguments:{name:'one'}});
  add('tool/ptc-dispatch',12,{rootCallId:'r',subCallId:'a',name:'skill',arguments:{name:'one'},result:{}});
  add('tool/ptc-dispatch',13,{rootCallId:'r',subCallId:'a',name:'skill',arguments:{name:'one'},result:{}});
  add('tool/ptc-dispatch',14,{rootCallId:'r',subCallId:'b',name:'skill',arguments:{name:'failed'},error:'failed'});
  add('assistant/message',999,{message:{role:'assistant',content:[]}});
  const {session}=projectPresetContext({id:'s',agentPreset:'mode',delegationDepth:1},events,{deriveEventMessage:e=>e.data.message??e.data});
  const row=session.skills.find(row=>row.name==='one');assert.equal(row.loads,1);assert.equal(row.loadEvents[0].time,12);
  const preset={id:'mode',tools:[],skills:[{name:'one'}]};attachCurrentUsage(preset,{sessions:[session]});
  assert.equal(preset.skills[0].usage.lastLoadedAt,12);assert.equal(preset.skills[0].usage.untimed,0);
  const old={id:'old',preset:'mode',lastAt:2000,createdAt:1000,skills:[{name:'one',loads:3,catalogs:1}]};attachCurrentUsage(preset,{sessions:[old]});
  assert.equal(preset.skills[0].usage.lastLoadedAt,null);assert.equal(preset.skills[0].usage.untimed,3);
});
test('description candidates exclude shared body text and explicit reference dependencies',()=>{
  const body='identical long body '.repeat(30);
  assert.deepEqual(descriptionOverlap([{name:'a',description:'Proof elaboration syntax',body},{name:'b',description:'Frontend visual layouts',body}]),[]);
  const pairs=descriptionOverlap([{name:'workflow',description:'Configure Cordis composition presets and plugin declarations',body:'Load `reference` for details.'},{name:'reference',description:'Cordis composition presets plugin declarations reference',body:''}]);
  assert.equal(pairs.length,0);
});
test('tool name references alone are not marked redundant; repeated long statements retain exact evidence',()=>{
  const sentence='Read a UTF-8 text file at the supplied path and return its content with line numbers.';
  const result=skillToolRepetition([{name:'workflow',body:'Call `read` when investigating a file.'},{name:'repeat',body:sentence}], [{name:'read',description:sentence,package:'official'}]);
  assert.equal(result.checks[0].matches.length,0);assert.deepEqual(result.checks[0].mentionedTools,['read']);
  assert.equal(result.checks[1].matches[0].excerpt,sentence);
});
test('freshness remains a timestamp comparison and does not declare a skill expired',()=>{
  const p={skills:[{name:'x',description:'',body:'',modifiedAt:100,usage:{lastLoadedAt:50,events:[]}}],tools:[]};
  const result=buildSkillManagement(p,{capturedAt:200});assert.equal(p.skills[0].freshness.modifiedAfterLastRead,true);
  assert.equal(result.embeddings,false);assert.equal(result.modelsDownloaded,false);assert.equal(p.skills[0].freshness.expired,undefined);
});

test('reference diagrams preserve direction and the actual excerpt, excluding official-official pairs',()=>{
  const official=name=>({name,provenance:{origin:'official'},body:'Use `official-b`.'});
  const skills=[official('official-a'),official('official-b'),{name:'mine',body:'Read [guide](../official-a/SKILL.md) before checking.\n`mine` refers to itself.',provenance:{origin:'personal'}}];
  const references=skillReferences(skills);
  assert.equal(references.length,1);assert.equal(references[0].from,'mine');assert.equal(references[0].to,'official-a');
  assert.equal(references[0].excerpt,'Read [guide](../official-a/SKILL.md) before checking.');
  assert.equal(references[0].kind,'body-reference');
});
