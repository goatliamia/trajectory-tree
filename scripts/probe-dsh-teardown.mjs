// Bounded fixtures only: never loads user plugins, rewrites profiles or scans
// arbitrary processes. The filesystem observer stands outside Cordis effects.
import { readFile, writeFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { loadManagementSdk, hash } from './dsh-management-config.mjs';
import { assessTeardown } from '../lib/lifecycle-observation.mjs';
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const output=resolve(option('--out','.dsh/teardown-review'));
await mkdir(output,{recursive:true});
const api=await loadManagementSdk(),{Context}=await import(pathToFileURL(api.sdk.resolve('@deepseek-ai/cordis')).href);
const version=JSON.parse(await readFile(api.anchor,'utf8')).version;
const rootDir=await mkdtemp(join(output,'fixtures-')),results=[];
for(const mode of ['managed','lying-disposer','outside-write']){
  const dir=join(rootDir,mode);await mkdir(dir);
  const table=new Map(),root=new Context(),reports=[];
  const observer=async()=>[...[...table].map(([k,v])=>`tool:${k}:${v}`),...await Promise.all((await readdir(dir)).map(async name=>`file:${name}:${hash(await readFile(join(dir,name),'utf8'))}`))].sort();
  const before=await observer();
  const fiber=await root.plugin({name:'trajectory-fixture-'+mode,apply(ctx){
    ctx.effect(()=>{
      table.set('fixture','v1');
      return ()=>{reports.push('tool:fixture:v1');if(mode!=='lying-disposer')table.delete('fixture');};
    });
    if(mode==='outside-write')return writeFile(join(dir,'outside.txt'),'fixture residual');
  }});
  const loaded=await observer();let disposalError=null;
  try{await fiber.dispose();}catch(error){disposalError=error.message;}
  const after=await observer();
  const assessment=assessTeardown({before,loaded,after,registered:['tool:fixture:v1'],withdrawn:reports,
    coverage:{complete:true,independent:true,surface:'fixture tool identity + fixture directory file contents'}});
  results.push({mode,before,loaded,after,disposerReturned:disposalError===null,disposalError,assessment});
}
const crRoot=option('--cr-root',process.env.TRAJECTORY_CR_ROOT);let cr={status:'not-configured'};
if(crRoot){
  const program=`import json,sys\nfrom code_relations.change_goals import compare\nrows=json.load(sys.stdin)\nprint(json.dumps([compare(row['mode'], {'surface':{'answers':row['before'],'complete':True}}, {'surface':{'answers':row['after'],'complete':True}}) for row in rows],ensure_ascii=False))`;
  cr=await new Promise((done,reject)=>{const child=execFile('python',['-c',program],{cwd:crRoot,windowsHide:true,timeout:20000,maxBuffer:1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}},(error,stdout)=>error?reject(error):done({status:'observed',provider:'code_relations.change_goals.compare',reports:JSON.parse(stdout)}));child.stdin.end(JSON.stringify(results));});
}
const report={version,fixtureRoot:rootDir,research:'math-to-engineering / reversibility-standalone',results,cr,
  boundary:'Fixtures show whether Cordis verifies arbitrary effects. No conclusion about a particular installed plugin; no production plugin was disabled.'};
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({version,report:join(output,'report.json'),results:results.map(r=>({mode:r.mode,disposerReturned:r.disposerReturned,verdict:r.assessment.verdict,residual:r.after})),cr:cr.reports?.map(r=>({id:r.id,status:r.status}))},null,2));
