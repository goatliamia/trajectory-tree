import { toolNameHtml } from './tool-colors.js';
import { managementButton } from './capability-management.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tokens=value=>value==null?'—':value>=1000?(value/1000).toFixed(1)+'k':Math.round(value).toLocaleString('zh-CN');
const date=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(value);
const categoryInfo={
  system:{label:'系统提示',color:'system',title:'系统提示',description:'预设引导与当前插件注册的提示片段。'},
  instructions:{label:'AGENTS.md',color:'user',title:'工作指令',description:'按当前工作目录读取的指令文件。'},
  tools:{label:'工具定义',color:'tools',title:'工具定义',description:'当前配置中已识别的工具声明，按名称查看用途与来源。'},
  skills:{label:'Skill 目录',color:'skill',title:'Skill 目录',description:'名称与用途进入目录；正文按需加载。'},
  injections:{label:'环境注入',color:'inject',title:'环境与插件补充',description:'当前配置注册的环境片段和消息来源，具体内容随运行状态变化。'},
};
let data;const state={preset:null,category:'overview',query:'',open:undefined,unused:false};
const current=()=>data.presets.find(row=>row.id===state.preset)??data.presets[0];
function inline(text){return esc(text).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');}
function documentBody(text){
  const lines=String(text??'').split(/\r?\n/),html=[];let code=null,list=null,paragraph=[];
  const flush=()=>{if(paragraph.length){html.push('<p>'+inline(paragraph.join(' '))+'</p>');paragraph=[];}};
  const closeList=()=>{if(list){html.push('</'+list+'>');list=null;}};
  for(const line of lines){
    if(/^\s*```/.test(line)){flush();closeList();if(code){html.push('<pre><code>'+esc(code.join('\n'))+'</code></pre>');code=null;}else code=[];continue;}
    if(code){code.push(line);continue;}
    const heading=line.match(/^#{1,6}\s+(.+)/),item=line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)/),quote=line.match(/^\s*>\s?(.*)/);
    if(heading){flush();closeList();html.push('<h3>'+inline(heading[1])+'</h3>');}
    else if(item){flush();const kind=item[2]?'ol':'ul';if(list!==kind){closeList();html.push('<'+kind+(item[2]?' start="'+Number(item[2])+'"':'')+'>');list=kind;}html.push('<li>'+inline(item[3])+'</li>');}
    else if(quote){flush();closeList();html.push('<blockquote>'+inline(quote[1])+'</blockquote>');}
    else if(!line.trim()){flush();closeList();}else{closeList();paragraph.push(line);}
  }
  flush();closeList();if(code)html.push('<pre><code>'+esc(code.join('\n'))+'</code></pre>');return html.join('');
}
function metadata(pairs){return '<dl class="entity-source">'+pairs.filter(([,value])=>value!==null&&value!==undefined&&value!=='').map(([label,value,mono])=>'<dt>'+esc(label)+'</dt><dd'+(mono?' class="source-path"':'')+'>'+esc(value)+'</dd>').join('')+'</dl>';}
function reader(text,label='当前正文',metric=''){return '<div class="reader-title"><strong>'+esc(label)+'</strong><span>'+esc(metric)+'</span></div><div class="document">'+documentBody(text)+'</div>';}
function entity(row,index,kind=state.category){const key=kind+':'+index;let title,description='',meta='',amount='',amountLabel='',body='';
  if(kind==='instructions'){
    title=row.scope==='个人指令'?row.displayPath:(row.workspaceNames?.[0]?row.workspaceNames[0]+' / ':'')+row.displayPath;description=(row.workspaceNames??[]).filter(Boolean).slice(0,3).join('、')+(row.workspaceNames?.length>3?' 等 '+row.workspaceNames.length+' 个工作区':'');meta=row.scope+' · 当前文件 · '+date(row.modifiedAt);amount='≈ '+tokens(row.tokens);amountLabel='tokens · 文件正文';
    body=metadata([['文件位置',row.path,true],['加载来源',row.package,true],['适用工作区',row.workspaceNames?.filter(Boolean).join('、')],['加载方式',row.scope==='个人指令'?'个人全局指令链':'从项目根目录到会话工作目录，按目录层级加载'],['文件状态',row.omitted?'超出预算，开局未带入':row.truncated?'按当前预算截短':'当前来源文件可读取']])+reader(row.body,'当前文件正文',row.bytes.toLocaleString('zh-CN')+' bytes');
  }else if(kind==='skills'){
    title=row.name;description=row.description;meta=row.sourceLabel+(row.package?' · '+row.package:'');amount='≈ '+tokens(row.catalogTokens);amountLabel='tokens · 名称与描述';
    body=metadata([['来源',row.sourceLabel],['提供方',row.package??row.provider??'本地 Skill 文件',true],['文件位置',row.path,true],['修改时间',date(row.modifiedAt)]])+reader(row.body,'当前 Skill 正文','约 '+tokens(row.bodyTokens)+' tokens · 按需加载');
  }else{
    title=row.name;description=kind==='tools'?(row.description||'描述含动态字段，查看当前注册位置。'):kind==='system'?(row.kind==='persona'?row.body:row.body?.split('\n')[0]||'内容由当前注册的提供方生成。'):(row.kind==='context'?'具名运行时环境片段':'按运行事件提供的上下文消息');
    meta=row.package+(row.version?' · '+row.version:'');amount=kind==='tools'?(row.measuredTokens==null?'待组装':'≈ '+tokens(row.measuredTokens)):row.kind==='persona'?'预设':row.kind==='context'?'环境快照':kind==='injections'?'按需消息':'注册片段';if(kind==='tools')amountLabel='tokens · 声明估算';
    body=metadata([['提供插件',row.package,true],['当前版本',row.version],['配置作用域',row.scope==='preset'?'所选预设':'宿主全局'],['注册位置',row.file?row.file+':'+row.line:null,true]]);
    if(row.body)body+=reader(row.body,kind==='system'&&row.kind==='persona'?'预设中的提示文本':'当前源码中的文本片段');
    if(row.code)body+='<div class="reader-title"><strong>注册位置</strong><span>当前安装源码 · 节选</span></div><pre class="registration-code">'+esc(row.code)+'</pre>';
  }
  let usage='';if(row.usage){const u=row.usage,verb=kind==='tools'?'调用':'正文加载／读取';usage='<div class="entity-usage"><strong>'+ (u.unusedCandidate?'未见使用':u.unobserved?'暂无使用记录':u.count?u.count.toLocaleString('zh-CN')+' 次'+verb:'观察不足')+'</strong><span>'+u.visibleSessions+' / '+u.sessions+' 个同模式会话中可见</span></div>';body=metadata([['使用背景','最近 '+u.sessions+' 个同模式会话，按当前名称关联'],[verb,u.count+' 次'],['可见范围',u.visibleSessions+' 个会话'],['发生使用',u.usedSessions+' 个会话']])+body;}
  if(kind==='tools'||kind==='skills')body=managementButton(kind==='tools'?'tool':'skill',row.name)+body;
  const origin=row.provenance?.origin??'unknown',originLabel={official:'DSH 官方',plugin:'我装的插件',personal:'我的内容',unknown:'来源待确认'}[origin]; const open=state.open===key;return '<details class="entity" data-entity="'+key+'"'+(open?' open':'')+'><summary><div><div class="entity-name '+(kind==='skills'||kind==='tools'?'mono':'')+'">'+(kind==='tools'?toolNameHtml(row.name,title):esc(title))+'</div>'+(description?'<p class="entity-desc">'+esc(description)+'</p>':'')+'<div class="entity-meta"><span class="origin-badge '+origin+'">'+originLabel+'</span>'+esc(meta)+'</div>'+usage+'</div><span class="entity-value">'+esc(amount)+(amountLabel?'<small>'+esc(amountLabel)+'</small>':'')+'</span><span class="chevron" aria-hidden="true">›</span></summary><div class="entity-body">'+body+'</div></details>';
}

import { installController } from './controller.js';
installController({$,state,categoryInfo,entity,documentBody,esc,tokens,date,current,getData:()=>data,setData:value=>{data=value;}});
