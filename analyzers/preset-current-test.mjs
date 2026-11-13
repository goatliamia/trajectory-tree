import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredEnablement, flattenConfiguredRows, winningSkillCandidates, configuredContribution } from './preset-current.mjs';
import { scanContributions } from '../scripts/preset-source-inventory.mjs';
import { createRequire } from 'node:module';
const local=createRequire(import.meta.url),sdk=createRequire(local.resolve('@deepseek-ai/dsh/package.json')),{parse}=sdk('acorn');

test('current platform is resolved, arbitrary configuration expressions are not executed',()=>{
  assert.equal(configuredEnablement({__jsExpr:"process.platform === 'win32'"},{platform:'win32'}),'disabled');
  assert.equal(configuredEnablement({__jsExpr:"process.platform !== 'win32'"},{platform:'win32'}),'enabled');
  assert.equal(configuredEnablement({__jsExpr:'process.exit(9)'}),'conditional');
});
test('disabled ancestor remains disabled and other presets are not flattened into the selected one',()=>{
  const rows=flattenConfiguredRows([{name:'group',group:true,disabled:true,config:[{name:'child'}]},{name:'@deepseek-ai/dsh-agent-preset',config:{plugins:[{name:'unrelated'}]}}],'host',{});
  assert.equal(rows.length,1);assert.equal(rows[0].status,'disabled');
});
test('current Skill precedence produces one entry and does not resurrect a disabled winning name',()=>{
  const rows=winningSkillCandidates([{name:'a',rank:600},{name:'a',rank:100,path:'project'},{name:'b',rank:100,invocation:{modelInvocable:false}},{name:'b',rank:600}]);
  assert.deepEqual(rows.map(row=>[row.name,row.path]),[['a','project']]);
});
test('current file-tool flags remove disabled declarations and opt-in apply_patch',()=>{
  const row={name:'@deepseek-ai/dsh-tool-fs',status:'enabled',config:{read:false,readImage:true}};
  assert.equal(configuredContribution({kind:'tool',name:'read'},row),false);
  assert.equal(configuredContribution({kind:'section',name:'tool:read'},row),false);
  assert.equal(configuredContribution({kind:'tool',name:'read_image'},row),true);
  assert.equal(configuredContribution({kind:'tool',name:'apply_patch'},row),false);
  const web={name:'@deepseek-ai/dsh-tool-web',status:'enabled',config:{search:false,fetch:true}};
  assert.equal(configuredContribution({kind:'tool',name:'web_search'},web),false);
  assert.equal(configuredContribution({kind:'tool',name:'web_fetch'},web),true);
});
test('non-message source metadata is not a context injection',()=>{
  const code='const metadata = {source:{kind:"provider"}}; createUserMessage({content:[],source:{kind:"actual-context"}});';
  const rows=scanContributions(code,{package:'example'},parse).rows;
  assert.equal(rows.find(row=>row.name==='provider').modelFacing,false);
  assert.equal(rows.find(row=>row.name==='actual-context').modelFacing,true);
});
