import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {Script} from 'node:vm';
import assert from 'node:assert/strict';

const root=new URL('../',import.meta.url),demo=new URL('docs/demo/context-loading/',root);
const input=new URL('.dsh/context-loading-matrix/data.json',root);
if(!existsSync(input))await import('./build-context-loading-matrix.mjs');
const data=JSON.parse(readFileSync(input,'utf8'));
assert.equal(data.groups.reduce((s,g)=>s+g.tokens,0),data.total);
assert.equal(data.groups.flatMap(g=>g.items).length,data.leaves.length);
assert(data.groups.every(g=>Number.isSafeInteger(g.seq)&&Number.isFinite(g.time)));
const admissions=[...data.groups].sort((a,b)=>a.seq-b.seq);
assert(admissions.every((g,i)=>!i||g.time>=admissions[i-1].time),'Arrival playback requires monotonic recorded times');
const html=readFileSync(new URL('light.html',demo),'utf8');
let css=readFileSync(new URL('light.css',demo),'utf8');
for(const name of ['Geist-Variable.woff2','GeistMono-Variable.woff2'])css=css.replace('../layout-review/fonts/'+name,'data:font/woff2;base64,'+readFileSync(new URL('docs/demo/layout-review/fonts/'+name,root)).toString('base64'));
const layout=readFileSync(new URL('docs/demo/preset-context/treemap.js',root),'utf8').replace('export function tileLayout','function tileLayout');
const app=readFileSync(new URL('light.js',demo),'utf8');new Script(app,{filename:'light.js'});
const zoomApp=readFileSync(new URL('light-zoom.js',demo),'utf8');new Script(zoomApp,{filename:'light-zoom.js'});
const zoomCss=readFileSync(new URL('light-zoom.css',demo),'utf8');
const serialized=JSON.stringify(data).replaceAll('<','\\u003c');
const output=new URL('.dsh/context-light-demos/',root);mkdirSync(output,{recursive:true});
const designs=[['matrix','留白矩阵'],['reader','分层阅读'],['overview','内容总览'],['zoom','连续缩放']];
for(const [id,title] of designs){
  let template=['matrix','zoom'].includes(id)?html.replace(/  <nav class="design-nav"[^\n]*<\/nav>\r?\n/,''):html;
  if(id==='zoom')template=template.replace('class="brand" href="matrix.html"','class="brand" href="zoom.html"');
  const page=template.replaceAll('__DESIGN__',id).replaceAll('__TITLE__',['matrix','zoom'].includes(id)?'上下文':title)
    .replace('<link rel="stylesheet" href="light.css">',()=>'<style>'+css+(id==='zoom'?'\n'+zoomCss:'')+'</style>')
    .replace('<script src="light-data.js" defer></script>',()=>'<script>window.LIGHT_CONTEXT='+serialized+';</script>')
    .replace('<script src="light-layout.js" defer></script>',()=>'<script>'+layout+'</script>')
    .replace('<script src="light.js" defer></script>',()=>'<script>'+((id==='zoom'?zoomApp+'\n':'')+app).replace(/<\/script/gi,'<\\/script')+'</script>');
  writeFileSync(new URL(id+'.html',output),page);
  if(id==='zoom')writeFileSync(new URL('index.html',output),page);
}
console.log(JSON.stringify({output:'.dsh/context-light-demos/',designs:designs.map(([id,title])=>({file:id+'.html',title})),groups:data.groups.length,items:data.leaves.length,total:data.total}));
