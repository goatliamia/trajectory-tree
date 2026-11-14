import assert from 'node:assert/strict';
import {adaptCodexThread} from './codex-adapter.mjs';
import {codexContextAnchors} from './codex-context-anchors.mjs';
const start = Date.parse('2026-01-01T00:00:00Z');
const row = (ms, type, payload) => ({timestamp:new Date(start+ms).toISOString(),type,payload});
const complete = (ms,id,type) => row(ms,'event_msg',{type:'item_completed',item:{id,type},turn_id:'turn',started_at_ms:start+ms-1,completed_at_ms:start+ms});
const response = (ms,payload) => row(ms,'response_item',payload);
const records = [row(0,'session_meta',{id:'context-anchor'}),row(0,'turn_context',{turn_id:'turn'}),
  response(0,{type:'message',role:'user',content:[{text:'Read two files.'}]}),
  response(10,{type:'custom_tool_call',id:'wrapper',call_id:'batch',name:'exec',input:'two commands'}),
  complete(20,'one','CommandExecution'),complete(21,'two','CommandExecution'),
  response(22,{type:'custom_tool_call_output',call_id:'batch',output:'x'.repeat(8000)}),
  complete(30,'reply','AgentMessage'),response(31,{type:'message',id:'reply',role:'assistant',content:[{text:'Results received.'}]}),
];
const snapshot = {thread:{id:'context-anchor',createdAt:start/1000,turns:[{id:'turn',startedAt:start/1000,completedAt:(start+40)/1000,status:'completed',items:[
  ...['one','two'].map(id=>({id,type:'commandExecution',command:'cat file',aggregatedOutput:'x',status:'completed',exitCode:0})),
  {id:'reply',type:'agentMessage',text:'Results received.'},
]}]}};
const result = adaptCodexThread(snapshot,{rollout:records.map(JSON.stringify).join('\n')});
const [first,batch,reply] = result.context.requests;
assert.equal(first.tool,0);
assert.equal(batch.tool,2000,'Late persisted batch output belongs to the final tool action');
assert.deepEqual(batch.contextSteps,[1,2]);
assert.equal(reply.tool,batch.tool,'The reply does not inherit tool growth');
assert.ok(reply.assistant>batch.assistant,'Own message is included despite persistence delay');
const ambiguous=codexContextAnchors([
  {ordinal:1,type:'response_item',payload:{type:'function_call',call_id:'a'}},
  {ordinal:2,type:'response_item',payload:{type:'function_call',call_id:'b'}},
  {ordinal:3,type:'event_msg',payload:{type:'item_completed',item:{id:'unknown',type:'CommandExecution'}}},
  {ordinal:4,type:'response_item',payload:{type:'function_call_output',call_id:'a'}},
]);
assert.equal(ambiguous.get('unknown').basis,'completion','Overlapping envelopes do not invent parentage');
console.log('Codex context anchors passed: delayed persistence, combined returns, own reply and ambiguous envelopes.');
