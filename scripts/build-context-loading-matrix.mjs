// Local UI study: numerical estimates and native placement stay separate.
// Native message bodies and the resulting standalone HTML stay in ignored .dsh/.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {tileLayout} from '../docs/demo/preset-context/treemap.js';

const root=new URL('../',import.meta.url),demo=new URL('docs/demo/context-loading/',root);
const native=new URL('.dsh/context-loading-native/native-data.js',root);
if(!existsSync(native))await import('./build-context-loading-native.mjs');
const nativeData=JSON.parse(readFileSync(native,'utf8').replace(/^window.CONTEXT_NATIVE\s*=\s*/,'').replace(/;\s*$/,''));
const require=createRequire(import.meta.url),sdk=createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
const meter=await import(pathToFileURL(sdk.resolve('@deepseek-ai/dsh-token-meter/estimate')).href);
const groups=[],leaves=[];
const groupNames={'system-prompt':'系统提示','user-approval':'审批策略','user':'用户输入','agent-instructions':'工作指令','runtime-context':'运行环境','skill-catalog':'Skill 目录','time-context':'时间信息'};
const sectionNames={'working-directory:current':'工作目录','sandbox:policy':'文件沙箱','approval:policy':'审批策略','harness:source':'宿主位置','app:web-surface':'Web 界面'};
const slots=nativeData.frames.at(-1).slots;
const textParts=text=>{
  const out=[];let start=0;
  for(const match of text.matchAll(/\n{2,}/g)){out.push(text.slice(start,match.index+match[0].length));start=match.index+match[0].length;}
  if(start<text.length)out.push(text.slice(start));
  return out.filter(Boolean);
};
const lead=text=>text.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
const systemName=(text,index)=>{
  const mapping=[[/^You are an AI/,'Harness 身份'],[/^You are a coding/,'模型与职责'],[/^Tokens prefixed/,'引用路径'],[/^Non-zero exits/,'命令退出状态'],[/^Use the read tool/,'读取文件'],[/^Read an existing file/,'覆盖前检查'],[/^Read a file before/,'编辑前观察'],[/^Use the glob tool/,'路径发现'],[/^Use the grep tool/,'内容检索'],[/^Track every background/,'后台任务'],[/^web_search/,'搜索结果约定'],[/^web_fetch/,'网页取回约定'],[/^create_goal/,'目标生命周期'],[/^Use the workflow/,'工作流调用'],[/^Start independent/,'独立委派'],[/^Prefer showing/,'交付与展示'],[/^The runtime context/,'宿主与工作目录'],[/^You are interacting/,'Web 界面约定']];
  return mapping.find(([re])=>re.test(text))?.[1]||'系统片段 '+String(index+1).padStart(2,'0');
};
const add=(group,row)=>{
  const leaf={id:group.id+':'+group.items.length,groupId:group.id,order:group.items.length,kind:group.kind,field:group.field,...row};
  group.items.push(leaf.id);leaves.push(leaf);return leaf;
};
for(const slot of slots){
  const f=nativeData.fragments[slot.id],frame=nativeData.frames.find(r=>r.seq===slot.seq);
  const group={id:f.producer,name:groupNames[f.producer]||f.label,kind:f.producer==='skill-catalog'?'catalog':f.producer==='system-prompt'?'system':f.producer==='agent-instructions'?'instructions':f.producer==='runtime-context'?'runtime':'message',seq:slot.seq,messageIndex:slot.ordinal,role:slot.role,producer:f.producer,field:'messages['+slot.ordinal+']',time:frame.time,body:f.text,items:[]};
  group.tokens=meter.estimateMessage({role:slot.role,content:[{type:'text',text:f.text}]});
  const queued=nativeData.frames.find(r=>r.type==='agent/inbox/spliced'&&r.fragment===slot.id&&!r.removedCount);
  const claimed=nativeData.frames.find(r=>r.type==='agent/inbox/spliced'&&r.fragment===slot.id&&r.removedCount);
  if(queued&&claimed)group.queue={queued:queued.seq,claimed:claimed.seq};
  if(f.producer==='system-prompt'){
    textParts(f.text).forEach((body,i)=>add(group,{name:systemName(body,i),description:lead(body),body,tokens:body.length/4,basis:'text-density',path:'content[0] · 段落 '+(i+1)}));
  }else if(f.producer==='skill-catalog'){
    const entries=new Map(f.entries.map(entry=>[entry.name,entry]));
    for(const match of f.text.matchAll(/^- `([^`]+)`:.*(?:\n|$)/gm)){
      const entry=entries.get(match[1]);if(!entry)continue;
      add(group,{name:entry.name,description:entry.description,body:match[0],tokens:match[0].length/4,basis:'text-density',path:'available_skills · '+entry.name});
    }
    assert.equal(group.items.length,f.entries.length,'Every recorded catalog entry must remain inspectable');
  }else if(f.producer==='runtime-context'){
    for(const section of f.sections){
      assert(f.text.includes(section.text));
      add(group,{name:sectionNames[section.name]||section.name,description:section.text,body:section.text,tokens:section.text.length/4,basis:'text-density',path:section.name});
    }
  }else{
    add(group,{name:f.producer==='agent-instructions'?f.paths?.join(' · ')||'适用指令':group.name,description:lead(f.text),body:f.text,tokens:group.tokens,basis:'message-estimate',path:group.field});
  }
  const measured=leaves.filter(r=>r.groupId===group.id).reduce((sum,r)=>sum+r.tokens,0),remainder=group.tokens-measured;
  assert(remainder>=-1e-8,'Never shrink measured content to force a total');
  if(remainder>1e-8){
    const omitted=f.producer==='skill-catalog'?f.text.replace(/^- `([^`]+)`:.*(?:\n|$)/gm,''):f.producer==='runtime-context'?f.sections.reduce((text,s)=>text.replace(s.text,''),f.text):'';
    add(group,{name:'引导文本与封装',description:'未拆入子项的原文、角色封装与固定密度估算取整。',body:omitted||'角色与内容封装；此项是估算器的结构开销，不是另一次注入。',tokens:remainder,basis:'envelope-remainder',path:group.field+' · framing',auxiliary:true});
  }
  groups.push(group);
}
const toolFrame=nativeData.frames.find(r=>r.seq===nativeData.source.toolsHeaderSeq);
const tools={id:'tools',name:'工具声明',kind:'tools',seq:nativeData.source.toolsHeaderSeq,messageIndex:null,role:null,producer:'request/header',field:'tools[]',time:toolFrame.time,body:JSON.stringify(nativeData.tools,null,2),items:[],tokens:meter.estimateToolsTokens({tools:nativeData.tools})};
nativeData.tools.forEach((tool,i)=>{
  const compact=JSON.stringify(tool);
  add(tools,{name:tool.name,description:tool.description||'',body:JSON.stringify(tool,null,2),tokens:compact.length/4,basis:'schema-density',path:'tools['+i+']',parameters:Object.keys(tool.parameters?.properties||{}),nativeIndex:i});
});
const schemaTokens=leaves.filter(r=>r.groupId==='tools').reduce((sum,r)=>sum+r.tokens,0);
add(tools,{name:'工具数组封装',description:'数组分隔符、结构开销与估算取整。',body:'工具列表的数组封装，不是工具定义。',tokens:tools.tokens-schemaTokens,basis:'envelope-remainder',path:'tools[] · framing',auxiliary:true});groups.push(tools);
const total=groups.reduce((sum,g)=>sum+g.tokens,0);
assert(groups.every((group,i)=>!i||group.seq>groups[i-1].seq),'This first-request study requires recorded monotonic admission events');
for(const group of groups){
  if(group.queue)assert(group.queue.queued<group.queue.claimed&&group.queue.claimed<group.seq);
  const own=leaves.filter(l=>l.groupId===group.id);assert(own.every(l=>l.tokens>0));
  assert(Math.abs(own.reduce((sum,l)=>sum+l.tokens,0)-group.tokens)<1e-6);
}
// Verify the geometry against the data contract at both broad and narrow sizes.
for(const [w,h] of [[920,520],[700,490],[340,410]]){
  const rects=tileLayout(groups.map(g=>({...g,weight:g.tokens})),w,h);
  assert.equal(rects.length,groups.length);
  for(const r of rects){
    assert(r.x>=-1e-7&&r.y>=-1e-7&&r.x+r.w<=w+1e-7&&r.y+r.h<=h+1e-7);
    assert(Math.abs(r.w*r.h/(w*h)-r.tokens/total)<1e-7);
    const children=tileLayout(leaves.filter(l=>l.groupId===r.id).sort((a,b)=>b.tokens-a.tokens).map(l=>({...l,weight:l.tokens})),r.w,r.h);
    assert(Math.abs(children.reduce((s,c)=>s+c.w*c.h,0)-r.w*r.h)<1e-5);
  }
}
const source={...nativeData.source,date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(toolFrame.time),estimator:'@deepseek-ai/dsh-token-meter/estimate',numericalBasis:'Fixed text density, not provider tokenization or billed usage.',placementBasis:'Native event sequence and official logical message order; not provider byte offsets.'};
const data={schema:'context-matrix-study/1',source,groups,leaves,total,toolCount:nativeData.tools.length,messageCount:slots.length};
const output=new URL('.dsh/context-loading-matrix/',root);mkdirSync(output,{recursive:true});
const serialized=JSON.stringify(data).replaceAll('<','\\u003c');
writeFileSync(new URL('data.json',output),serialized);
const layout=readFileSync(new URL('docs/demo/preset-context/treemap.js',root),'utf8').replace('export function tileLayout','function tileLayout');
let css=readFileSync(new URL('matrix.css',demo),'utf8');
for(const name of ['Geist-Variable.woff2','GeistMono-Variable.woff2']){
  const bytes=readFileSync(new URL('docs/demo/layout-review/fonts/'+name,root));
  css=css.replace('../layout-review/fonts/'+name,'data:font/woff2;base64,'+bytes.toString('base64'));
}
const app=readFileSync(new URL('matrix.js',demo),'utf8');
const assembly=readFileSync(new URL('matrix-assembly.js',demo),'utf8');
new Script(app,{filename:'matrix.js'});
new Script(assembly,{filename:'matrix-assembly.js'});
const html=readFileSync(new URL('matrix.html',demo),'utf8').replace('<link rel="stylesheet" href="matrix.css">','<style>'+css+'</style>')
  .replace('<script src="matrix-data.js" defer></script>','<script>window.CONTEXT_MATRIX='+serialized+';</script>')
  .replace('<script src="matrix-layout.js" defer></script>','<script>'+layout+'</script>')
  .replace('<script src="matrix-assembly.js" defer></script>','<script>'+assembly.replace(/<\/script/gi,'<\\/script')+'</script>')
  .replace('<script src="matrix.js" defer></script>','<script>'+app.replace(/<\/script/gi,'<\\/script')+'</script>');
writeFileSync(new URL('index.html',output),html);
console.log(JSON.stringify({output:'.dsh/context-loading-matrix/index.html',groups:groups.length,items:leaves.length,tokens:total,byGroup:groups.map(g=>({name:g.name,tokens:g.tokens,items:g.items.length})),bytes:Buffer.byteLength(html)}));
