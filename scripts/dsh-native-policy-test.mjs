import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { loadManagementSdk } from './dsh-management-config.mjs';
import * as policy from '../plugin/analysis-view/lib/skill-policy.js';

test('native Skill registry scopes, deny overlay and automatic inverse',async()=>{
  const api=await loadManagementSdk(),load=name=>import(pathToFileURL(api.sdk.resolve(name)).href);
  const [{Context},skills,{createScope}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-skill'),load('@deepseek-ai/dsh-scope')]);
  const root=new Context(),registry=await root.plugin(skills.SkillRegistry),keys=[{},{}],scopes=[];
  const scopeOwner=await root.plugin({name:'policy-test-scopes',inject:['skills'],apply(ctx){for(const key of keys)scopes.push(createScope(ctx,key));}});
  const definition={name:'fixture-skill',description:'Native fixture.',content:'Original content',source:'runtime',invocation:{modelInvocable:true,userInvocable:true}};
  for(const scope of scopes)await scope.ctx.plugin({name:'project-fixture',inject:['skills'],apply(ctx){
    ctx.skills.registerProvider(()=>({name:'project-fixture',list:async()=>[{...definition,provider:'project-fixture',rank:100,locator:'fixture'}],get:async()=>({...definition,provider:'project-fixture'})}));
  }});
  const service=root.get('skills');
  assert.equal((await service.get('fixture-skill',{scope:keys[0]})).content,'Original content');
  const layer=await scopes[0].ctx.plugin({...policy,name:'policy-test',apply(ctx,config){policy.apply(ctx,config);return ()=>{};}},{disabled:[{name:'fixture-skill',description:'Native fixture.'}]});
  const disabled=(await service.list({scope:keys[0]})).find(s=>s.name==='fixture-skill');
  assert.equal(skills.isModelInvocable(disabled),false);assert.equal(skills.isUserInvocable(disabled),false);
  assert.equal((await service.get('fixture-skill',{scope:keys[1]})).content,'Original content');
  await layer.dispose();
  const restored=await service.get('fixture-skill',{scope:keys[0]});
  assert.equal(restored.content,'Original content');assert.equal(restored.invocation.modelInvocable,true);
  assert.equal((await service.list({scope:keys[1]})).find(s=>s.name==='fixture-skill').invocation.modelInvocable,true);
  await scopeOwner.dispose();await registry.dispose();
});

test('native tools.register owns its inverse even with an empty plugin disposer',async()=>{
  const api=await loadManagementSdk(),load=name=>import(pathToFileURL(api.sdk.resolve(name)).href);
  const [{Context},{ToolsService}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-tools')]);
  const root=new Context();
  const prompt=await root.plugin({name:'prompt-fixture',apply(ctx){ctx.provide('systemPrompt',{tools(){return ()=>{};}});}});
  const serviceFiber=await root.plugin(ToolsService);
  const fixture=await root.plugin({name:'native-tool-fixture',inject:['tools'],apply(ctx){
    ctx.tools.register({name:'fixture_tool',description:'Native fixture.',parameters:{type:'object',properties:{}},output:{schema:{type:'string'},render:value=>[{type:'text',text:value}]},execute:async()=>''});return ()=>{};
  }});
  assert.ok(root.get('tools').get('fixture_tool'));await fixture.dispose();
  assert.equal(root.get('tools').get('fixture_tool'),undefined);
  await serviceFiber.dispose();await prompt.dispose();
});
