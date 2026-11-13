// Read-only replay of local records through the production workspace service.
// Cache writes stay under --out. This does not boot plugins or execute commands.
import http from 'node:http';
import {readFileSync,existsSync,mkdirSync,statSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {decodeZstdSession} from '../experiments/corpus/decode-session.mjs';
import {OverviewService} from '../plugin/analysis-view/lib/eval/overview/service.mjs';
import {EvalWorkspaceService,WORKSPACE_PATH} from '../plugin/analysis-view/lib/eval/workspace-service.mjs';
import {TraceQueue} from '../plugin/analysis-view/lib/trace-resources.js';
import {restoreOverviewModels} from '../plugin/analysis-view/lib/eval/overview/persisted-cache.mjs';
import {commandCrOptions} from '../analyzers/cr-pwsh.mjs';
const arg=(name,fallback)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1];};
const root=resolve(arg('--out','.dsh/release-review/native')),home=resolve(arg('--home',join(homedir(),'.dsh')));
const history=JSON.parse(readFileSync(resolve(arg('--history','.dsh/preset-context-demo/data.json')),'utf8'));
const rows=new Map(history.sessions.filter(s=>existsSync(s.file)).map(s=>[s.id,s]));
const workspaces=new Map();
for(const row of rows.values()){
  if(!workspaces.has(row.project))workspaces.set(row.project,{id:row.project,path:row.cwd,title:row.projectName,sessionIds:[]});
  workspaces.get(row.project).sessionIds.push(row.id);
}
const local=createRequire(import.meta.url),profile={name:'web',home,dir:join(home,'profiles/web'),cwd:process.cwd(),installAnchor:local.resolve('@deepseek-ai/dsh/package.json'),overlays:[]};
let reads=0;
const revision=id=>{const row=rows.get(id),s=statSync(row.file);return JSON.stringify([row.file,s.size,s.mtimeMs]);};
const services={profileContext:profile,workspaceRegistry:{list:()=>[...workspaces.values()],archivedSessionIds:[]},sessionPersistence:{stat:async id=>({revision:revision(id)})}};
const ctx={get:key=>services[key]};
const observe=async(id,signal)=>{
  signal.throwIfAborted();reads++;
  const source=revision(id),raw=decodeZstdSession(readFileSync(rows.get(id).file)).toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const header=raw.find(r=>r.type==='session'),events=raw.filter(r=>Number.isSafeInteger(r.seq)).sort((a,b)=>a.seq-b.seq);
  return {header,events,source:'persisted',revision:source,inheritedEventCount:header.inheritedEventCount??(header.isSeeded?(events.find(e=>e.type==='session/end-seed')?.seq??Infinity)+1:0)};
};
function create(){
  const queue=new TraceQueue(1),overview=new OverviewService(ctx,{observe,dispose:()=>{},queue,timeout:(run,_ms,signal)=>run(signal)});
  const workspace=new EvalWorkspaceService(ctx,overview,{cr:commandCrOptions(process.argv.slice(2)),cacheRoot:root});
  return {overview,workspace,dispose(){workspace.dispose();overview.dispose();queue.dispose();}};
}
mkdirSync(root,{recursive:true});
if(process.argv.includes('--benchmark-config')){
  const samples=[];
  for(const phase of ['cold','restarted']){
    const service=create(),start=performance.now(),data=await service.workspace.current();
    samples.push({phase,milliseconds:Math.round(performance.now()-start),configurationChecking:data.progress.configurationChecking,presets:data.presets.length});
    await Promise.allSettled([...service.workspace.pending.values()]);service.dispose();console.log(JSON.stringify(samples.at(-1)));
  }
  writeFileSync(join(root,'configuration-benchmark.json'),JSON.stringify(samples,null,2));
}else if(process.argv.includes('--benchmark')){
  const samples=[];let expected;
  for(const phase of ['cold','restarted']){
    const service=create(),start=performance.now(),before=reads,scope=service.overview.scope();
    scope.sessions=scope.sessions.slice(0,Number(arg('--limit',20)));
    const output=await Array.fromAsync(service.overview.stream(scope,new AbortController().signal));
    const catalog=output.at(-1).models;
    const facts=JSON.stringify(output.filter(x=>x.session).map(x=>restoreOverviewModels(x.session,catalog,{index:route=>JSON.stringify(route)})).sort((a,b)=>a.id.localeCompare(b.id)));
    samples.push({phase,sessions:scope.sessions.length,rawReads:reads-before,milliseconds:Math.round(performance.now()-start),sameResults:expected==null||facts===expected,unread:output.at(-1).unread});
    expected=facts;service.dispose();console.log(JSON.stringify(samples.at(-1)));
  }
  writeFileSync(join(root,'benchmark.json'),JSON.stringify(samples,null,2));
}else{
  const service=create(),secret=randomBytes(24).toString('hex');
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.searchParams.get('reviewToken')===secret){res.writeHead(302,{'set-cookie':`trajectory-review=${secret}; Path=/; HttpOnly; SameSite=Strict`,'location':'/analysis-view/overview'}).end();return;}
    if(!req.headers.cookie?.split('; ').includes('trajectory-review='+secret)){res.writeHead(401).end();return;}
    try{
      if(url.pathname==='/analysis-view/overview'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(service.workspace.page());return;}
      // Review server never changes the user's capability configuration.
      if(url.pathname.includes('/api/management/')&&req.method!=='GET'){res.writeHead(403).end();return;}
      if(url.pathname.startsWith(WORKSPACE_PATH+'/')){await service.workspace.handle(req,res,url,{signal:service.workspace.controller.signal,origin:'http://'+req.headers.host});return;}
      res.writeHead(404).end();
    }catch(error){console.error(error.stack);if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}
  });
  server.listen(0,'127.0.0.1',()=>console.log('Native Eval review: http://127.0.0.1:'+server.address().port+'/?reviewToken='+secret));
  process.on('SIGINT',()=>{service.dispose();server.close();});
}
