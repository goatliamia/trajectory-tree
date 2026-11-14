import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {collectCurrentPreset,collectCurrentWorkspaces} from '../lib/dsh-current-preset.mjs';

test('all-workspace history uses cwd-free configuration and native global Skill winners',async()=>{
  const local=createRequire(import.meta.url);let anchor;
  try{anchor=local.resolve('@deepseek-ai/dsh-config-editor/package.json');}
  catch{anchor=createRequire(local.resolve('@deepseek-ai/dsh/package.json')).resolve('@deepseek-ai/dsh-config-editor/package.json');}
  const sdk=createRequire(anchor),yaml=sdk('yaml');
  await mkdir('.dsh/configuration-tests',{recursive:true});
  const root=await mkdtemp(resolve('.dsh/configuration-tests/scope-')),home=join(root,'home'),profileRoot=join(home,'profiles','web'),project=join(root,'project'),agents=join(root,'agents');
  const bundle=join(profileRoot,'node_modules','fixture-bundle'),explicitRoot=join(project,'explicit-skills');
  for(const path of [bundle,join(project,'.git'),agents])await mkdir(path,{recursive:true});
  await writeFile(join(profileRoot,'package.json'),JSON.stringify({name:'scope-fixture',dsh:{profile:{bundles:['fixture-bundle']}}}));
  await writeFile(join(bundle,'package.json'),JSON.stringify({name:'fixture-bundle',version:'1.0.0',type:'module',main:'index.js',dsh:{bundle:{patch:'cordis.patch.yml'}}}));
  await writeFile(join(bundle,'index.js'),"throw Error('configuration collection must not activate plugins');\nexport function apply(ctx){ctx.tools.register({name:'scope_tool',description:'A static fixture.',parameters:{}});}");
  await writeFile(join(bundle,'cordis.patch.yml'),yaml.stringify([{insert:[{id:'preset-custom',name:'@deepseek-ai/dsh-agent-preset',config:{id:'custom',plugins:[
    {id:'instructions',name:'@deepseek-ai/dsh-agent-instructions',config:{agentsHome:agents}},
    {id:'skills',name:'@deepseek-ai/dsh-skill-filesystem',config:{agentsHome:agents,customSkillDirs:[explicitRoot]}},
    {id:'tools',name:'fixture-bundle'},
  ]}}]}]));
  await writeFile(join(home,'AGENTS.md'),'Shared global instructions.');await writeFile(join(project,'AGENTS.md'),'Project-specific instructions.');
  async function skill(dir,name,body){await mkdir(dir,{recursive:true});await writeFile(join(dir,'SKILL.md'),`---\nname: ${name}\ndescription: ${body}\n---\n\n${body}\n`);}
  await skill(join(home,'skills','shared'),'shared','Global shared guidance');
  await skill(join(project,'.dsh','skills','shared'),'shared','Project override');
  await skill(join(project,'.agents','skills','project-only'),'project-only','Project-only guidance');
  await skill(join(explicitRoot,'explicit'),'explicit','Explicit preset guidance');
  const options={home,profileRoot,anchor},workspaces=[{id:'missing',path:join(root,'not-created')},{id:'project',path:project}];
  const global=await collectCurrentWorkspaces({...options,workspaces}),selected=await collectCurrentPreset({...options,cwd:project});
  const common=global.presets[0],scoped=selected.presets[0];
  assert.equal(global.workspace.id,'all');assert.equal(common.configurationScope,'global');assert.equal(global.workspaces.length,2);
  assert.deepEqual(common.instructions.map(row=>row.path),[join(home,'AGENTS.md')]);
  assert.deepEqual(new Set(common.skills.map(row=>row.name)),new Set(['shared','explicit']));
  assert.match(common.skills.find(row=>row.name==='shared').body,/Global shared guidance/);
  assert.equal(scoped.configurationScope,'workspace');assert.equal(scoped.instructions.length,2);
  assert.match(scoped.skills.find(row=>row.name==='shared').body,/Project override/);
  assert.ok(scoped.skills.some(row=>row.name==='project-only'));
  assert.deepEqual(common.tools.map(row=>row.name),scoped.tools.map(row=>row.name));
  assert.equal(common.statistics.instructions.files,1);assert.ok(common.statistics.total<scoped.statistics.total);
});
