// Public showcase fixtures only. Never reads local sessions or private reports.
import {mkdirSync,readFileSync,writeFileSync,existsSync,copyFileSync} from 'node:fs';
import {join,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import http from 'node:http';
import {createPiSample} from '../analyzers/pi-sample.mjs';
import {datasetFromNative} from '../plugin/portable-tools/sources.mjs';
import {writeHostTracePage} from '../view/render.mjs';
import {renderTracePage} from '../plugin/analysis-view/lib/index.js';
import {inlineTraceFonts} from '../plugin/analysis-view/lib/eval/render.mjs';
import {renderReport} from '../report/render.mjs';
import {assemblyConcept} from '../docs/demo/assembly-study/sequence.mjs';
import {compileMarkdown} from '../report/compile.mjs';
import {publicEvalShowcase} from './readme-fixtures.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'.dsh/readme-media');mkdirSync(out,{recursive:true});
const sample=createPiSample({revision:'public-readme-fixture'},{skillStudy:true});
const languages=[
 {locale:'zh-CN',suffix:'',title:'账单导出 · 示例会话'},
 {locale:'en',suffix:'-en',title:'Billing export · sample session'},
];
const agentTimes=type=>sample.capture.filter(row=>row.event.type===type).map(row=>row.observedAt);
const starts=agentTimes('agent_start'),ends=agentTimes('agent_end');
const pages=languages.flatMap(({suffix})=>['path','eval','diagnosis','global-eval','report'].map(name=>name+suffix));
for(const {locale,suffix,title} of languages){
 const input=structuredClone(sample),last=input.entries.at(-1);
 input.entries.push({type:'session_info',id:'readme-session-title',parentId:last.id,timestamp:last.timestamp,name:title});
 const dataset=datasetFromNative('pi',input),trace=dataset.payload,turns=trace.sessions[0].turns;
 // The public fixture includes simulated agent start/end capture. Show the
 // complete-data chart using those observations, without changing live Pi.
 if(starts.length!==turns.length||ends.length!==turns.length)throw Error('Incomplete showcase turn timing');
 for(const [i,turn] of turns.entries()){
  if(ends[i]<starts[i])throw Error('Invalid showcase turn timing');
  Object.assign(turn,{start:starts[i],end:ends[i],endObserved:true,durationMs:ends[i]-starts[i]});
 }
 writeHostTracePage(trace,join(out,'path'+suffix+'.html'),{locale});
 const showcase=publicEvalShowcase(locale);
 writeFileSync(join(out,'eval'+suffix+'.html'),inlineTraceFonts(showcase.evaluation));
 writeFileSync(join(out,'global-eval'+suffix+'.html'),showcase.overview);
 writeFileSync(join(out,'report'+suffix+'.html'),showcase.report);
 // Exercise the DSH selection UI with the same public fixture, never a host profile.
 writeFileSync(join(out,'diagnosis'+suffix+'.html'),inlineTraceFonts(renderTracePage({...trace,host:'dsh',locale})));
}
const source={host:'synthetic',session:'public-readme-example',snapshot:'showcase-v1',log:'synthetic-example',cut:24};
const series=['system','tools','user','inject','skill','assistant','tool'];
const labels=['系统提示','工具定义','用户消息','补充内容','技能目录','助手消息','工具结果'];
const columns={turn:{label:'轮次',unit:'turn',basis:'identifier'},...Object.fromEntries(series.map((s,i)=>[s,{label:labels[i],unit:'tokens',basis:'estimated',aggregate:'sum'}]))};
let assistant=1700,tool=1100,user=650;
const rows=Array.from({length:24},(_,i)=>{
 if(i===15){assistant=11500;tool=4700;user=3100;}
 assistant+=900+(i%4)*330;tool+=i%5===2?3100:570;user+=170;
 return{id:'turn:'+ (i+1),turn:i+1,time:i*7000,system:1500,tools:5200,user,inject:420,skill:960,assistant,tool};
});
const context={schema:'trajectory-data/1',id:'context',kind:'context',source,columns,rows,coverage:{synthetic:true}};
const contextFigures={trend:{type:'context',data:'context',title:'上下文怎样积累，又在哪里被整理',fields:{x:'turn'},series,layers:['total','delta']}};
writeFileSync(join(out,'context.html'),renderReport({markdown:'# 上下文的变化，有迹可循\n\n示例数据 · 同一套来源颜色，追踪保留量与每轮增减。\n\n[[figure:trend]]\n',datasets:{context},figures:contextFigures}).html);
const assembly=assemblyConcept();
writeFileSync(join(out,'assembly.html'),renderReport({markdown:'# 上下文，一轮一轮拼起来\n\n概念序列 · 追加、保留与历史改写，由同一个装配组件重放。\n\n[[figure:assembly]]\n',datasets:{assembly},figures:{assembly:{type:'assembly',data:'assembly',title:'上下文动态装配',initialRow:'concept:0',autoplay:false}}}).html);
// Preview this repository's trusted README. Product Markdown remains unchanged.
for(const [name,filename] of [['index','README.md'],['english','README.en.md']]){
 const blocks=[],keep=html=>'\n\nREADMEBLOCK'+(blocks.push(html)-1)+'\n\n';
 let markdown=readFileSync(join(root,filename),'utf8').replace(/^\uFEFF/,'')
  .replace(/^<p\b[\s\S]*?<\/p>/gm,keep).replace(/^<h1\b[^\n]*<\/h1>/gm,keep)
  .replace(/^<details>\s*\n<summary>[^\n]*<\/summary>/gm,keep).replace(/^<\/details>/gm,keep)
  .replace(/^!\[([^\]]*)\]\((docs\/media\/[^)]+)\)$/gm,(_,alt,path)=>keep('<img src="/'+path+'" alt="'+alt.replaceAll('"','&quot;')+'">'));
 let body=compileMarkdown(markdown).blocks.map(block=>block.html).join('\n').replace(/<p>READMEBLOCK(\d+)<\/p>/g,(_,n)=>blocks[Number(n)]);
 body=body.replace(/href="([^"#][^"]*)"/g,(all,url)=>/^https?:/.test(url)?all:'href="'+(url==='README.md'?'/':url==='README.en.md'?'/english':'https://github.com/goatliamia/trajectory-tree/blob/main/'+url)+'"');
 writeFileSync(join(out,name+'.html'),'<!doctype html><html lang="'+(name==='index'?'zh-CN':'en')+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trajectory Tree · README</title><style>body{margin:0;background:#fff;color:#1f2328;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:980px;padding:30px 34px 60px;margin:auto}h1{font-size:36px;letter-spacing:-.04em;margin:18px 0}h2{font-size:24px;letter-spacing:-.025em;margin:42px 0 16px;padding-bottom:8px;border-bottom:1px solid #d8dee4}h3{font-size:19px}a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}img{display:block;max-width:100%;height:auto;margin:20px auto}p[align=center]{color:#57606a}code{background:#eff1f3;border-radius:5px;font:13px/1.6 Consolas,monospace;padding:3px 6px}pre{background:#f6f8fa;padding:16px;overflow:auto;border-radius:6px}pre code{padding:0;background:none}blockquote{border-left:4px solid #d0d7de;color:#656d76;padding:0 16px;margin:16px 0}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #d0d7de;padding:8px 13px;text-align:left}tr:nth-child(even){background:#f6f8fa}details{margin:12px 0;padding:13px 16px;border:1px solid #d8dee4;border-radius:7px}summary{cursor:pointer}details[open]>summary{margin-bottom:16px}li{margin:5px 0}</style><main>'+body+'</main></html>');
}
pages.push('context','assembly','english');
console.log(JSON.stringify({output:out,pages,source:'synthetic-only'}));
if(process.argv.includes('--capture')){
 const {chromium}=createRequire(new URL('../test/browser/package.json',import.meta.url))('playwright');
 const browser=await chromium.launch();
 const capture=join(out,'captures');mkdirSync(capture,{recursive:true});
 const captured=[];
 try{
  for(const {locale,suffix} of languages){
   const width=1200,height=770;
   const page=await browser.newPage({locale,colorScheme:'light',viewport:{width,height},deviceScaleFactor:1.5});
   const open=async(name)=>{
    await page.goto(pathToFileURL(join(out,name+suffix+'.html')).href);
    await page.evaluate(()=>document.fonts.ready);
   };
   const take=async(name,options={})=>{const filename=name+suffix+'.jpg';await page.screenshot({path:join(capture,filename),type:'jpeg',quality:89,animations:'disabled',...options});captured.push(filename);};
   const takeElement=async(name,selector)=>{const filename=name+suffix+'.jpg';await page.locator(selector).screenshot({path:join(capture,filename),type:'jpeg',quality:89,animations:'disabled'});captured.push(filename);};
   await open('path');
   await page.locator('#graph .br-trunk').waitFor({state:'attached'});
   await take('trajectory-overview');
   await open('eval');
   await page.locator('#turn-usage .usage-point').first().waitFor();
   const chart=await page.locator('#turn-usage').boundingBox();
   await take('eval-overview',{clip:{x:0,y:0,width,height:Math.ceil(chart.y+chart.height)+16}});
   await open('diagnosis');
   await page.locator('#review-rounds').click();
   await page.locator('[data-review-round-path="2"]').click();
   const step=page.locator('#graph [data-step="1"]');
   await step.press('Enter');
   await step.press('Shift+Enter');
   await page.locator('#diagnosis-confirm').click();
   await page.locator('#questions button').nth(1).click();
   const graph=await page.locator('#graph-scroll').boundingBox(),y=Math.floor(graph.y)+22;
   await take('diagnosis-draft',{clip:{x:0,y,width,height:height-y}});
   await page.setViewportSize({width,height:900});
   await open('global-eval');
   await page.locator('#overview-page').waitFor({state:'visible'});
   await take('global-eval');
   await page.locator('#window-section').evaluate(node=>node.scrollIntoView({block:'start',behavior:'instant'}));
   await take('window-comparison');
   await takeElement('diagnosis-signals','#overview-findings');
   await open('eval');
   await page.locator('[data-ce-tab="code"]').click();
   await page.locator('.app-header').evaluate(node=>node.style.visibility='hidden');
   await takeElement('code-execution','#code-execution');
   await open('report');
   await page.locator('[data-flow-node]').first().waitFor({state:'visible'});
   await take('diagnostic-report');
   await page.close();
  }
 }finally{await browser.close();}
 if(process.argv.includes('--publish-captures'))for(const name of captured)copyFileSync(join(capture,name),join(root,'docs/media',name));
 console.log(JSON.stringify({captures:capture,count:captured.length,published:process.argv.includes('--publish-captures')}));
}
if(process.argv.includes('--serve')){
 const types={'.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.gif':'image/gif','.svg':'image/svg+xml'};
 const routes=new Map(pages.map(name=>['/'+name,join(out,name+'.html')]));
 const server=http.createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  let file=routes.get(path);
  if(path.startsWith('/docs/media/')&&!path.slice(12).includes('/')&&!path.includes('..'))file=join(root,path.slice(1));
  if(path==='/')file=join(out,'index.html');
  if(!file||!existsSync(file)){res.writeHead(404).end();return;}
  res.writeHead(200,{'content-type':types[extname(file)]||'text/plain; charset=utf-8','cache-control':'no-store'});res.end(readFileSync(file));
 });
 server.listen(Number(process.argv[process.argv.indexOf('--serve')+1])||3099,'127.0.0.1',()=>console.log('README showcase: http://127.0.0.1:'+server.address().port+'/'));
}
