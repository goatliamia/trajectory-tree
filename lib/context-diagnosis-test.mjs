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
    {id:'standard',instructions:[{name:'AGENTS.md',path:'/fixture/AGENTS.md',body:'Selected project instructions.'}],
      tools:[{name:'private-tool',description:'Not selected.'}]},
    {id:'other',instructions:[{name:'AGENTS.md',body:'Another preset.'}]},
  ]};
  const item=contextOverlap(snapshot,'standard').items.find(row=>row.kind==='instructions');
  const receipt=await prepareContextDiagnosis(snapshot,{preset:'standard',itemIds:[item.id]},root);
  const original=await readFile(receipt.path,'utf8'),saved=JSON.parse(original);
  assert.equal(receipt.count,1);
  assert.equal(saved.items[0].text,'Selected project instructions.');
  assert.equal(saved.preset,'standard');
  assert.equal(saved.runtimeObserved,false);
  assert.equal(saved.capturedAt,100);
  assert.ok(!original.includes('Not selected.')&&!original.includes('Another preset.'));
  snapshot.presets[0].instructions[0].body='Changed after preparation.';
  assert.equal(await readFile(receipt.path,'utf8'),original);
  for(const selection of [[],['missing']]){
    await assert.rejects(prepareContextDiagnosis(snapshot,{preset:'standard',itemIds:selection},root),/加载项已变化/);
  }
  await assert.rejects(prepareContextDiagnosis(snapshot,{preset:'standard'},root,AbortSignal.abort()),{name:'AbortError'});
  assert.deepEqual(await readdir(root),[receipt.id+'.json']);
});
