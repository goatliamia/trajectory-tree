export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHtml;
const n=value=>Number(value||0).toLocaleString('zh-CN');
const compact=value=>value>=1000?(value/1000).toFixed(1)+'k':n(value);
const percent=value=>(value*100).toFixed(value&&value<.01?2:1)+'%';
export const contextKinds={system:'系统提示',instructions:'项目指令',tools:'工具说明',catalog:'Skill 目录',skills:'Skill 正文',injections:'插件注入'};
export const contextPhases={startup:'开场配置','on-demand':'按需加载',dynamic:'动态注入片段','tool-directory':'PTC 工具目录'};
const origins={official:'DSH 官方',plugin:'用户插件',personal:'个人 / 项目',unknown:'来源未归属'};
export const itemName=item=>item.name+(item.field==='body'?'':item.field==='description'?' · 描述':item.field==='whenToUse'?' · 使用条件':' · '+item.field.replace('parameters/',''));
const documentIcon='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3.5h7l4 4v13H6V3.5h1Zm7 0v4h4M9 12h6M9 15.5h6" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

export function coverageView(item,coverage,side,{path=false}={}){
  return `<section class="co-document" data-kind="${e(item.kind)}">
    <div class="co-document-heading"><span class="co-document-icon">${documentIcon}</span><div>
      <div class="co-document-name"><span class="co-document-side">${side}</span><h3>${e(itemName(item))}</h3></div>
      <div class="co-source-tags"><span>${contextKinds[item.kind]}</span><span>${origins[item.origin]||origins.unknown}</span><span>${contextPhases[item.phase]}</span>${item.evidence==='static-fragment'?'<span>静态片段</span>':''}</div>
    </div></div>
    <div class="co-document-scale"><div><span>相同文字占全文</span><strong>${coverage==null?'—':percent(coverage)}</strong></div><div class="co-document-track" role="img" aria-label="${e(itemName(item))}：${coverage==null?'未进行自动比对':percent(coverage)+' 的文字相同'}"><span style="width:${(coverage||0)*100}%"></span></div><small>全文 ${n(item.characters)} 字符</small></div>
    ${path?`<details class="co-source-location"><summary>来源位置</summary><code>${e(item.path||item.package||'当前配置')}</code>${item.package?`<small>${e(item.package)}</small>`:''}</details>`:''}
  </section>`;
}

export function renderOverlapPair(pair,left,right){
  const excerpt=left.text.slice(pair.matches[0].left.start,pair.matches[0].left.end);
  const characters=Array.from(excerpt.replace(/^[\s，。,:;；]+/u,'')),quote=characters.slice(0,180).join('');
  return `<article class="co-pair"><header class="co-pair-heading"><span>${pair.matches.length} 处相同片段${pair.reference?' · 正文含引用':''}</span><button type="button" data-co-pair="${e(pair.id)}" class="co-open-pair">查看原文 <span aria-hidden="true">↗</span></button></header>
    <div class="co-comparison-layout"><div class="co-document-pair">${coverageView(left,pair.leftCoverage,'A')}${coverageView(right,pair.rightCoverage,'B')}</div>
      <section class="co-common"><div class="co-common-heading"><span>相同片段</span><strong>${n(pair.characters)}<small> 字符</small></strong></div><blockquote class="co-shared-quote">${e(quote)}${characters.length>180?'…':''}</blockquote>${pair.matches.length>1?`<div class="co-quote-caption">另有 ${pair.matches.length-1} 处片段</div>`:''}</section>
    </div></article>`;
}

function renderScope(data,groups,scopeOpen,kind){
  const max=Math.max(1,...groups.map(group=>group.characters));
  return `<details class="co-distribution" ${scopeOpen?'open':''}><summary><span>比对范围</span><small>${groups.map(group=>group.label+' '+group.count).join(' · ')}</small></summary><div class="co-distribution-rows">${groups.map(group=>`<button data-co-kind="${group.kind}" aria-pressed="${kind===group.kind}"><span>${group.label}<small>${group.count} 项</small></span><span class="co-bar-track"><i style="width:${group.characters/max*100}%"><b style="width:${group.matched/(group.characters||1)*100}%"></b></i></span><span class="co-bar-value">${compact(group.characters)}<small>${group.matched?compact(group.matched)+' 相同':'—'}</small></span></button>`).join('')}</div></details>`;
}

export function renderOverlapPage(data,{scopeOpen,filterOpen,filter}){
  const groups=Object.entries(contextKinds).map(([kind,label])=>{const items=data.items.filter(item=>item.kind===kind);return{kind,label,characters:items.reduce((sum,item)=>sum+item.characters,0),matched:items.reduce((sum,item)=>sum+item.matchedCharacters,0),count:items.length};}).filter(group=>group.count);
  const active=filter.kind!=='all'||filter.phase!=='all';
  const captured=new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Shanghai'}).format(data.capturedAt);
  return `<section class="co-page">
    <header class="co-context-summary"><div><p><strong>${n(data.summary.items)}</strong> 项文本 <span>·</span> ${compact(data.summary.characters)} 字符</p><small>${e(data.workspace?.name||'当前项目')} · 当前配置与本地正文 · ${captured}</small></div><div class="co-page-actions"><button type="button" class="tt-button" data-co="diagnose">诊断加载项</button><details class="co-actions-menu"><summary aria-label="更多上下文操作">···</summary><div><button data-co="choose">选择两项对照</button><button data-co="method">计算口径</button></div></details></div></header>
    ${renderScope(data,groups,scopeOpen,filter.kind)}
    <section class="co-results" aria-labelledby="co-results-title"><header class="co-results-heading"><div><h3 id="co-results-title">文本重合 <span class="co-result-count"></span></h3><p>${n(data.summary.involved)} 项内容含相同片段</p></div><div class="co-results-tools"><input type="search" data-co-query aria-label="查找加载项" placeholder="查找名称或文件" value="${e(filter.query)}"><details class="co-filter-menu" ${filterOpen?'open':''}><summary aria-label="筛选重合内容">筛选${active?' · 已应用':''}<span aria-hidden="true">⌄</span></summary><div class="co-filters" id="co-filters"><label>内容类型<select data-co-filter="kind" aria-label="内容类型"><option value="all">全部内容类型</option>${groups.map(group=>`<option value="${group.kind}" ${filter.kind===group.kind?'selected':''}>${group.label}</option>`).join('')}</select></label><label>加载位置<select data-co-filter="phase" aria-label="加载位置"><option value="all">全部加载位置</option>${Object.entries(contextPhases).map(([id,name])=>`<option value="${id}" ${filter.phase===id?'selected':''}>${name}</option>`).join('')}</select></label><button class="text-action" data-co="clear-filters">恢复全部</button></div></details></div></header><div class="co-pairs"></div></section>
  </section>`;
}
