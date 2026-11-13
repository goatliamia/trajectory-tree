import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceForModule} from '../scripts/read-dsh-bundles.mjs';

test('native installation and official catalog flags decide origin, not a package prefix',()=>{
  const bundles=[
    {name:'base',enabled:true,official:false,availability:'installation',rows:[{moduleName:'built-in'}]},
    {name:'optional',enabled:true,official:true,availability:'profile',rows:[{moduleName:'official-extra'}]},
    {name:'@deepseek-ai/custom-name',enabled:true,official:false,availability:'profile',rows:[]},
  ];
  assert.equal(sourceForModule('built-in',bundles).origin,'official');
  assert.equal(sourceForModule('official-extra',bundles).origin,'official');
  assert.equal(sourceForModule('@deepseek-ai/custom-name',bundles).origin,'plugin');
  assert.equal(sourceForModule('unlisted',bundles).origin,'unknown');
});
test('scoped preset tools inherit the native bundle owning that exact preset entry',()=>{
  const bundles=[
    {name:'web',enabled:true,availability:'installation',rows:[{rowId:'standard',moduleName:'@deepseek-ai/dsh-agent-preset'}]},
    {name:'custom-preset',enabled:true,availability:'profile',rows:[{rowId:'mine',moduleName:'@deepseek-ai/dsh-agent-preset'}]},
  ];
  assert.equal(sourceForModule('nested-tool',bundles,'standard').origin,'official');
  assert.equal(sourceForModule('nested-tool',bundles,'mine').origin,'plugin');
  assert.equal(sourceForModule('nested-tool',bundles,'missing').origin,'unknown');
});
