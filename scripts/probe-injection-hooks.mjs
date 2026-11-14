// Read-only mechanism probe: real installed plugins, isolated Cordis context,
// controlled service inputs, no agent loop or model calls.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadManagementSdk} from './dsh-management-config.mjs';
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const api=await loadManagementSdk(),load=async name=>import(pathToFileURL(api.sdk.resolve(name)).href);
const originalClosureRoot=process.env.DSH_CLOSURE_STATE_REPO;
const [{Context},{SystemPrompt},clockPlugin,devPlugin]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-system-prompt'),load('@deepseek-ai/dsh-time-context'),load('@deepseek-ai/dsh-harness-dev-context')]);
const root=new Context(),projections=new Map(),hooks=[],lateHooks=[],tools=[];
const tracked=new Set(['agent/pre-step','agent/turn-stopping','tools/result']);
const observer=target=>function(event){if(tracked.has(event))target.push({event,owner:this.fiber.runtime?.name??null});};
root.on('internal/listener',observer(hooks),{global:true});
const report={dshVersion:JSON.parse(readFileSync(api.anchor,'utf8')).version,mode:'isolated-native-plugins',modelCalls:0,realSessionWrites:0};
try{
  await root.plugin({name:'probe-inputs',apply(ctx){
    ctx.provide('agents',{});ctx.provide('webApp',{getAdvertisedUrl:()=> 'http://127.0.0.1:0/probe'});
    ctx.provide('tools',{register:row=>{tools.push(row.name);return ()=>{};}});
    ctx.provide('sessionProjections',{register:async definition=>{
      const entry={definition,state:definition.init({cwd:process.cwd()})};projections.set(definition.key,entry);
      return {stateOf:()=>entry.state};
    }});
  }});
  await root.plugin(SystemPrompt,{includeHarnessIdentity:false});
  const dev=await root.plugin(devPlugin);
  const assembled=await root.get('systemPrompt').assemble();
  report.prompt={sections:assembled.sections.filter(row=>row.text).map(row=>({name:row.name,chars:row.text.length})),contexts:assembled.contexts.map(row=>({name:row.name,chars:row.text.length})),evidence:'assembled-with-controlled-web-url'};
  const clock=await root.plugin(clockPlugin,{timeZone:'Asia/Shanghai',refreshIntervalMs:600000});
  const closurePath=option('--closure-state');let closure;
  if(closurePath){
    if(process.argv.includes('--controlled-closure')){
      const fixture=resolve('.dsh/injection-hook-probe/closure-fixture');mkdirSync(join(fixture,'core/db'),{recursive:true});
      const facts={certificates:[{id:'probe-certificate',targets:{'instance:probe-world':{state:'stale',current:'new-revision',recorded:'old-revision'}}}]};
      writeFileSync(join(fixture,'core/db/blocked.py'),'print('+JSON.stringify(JSON.stringify(facts))+')\n');
      process.env.DSH_CLOSURE_STATE_REPO=fixture;
    }
    const file=resolve(closurePath),text=readFileSync(file,'utf8');
    report.closureSource={file,sha256:createHash('sha256').update(text).digest('hex')};
    closure=await root.plugin(await import(pathToFileURL(file).href));
  }
  root.on('internal/listener',observer(lateHooks),{global:true});
  const session={},agent={session},signal=new AbortController().signal;
  const feed=event=>{for(const p of projections.values())p.state=p.definition.apply(p.state,event);};
  feed({type:'turn/start',time:Date.now(),data:{turn:1}});
  const run=step=>root.waterfall('agent/pre-step',{agent,turn:1,step,signal,messages:[]},async()=>({kind:'enter',messages:[]}));
  const started=performance.now(),first=await run(1);
  const messages=first.messages.map(m=>({kind:m.source?.kind,chars:(m.content??[]).reduce((n,b)=>n+(b.text?.length??0),0)}));
  for(const message of first.messages)feed({type:'user/message',time:Date.now(),data:message});
  const second=await run(2);
  report.steps={first:messages,immediateNext:second.messages.map(m=>m.source?.kind),milliseconds:Math.round((performance.now()-started)*100)/100,evidence:'pre-step-returned-not-request-sent'};
  if(closure&&process.argv.includes('--controlled-closure')){
    root.emit('tools/result',{name:'edit',arguments:{file_path:'core/instances/probe-world/probe.txt'}});
    const conditional=await run(3),quiet=await run(4);
    report.controlledClosure={facts:'isolated-stale-certificate',event:'synthetic-edit-metadata-no-user-file-write',messages:conditional.messages.map(m=>({kind:m.source?.kind,chars:m.content.reduce((n,b)=>n+(b.text?.length??0),0)})),nextMessages:quiet.messages.length};
  }
  await closure?.dispose();await clock.dispose();await dev.dispose();
  report.afterDispose={messages:(await run(3)).messages.length,contexts:(await root.get('systemPrompt').assemble()).contexts.length};
  report.hooks=hooks;report.lateObserver=lateHooks;report.tools=tools;
  const file=resolve(option('--out','.dsh/injection-hook-probe/report.json'));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,closureSource:report.closureSource?{sha256:report.closureSource.sha256}:undefined,output:file}));
}finally{await root.fiber.dispose();if(originalClosureRoot===undefined)delete process.env.DSH_CLOSURE_STATE_REPO;else process.env.DSH_CLOSURE_STATE_REPO=originalClosureRoot;}
