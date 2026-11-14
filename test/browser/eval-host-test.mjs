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
  const config={workspace:{id:'all',name:'全部工作区'},workspaces:[],presets:[preset('custom-a'),preset('custom-b'),...Array.from({length:26},(_,i)=>preset('custom-long-preset-'+i))],defaultPreset:'custom-a',capturedAt:Date.now(),coverage:{issues:[]},bundleInventory:[],progress:{revision:0,complete:true}};
  server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname,json=data=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(data));
    if(path==='/')return res.writeHead(200,{'content-type':'text/html'}).end('<body style="--dsw-alias-bg-layer-1:#fbfbfb;--dsw-alias-label-primary:#171717"><button id="dark" onclick="document.body.toggleAttribute(\'data-ds-dark-theme\');document.body.style.setProperty(\'--dsw-alias-bg-layer-1\',document.body.hasAttribute(\'data-ds-dark-theme\')?\'#181a1f\':\'#fbfbfb\')">Theme</button><iframe id="eval" src="/index.html" style="display:block;width:calc(100vw - 16px);height:calc(100vh - 48px);border:0"></iframe>');
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
    await page.goto(origin);const frame=page.frameLocator('#eval');await frame.locator('.preset-options [data-preset="custom-a"]').waitFor({state:'attached'});
    assert.equal(await frame.locator('.sidebar').count(),0);
    assert.equal(await frame.locator('html').getAttribute('data-dsh-theme'),'light','host light wins over browser dark');
    assert.equal(await frame.locator('html').evaluate(el=>getComputedStyle(el).colorScheme),'light');
    assert.equal(await frame.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--tt-surface').trim()),'#fbfbfb');
    await frame.getByRole('navigation',{name:'选择当前预设'}).getByRole('button',{name:'custom-b'}).click();assert.equal(await frame.getByRole('button',{name:'custom-b'}).getAttribute('aria-pressed'),'true');
    assert.ok(await frame.locator('.preset-options button[hidden]').count()>0,'many presets stay out of the header instead of wrapping');
    await frame.getByRole('button',{name:'全部预设',exact:true}).click();await frame.getByRole('searchbox',{name:'查找预设'}).fill('long-preset-25');
    await frame.getByRole('dialog',{name:'全部预设',exact:true}).getByRole('button',{name:'custom-long-preset-25'}).click();
    assert.equal(await frame.getByRole('navigation',{name:'选择当前预设'}).getByRole('button',{name:'custom-long-preset-25'}).getAttribute('aria-pressed'),'true');
    assert.equal(await frame.getByRole('navigation',{name:'选择当前预设'}).getByRole('button',{name:'custom-long-preset-25'}).isVisible(),true,'selected preset remains visible even at the end of a long list');
    assert.ok(await frame.locator('.preset-options').evaluate(el=>el.getBoundingClientRect().height)<45,'preset navigation stays on one line');
    await frame.getByRole('button',{name:'全部预设',exact:true}).click();await frame.getByRole('searchbox',{name:'查找预设'}).fill('not-present');
    await frame.getByText('没有匹配的预设',{exact:true}).waitFor();await frame.getByRole('searchbox',{name:'查找预设'}).press('Escape');
    await frame.getByRole('group',{name:'放大来源分区'}).getByRole('button',{name:'DSH 官方'}).click();
    await frame.getByRole('group',{name:'放大来源分区'}).getByRole('button',{name:'全部来源'}).waitFor();
    await frame.getByRole('button',{name:'read，工具定义，20 tokens，DSH 官方',exact:true}).click();
    assert.equal(await frame.locator('#current-list details[open]').getAttribute('data-entity'),'tools:0','one measured tile opens the same tool rather than the whole category');
    await frame.getByRole('button',{name:'关闭详情',exact:true}).click();
    await page.emulateMedia({colorScheme:'light'});await page.locator('#dark').click();await frame.locator('html[data-dsh-theme="dark"]').waitFor();
    assert.equal(await frame.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--tt-surface').trim()),'#181a1f');
    assert.equal(await frame.locator('html').evaluate(el=>getComputedStyle(el).colorScheme),'dark');
    await page.locator('#dark').click();await frame.locator('html[data-dsh-theme="light"]').waitFor();assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
