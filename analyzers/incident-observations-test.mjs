import test from 'node:test';
import assert from 'node:assert/strict';
import {computeIncidents} from '../plugin/analysis-view/lib/incident-facts.js';
import {buildDigest,buildEvidence,interpret} from '../plugin/analysis-view/lib/index.js';
import {incidents} from './incidents.mjs';

const event=(type,seq,data={})=>({type,seq,time:seq,data});
const call=(seq,callId,name='poll')=>event('tool/call',seq,{callId,name,arguments:'{"task":"same"}'});
const result=(seq,callId,error=false)=>event('tool/result',seq,{callId,...(error?{error:{code:'FAIL'}}:{message:{content:[{type:'text',text:'done'}]}})});
const unsupported=/次冗余调用|该部分目标未达成|该 turn 未推进/;

test('successful polling remains an observed repetition without an impact verdict',()=>{
  const events=[event('turn/start',0),call(1,'p1'),result(2,'p1'),call(3,'p2'),result(4,'p2')];
  const facts=computeIncidents(events),repeat=facts.incidents.find(row=>row.type==='retry-loop');
  assert.equal(facts.errors,0);assert.deepEqual(repeat.seqs,[1,3]);assert.match(repeat.impact,/待核对/);assert.doesNotMatch(repeat.impact,unsupported);
  assert.deepEqual(incidents.run(events),facts,'offline and host consumers use the same observation policy');
});

test('an error followed by a completed alternative preserves the error and leaves task outcome unclassified',()=>{
  const events=[event('turn/start',0),call(1,'failed','edit'),result(2,'failed',true),call(3,'alternative','write'),result(4,'alternative'),event('assistant/message',5,{message:{content:[{type:'text',text:'finished using the alternative'}]}})];
  const digest=buildDigest('case',events),facts=computeIncidents(events),error=facts.incidents.find(row=>row.type==='error');
  assert.equal(digest.errors,1);assert.deepEqual(error.seqs,[2]);assert.doesNotMatch(error.impact,unsupported);assert.match(error.impact,/待核对/);
  const evidence=buildEvidence('case',events,facts,{id:'cut',events:6,minSeq:0,maxSeq:5});
  assert.match(evidence,/impact_to_verify/);assert.doesNotMatch(evidence,unsupported);
});

test('a nearby unrelated error is not attributed to the repeated calls',()=>{
  const facts=computeIncidents([event('turn/start',0),call(1,'p1'),result(2,'other',true),call(3,'p2'),result(4,'p2')]);
  const repeat=facts.incidents.find(row=>row.type==='retry-loop');
  assert.equal(repeat.severity,2);assert.doesNotMatch(repeat.cause,/关联调用有错误/);
});

test('a turn with only a boundary has an evidence anchor and no progress verdict',()=>{
  for(const tail of [[],[event('turn/end',8,{reason:{kind:'aborted'}})]]){
    const facts=computeIncidents([event('turn/start',7),...tail]),empty=facts.incidents.find(row=>row.type==='noop');
    assert.equal(facts.emptyTurns,1);assert.deepEqual(empty.seqs,[7]);assert.match(empty.detail,/未记录/);assert.doesNotMatch(empty.impact,unsupported);assert.match(empty.impact,/采集边界/);
  }
});

test('the actual interpretation path asks for impact verification and permits no action',async()=>{
  const events=[event('turn/start',0)],facts=computeIncidents(events);let request;
  const ctx={get:key=>key==='llm'?{async *stream(value){request=value;yield {type:'text-delta',text:'needs verification'};}}:key==='agentDefaultModel'?{currentSelection:()=>({provider:'fixture',model:'fixture'})}:undefined};
  const response=await interpret(ctx,'case',events,facts,{id:'cut',events:1,minSeq:0,maxSeq:0});
  assert.equal(response.text,'needs verification');assert.match(request.system,/不等于冗余/);assert.match(request.system,/不等于任务目标失败/);assert.match(request.system,/不等于未推进/);assert.match(request.system,/允许无需进一步处置/);
  assert.match(request.messages[0].content[0].text,/evidence \(seq 0\)/);
});
