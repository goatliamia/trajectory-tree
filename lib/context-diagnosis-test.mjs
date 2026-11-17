import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {contextOverlap} from '../analyzers/context-overlap.mjs';
import {prepareContextDiagnosis} from './context-diagnosis.mjs';

test('diagnosis freezes only selected context and rejects stale or cancelled writes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'trajectory-context-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const snapshot={workspace:'/fixture',capturedAt:100,dshVersion:'fixture',presets:[
    {id:'standard',instructions:[
      {name:'AGENTS.md',path:'/fixture/AGENTS.md',tokens:42,body:'Selected project instructions with a shared sixty-four character rule block that repeats across files for testing.'},
      {name:'CLAUDE.md',path:'/fixture/CLAUDE.md',tokens:38,body:'Header line.\nSelected project instructions with a shared sixty-four character rule block that repeats across files for testing.'},
    ],
      tools:[{name:'private-tool',description:'Not selected.'}]},
    {id:'other',instructions:[{name:'AGENTS.md',body:'Another preset.'}]},
  ]};
  const overlap=contextOverlap(snapshot,'standard');
  const item=overlap.items.find(row=>row.name==='AGENTS.md');
  const receipt=await prepareContextDiagnosis(snapshot,{preset:'standard',itemIds:[item.id]},root);
  const original=await readFile(receipt.path,'utf8'),saved=JSON.parse(original);
  assert.equal(receipt.count,1);
  assert.equal(receipt.items[0].tokens,42);
  assert.equal(saved.items[0].text,'Selected project instructions with a shared sixty-four character rule block that repeats across files for testing.');
  assert.equal(saved.preset,'standard');
  assert.equal(saved.runtimeObserved,false);
  assert.equal(saved.capturedAt,100);
  assert.ok(!original.includes('Not selected.')&&!original.includes('Another preset.'));
  const both=await prepareContextDiagnosis(snapshot,{preset:'standard',itemIds:overlap.items.map(i=>i.id)},root);
  assert.equal(both.pairs,1);
  assert.equal(both.pairSummaries.length,1);
  assert.equal(both.pairSummaries[0].matches[0].leftLines,'L1');
  assert.equal(both.pairSummaries[0].matches[0].rightLines,'L2');
  snapshot.presets[0].instructions[0].body='Changed after preparation.';
  assert.equal(await readFile(receipt.path,'utf8'),original);
  for(const selection of [[],['missing']]){
    await assert.rejects(prepareContextDiagnosis(snapshot,{preset:'standard',itemIds:selection},root),/加载项已变化/);
  }
  await assert.rejects(prepareContextDiagnosis(snapshot,{preset:'standard'},root,AbortSignal.abort()),{name:'AbortError'});
  assert.deepEqual((await readdir(root)).sort(),[receipt.id+'.json',both.id+'.json'].sort());
});
