import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {join,extname} from 'node:path';
import {chromium,firefox,webkit} from 'playwright';
import {summarizePresetInventory} from '../../analyzers/preset-statistics.mjs';
import {buildSkillManagement} from '../../analyzers/preset-skill-management.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),files=new Map();let server,origin;
function preset(id){
  const p={id,name:id,toolMode:'直接工具',instructions:[],skills:[],disabledSkills:[],injections:[],modules:[],
    system:[{name:'Identity',body:'Fixture',measuredTokens:5,provenance:{origin:'official'}}],tools:[{name:'read',description:'Read a file',measuredTokens:20,provenance:{origin:'official'}}]};
  p.statistics=summarizePresetInventory(p,null);p.skillManagement=buildSkillManagement(p);return p;
}
before(async()=>{
  const ui=join(root,'docs/demo/preset-context');for(const name of await readdir(ui))if(/\.(js|css|html)$/.test(name))files.set('/'+name,join(ui,name));
  for(const name of ['tokens.css','primitives.css'])files.set('/design/'+name,join(root,'design',name));
  for(const name of ['tool-colors','tool-feedback'])files.set('/'+name+'.js',join(root,'lib',name+'.mjs'));
  for(const name of ['Geist-Variable.woff2','GeistMono-Variable.woff2'])files.set('/fonts/'+name,join(root,'docs/demo/layout-review/fonts',name));
  const config={workspace:{id:'all',name:'全部工作区'},workspaces:[],presets:[preset('custom-a'),preset('custom-b')],defaultPreset:'custom-a',capturedAt:Date.now(),coverage:{issues:[]},bundleInventory:[],progress:{revision:0,complete:true}};
  server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname,json=data=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(data));
    if(path==='/')return res.writeHead(200,{'content-type':'text/html'}).end('<body style="--dsw-alias-bg-layer-1:#fbfbfb;--dsw-alias-label-primary:#171717"><button id="dark" onclick="document.body.toggleAttribute(\'data-ds-dark-theme\');document.body.style.setProperty(\'--dsw-alias-bg-layer-1\',document.body.hasAttribute(\'data-ds-dark-theme\')?\'#181a1f\':\'#fbfbfb\')">Theme</button><iframe id="eval" src="/index.html" style="width:1200px;height:900px"></iframe>');
    if(path==='/data.json')return json(config);
    if(path==='/api/status')return json(config.progress);
    if(path==='/api/overlap-examples')return json(null);
    if(['/tool-colors.css','/tool-feedback.css'].includes(path))return res.writeHead(200,{'content-type':'text/css'}).end('');
    if(!files.has(path))return res.writeHead(404).end();
    let content=await readFile(files.get(path));if(path==='/index.html')content=content.toString().replace('<head>','<head><script>window.__trajectoryWorkspace={native:true,base:""};</script>');
    res.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[extname(path)]}).end(content);
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
});
after(()=>new Promise(resolve=>server.close(resolve)));
for(const [name,engine]of Object.entries({chromium,firefox,webkit}))test(name+': Eval uses DSH theme and a top-left custom preset selector',async()=>{
  const browser=await engine.launch(name==='chromium'&&process.env.TRAJECTORY_BROWSER_CHANNEL?{channel:process.env.TRAJECTORY_BROWSER_CHANNEL}:{});try{
    const context=await browser.newContext({colorScheme:'dark'}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);const frame=page.frameLocator('#eval');await frame.locator('#preset-select option[value="custom-a"]').waitFor({state:'attached'});
    assert.equal(await frame.locator('.sidebar').count(),0);
    assert.equal(await frame.locator('html').getAttribute('data-dsh-theme'),'light','host light wins over browser dark');
    assert.equal(await frame.locator('html').evaluate(el=>getComputedStyle(el).colorScheme),'light');
    assert.equal(await frame.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--tt-surface').trim()),'#fbfbfb');
    await frame.getByLabel('选择当前预设').selectOption('custom-b');assert.equal(await frame.getByLabel('选择当前预设').inputValue(),'custom-b');
    await page.emulateMedia({colorScheme:'light'});await page.locator('#dark').click();await frame.locator('html[data-dsh-theme="dark"]').waitFor();
    assert.equal(await frame.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--tt-surface').trim()),'#181a1f');
    assert.equal(await frame.locator('html').evaluate(el=>getComputedStyle(el).colorScheme),'dark');
    await page.locator('#dark').click();await frame.locator('html[data-dsh-theme="light"]').waitFor();assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
