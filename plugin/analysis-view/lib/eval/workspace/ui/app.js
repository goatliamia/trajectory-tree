import {ui as __ttUi} from "./ui-locale.js";
import { toolNameHtml } from './tool-colors.js';
import { managementButton } from './capability-management.js';
import {followDshTheme} from './host-theme.js';
followDshTheme();
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tokens=value=>value==null?'—':value>=1000?(value/1000).toFixed(1)+'k':Math.round(value).toLocaleString(globalThis.__trajectoryLocale??'zh-CN');
const date=value=>new Intl.DateTimeFormat(globalThis.__trajectoryLocale??'zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(value);
const categoryInfo={
  system:{label:__ttUi('系统提示'),color:'system',title:__ttUi('系统提示'),description:__ttUi('预设引导与当前插件注册的提示片段。')},
  instructions:{label:'AGENTS.md',color:'user',title:__ttUi('工作指令'),description:__ttUi('按当前工作目录读取的指令文件。')},
  tools:{label:__ttUi('工具定义'),color:'tools',title:__ttUi('工具定义'),description:__ttUi('当前配置中已识别的工具声明，按名称查看用途与来源。')},
  skills:{label:__ttUi('Skill 目录'),color:'skill',title:__ttUi('Skill 目录'),description:__ttUi('名称与用途进入目录；正文按需加载。')},
  injections:{label:__ttUi('环境注入'),color:'inject',title:__ttUi('环境与插件补充'),description:__ttUi('当前配置注册的环境片段和消息来源，具体内容随运行状态变化。')},
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
function reader(text,label=__ttUi('当前正文'),metric=''){return '<div class="reader-title"><strong>'+esc(label)+'</strong><span>'+esc(metric)+'</span></div><div class="document">'+documentBody(text)+'</div>';}
function entity(row,index,kind=state.category){const key=kind+':'+index;let title,description='',meta='',amount='',amountLabel='',body='';
  if(kind==='instructions'){
    title=row.scope==='个人指令'?row.displayPath:(row.workspaceNames?.[0]?row.workspaceNames[0]+' / ':'')+row.displayPath;description=(row.workspaceNames??[]).filter(Boolean).slice(0,3).join('、')+(row.workspaceNames?.length>3?__ttUi(' 等 ')+row.workspaceNames.length+__ttUi(' 个工作区'):'');meta=row.scope+__ttUi(' · 当前文件 · ')+date(row.modifiedAt);amount='≈ '+tokens(row.tokens);amountLabel=__ttUi('tokens · 文件正文');
    body=metadata([[__ttUi('文件位置'),row.path,true],[__ttUi('加载来源'),row.package,true],[__ttUi('适用工作区'),row.workspaceNames?.filter(Boolean).join('、')],[__ttUi('加载方式'),row.scope==='个人指令'?__ttUi('个人全局指令链'):__ttUi('从项目根目录到会话工作目录，按目录层级加载')],[__ttUi('文件状态'),row.omitted?__ttUi('超出预算，开局未带入'):row.truncated?__ttUi('按当前预算截短'):__ttUi('当前来源文件可读取')]])+reader(row.body,__ttUi('当前文件正文'),row.bytes.toLocaleString('zh-CN')+' bytes');
  }else if(kind==='skills'){
    title=row.name;description=row.description;meta=(row.sourceLabel??'')+(row.package?' · '+row.package:'');amount='≈ '+tokens(row.catalogTokens);amountLabel=__ttUi('tokens · 名称与描述');
    body=metadata([[__ttUi('来源'),row.sourceLabel],[__ttUi('提供方'),row.package??row.provider??__ttUi('本地 Skill 文件'),true],[__ttUi('文件位置'),row.path,true],[__ttUi('修改时间'),date(row.modifiedAt)]])+reader(row.body,__ttUi('当前 Skill 正文'),__ttUi('约 ')+tokens(row.bodyTokens)+__ttUi(' tokens · 按需加载'));
  }else{
    title=row.name;description=kind==='tools'?(row.description||__ttUi('描述含动态字段，查看当前注册位置。')):kind==='system'?(row.kind==='persona'?row.body:row.body?.split('\n')[0]||__ttUi('内容由当前注册的提供方生成。')):(row.kind==='context'?__ttUi('具名运行时环境片段'):__ttUi('按运行事件提供的上下文消息'));
    meta=(row.package??'')+(row.version?' · '+row.version:'');amount=kind==='tools'?(row.measuredTokens==null?__ttUi('待组装'):'≈ '+tokens(row.measuredTokens)):row.kind==='persona'?__ttUi('预设'):row.kind==='context'?__ttUi('环境快照'):kind==='injections'?__ttUi('按需消息'):__ttUi('注册片段');if(kind==='tools')amountLabel=__ttUi('tokens · 声明估算');
    body=metadata([[__ttUi('提供插件'),row.package,true],[__ttUi('当前版本'),row.version],[__ttUi('配置作用域'),row.scope==='preset'?__ttUi('所选预设'):__ttUi('宿主全局')],[__ttUi('注册位置'),row.file?row.file+':'+row.line:null,true]]);
    if(row.body)body+=reader(row.body,kind==='system'&&row.kind==='persona'?__ttUi('预设中的提示文本'):__ttUi('当前源码中的文本片段'));
    if(row.code)body+=__ttUi('<div class="reader-title"><strong>注册位置</strong><span>当前安装源码 · 节选</span></div><pre class="registration-code">')+esc(row.code)+'</pre>';
  }
  let usage='';if(row.usage){const u=row.usage,verb=kind==='tools'?__ttUi('调用'):__ttUi('正文加载／读取');usage='<div class="entity-usage"><strong>'+ (u.unusedCandidate?__ttUi('未见使用'):u.unobserved?__ttUi('暂无使用记录'):u.count?u.count.toLocaleString('zh-CN')+__ttUi(' 次')+verb:__ttUi('观察不足'))+'</strong><span>'+u.visibleSessions+' / '+u.sessions+__ttUi(' 个同模式会话中可见</span></div>');body=metadata([[__ttUi('使用背景'),__ttUi('最近 ')+u.sessions+__ttUi(' 个同模式会话，按当前名称关联')],[verb,u.count+__ttUi(' 次')],[__ttUi('可见范围'),u.visibleSessions+__ttUi(' 个会话')],[__ttUi('发生使用'),u.usedSessions+__ttUi(' 个会话')]])+body;}
  if(kind==='tools'||kind==='skills')body=managementButton(kind==='tools'?'tool':'skill',row.name)+body;
  const origin=row.provenance?.origin??'unknown',originLabel={official:__ttUi('DSH 官方'),plugin:__ttUi('我装的插件'),personal:__ttUi('我的内容'),unknown:__ttUi('来源待确认')}[origin]; const open=state.open===key;return '<details class="entity" data-entity="'+key+'"'+(open?' open':'')+'><summary><div><div class="entity-name '+(kind==='skills'||kind==='tools'?'mono':'')+'">'+(kind==='tools'?toolNameHtml(row.name,title):esc(title))+'</div>'+(description?'<p class="entity-desc">'+esc(description)+'</p>':'')+'<div class="entity-meta"><span class="origin-badge '+origin+'">'+originLabel+'</span>'+esc(meta)+'</div>'+usage+'</div><span class="entity-value">'+esc(amount)+(amountLabel?'<small>'+esc(amountLabel)+'</small>':'')+'</span><span class="chevron" aria-hidden="true">›</span></summary><div class="entity-body">'+body+'</div></details>';
}

import { installController } from './controller.js';
installController({$,state,categoryInfo,entity,documentBody,esc,tokens,date,current,getData:()=>data,setData:value=>{data=value;}});
