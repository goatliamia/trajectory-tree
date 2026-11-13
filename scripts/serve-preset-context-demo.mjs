import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderEvalDemo } from './render-eval-demo.mjs';
import { diagnosisView, windowView } from '../analyzers/eval-insights.mjs';
import { contextOverlap } from '../analyzers/context-overlap.mjs';
import { skillOverlapExamples } from '../analyzers/skill-overlap-demo.mjs';
import { commandCrOptions } from '../analyzers/cr-pwsh.mjs';
import { toolColorCss } from '../lib/tool-colors.mjs';
import { toolFeedbackCss } from '../lib/tool-feedback.mjs';
import { DshManagement } from './dsh-management.mjs';
import { managementHttp } from './dsh-management-http.mjs';
import {prepareContextDiagnosis} from '../lib/context-diagnosis.mjs';
const root=resolve('.dsh/preset-context-demo'),assets=resolve('docs/demo/preset-context');
const files=new Map([['/',join(root,'index.html')],['/data.json',join(root,'current-data.json')],['/trace.html',join(root,'trace.html')],['/app.js',join(assets,'app.js')],['/style.css',join(assets,'style.css')],['/design/tokens.css',join(root,'tokens.css')],['/design/primitives.css',resolve('design/primitives.css')],['/fonts/Geist-Variable.woff2',resolve('docs/demo/layout-review/fonts/Geist-Variable.woff2')],['/fonts/GeistMono-Variable.woff2',resolve('docs/demo/layout-review/fonts/GeistMono-Variable.woff2')]]);
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'};
files.set('/tool-colors.js',resolve('lib/tool-colors.mjs'));
files.set('/tool-feedback.js',resolve('lib/tool-feedback.mjs'));
files.set('/action-path.html',resolve('.dsh/layout-review/geist.html'));
for(const name of ['variants.js','variants.css','controller.js','skill-manager.js','skill-manager.css','eval-shell.css','eval-views.js','eval-redesign.css','eval-visuals.css','skill-visuals.js','diagnosis-designs.js','diagnosis-review.js','overlap-preview.js'])files.set('/'+name,join(assets,name));
let evalCache;
let overlapCache;
for(const name of ['context-overlap.js','context-overlap.css','home-overview.js','home-overview.css'])files.set('/'+name,join(assets,name));
files.set('/workspace-api.js',join(assets,'workspace-api.js'));
async function overlapData(preset){
  const file=join(root,'current-data.json'),info=await stat(file);
  if(overlapCache?.mtime!==info.mtimeMs)overlapCache={mtime:info.mtimeMs,data:JSON.parse(await readFile(file,'utf8')),presets:new Map()};
  if(!overlapCache.presets.has(preset))overlapCache.presets.set(preset,contextOverlap(overlapCache.data,preset));
  return overlapCache.presets.get(preset);
}
for(const name of ['capability-management.js','capability-management.css'])files.set('/'+name,join(assets,name));
async function evalData(){const file=join(root,'eval-data.json'),info=await stat(file);if(evalCache?.mtime!==info.mtimeMs)evalCache={mtime:info.mtimeMs,data:JSON.parse(await readFile(file,'utf8'))};return evalCache.data;}
const run=promisify(execFile),refreshes=new Map();let refreshQueue=Promise.resolve();
const cr=commandCrOptions(process.argv.slice(3));
function refresh(kind){
  if(refreshes.has(kind))return refreshes.get(kind);
  const task=refreshQueue.catch(()=>{}).then(async()=>{
    const options={cwd:process.cwd(),windowsHide:true,timeout:120000,maxBuffer:1024*1024};
    if(kind==='usage'){
      await run(process.execPath,[resolve('scripts/build-preset-context-demo.mjs'),'--history','--skip-trace'],options);
      await run(process.execPath,[resolve('scripts/build-eval-overview-demo.mjs'),...(cr.root?['--cr-root',cr.root]:[]),...(cr.pwsh?['--pwsh',cr.pwsh]:[])],options);
    }
    await run(process.execPath,[resolve('scripts/build-current-preset-demo.mjs')],options);
  }).finally(()=>refreshes.delete(kind));
  refreshQueue=task;refreshes.set(kind,task);return task;
}
const management=new DshManagement({readSnapshot:async()=>JSON.parse(await readFile(join(root,'current-data.json'),'utf8'))});
const manage=managementHttp(management,{origin:()=>`http://127.0.0.1:${server.address().port}`,onSaved:()=>refresh('config')});
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  if(await manage(req,res,url))return;
  if(path==='/api/diagnosis-context'&&req.method==='POST'){
    const origin='http://127.0.0.1:'+server.address().port;
    if(req.headers.origin!==origin||req.headers['content-type']!=='application/json'){res.writeHead(403).end();return;}
    try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536)throw Error('选区过大');chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8')),snapshot=JSON.parse(await readFile(join(root,'current-data.json'),'utf8'));
      const result=await prepareContextDiagnosis(snapshot,input,join(root,'diagnosis'));
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(result));
    }catch{res.writeHead(409,{'content-type':'application/json; charset=utf-8'}).end(JSON.stringify({error:'选区已变化，请重新读取后准备诊断'}));}return;
  }
  if(path==='/api/context-overlap'&&req.method==='GET'){
    try{const data=await overlapData(url.searchParams.get('preset'));
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(data));
    }catch{res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Current context snapshot unavailable'}));}return;
  }
  if(path==='/tool-feedback.css'&&req.method==='GET'){res.writeHead(200,{'content-type':'text/css','cache-control':'no-store'}).end(toolFeedbackCss());return;}
  if(path==='/tool-colors.css'&&req.method==='GET'){res.writeHead(200,{'content-type':'text/css','cache-control':'no-store'}).end(toolColorCss());return;}
  if(path==='/api/overlap-examples'&&req.method==='GET'){
    res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(skillOverlapExamples()));return;
  }
  if(path==='/api/eval-view'&&req.method==='GET'){
    try{const data=await evalData(),options=Object.fromEntries(url.searchParams),view=options.view==='diagnosis'?diagnosisView(data,options):windowView(data,options);
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(view));
    }catch(error){res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Eval snapshot unavailable'}));}return;
  }
  if(path==='/eval-retained.html'&&req.method==='GET'){
    try{const data=JSON.parse(await readFile(join(root,'eval-data.json'),'utf8'));
      const body=renderEvalDemo(data,{preset:url.searchParams.get('preset'),view:url.searchParams.get('view')});
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}).end(body);
    }catch{res.writeHead(503,{'content-type':'text/html; charset=utf-8'}).end('<p>尚无可读的 Eval 快照，请使用页面顶部的「刷新使用记录」。</p>');}return;
  }
  if(['/api/refresh','/api/refresh-usage'].includes(path)&&req.method==='POST'){
    const origin='http://127.0.0.1:'+server.address().port;
    if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403).end();return;}
    try{await refresh(path==='/api/refresh-usage'?'usage':'config');res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end('{"ok":true}');}catch{res.writeHead(500).end('Current configuration refresh failed');}return;
  }
  const file=files.get(path);if(!file||req.method!=='GET'){res.writeHead(404).end();return;}
  try{const body=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'}).end(body);}catch{res.writeHead(404).end('Local preview file unavailable');}
});
server.listen(Number(process.argv[2]||0),'127.0.0.1',()=>console.log('Preset context demo: http://127.0.0.1:'+server.address().port+'/'));
