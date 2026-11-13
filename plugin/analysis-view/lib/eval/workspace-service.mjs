import {readFileSync,readdirSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {OverviewDiskCache} from './overview/persisted-cache.mjs';
import {enrichFindingPowerShell} from './pwsh-evidence.mjs';
import {collectCurrentPreset} from './workspace/runtime/lib/dsh-current-preset.mjs';
import {projectPresetContext} from './workspace/runtime/analyzers/preset-context.mjs';
import {currentUsageStatistics} from './workspace/runtime/analyzers/preset-statistics.mjs';
import {contextOverlap} from './workspace/runtime/analyzers/context-overlap.mjs';
import {diagnosisView,windowView} from './workspace/runtime/analyzers/eval-insights.mjs';
import {skillOverlapExamples} from './workspace/runtime/analyzers/skill-overlap-demo.mjs';
import {DshManagement} from './workspace/runtime/scripts/dsh-management.mjs';
import {loadManagementSdk} from './workspace/runtime/scripts/dsh-management-config.mjs';
import {managementHttp} from './workspace/runtime/scripts/dsh-management-http.mjs';
import {prepareContextDiagnosis} from './workspace/runtime/lib/context-diagnosis.mjs';

export const WORKSPACE_PATH='/analysis-view/workspace';
const uiRoot=fileURLToPath(new URL('./workspace/ui/',import.meta.url));
const mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.woff2':'font/woff2'};
const hash=value=>createHash('sha256').update(value).digest('hex');
const safeJson=value=>JSON.stringify(value).replaceAll('<','\\u003c');
const HISTORY_BYTES=64*1024*1024,HISTORY_SESSIONS=1024;

// Changes to the actual projector graph invalidate derived summaries. UI-only
// edits do not discard history; the shipped SDK version remains part of the key.
export function overviewProjectionVersion(profile){
  const seen=new Set(),parts=['overview-summary/3',readFileSync(profile.installAnchor,'utf8')];
  function visit(file){
    if(seen.has(file))return;seen.add(file);const text=readFileSync(file,'utf8');parts.push(text);
    for(const match of text.matchAll(/\bfrom\s*['"](\.[^'"\n]+)['"]/g))visit(fileURLToPath(new URL(match[1],pathToFileURL(file))));
  }
  for(const file of ['overview/data.mjs','overview/service.mjs','pwsh-evidence.mjs','workspace/runtime/analyzers/preset-context.mjs'])visit(fileURLToPath(new URL('./'+file,import.meta.url)));
  return hash(parts.join('\n'));
}

export class EvalWorkspaceService {
  constructor(ctx,overview,{profile=ctx.get('profileContext'),cr,cacheRoot,collect=collectCurrentPreset}={}){
    this.ctx=ctx;this.overview=overview;this.profile=profile;this.cr=cr;this.collect=collect;
    this.controller=new AbortController();this.configs=new Map();this.managers=new Map();this.pending=new Map();this.lastViewed=Date.now();
    this.data={host:'dsh',latest:Date.now(),projects:[],sessions:[],models:[],categories:[],failures:[]};
    this.progress={loading:false,done:0,total:0,unread:0,revision:0};
    if(profile){
      this.version=overviewProjectionVersion(profile);
      this.cacheRoot=cacheRoot??join(profile.home,'cache','trajectory-tree',hash(profile.dir).slice(0,16));
      overview.disk=new OverviewDiskCache(join(this.cacheRoot,'sessions'),this.version);
      this.previews=new OverviewDiskCache(join(this.cacheRoot,'configuration'),hash(this.version+readFileSync(new URL('./workspace/manifest.json',import.meta.url),'utf8')),{maxEntries:4,maxBytes:16*1024*1024,maxEntryBytes:4*1024*1024});
      overview.augment=(id,cwd,observation,signal,data)=>this.augment(id,cwd,observation,signal,data);
    }
  }
  workspaces(){return [...(this.ctx.get('workspaceRegistry')?.list?.()??[])].map(w=>({id:w.id,name:w.title||basename(w.path),path:w.path}));}
  workspace(id){
    const rows=this.workspaces();
    const selected=id?rows.find(w=>w.id===id):rows.find(w=>w.path===this.profile?.cwd)??rows[0];
    if(!selected)throw Error('请先在 DSH 中登记工作区');return selected;
  }
  async runtime(){
    return this.sdk??=Promise.resolve().then(async()=>{
      const sdk=createRequire(this.profile.installAnchor),load=name=>import(pathToFileURL(sdk.resolve(name)).href);
      const surface=await load('@deepseek-ai/dsh-session/surface');return surface;
    });
  }
  async augment(id,cwd,observation,signal,data){
    const events=observation.events??[],header=observation.header??{id,cwd};
    const projected=projectPresetContext(header,events,await this.runtime(),{summaryOnly:true,inheritedEventCount:observation.inheritedEventCount});
    signal.throwIfAborted();
    return {preset:projected?.session.preset??header.agentPreset??'unrecorded',title:projected?.session.title??id,
      presetUsage:projected?.session??null,findingCalls:await enrichFindingPowerShell(data.findingCalls,events,this.cr,signal)};
  }
  history(){return {generatedAt:this.progress.capturedAt??null,sessions:this.data.sessions.map(s=>s.presetUsage).filter(Boolean)};}
  startHistory({refresh=false}={}){
    if(this.job)return this.job;
    if(this.progress.complete&&!refresh)return Promise.resolve();
    const scope=this.overview.scope();if(!scope)return Promise.reject(Error('工作区记录暂时不可用'));
    const omitted=Math.max(0,scope.sessions.length-HISTORY_SESSIONS);scope.sessions=scope.sessions.slice(0,HISTORY_SESSIONS);
    const prior=new Map(this.data.sessions.map(s=>[s.id,s]));
    const priorBytes=new Map([...prior].map(([id,row])=>[id,Buffer.byteLength(JSON.stringify(row))]));
    const allowed=new Set(scope.sessions.map(s=>s.id));for(const id of prior.keys())if(!allowed.has(id))prior.delete(id);
    Object.assign(this.progress,{loading:true,complete:false,paused:false,error:null,total:scope.sessions.length,done:0,unread:0,omitted});
    const idle=new AbortController(),signal=AbortSignal.any([this.controller.signal,idle.signal]);
    const check=setInterval(()=>{if(Date.now()-this.lastViewed>15000)idle.abort();},3000);check.unref?.();
    this.job=(async()=>{
      const next=new Map();let bytes=0;
      for await(const row of this.overview.stream(scope,signal)){
        if(row.type==='start')Object.assign(this.data,{projects:row.projects,latest:row.latest,models:row.models,categories:row.categories});
        if(row.session){
          const size=Buffer.byteLength(JSON.stringify(row.session));prior.delete(row.session.id);
          if(bytes+size<=HISTORY_BYTES){next.set(row.session.id,row.session);bytes+=size;}else this.progress.omitted++;
        }
        if(row.type==='session'){
          Object.assign(this.progress,{done:row.done,unread:row.unread,capturedAt:Date.now()});
          // Keep already displayed data while the same sources are revalidated.
          this.data.sessions=[...next.values()];let held=bytes;
          for(const old of prior.values()){const size=priorBytes.get(old.id)??0;if(held+size<=HISTORY_BYTES){this.data.sessions.push(old);held+=size;}}
          this.data.models=[...row.models];this.progress.revision++;
        }
        if(row.type==='complete'){
          this.data.sessions=[...next.values()];this.data.models=[...row.models];
          Object.assign(this.progress,{complete:true,unread:row.unread,capturedAt:Date.now()});
        }
      }
    })().catch(error=>{if(idle.signal.aborted)this.progress.paused=true;else if(!this.controller.signal.aborted)this.progress.error='历史统计读取未完成，可以重新刷新。';})
      .finally(()=>{clearInterval(check);this.progress.loading=false;this.progress.revision++;this.job=null;});
    return this.job;
  }
  async current(id,{refresh=false}={}){
    const workspace=this.workspace(id);if(!this.profile)throw Error('当前宿主没有提供配置位置');
    let cached=this.configs.get(workspace.id);
    if(!cached&&!refresh){
      const saved=await this.previews.get(workspace.id,workspace.path,'display-only',this.controller.signal);
      if(saved?.data){cached={at:0,value:saved.data};this.configs.set(workspace.id,cached);}
    }
    if(!cached||refresh||Date.now()-cached.at>30000){
      let task=this.pending.get(workspace.id);
      if(!task){
        task=this.collect({home:this.profile.home,profileRoot:this.profile.dir,cwd:workspace.path,anchor:this.profile.installAnchor,
          profile:this.profile.name,overlays:this.profile.overlays??[]}).then(async value=>{
            this.controller.signal.throwIfAborted();
            this.configs.delete(workspace.id);this.configs.set(workspace.id,{at:Date.now(),value});
            while(this.configs.size>4)this.configs.delete(this.configs.keys().next().value);
            await this.previews.put(workspace.id,workspace.path,'display-only',value,[],this.controller.signal);
            this.progress.configurationError=null;this.progress.revision++;return value;
          }).catch(error=>{this.progress.configurationError='配置核对未完成，可刷新重试';throw error;})
            .finally(()=>this.pending.delete(workspace.id));
        this.pending.set(workspace.id,task);
      }
      // Last-known configuration can paint immediately, visibly marked as being
      // checked. Mutation previews always pass refresh:true and await the scan.
      if(!cached||refresh)cached={at:Date.now(),value:await task};else task.catch(()=>{});
    }
    const result=structuredClone(cached.value),history=this.history();
    for(const preset of result.presets)Object.assign(preset.statistics,currentUsageStatistics(preset,history));
    result.coverage.historyAsOf=history.generatedAt;result.workspaces=this.workspaces();result.workspace.id=workspace.id;
    result.progress={...this.progress,configurationChecking:this.pending.has(workspace.id)};return result;
  }
  async manager(id,origin){
    const workspace=this.workspace(id);let manager=this.managers.get(workspace.id);
    if(!manager){
      const service=new DshManagement({home:this.profile.home,profileRoot:this.profile.dir,workspace:workspace.path,
        storage:join(this.cacheRoot,'management'),readSnapshot:()=>this.current(workspace.id,{refresh:true}),api:await loadManagementSdk(this.profile.installAnchor),
        reconcile:async receipt=>{
          const pluginManager=this.ctx.get('pluginManager');
          if(receipt.kind==='bundle'&&typeof pluginManager?.setBundleEnabled==='function')return pluginManager.setBundleEnabled(receipt.source,receipt.enabled);
          const hmr=this.ctx.get('hmr');
          if(typeof hmr?.reconcileProfile!=='function')return {application:'restart-required',restartReason:'no-hmr'};
          const result=await hmr.reconcileProfile();
          return {...result,application:result.restartReason||result.pending?.length?'restart-required':'applied'};
        }});
      const http=managementHttp(service,{origin:()=>manager.origin,onSaved:async()=>{this.configs.clear();}});
      manager={service,http,origin};this.managers.set(workspace.id,manager);
      while(this.managers.size>8)this.managers.delete(this.managers.keys().next().value);
    }
    manager.origin=origin;return manager;
  }
  page(){
    const html=readFileSync(join(uiRoot,'index.html'),'utf8');
    return html.replace('<head>','<head><base href="'+WORKSPACE_PATH+'/">')
      .replace(/((?:href|src)=")\/(?!\/)/g,'$1'+WORKSPACE_PATH+'/')
      .replace('<body data-layout="desk">','<body data-layout="desk" class="native-eval">')
      .replace('<script type="module"',`<script>window.__trajectoryWorkspace=${safeJson({base:WORKSPACE_PATH,native:true})};</script><script type="module"`)
      .replace('本机配置预览','预设与配置').replace('>sql event<','>工作区<');
  }
  async handle(req,res,url,{signal,origin}){
    const path=url.pathname.slice(WORKSPACE_PATH.length)||'/';
    const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
    const id=url.searchParams.get('workspace');
    if(['/data.json','/api/status','/api/eval-view'].includes(path))this.lastViewed=Date.now();
    if(path.startsWith('/api/management/')){
      if(this.profile?.overlays?.length)return send(409,{error:'启动参数包含临时配置覆盖，请在原配置中管理加载项。'});
      const manager=await this.manager(id,origin),local=new URL(url);local.pathname=path;return manager.http(req,res,local);
    }
    if(req.method==='POST'){
      if(req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'请从当前 Eval 页面操作'});
      if(path==='/api/diagnosis-context'){
        if(req.headers['content-type']!=='application/json')return send(400,{error:'请求格式错误'});
        const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>65536)return send(413,{error:'选区过大'});parts.push(part);}
        const input=JSON.parse(Buffer.concat(parts).toString('utf8'));
        return send(200,await prepareContextDiagnosis(await this.current(id),input,join(this.cacheRoot,'diagnosis'),signal));
      }
      if(path==='/api/refresh'){await this.current(id,{refresh:true});return send(200,{ok:true});}
      if(path==='/api/refresh-usage'){this.startHistory({refresh:true}).catch(()=>{});return send(202,{ok:true});}
      return send(404,{error:'not found'});
    }
    if(req.method!=='GET')return send(405,{error:'method not allowed'});
    if(path==='/data.json'){
      const data=await this.current(id);send(200,data);this.startHistory().catch(()=>{});return;
    }
    if(path==='/api/status'){if(this.progress.paused)this.startHistory().catch(()=>{});const selected=this.workspace(id);return send(200,{...this.progress,configurationChecking:this.pending.has(selected.id)});}
    if(path==='/api/conversations'){
      const scope=this.overview.scope();return send(200,{sessions:(scope?.sessions??[]).map(s=>({id:s.id,title:this.data.sessions.find(r=>r.id===s.id)?.title??s.id,cwd:s.cwd}))});
    }
    if(path==='/api/context-overlap')return send(200,contextOverlap(await this.current(id),url.searchParams.get('preset')));
    if(path==='/api/overlap-examples')return send(200,skillOverlapExamples());
    if(path==='/api/eval-view'){
      this.startHistory().catch(()=>{});const options=Object.fromEntries(url.searchParams);
      const result=(options.view==='diagnosis'?diagnosisView:windowView)(this.data,options);result.progress={...this.progress};return send(200,result);
    }
    // The allowlist is independent of the request path; no arbitrary file read.
    const allowed=new Set(readdirSync(uiRoot).filter(name=>/\.(?:css|js|mjs)$/.test(name)).map(name=>'/'+name));
    for(const name of ['tokens.css','primitives.css'])allowed.add('/design/'+name);
    let file;
    if(allowed.has(path))file=join(uiRoot,path.slice(1));
    else if(['/fonts/Geist-Variable.woff2','/fonts/GeistMono-Variable.woff2'].includes(path))file=fileURLToPath(new URL('../trace'+path,import.meta.url));
    if(!file)return send(404,{error:'not found'});
    signal.throwIfAborted();const content=await readFile(file,{signal});
    res.writeHead(200,{'content-type':mime[file.slice(file.lastIndexOf('.'))]??'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff'});res.end(content);
  }
  dispose(){this.controller.abort();this.configs.clear();this.managers.clear();}
}
