import {originIcon} from './origin-icons.js';
import { renderHomeOverview } from './home-overview.js';
export const layouts=[{id:'desk',letter:'A',name:'拼装卡片'},{id:'canvas',letter:'B',name:'来源地图'},{id:'shelf',letter:'C',name:'配置书架'}];
export const originInfo={
  official:{name:'DSH 官方',short:'官方',symbol:'DSH',description:'Harness 和官方扩展提供'},
  plugin:{name:'我装的插件',short:'我的插件',symbol:'＋',description:'你为 DSH 加上的能力'},
  personal:{name:'我的指令与 Skill',short:'我的内容',symbol:'文',description:'来自个人与当前项目的文件'},
  unknown:{name:'来源待确认',short:'待确认',symbol:'?',description:'保留待核对的来源'},
};
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=value=>value==null?'待组装':value>=1000?(value/1000).toFixed(1)+'k':Math.round(value).toLocaleString('zh-CN');
const num=value=>Number(value??0).toLocaleString('zh-CN');
const keys=['system','instructions','tools','skills','injections'];
const titles={system:'系统提示',instructions:'AGENTS.md',tools:'工具',skills:'Skill',injections:'环境与消息'};
const icon=(id,size='')=>`<span class="origin-icon ${id} ${size}" aria-hidden="true">${originIcon(id)}</span>`;
const action=(kind,extra='')=>`data-action="category" data-kind="${kind}" ${extra}`;

