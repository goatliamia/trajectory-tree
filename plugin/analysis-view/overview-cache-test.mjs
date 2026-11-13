import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OverviewDiskCache,restoreOverviewModels} from './lib/eval/overview/persisted-cache.mjs';
import {OverviewService} from './lib/eval/overview/service.mjs';
import {createOverviewModels} from './lib/eval/overview/shared.mjs';
import {TraceQueue} from './lib/trace-resources.js';

test('restart reuse keeps empty results, rejects revisions and live cuts, and recovers from corrupt files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'trajectory-overview-'));
  try{
    const disk=new OverviewDiskCache(root,'v1');await disk.put('empty','/a','r1',null,[]);
    assert.equal((await new OverviewDiskCache(root,'v1').get('empty','/a','r1')).data,null);
    assert.equal(await disk.get('empty','/a','r2'),null);assert.equal(await disk.get('empty','/b','r1'),null);
    assert.equal(await new OverviewDiskCache(root,'v2').get('empty','/a','r1'),null);
    await disk.put('active','/a','live:9',{value:1},[]);assert.equal(await disk.get('active','/a','live:9'),null);
    await writeFile(disk.path('empty','/a'),'{broken');assert.equal(await disk.get('empty','/a','r1'),null);
    await disk.put('empty','/a','r2',{value:2},[]);assert.equal((await disk.get('empty','/a','r2')).data.value,2);
    const stopped=AbortSignal.abort();await assert.rejects(disk.put('new','/a','r1',{},[],stopped));
    assert.equal(await disk.get('new','/a','r1'),null);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('independently cached model catalogs restore request and occupancy identities',()=>{
  const catalog=createOverviewModels();catalog.index({provider:'new',model:'existing'});
  const data={turns:[{model:1,requests:[{model:2}]}],occupancy:{actions:[[1,2,3,4,'read',0,2,10,5,0,1,9]]}};
  const models=[{name:'unknown'},{provider:'a',name:'first'},{provider:'b',name:'second'}];
  const restored=restoreOverviewModels(data,models,catalog);
  assert.equal(restored.turns[0].model,2);assert.equal(restored.turns[0].requests[0].model,3);
  assert.equal(restored.occupancy.actions[0][10],2);assert.equal(data.turns[0].model,1);
});

test('cache budget prunes only its own summaries',async()=>{
  const root=await mkdtemp(join(tmpdir(),'trajectory-budget-'));
  try{
    const disk=new OverviewDiskCache(root,'v1',{maxEntries:2});await writeFile(join(root,'keep.txt'),'user');
    for(let i=0;i<4;i++)await disk.put(String(i),'/a','r1',{i},[]);
    const names=await readdir(root);assert.equal(names.filter(n=>n.endsWith('.json')).length,2);assert.ok(names.includes('keep.txt'));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a fresh service restores summaries without observing raw logs and rebuilds only changed revisions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'trajectory-restart-'));let reads=0,revision='r1';
  const event=(seq,type,data)=>({seq,type,data,time:1000+seq});
  const events=[event(0,'turn/start',{turn:1}),event(1,'step/start',{turn:1,step:1}),event(2,'assistant/message',{turn:1,step:1,message:{role:'assistant',source:{kind:'model',provider:'fixture',model:'one'},content:[{type:'text',text:'ok'}]},usage:{inputTokens:10,outputTokens:2}}),event(3,'turn/end',{turn:1,reason:{kind:'completed'}})];
  const persistence={stat:async()=>({revision})},ctx={get:name=>name==='sessionPersistence'?persistence:null};
  const make=()=>new OverviewService(ctx,{disk:new OverviewDiskCache(root,'v1'),queue:new TraceQueue(1),sdk:async()=>({stream:{}}),timeout:fn=>fn(),observe:async()=>{reads++;return{events,source:'persisted',revision};},dispose:()=>{}});
  const scope={projects:[],sessions:[{id:'one',cwd:'/a'}]},signal=new AbortController().signal;
  try{
    const first=make(),before=await Array.fromAsync(first.stream(scope,signal));first.dispose();
    const second=make(),after=await Array.fromAsync(second.stream(scope,signal));
    assert.equal(reads,1);assert.deepEqual(after.find(x=>x.session).session,before.find(x=>x.session).session);
    revision='r2';await Array.fromAsync(second.stream(scope,signal));assert.equal(reads,2);second.dispose();
  }finally{await rm(root,{recursive:true,force:true});}
});
