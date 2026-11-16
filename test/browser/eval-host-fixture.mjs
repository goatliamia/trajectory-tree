import {readFile,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {join,extname} from 'node:path';
import {summarizePresetInventory} from '../../analyzers/preset-statistics.mjs';
import {buildSkillManagement} from '../../analyzers/preset-skill-management.mjs';

function preset(id){
  const p={id,name:id,configurationScope:'global',toolMode:'直接工具',instructions:[],skills:[],disabledSkills:[],injections:[],modules:[],
    system:[{name:'Identity',body:'Fixture',measuredTokens:5,provenance:{origin:'official'}}],tools:[{name:'read',description:'工具输出.js：原始中文证据',measuredTokens:20,provenance:{origin:'official'}}]};
  p.statistics=summarizePresetInventory(p,null);p.skillManagement=buildSkillManagement(p);return p;
}
// Exercise the shipped workspace, including its compiled UI language layer.
export async function evalHostFixture(){
  const root=fileURLToPath(new URL('../../',import.meta.url)),ui=join(root,'plugin/analysis-view/lib/eval/workspace/ui'),files=new Map();
  async function collect(dir,prefix=''){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const key=prefix+'/'+entry.name,path=join(dir,entry.name);
      if(entry.isDirectory())await collect(path,key);else files.set(key,path);
    }
  }
  await collect(ui);
  await collect(join(root,'plugin/analysis-view/lib/trace/fonts'),'/fonts');
  const config={workspace:{id:'all',name:'全部工作区'},workspaces:[],presets:[preset('custom-a'),preset('custom-b'),...Array.from({length:26},(_,i)=>preset('custom-long-preset-'+i))],defaultPreset:'custom-a',capturedAt:Date.now(),coverage:{issues:[]},bundleInventory:[],progress:{revision:0,complete:true}};
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname,json=data=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(data));
    if(path==='/')return res.writeHead(200,{'content-type':'text/html'}).end(`<html lang="zh-CN"><head><meta charset="utf-8"></head><body style="--dsw-alias-bg-layer-1:#fbfbfb;--dsw-alias-label-primary:#171717"><button id="dark" onclick="document.body.toggleAttribute('data-ds-dark-theme');document.body.style.setProperty('--dsw-alias-bg-layer-1',document.body.hasAttribute('data-ds-dark-theme')?'#181a1f':'#fbfbfb')">Theme</button><button id="english" onclick="document.documentElement.lang='en'">English</button><button id="chinese" onclick="document.documentElement.lang='zh-CN'">中文</button><iframe id="eval" src="/index.html" style="display:block;width:calc(100vw - 16px);height:calc(100vh - 48px);border:0"></iframe></body></html>`);
    if(path==='/data.json')return json(config);
    if(path==='/api/status')return json(config.progress);
    if(path==='/api/overlap-examples')return json(null);
    if(!files.has(path))return res.writeHead(404).end();
    let content=await readFile(files.get(path));if(path==='/index.html')content=content.toString().replace('<head>','<head><script>window.__trajectoryWorkspace={native:true,base:""};</script>');
    res.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[extname(path)]}).end(content);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,origin:'http://127.0.0.1:'+server.address().port};
}
