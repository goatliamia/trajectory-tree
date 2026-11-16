import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCurrentContext, buildRequestContext } from '../trajectory-tools/lib/request-context.js';
import { CurrentContextService } from './lib/current-context-service.js';

test('current items follow the native replacement/projection and existing category totals', () => {
  const message = (role, source, units, body) => ({ role, source, units, content: [{ type: 'text', text: body }] });
  const tools = [{ name: 'read', schema: {} }, { name: 'skill', schema: {} }];
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'request/header', data: { header: { tools } } },
    { type: 'system/message', surfaceOp: 'append', data: { message: message('system', {}, 3, 'old') } },
    { type: 'user/message', surfaceOp: 'append', data: { message: message('user', { kind: 'user' }, 5, 'question') } },
    { type: 'tool/call', data: { callId: 'skill-1', name: 'skill' } },
    { type: 'tool/result', surfaceOp: 'append', data: { message: message('tool', { kind: 'tool', callId: 'skill-1' }, 7, 'skill body') } },
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'request/header', data: { header: { tools } } },
    { type: 'system/message', surfaceOp: { startSeq: 2, endSeq: 2 }, data: { turn: 1, message: message('system', {}, 11, 'new') } },
  ].map((row, seq) => ({ ...row, seq, time: seq }));
  const projected = message('user', { kind: 'user' }, 2, 'projected question');
  const meter = { canonicalHeader: value => value, estimateToolsTokens: () => 13, estimateMessage: value => value.units,
    deriveEventMessage: (event, projections) => projections?.get(event.seq) ?? event.data.message,
    foldSurface: (_events, projections) => { for (const p of projections) p.project(events[8], {}); return { nodes: [8, 3, 5], replacements: [{ seq: 8, shadowedSeqs: [2] }], projectedMessages: new Map([[3, projected]]) }; } };
  const projections = [{ type: 'projection', project: () => new Map([[3, projected]]) }];
  const current = buildCurrentContext(events, meter, projections);
  assert.deepEqual(current.totals, buildRequestContext(events, meter, projections).current);
  assert.equal(current.items.some(row => row.id === 'message-2'), false);
  assert.equal(current.items.find(row => row.id === 'message-5').category, 'skill');
  assert.equal(current.bodies.get('message-3'), 'projected question');
  assert.equal(current.items.find(row => row.id === 'tool-read').turn, 1, 'unchanged headers preserve original entry turn');
  assert.equal(current.items.find(row => row.id === 'message-8').turn, 2, 'replacement enters in the current turn, not the copied origin turn');
  assert.equal(current.items.some(row => 'body' in row), false, 'full text never rides on sidebar updates');
});

test('sidebar metadata/body cache is revision-bound, bounded and expires', async () => {
  let revision = 'r1', now = 0, reads = 0, disposed = 0;
  const persistence = { stat: async () => ({ revision }) };
  const service = new CurrentContextService({ get: key => key === 'sessionPersistence' ? persistence : undefined }, {
    observe: async () => ({ events: [], revision }), dispose: () => disposed++, queue: { run: task => task() }, now: () => now,
    read: async () => { reads++; return { items: [{ id: 'm', tokens: 1 }], bodies: new Map([['m', 'body']]), cut: 1, totals: { total: 1 } }; },
  });
  try {
    const first = await service.snapshot('a'); assert.equal((await service.snapshot('a')).version, first.version); assert.equal(reads, 1);
    revision = 'r2'; const second = await service.snapshot('a'); assert.notEqual(second.version, first.version);
    assert.equal(service.body('a', first.version, 'm'), null); assert.equal(service.body('a', second.version, 'm').text, 'body');
    await service.snapshot('b'); const third = await service.snapshot('c'); assert.equal(service.entries.size, 2); assert.equal(service.body('a', second.version, 'm'), null);
    now = 90001; assert.equal(service.body('c', third.version, 'm'), null); service.expire(); assert.equal(service.entries.size, 0);
    const recovered = await service.readBody('c', third.version, 'm');
    assert.equal(recovered.text, 'body');
    assert.equal(disposed, reads);
  } finally { service.dispose(); }
});

test('queued requests share a revision and a failed or disposed read releases its observation', async () => {
  let tail=Promise.resolve(),reads=0,disposed=0,fail=false;
  const persistence={stat:async()=>({revision:'same'})};
  const service=new CurrentContextService({get:key=>key==='sessionPersistence'?persistence:undefined},{
    observe:async()=>({events:[],revision:'same'}),dispose:()=>disposed++,queue:{run(task){const next=tail.then(task);tail=next.catch(()=>{});return next;}},
    read:async()=>{reads++;if(fail)throw Error('projection failed');return {items:[],bodies:new Map(),cut:1,totals:{total:0}};},
  });
  try{
    const responses=await Promise.all(Array.from({length:4},()=>service.snapshot('same')));
    assert.equal(reads,1,'a queued duplicate must reuse the completed snapshot');
    assert.ok(responses.every(value=>value.version===responses[0].version));
    fail=true;await assert.rejects(service.snapshot('failure'),/projection failed/);
    assert.equal(disposed,2,'both success and failure release their native observations');
    const controller=new AbortController();controller.abort();
    await assert.rejects(service.snapshot('same',controller.signal),{name:'AbortError'});
  }finally{service.dispose();}
});

test('an in-flight read cannot publish after disposal',async()=>{
  let release,entered,disposed=0;
  const reading=new Promise(resolve=>{entered=resolve;}),hold=new Promise(resolve=>{release=resolve;});
  const service=new CurrentContextService({get:()=>undefined},{observe:async()=>({events:[]}),dispose:()=>disposed++,queue:{run:task=>task()},
    read:async()=>{entered();await hold;return {items:[],bodies:new Map(),cut:1,totals:{total:0}};}});
  const pending=service.snapshot('race');await reading;service.dispose();release();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(service.entries.size,0);assert.equal(disposed,1);
});
