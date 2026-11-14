import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {editNativeConfig} from '../plugin/analysis-view/lib/eval/native-config-edit.mjs';

test('official ConfigEditor preserves other expressions, applies through Loader and rolls back failed application',async t=>{
  const local=createRequire(import.meta.url);let anchor;
  try{anchor=local.resolve('@deepseek-ai/dsh-config-editor/package.json');}
  catch{anchor=createRequire(local.resolve('@deepseek-ai/dsh/package.json')).resolve('@deepseek-ai/dsh-config-editor/package.json');}
  const sdk=createRequire(anchor);
  const api={anchor,sdk,yaml:sdk('yaml'),boot:await import(pathToFileURL(sdk.resolve('@deepseek-ai/dsh-app-boot')).href)};
  const {ConfigEditor}=await import(pathToFileURL(api.sdk.resolve('@deepseek-ai/dsh-config-editor')).href);
  await mkdir('.dsh/native-config-tests',{recursive:true});
  const dir=await mkdtemp(resolve('.dsh/native-config-tests/profile-')),bundle=join(dir,'node_modules','fixture');await mkdir(bundle,{recursive:true});
  const module=join(bundle,'index.mjs');
  await writeFile(module,'export function apply(ctx,config){if(config.fail)throw Error("fixture rejected application");}\n');
  await writeFile(join(bundle,'package.json'),JSON.stringify({name:'fixture',version:'1.0.0',type:'module',main:'index.mjs',dsh:{bundle:{patch:'cordis.patch.yml'}}}));
  await writeFile(join(bundle,'cordis.patch.yml'),api.yaml.stringify([{insert:[{id:'first',name:pathToFileURL(module).href,config:{value:1}},{id:'second',name:pathToFileURL(module).href,config:{value:2}}]}]));
  await writeFile(join(dir,'package.json'),JSON.stringify({name:'fixture-profile',private:true,dsh:{profile:{bundles:['fixture']}}}));
  const base=join(dir,'cordis.yml'),patchPath=join(dir,'cordis.patch.yml');await writeFile(base,'[]\n');
  await writeFile(patchPath,'# untouched expression\n- id: first\n  config:\n    value: !!js "process.platform"\n');
  const profile={dir,home:join(dir,'home'),name:'fixture',patchPath,overlays:[],installAnchor:api.anchor};
  const ctx=await api.boot.boot('fixture',base,api.boot.readProfilePatches('fixture',profile),async ctx=>{ctx.provide('profileContext',profile);await ctx.plugin(ConfigEditor);},pathToFileURL(api.anchor).href);
  t.after(()=>ctx.fiber.dispose());
  const editor=ctx.get('configEditor'),entry=()=>editor.entries().find(e=>e.options.id==='second');
  for(const value of [3,4]){
    const before=await readFile(patchPath,'utf8'),currentConfig=structuredClone(entry().options.config);
    await editNativeConfig(ctx,{before,currentConfig,patch:{id:'second',name:pathToFileURL(module).href,config:{value}}});
    assert.equal(entry().options.config.value,value);
    const after=await readFile(patchPath,'utf8');assert.match(after,/# untouched expression/);assert.doesNotMatch(after,/\[object Object\]/);
    assert.equal(api.boot.loadOverlayPatches('fixture',patchPath).find(p=>p.id==='first').config.value.__jsExpr,'process.platform');
  }
  const before=await readFile(patchPath,'utf8'),currentConfig=structuredClone(entry().options.config);
  await assert.rejects(editNativeConfig(ctx,{before,currentConfig,patch:{id:'second',name:pathToFileURL(module).href,config:{fail:true}}}));
  assert.equal(await readFile(patchPath,'utf8'),before,'official editor restores the previous document');
  assert.equal(entry().options.config.value,4,'Loader restores the previous configuration');
  await assert.rejects(editNativeConfig(ctx,{before:before+'# changed',currentConfig,patch:{id:'second',name:pathToFileURL(module).href,config:{value:5}}}),/配置已变化/);
  assert.equal(await readFile(patchPath,'utf8'),before);
});