export function entriesOf(preset){return keys.flatMap(kind=>preset[kind].map((row,index)=>({row,index,kind,origin:row.provenance?.origin??'unknown'})));}
export function bundleLabel(bundle){
  const label=bundle?.meta?.title?.zh??bundle?.meta?.title?.['zh-CN']??bundle?.meta?.title?.en;
  if(label&&label!==bundle?.name)return label;
  if(bundle?.name==='@deepseek-ai/dsh-base')return 'DSH 基础能力';
  return (bundle?.name??'本地内容').replace(/^@[^/]+\//,'').replace(/^dsh-/,'').split(/[-_]/).map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(' ');
}
export function originGroups(preset,data){
  const entries=entriesOf(preset);
  return Object.entries(originInfo).map(([id,info])=>{
    const items=entries.filter(item=>item.origin===id),known=items.filter(item=>item.row.measuredTokens!=null);
    const bundles=[...new Set(items.map(item=>item.row.provenance?.bundle).filter(Boolean))].map(name=>data.bundleInventory?.find(bundle=>bundle.name===name)??{name}).sort((a,b)=>items.filter(item=>item.row.provenance?.bundle===b.name).length-items.filter(item=>item.row.provenance?.bundle===a.name).length);
    return {id,...info,items,bundles,tokens:known.length?known.reduce((sum,item)=>sum+item.row.measuredTokens,0):items.length?null:0,pending:items.length-known.length,
      tools:items.filter(item=>item.kind==='tools').length,skills:items.filter(item=>item.kind==='skills').length,instructions:items.filter(item=>item.kind==='instructions').length};
  }).filter(group=>group.id!=='unknown'||group.items.length);
}
function groupSentence(group){
  if(!group.items.length)return '这个预设没有带入这些内容';
  return [group.tools?group.tools+' 个工具':'',group.skills?group.skills+' 项 Skill':'',group.instructions?group.instructions+' 份指令':''].filter(Boolean).join(' · ')||group.items.length+' 项提示与环境内容';
}
function examples(group){
  if(group.id==='personal')return [...new Set(group.items.filter(item=>['instructions','skills'].includes(item.kind)).map(item=>item.row.displayPath??item.row.name))].slice(0,3);
  if(group.id==='official')return [group.tools?'文件、执行与工作工具':'',group.items.some(item=>item.kind==='system')?'身份与系统提示':'',group.skills?'预设 Skill':''].filter(Boolean);
  return group.bundles.slice(0,3).map(bundleLabel);
}
function originCard(group,mode='card'){
  return `<button class="origin-card ${group.id} ${mode}" data-action="origin" data-origin="${group.id}" ${mode==='fan-card'?`data-fan-link="${group.id}"`:''}>
    <span class="origin-card-top">${icon(group.id)}<span class="origin-name"><strong>${group.name}</strong><small>${group.description}</small></span><span class="open-arrow">↗</span></span>
    <span class="origin-examples">${examples(group).map(label=>`<span>${e(label)}</span>`).join('')}</span>
    <span class="origin-card-foot"><span>${groupSentence(group)}</span><small>${group.tokens===null?'体积待组装':'≈ '+n(group.tokens)+' tokens'}${mode==='fan-card'&&group.share!==null?`<b class="fan-card-share">${(group.share*100).toFixed(1)}%</b>`:''}</small></span>
  </button>`;
}
function range(p){const u=p.statistics.usage;return u.sessions?`同预设最近 ${u.sessions} 个已读会话 · 跨项目`:'暂无同预设使用记录';}
function usage(p){const s=p.statistics;
  return `<section class="use-story"><div class="story-heading"><span class="eyebrow">使用与检查</span><small>${range(p)}</small></div>
    <div class="story-grid"><div><button class="story-number" ${action('tools')}><strong>${s.tools.used}<small> / ${s.tools.current}</small></strong><span>工具有过调用 <b>↗</b></span></button><p>${num(s.tools.count)} 次调用${s.tools.current-s.tools.used-s.tools.unused?' · '+(s.tools.current-s.tools.used-s.tools.unused)+' 项观察不足':''}</p><button class="review-link" ${action('tools','data-unused="true"')}>${s.tools.unused} 个工具未见使用 <span>→</span></button></div>
    <div><button class="story-number" ${action('skills')}><strong>${s.skills.used}<small> / ${s.skills.current}</small></strong><span>Skill 读过正文 <b>↗</b></span></button><p>${num(s.skills.count)} 次加载／读取${s.skills.current-s.skills.used-s.skills.unused?' · '+(s.skills.current-s.skills.used-s.skills.unused)+' 项观察不足':''}</p><button class="review-link" ${action('skills','data-unused="true"')}>${s.skills.unused} 项 Skill 未见加载 <span>→</span></button></div>
    <div class="instruction-story"><span class="paper-mark" aria-hidden="true">A<span>≡</span></span><button ${action('instructions')}><strong>${s.instructions.files?'我的 AGENTS.md':'工作指令'}</strong><span>${s.instructions.files?(s.instructions.bytes/1024).toFixed(1)+' KB · '+(s.instructions.truncated?'有截短，建议检查':'未见截短'):'此预设未配置'}</span></button><small>${s.instructions.truncated?'先核对关键约束是否完整保留。':'展开查看当前文件与加载来源。'}</small></div></div>
    <p class="quiet-note">“未见使用”要求至少 3 个会话中可见；低频本身不代表无用。</p></section>`;
}
function categoryList(p,info,compact=false){const s=p.statistics;return `<section class="content-composition ${compact?'compact':''}"><div class="story-heading"><h2>内容类型</h2><span>已计量 <b>≈ ${n(s.total)}</b> tokens</span></div>
  <div class="category-collection">${s.categories.map(c=>`<button class="content-kind" ${action(c.id)} style="--kind:var(--tt-context-${info[c.id].color})"><span class="kind-heading"><i></i><strong>${c.label}</strong><small>${c.items} 项</small><b>↗</b></span><span class="kind-amount">${c.tokens===null?'待组装':n(c.tokens)}<small>${c.share==null?'':(c.share*100).toFixed(1)+'%'}</small></span><span class="kind-meter"><i style="width:${(c.share??0)*100}%"></i></span><span class="kind-note">${c.id==='system'?(p.completePrompt?'完整提示替换':'身份前缀 + 系统片段'):c.id==='skills'?'仅目录，正文按需加载':c.pending?c.pending+' 项待组装':c.id==='instructions'?'当前文件正文':'当前声明'}</span></button>`).join('')}</div>
  <p class="quiet-note">${s.pending} 项待运行时组装，占比仅在已计量内容内比较。${p.toolMode==='PTC'?'PTC 的 SDK 实际组装体积另计。':''}</p></section>`;}
function identity(p){const persona=p.system.find(row=>row.kind==='persona');return `<button class="identity-note" ${action('system')}><span class="identity-glyph" aria-hidden="true">✳</span><span><strong>${p.completePrompt?'这个预设替换了完整系统提示':'系统提示词'}</strong><small>${p.completePrompt?'只保留预设指定的系统提示，工具声明另列。':'查看身份前缀、Harness 与插件提供的提示片段。'}</small></span><span>↗</span></button>`;}

// One chart for provenance. Category colors remain reserved for the content
// breakdown below; these sectors use the same ownership colors as the cards.
function sectorPath(start,end){
  const point=(radius,angle)=>[150+radius*Math.cos(angle),150+radius*Math.sin(angle)].map(value=>value.toFixed(3)).join(' ');
  const arc=(radius,from,to,clockwise)=>`A ${radius} ${radius} 0 ${to-from>Math.PI?1:0} ${clockwise} ${point(radius,clockwise?to:from)}`;
  if(end-start>=Math.PI*2-0.00001){const middle=start+Math.PI;return `M ${point(118,start)} ${arc(118,start,middle,1)} ${arc(118,middle,end,1)} L ${point(77,end)} ${arc(77,middle,end,0)} ${arc(77,start,middle,0)} Z`;}
  return `M ${point(118,start)} ${arc(118,start,end,1)} L ${point(77,end)} ${arc(77,start,end,0)} Z`;
}
function originFan(groups,total,pending){
  const active=groups.filter(group=>group.tokens>0);let angle=-Math.PI/2;
  const sectors=active.map(group=>{
    const start=angle,share=group.tokens/total;angle+=share*Math.PI*2;
    const center=(start+angle)/2,percentage=(share*100).toFixed(1);
    return `<path class="fan-sector ${group.id}" d="${sectorPath(start,angle)}" style="--sector:var(--origin-${group.id});--nudge-x:${(Math.cos(center)*4).toFixed(2)}px;--nudge-y:${(Math.sin(center)*4).toFixed(2)}px" data-action="origin" data-origin="${group.id}" data-fan-link="${group.id}" data-fan-label="${e(group.name)}" data-fan-value="${n(group.tokens)}" data-fan-share="${percentage}%" tabindex="0" role="button" aria-label="${e(group.name)}，约 ${num(group.tokens)} tokens，占已计量内容的 ${percentage}%，查看详情"><title>${e(group.name)} · ${percentage}% · ${num(group.tokens)} tokens</title></path>`;
  }).join('');
  const mine=groups.filter(group=>['plugin','personal'].includes(group.id)).reduce((sum,group)=>sum+(group.tokens??0),0);
  return `<section class="origin-composition" aria-label="按来源查看上下文占用"><div class="origin-composition-top"><div class="fan-intro"><span class="eyebrow">当前预设</span><h2>上下文构成</h2><p>当前预设的基础能力、扩展与个人内容。</p><div class="fan-takeaway"><span class="owner-dots" aria-hidden="true"><i></i><i></i></span><span>${total>0?`个人与扩展内容占 <strong>${(mine/total*100).toFixed(1)}%</strong>`:'当前体积尚待计量'}</span></div><p class="fan-measure">只比较已计量的静态内容。<button data-action="about">${pending} 项待组装 <span>↗</span></button></p></div><figure class="origin-fan"><svg viewBox="0 0 300 300" aria-labelledby="fan-title fan-description"><title id="fan-title">上下文来源占比</title><desc id="fan-description">扇区对应下方来源卡片。未知体积不计入面积，点击扇区可查看当前内容。</desc><circle cx="150" cy="150" r="97.5" fill="none" stroke="var(--tt-soft)" stroke-width="41"/>${sectors}</svg><div class="fan-center" aria-hidden="true"><span data-fan-center-label>当前已计量</span><strong data-fan-center-value>${total>0?n(total):'—'}</strong><small data-fan-center-share>tokens · 估算</small></div><figcaption>指向扇区查看占比，点击查看内容</figcaption></figure></div><div class="origin-cards fan-cards">${groups.map(group=>originCard({...group,share:total>0&&group.tokens!==null?group.tokens/total:null},'fan-card')).join('')}</div></section>`;
}
function desk(p,data,info){return renderHomeOverview(p,data,info,originGroups(p,data).map(g=>({...g,examples:examples(g),summary:groupSentence(g)})));}

function canvas(p,data,info){const s=p.statistics,groups=originGroups(p,data);let offset=0;const circumference=2*Math.PI*103;
  const ring=s.categories.filter(c=>c.tokens>0).map(c=>{const length=c.share*circumference;const html=`<circle cx="140" cy="140" r="103" pathLength="${circumference}" fill="none" stroke="var(--tt-context-${info[c.id].color})" stroke-width="16" stroke-dasharray="${Math.max(0,length-3)} ${circumference-Math.max(0,length-3)}" stroke-dashoffset="${-offset}" transform="rotate(-90 140 140)" ${action(c.id)} role="button" tabindex="0" aria-label="查看${c.label}，${n(c.tokens)} tokens"><title>${c.label} · ${n(c.tokens)} tokens</title></circle>`;offset+=length;return html;}).join('');
  return `<div class="layout-canvas"><div class="map-intro"><span class="eyebrow">CONTEXT / ${e(p.name.toUpperCase())}</span><h2>谁为它带来了这些能力？</h2><p>每一项内容，都有它的来处。</p></div><div class="source-map"><div class="context-core"><svg viewBox="0 0 280 280" aria-label="已计量内容构成"><circle cx="140" cy="140" r="103" fill="none" stroke="var(--tt-line)" stroke-width="16"/>${ring}</svg><div class="core-label"><span>当前上下文</span><strong>${n(s.total)}</strong><small>tokens · 已计量部分</small><button data-action="about">${s.pending} 项待组装 ↗</button></div></div><div class="source-branches">${groups.map(g=>originCard(g,'map-node')).join('')}</div></div><div class="map-legend">${s.categories.map(c=>`<button ${action(c.id)}><i style="background:var(--tt-context-${info[c.id].color})"></i>${c.label}<b>${c.tokens===null?'—':n(c.tokens)}</b></button>`).join('')}</div>${identity(p)}${usage(p)}</div>`;
}
function bundleArt(bundle,id){const img=bundle?.meta?.icon;if(typeof img==='string'&&/^data:image\/(?:svg\+xml|png|jpeg|webp);base64,/.test(img))return `<img src="${e(img)}" alt="" loading="lazy">`;const label=bundleLabel(bundle),initials=/^[a-z]/i.test(label)?label.split(' ').slice(0,2).map(word=>word[0]).join(''):id==='official'?'DSH':label.slice(0,1);return `<span class="bundle-monogram ${id}" aria-hidden="true">${e(initials)}</span>`;}
function shelf(p,data,info,ui){const groups=originGroups(p,data),selected=ui.originFilter??'all';
  return `<div class="layout-shelf"><div class="shelf-intro"><h2>一个属于你的工作环境。</h2><p>DSH 打好底，你的插件与文件补上其余部分。</p></div><div class="shelf-glance"><span>最近的使用</span><button ${action('tools')}>${p.statistics.tools.used} / ${p.statistics.tools.current} 工具有调用</button><button ${action('skills')}>${p.statistics.skills.used} / ${p.statistics.skills.current} Skill 读过正文</button><span>已计量 ≈ ${n(p.statistics.total)} tokens</span></div><div class="shelf-filters" role="group" aria-label="按来源查看"><button data-action="filter-origin" data-origin="all" aria-pressed="${selected==='all'}">全部来源</button>${groups.map(g=>`<button data-action="filter-origin" data-origin="${g.id}" aria-pressed="${selected===g.id}">${icon(g.id,'tiny')}${g.short}</button>`).join('')}</div>
  <div class="shelf-sections">${groups.filter(g=>selected==='all'||g.id===selected).map(g=>`<section class="shelf-section ${g.id}"><div class="shelf-section-title">${icon(g.id)}<div><h3>${g.name}</h3><p>${g.description}</p></div><button data-action="origin" data-origin="${g.id}">${groupSentence(g)} <span>↗</span></button></div><div class="shelf-items">${g.id==='personal'?g.items.filter(item=>['instructions','skills'].includes(item.kind)).slice(0,ui.allPersonal?100:4).map(item=>`<button class="shelf-item file-item" ${action(item.kind,`data-index="${item.index}"`)}><span class="file-icon">${item.kind==='instructions'?'md':'S'}</span><span><strong>${e(item.row.displayPath??item.row.name)}</strong><small>${e(item.row.scope??item.row.sourceLabel)}${item.row.usage?.unusedCandidate?' · 未见加载':''}</small></span><b>↗</b></button>`).join(''):g.bundles.slice(0,ui.allBundles?100:g.id==='official'?3:6).map(bundle=>`<button class="shelf-item" data-action="bundle" data-bundle="${e(bundle.name)}">${bundleArt(bundle,g.id)}<span><strong>${e(bundleLabel(bundle))}</strong><small>${e((bundle.meta?.description?.zh??bundle.description??'').slice(0,72))}</small></span><b>↗</b></button>`).join('')||'<p class="quiet-note">此预设尚未带入这一类内容。</p>'}</div><button class="shelf-more" data-action="origin" data-origin="${g.id}">查看${g.items.length}项当前内容与使用情况 →</button></section>`).join('')}</div>${categoryList(p,info,true)}${identity(p)}${usage(p)}</div>`;
}
export function renderLayout(preset,data,layout,ui,info){return (layout==='canvas'?canvas:layout==='shelf'?shelf:desk)(preset,data,info,ui);}
