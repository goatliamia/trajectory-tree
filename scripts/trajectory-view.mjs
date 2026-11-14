#!/usr/bin/env node
import {generateTraceView} from '../view/generate.mjs';
import {generateOverviewView} from '../view/overview.mjs';
import {generateCommandView} from '../view/commands.mjs';
import {commandCrOptions} from '../analyzers/cr-pwsh.mjs';
import {serveViewFile,startViewServer,openViewBrowser} from '../view/serve.mjs';
const args=process.argv.slice(2);
const options=key=>args.flatMap((arg,index)=>{
 if(arg!==key)return [];
 const value=args[index+1];if(!value||value.startsWith('--'))throw Error('Missing value for '+key);
 return [value];
});
const option=key=>options(key)[0];
let previewServer;
if(args.includes('--help'))console.log('trajectory-view --host pi|codex|claude [--eval | --overview | --code | --commands] [--file native-session|snapshot] [--thread ID] [--dir session-directory] [--project cwd] [--limit 20] [--leaf ID] [--capture file] [--api-only] [--lang en|zh-CN|auto] [--out view.html] [--serve] [--open] [--keep-alive]\n--keep-alive keeps the preview server in this process for managed terminal sessions.\n--code opens the code execution section of the same session Eval.\nOverview accepts repeated --file or --thread arguments. Codex defaults to the current project; Pi and Claude require a directory or files.\nCommand diagnosis uses --host codex [--cr-root PATH] [--pwsh PATH] [--seq N ...] [--cut N].');
else try{
 const keepAlive=args.includes('--keep-alive');
 if(keepAlive&&!args.includes('--serve')&&!args.includes('--open'))throw Error('--keep-alive requires --serve or --open');
 const common={host:option('--host'),rollout:option('--rollout'),apiOnly:args.includes('--api-only'),output:option('--out'),locale:option('--lang'),synthetic:args.includes('--synthetic')};
 const modes=['--eval','--overview','--code','--commands'].filter(flag=>args.includes(flag));
 if(modes.length>1)throw Error('Choose one of --eval, --overview, --code or --commands');
 const selected={...common,file:option('--file'),thread:option('--thread')};
 let view;
 if(modes[0]==='--overview')view=await generateOverviewView({...common,files:options('--file'),threads:options('--thread'),directory:option('--dir'),project:option('--project'),limit:Number(option('--limit')??20)});
 else if(modes[0]==='--commands')view=await generateCommandView({...selected,seqs:options('--seq').map(Number),cut:option('--cut')===undefined?undefined:Number(option('--cut')),cr:commandCrOptions(args)});
 else view=await generateTraceView({...selected,leafId:option('--leaf'),captureFile:option('--capture'),
   ...(['--eval','--code'].includes(modes[0])?{initialView:modes[0]==='--code'?'code':'eval',cr:commandCrOptions(args)}:{initialView:'trace'})});
 if(args.includes('--serve')||args.includes('--open')){
  if(keepAlive){
   previewServer=await startViewServer(view.output);
   for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>previewServer.close());
   Object.assign(view,{url:previewServer.url,serving:'foreground'});
  }else Object.assign(view,await serveViewFile(view.output));
 }
 if(args.includes('--open'))await openViewBrowser(view.url);
 console.log(JSON.stringify({ok:true,...view}));
}catch(error){previewServer?.close();console.log(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
