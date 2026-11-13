import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { recordedPreset, projectPresetContext } from './preset-context.mjs';
import { scanContributions, associateSource } from '../scripts/preset-source-inventory.mjs';
const require=createRequire(import.meta.url),sdk=createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
const {parse}=sdk('acorn');

test('preset follows recorded selection before the first response, not the creation header',()=>{
  const events=[{seq:1,type:'agent-preset/selected',data:{agentPreset:'ptc'}},{seq:20,type:'agent-preset/selected',data:{agentPreset:'standard'}}];
  assert.equal(recordedPreset({agentPreset:'cordis'},events,10),'ptc');
  assert.equal(recordedPreset({},[],10),'unrecorded');
});

test('PTC start and result count once; failed Skill loads are not successful loads',()=>{
  const events=[],append=(type,data)=>events.push({seq:events.length,time:events.length,type,data});
  append('request/header',{header:{tools:[{name:'read'},{name:'skill'},{name:'run_code'}]}});
  append('user/message',{role:'user',source:{kind:'skill-catalog',entries:[{name:'alpha'},{name:'beta'}]}});
  append('assistant/message',{turn:1,step:1,message:{role:'assistant',content:[]}});
  append('tool/call',{callId:'load',name:'skill',arguments:{name:'beta'}});
  append('tool/result',{message:{role:'tool',toolCallId:'load',isError:true,content:[]}});
  append('tool/call',{callId:'read',name:'read',arguments:{file_path:'/skills/alpha/SKILL.md'}});
  append('tool/result',{message:{role:'tool',toolCallId:'read',content:[{type:'text',text:'Body'}]}});
  append('tool/ptc-dispatch-start',{rootCallId:'code',subCallId:'nested',name:'read'});
  append('tool/ptc-dispatch',{rootCallId:'code',subCallId:'nested',name:'read',result:{}});
  const runtime={deriveEventMessage:event=>event.data.message??event.data};
  const {session}=projectPresetContext({id:'example',agentPreset:'ptc',delegationDepth:1},events,runtime);
  assert.equal(session.requests,1);
  assert.equal(session.tools.find(row=>row.name==='read').calls,2);
  assert.equal(session.tools.find(row=>row.name==='read').requests,1);
  assert.equal(session.skills.find(row=>row.name==='alpha').loads,1);
  assert.equal(session.skills.find(row=>row.name==='beta').loads,0);
  assert.equal(session.initial.available,false,'child histories are not new-session baselines');
});

test('source extraction does not execute plugin code or guess dynamic registrations',()=>{
  const code='throw Error("must not run"); ctx.tools.register(defineTool({name:"read",description:"Read one file"})); ctx.tools.register(buildDefinition()); ctx.systemPrompt.context({name:"project:context",text:"Exact contextual facts that are long enough to match."});';
  const result=scanContributions(code,{package:'example',file:'example.js',version:'1'},parse);
  assert.equal(result.parsed,true);assert.deepEqual(result.rows.map(row=>[row.kind,row.name]),[['tool','read'],['context','project:context']]);
});

test('generic plugin source is never attributed to every plugin producer',()=>{
  const inventory={contributions:[{kind:'producer',name:'plugin',package:'unrelated'},{kind:'context',name:'sandbox:policy',package:'sandbox'}]};
  const result=associateSource({producer:'plugin',recordedPlugin:'actual-publisher',sections:[]},inventory);
  assert.deepEqual(result.candidates,[]);assert.equal(result.recordedPublisher,'actual-publisher');
  const scoped=associateSource({producer:'plugin',sections:[{name:'sandbox:policy'}]},inventory);
  assert.deepEqual(scoped.candidates.map(row=>row.package),['sandbox']);
});

test('description match narrows current source candidates without claiming historical ownership',()=>{
  const inventory={contributions:[{kind:'tool',name:'read',description:'old',package:'a'},{kind:'tool',name:'read',description:'current',package:'b'}]};
  const result=associateSource({kind:'tool',name:'read',description:'current'},inventory);
  assert.deepEqual(result.candidates.map(row=>row.package),['b']);assert.equal(result.historicalOwnerConfirmed,false);
});
