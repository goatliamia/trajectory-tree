import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import { DshManagement } from './dsh-management.mjs';
import { loadManagementSdk, readComposition, allEntries, textFile } from './dsh-management-config.mjs';
import { managementHttp } from './dsh-management-http.mjs';
import { assessTeardown } from '../lib/lifecycle-observation.mjs';

test('native configuration, reversible Skill policy and stale confirmation',async t=>{
  const api=await loadManagementSdk();
  await mkdir('.dsh/management-tests',{recursive:true});
  const root=await mkdtemp(resolve('.dsh/management-tests/fixture-')),home=join(root,'home'),workspace=join(root,'project'),profileRoot=join(home,'profiles','web'),bundle=join(profileRoot,'node_modules','fixture-bundle');
  await mkdir(bundle,{recursive:true});await mkdir(join(workspace,'.git'),{recursive:true});
  const manifest={name:'management-fixture',private:true,dependencies:{'fixture-bundle':'1.0.0'},dsh:{profile:{bundles:['fixture-bundle']}}};
  await writeFile(join(profileRoot,'package.json'),JSON.stringify(manifest));
  await writeFile(join(bundle,'package.json'),JSON.stringify({name:'fixture-bundle',version:'1.0.0',type:'module',main:'index.js',dsh:{bundle:{patch:'cordis.patch.yml'}}}));
  await writeFile(join(bundle,'index.js'),`throw Error('management must not execute plugin code');\nexport function apply(ctx){ctx.tools.register({name:'fixture_a',description:'a'});ctx.tools.register({name:'fixture_b',description:'b'});}`);
  const preset=id=>({id:'preset-'+id,name:'@deepseek-ai/dsh-agent-preset',config:{id,plugins:[{id:'files',name:'@deepseek-ai/dsh-tool-fs',config:{read:true,write:true,description:{__jsExpr:'process.platform'}}},{id:'fixture',name:'fixture-bundle'},{id:'skills',name:'@deepseek-ai/dsh-skill-filesystem',config:{includeDefaultRoots:true}}]}});
  const patch={insert:[preset('standard'),preset('ptc')]};
  await writeFile(join(bundle,'cordis.patch.yml'),api.yaml.stringify([patch]));
  await writeFile(join(profileRoot,'cordis.patch.yml'),'# preserve this comment\n[]\n');
  const policyPackage=join(profileRoot,'node_modules','dsh-analysis-view');await mkdir(policyPackage,{recursive:true});
  await writeFile(join(policyPackage,'package.json'),JSON.stringify({name:'dsh-analysis-view',type:'module',exports:{'./skill-policy':'./skill-policy.js'}}));
  await writeFile(join(policyPackage,'skill-policy.js'),await readFile('plugin/analysis-view/lib/skill-policy.js','utf8'));
  const skillDir=join(workspace,'.dsh','skills','mine'),bundled=join(root,'bundled','built-in');
  await mkdir(skillDir,{recursive:true});await mkdir(bundled,{recursive:true});
  const source='---\nname: mine\ndescription: A fixture skill.\n# retain metadata comments\nuser-invocable: true\n---\n\nFixture body.\n';
  const builtin='---\nname: built-in\ndescription: A bundled fixture.\n---\n\nOriginal installed body.\n';
  await writeFile(join(skillDir,'SKILL.md'),source);await writeFile(join(bundled,'SKILL.md'),builtin);
  const {FileSystemSkillProvider}=await import(pathToFileURL(api.sdk.resolve('@deepseek-ai/dsh-skill-filesystem')).href);
  async function readSnapshot(){
    const provider=new FileSystemSkillProvider({get:()=>undefined,logger:{warn:()=>{}}},{signal:new AbortController().signal,invalidate:()=>{}},{dshHome:home,agentsHome:join(root,'agents'),watch:false,customSkillDirs:[join(root,'bundled')]});
    try{
      const result=await provider.list({cwd:workspace}),list=Array.isArray(result)?result:result.candidates,winners=new Map();
      for(const c of [...list].sort((a,b)=>a.rank-b.rank))if(!winners.has(c.name))winners.set(c.name,c);
      const skills=[],disabledSkills=[];
      for(const c of winners.values()){const loaded=await provider.get(c,{cwd:workspace});if(!loaded)continue;(c.invocation?.modelInvocable===false?disabledSkills:skills).push({...c,path:loaded.path,package:c.source==='custom'?'fixture-skill-bundle':null});}
      return {presets:['standard','ptc'].map(id=>({id,skills,disabledSkills}))};
    }finally{await provider.dispose();}
  }
  const service=new DshManagement({home,profileRoot,workspace,storage:join(root,'audit'),readSnapshot,api});
  const pick=async(kind,name)=>(await service.list('standard')).targets.find(r=>r.kind===kind&&(r.name===name||r.source===name));
  const plan=async(kind,name,enabled)=>service.preview({preset:'standard',id:(await pick(kind,name)).id,enabled});
  const flip=async(kind,name,enabled)=>service.commit((await plan(kind,name,enabled)).token);
  await t.test('preview is read-only; changes only the requested preset and preserves expressions',async()=>{
    const before=await textFile(join(profileRoot,'cordis.patch.yml'));const p=await plan('tool','read',false);
    assert.match(p.notice,/缓存/);assert.equal(await textFile(join(profileRoot,'cordis.patch.yml')),before);
    const receipt=await service.commit(p.token);assert.equal(receipt.configurationVerified,true);assert.equal(receipt.runtime,'not-observed');assert.equal(receipt.cleanup,'unknown');
    const config=await readComposition(api,{home,profileRoot});
    assert.equal(allEntries(config.entries).find(r=>r.config?.id==='standard').config.plugins[0].config.read,false);
    assert.equal(allEntries(config.entries).find(r=>r.config?.id==='ptc').config.plugins[0].config.read,true);
    assert.deepEqual(allEntries(config.entries).find(r=>r.config?.id==='standard').config.plugins[0].config.description,{__jsExpr:'process.platform'});
    assert.match(await textFile(config.patchFile),/preserve this comment/);
    await assert.rejects(service.commit(p.token),/失效/);await flip('tool','read',true);
    assert.equal((await pick('tool','read')).enabled,true);
  });
  await t.test('provider-level switches expose collateral tools and can be restored',async()=>{
    const p=await plan('tool','fixture_a',false);assert.deepEqual(p.target.affected,['fixture_a','fixture_b']);
    await service.commit(p.token);assert.equal((await pick('tool','fixture_b')).enabled,false);
    await flip('tool','fixture_b',true);assert.equal((await pick('tool','fixture_a')).enabled,true);
  });
  await t.test('refuses a changed config instead of overwriting it',async()=>{
    const p=await plan('tool','read',false),file=join(profileRoot,'cordis.patch.yml');await writeFile(file,(await textFile(file))+'\n# concurrent writer\n');
    await assert.rejects(service.commit(p.token),/配置已变化/);assert.equal((await pick('tool','read')).enabled,true);
  });
  await t.test('identical higher-priority config still blocks an ineffective edit',async()=>{
    const config=await readComposition(api,{home,profileRoot}),row=allEntries(config.entries).find(r=>r.config?.id==='standard');
    await writeFile(join(home,'cordis.patch.yml'),api.yaml.stringify([{id:row.id,config:row.config}]));
    await assert.rejects(plan('tool','read',false),/更高优先级/);
    await writeFile(join(home,'cordis.patch.yml'),'[]\n');
  });
  await t.test('Skill policy disables only the selected preset and restores by removing its overlay',async()=>{
    await flip('skill','mine',false);
    assert.equal((await pick('skill','mine')).enabled,false);
    assert.equal((await service.list('ptc')).targets.find(t=>t.kind==='skill'&&t.name==='mine').enabled,true);
    assert.equal(await textFile(join(skillDir,'SKILL.md')),source);
    await flip('skill','mine',true);
    assert.equal((await pick('skill','mine')).enabled,true);
    const config=await readComposition(api,{home,profileRoot});
    assert.equal(allEntries(config.entries).find(r=>r.config?.id==='standard').config.plugins.some(r=>r.name==='dsh-analysis-view/skill-policy'),false);
    assert.equal(await textFile(join(skillDir,'SKILL.md')),source);
  });
  await t.test('bundled Skill uses the same preset policy without creating or modifying Skill files',async()=>{
    await flip('skill','built-in',false);assert.equal(await textFile(join(bundled,'SKILL.md')),builtin);assert.equal((await pick('skill','built-in')).enabled,false);
    assert.equal(await textFile(join(workspace,'.dsh','skills','built-in','SKILL.md')),null);
    const scopes=await service.skillScopes('built-in');assert.equal(scopes.rows.find(r=>r.preset==='standard').enabled,false);assert.equal(scopes.rows.find(r=>r.preset==='ptc').enabled,true);
    await flip('skill','built-in',true);assert.equal((await pick('skill','built-in')).enabled,true);
  });
  await t.test('bundle deselection preserves installed package; official writer re-enables it',async()=>{
    // The fixture supplies presets, so use a second installed bundle for this test.
    const other=join(profileRoot,'node_modules','fixture-extra');await mkdir(other,{recursive:true});
    await writeFile(join(other,'package.json'),JSON.stringify({name:'fixture-extra',version:'1.0.0',main:'index.js',dsh:{bundle:{patch:'cordis.patch.yml'}}}));
    await writeFile(join(other,'index.js'),'export {};');await writeFile(join(other,'cordis.patch.yml'),'[]\n');
    const file=join(profileRoot,'package.json'),m=JSON.parse(await textFile(file));m.dependencies['fixture-extra']='1.0.0';m.dsh.profile.bundles.push('fixture-extra');await writeFile(file,JSON.stringify(m));
    await flip('bundle','fixture-extra',false);await access(join(other,'package.json'));assert.equal((await pick('bundle','fixture-extra')).enabled,false);
    await flip('bundle','fixture-extra',true);assert.equal((await pick('bundle','fixture-extra')).enabled,true);
  });
  await t.test('HTTP mutations require same origin, capability token, preview ticket; no caller file paths',async()=>{
    let calls=0;const fake={list:async()=>({targets:[]}),preview:async()=>({token:'preview'}),commit:async()=>{calls++;return {};}};
    const server=http.createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,'http://localhost')))res.writeHead(404).end();});
    let origin;const handler=managementHttp(fake,{origin:()=>origin});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
    try{
      const read=await fetch(origin+'/api/management/inventory?preset=standard'),data=await read.json();
      const post=headers=>fetch(origin+'/api/management/commit',{method:'POST',headers,body:JSON.stringify({token:'x'})});
      assert.equal((await post({'content-type':'application/json',origin})).status,403);
      assert.equal((await post({'content-type':'application/json',origin:'https://attacker.test','x-trajectory-token':data.token})).status,403);assert.equal(calls,0);
      const denied=await fetch(origin+'/api/management/preview',{method:'POST',headers:{'content-type':'application/json',origin,'x-trajectory-token':data.token},body:JSON.stringify({preset:'standard',id:'a'.repeat(64),enabled:false,file:'outside'})});assert.equal(denied.status,409);
      assert.equal((await post({'content-type':'application/json',origin,'x-trajectory-token':data.token})).status,200);assert.equal(calls,1);
    }finally{await new Promise(r=>server.close(r));}
  });
});

test('cleanup verdict needs independent observation and distinguishes named retained effects',()=>{
  assert.equal(assessTeardown().verdict,'unknown');
  const coverage={complete:true,independent:true,surface:'fixture'};
  assert.equal(assessTeardown({before:[],loaded:['a'],after:[],registered:['a'],withdrawn:['a'],coverage}).verdict,'verified-reversible');
  assert.equal(assessTeardown({before:[],loaded:['a'],after:['a'],registered:['a'],withdrawn:['a'],coverage}).verdict,'unknown');
  assert.equal(assessTeardown({before:[],loaded:['a'],after:['a'],registered:['a'],withdrawn:[],retained:['a'],coverage}).verdict,'declared-irreversible');
  assert.equal(assessTeardown({before:[],loaded:[],after:[],coverage:{...coverage,complete:false}}).verdict,'unknown');
});
