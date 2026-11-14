import {tileLayout} from './treemap.js';
import {originIcon} from './origin-icons.js';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=value=>Number(value||0).toLocaleString('zh-CN');
const compact=value=>value==null?'—':value>=1000?(value/1000).toFixed(1)+'k':n(Math.round(value));
const pct=(value,total)=>total>0?(100*value/total).toFixed(1)+'%':'—';
const category=(kind,extra='')=>`data-action="category" data-kind="${kind}" ${extra}`;
const arrow='<span class="home-arrow" aria-hidden="true">↗</span>';
const documentIcon='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4M9 12h6M9 15.5h6" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

export function currentUsageState(row){return row.usage?.count>0?'used':row.usage?.unusedCandidate?'unused':'limited';}
export function usageDistribution(rows){
  const result={used:0,unused:0,limited:0,total:rows.length};for(const row of rows)result[currentUsageState(row)]++;return result;
}
export function homeArc(cx,cy,outer,inner,start,end){
  const point=(radius,angle)=>`${(cx+radius*Math.cos(angle)).toFixed(3)} ${(cy+radius*Math.sin(angle)).toFixed(3)}`;
  if(end-start>=Math.PI*2-.000001){const mid=start+Math.PI;return `M ${point(outer,start)} A ${outer} ${outer} 0 0 1 ${point(outer,mid)} A ${outer} ${outer} 0 0 1 ${point(outer,end)} L ${point(inner,end)} A ${inner} ${inner} 0 0 0 ${point(inner,mid)} A ${inner} ${inner} 0 0 0 ${point(inner,start)} Z`;}
  const large=end-start>Math.PI?1:0;
  return `M ${point(outer,start)} A ${outer} ${outer} 0 ${large} 1 ${point(outer,end)} L ${point(inner,end)} A ${inner} ${inner} 0 ${large} 0 ${point(inner,start)} Z`;
}
function originSection(p,groups){
  const s=p.statistics;let angle=-Math.PI/2;
  const sectors=groups.filter(g=>g.tokens>0).map(g=>{
    const start=angle;angle+=g.tokens/s.total*Math.PI*2;
    return `<path class="fan-sector ${g.id}" d="${homeArc(150,150,118,80,start,angle)}" style="--sector:var(--origin-${g.id})" data-action="origin" data-origin="${g.id}" data-fan-link="${g.id}" data-fan-label="${e(g.name)}" data-fan-value="${compact(g.tokens)}" data-fan-share="${pct(g.tokens,s.total)}" tabindex="0" role="button" aria-label="${e(g.name)}，${pct(g.tokens,s.total)}，查看当前内容"><title>${e(g.name)} · ${n(g.tokens)} tokens · ${pct(g.tokens,s.total)}</title></path>`;
  }).join('');
  return `<section class="home-origin origin-composition" aria-label="上下文来源构成"><header class="home-section-heading"><div><span class="home-eyebrow">当前预设 · ${e(p.toolMode)}</span><h2>${p.scopeAllWorkspaces?'配置内容构成':'上下文构成'}</h2>${p.scopeAllWorkspaces?'<span>全部工作区 · 按来源去重</span>':''}</div><button class="home-text-link" data-action="about">计量范围 ${arrow}</button></header><div class="home-origin-grid"><figure class="home-origin-figure origin-fan"><svg viewBox="0 0 300 300" role="group" aria-label="已计量静态内容按来源分布"><circle cx="150" cy="150" r="99" fill="none" stroke="var(--tt-grid)" stroke-width="38"/>${sectors}</svg><div class="fan-center" aria-hidden="true"><span data-fan-center-label>已计量静态内容</span><strong data-fan-center-value>${s.total>0?compact(s.total):'—'}</strong><small data-fan-center-share>tokens · 估算</small></div><figcaption>${s.pending?`<button data-action="about">${s.pending} 项待组装 ${arrow}</button>`:'静态内容已计量'}</figcaption></figure><div class="home-origin-list">${groups.map(g=>`<button class="home-origin-row ${g.id}" data-action="origin" data-origin="${g.id}" data-fan-link="${g.id}" data-fan-label="${e(g.name)}" data-fan-value="${compact(g.tokens)}" data-fan-share="${g.tokens==null?'':pct(g.tokens,s.total)}" style="--owner:var(--origin-${g.id});--owner-soft:var(--origin-${g.id}-soft,var(--tt-soft))"><span class="home-owner-icon" aria-hidden="true">${originIcon(g.id)}</span><span class="home-owner-content"><strong>${e(g.name)}</strong><span>${e(g.summary)}</span><small>${g.examples.map(e).join(' · ')}</small></span><span class="home-owner-amount"><strong>${g.tokens==null?'—':pct(g.tokens,s.total)}</strong><small>${g.tokens==null?'体积待组装':'≈ '+compact(g.tokens)+' tokens'}</small></span>${arrow}</button>`).join('')}</div></div></section>`;
}
function useGauge(p,kind,pending=false){
  const stats=p.statistics[kind],d=usageDistribution(p[kind]),isTool=kind==='tools';
  if(pending&&!p.statistics.usage.sessions)return `<section class="home-usage-card" aria-busy="true"><header><h3>${isTool?'工具调用':'Skill 读取'}</h3></header><div class="home-empty-usage"><span class="home-empty-symbol">—</span><strong>正在读取使用记录</strong><p>${d.total} 项当前${isTool?'工具':'Skill'}</p></div></section>`;
  const labels={used:isTool?'有调用记录':'正文有读取',unused:isTool?'未见调用':'未见读取',limited:'记录不足'};
  let angle=-Math.PI;
  const rows=['used','unused','limited'].map(id=>({id,count:d[id],label:labels[id]}));
  const sectors=rows.filter(r=>r.count>0).map(row=>{const start=angle;angle+=row.count/d.total*Math.PI;
    return `<path class="home-use-sector ${row.id}" d="${homeArc(100,100,88,67,start,angle)}" ${row.id==='limited'?`fill="url(#home-hatch-${kind})"`:''} ${category(kind,`data-usage-state="${row.id}"`)} role="button" tabindex="0" aria-label="${row.label} ${row.count} 项，点击查看"><title>${row.label} ${row.count} / ${d.total} · ${pct(row.count,d.total)}</title></path>`;}).join('');
  const legend=rows.map(row=>{
    const inner=`<i class="home-use-dot ${row.id}" aria-hidden="true"></i><span>${row.label}</span><strong>${row.count}</strong>${row.count?'<b aria-hidden="true">›</b>':'<b></b>'}`;
    return row.count?`<button ${category(kind,`data-usage-state="${row.id}"`)}>${inner}</button>`:`<div class="home-use-zero">${inner}</div>`;
  }).join('');
  return `<section class="home-usage-card"><header><h3>${isTool?'工具调用':'Skill 读取'}</h3><span>${n(stats.count)} 次${isTool?'调用':'加载 / 读取'}</span></header>${d.total?`<div class="home-usage-body"><figure class="home-use-gauge"><svg viewBox="0 0 200 116" role="group" aria-label="${isTool?'工具调用':'Skill 正文读取'}覆盖"><defs><pattern id="home-hatch-${kind}" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="var(--tt-grid)"/><path d="M-1 1L1-1M0 5L5 0M4 6L6 4" stroke="#c4ccd6" stroke-width="1"/></pattern></defs>${sectors}</svg><div class="home-gauge-value" aria-hidden="true"><strong>${d.used}</strong><span>/ ${d.total}</span></div><figcaption>${pct(d.used,d.total)} ${isTool?'有调用':'读过正文'}</figcaption></figure><div class="home-use-key">${legend}</div></div>`:`<div class="home-empty-usage"><span class="home-empty-symbol">—</span><strong>此预设未配置 ${isTool?'工具':'Skill'}</strong><p>启用后的使用记录会显示在这里。</p></div>`}<button class="home-text-link" ${isTool?category('tools'):'data-action="eval-tab" data-tab="skills"'}>${isTool?'工具与所属插件':'Skill 使用详情'} ${arrow}</button></section>`;
}
export function instructionSummary(p){
  const personal=p.instructions.filter(f=>f.scope==='个人指令'),project=p.instructions.filter(f=>f.scope!=='个人指令');
  return {personal,project,workspaces:new Set(project.flatMap(f=>f.workspaceIds??[])).size};
}
function instructions(p){
  const {personal,project,workspaces}=instructionSummary(p),count=p.instructions.length;
  return `<section class="home-instructions"><header class="home-section-heading"><h2>指令来源</h2><span>${count} 份文件</span></header>
    <div class="home-instruction-groups">${[['personal','个人全局',personal,'各工作区共用'],['project','项目指令',project,p.scopeAllWorkspaces?workspaces+' 个工作区':'当前工作目录链']].map(([id,label,files,detail])=>`<button class="home-instruction-group" ${category('instructions',`data-instruction-scope="${id}"`)} ${files.length?'':'disabled'}><span class="home-file-icon">${documentIcon}</span><span><strong>${label}</strong><small>${detail}</small></span><b>${files.length}<small>份</small></b>${arrow}</button>`).join('')}</div>
    <p class="home-instruction-rule">${p.scopeAllWorkspaces?'会话按工作目录加载对应项目指令。':'开局加载个人指令与项目目录链；进入更深目录时按需补充。'}</p>
    <button class="home-text-link" ${category('instructions')}>查看文件与适用范围 ${arrow}</button></section>`;
}
export function composition(p,info){
  const s=p.statistics,width=1000,height=280;
  const cells=tileLayout(s.categories.filter(c=>c.tokens>0).map(c=>({...c,weight:c.tokens})).sort((a,b)=>b.weight-a.weight),width,height);
  const label=c=>c.id==='instructions'?'AGENTS.md':c.label;
  const detail=c=>c.id==='skills'?'名称与描述 · 正文按需读取':c.id==='system'?'身份前缀与系统片段':c.id==='instructions'?c.items+' 份指令文件':c.id==='tools'?c.items+' 项工具定义':c.items+' 项环境片段';
  return `<section class="home-composition"><header class="home-section-heading"><div><h2>静态内容分布</h2><p class="home-map-description">面积表示 tokens · 颜色区分内容类型${p.scopeAllWorkspaces?' · 全工作区来源去重':''}</p></div><span>已计量 ≈ ${compact(s.total)} tokens</span></header>
    ${cells.length?`<div class="home-content-map" role="group" aria-label="静态内容矩形树图，面积按 tokens 分配"><div class="home-map-canvas">${cells.map(c=>`<button class="home-composition-tile kind-${c.id}" ${category(c.id)} data-composition-kind="${c.id}" style="left:${c.x/width*100}%;top:${c.y/height*100}%;width:${c.w/width*100}%;height:${c.h/height*100}%;--kind:var(--tt-context-${info[c.id].color})" aria-label="${label(c)}，${compact(c.tokens)} tokens，${pct(c.tokens,s.total)}，查看内容" title="${label(c)} · ${n(c.tokens)} tokens · ${pct(c.tokens,s.total)}"><span class="home-tile-content"><strong class="home-tile-name">${label(c)}</strong><span class="home-tile-amount">${compact(c.tokens)}<small> tokens</small></span><span class="home-tile-detail">${pct(c.tokens,s.total)} · ${detail(c)}</span></span></button>`).join('')}</div></div>`:'<p class="home-map-empty">当前没有可计量的静态内容。</p>'}
    <div class="home-composition-key">${s.categories.map(c=>`<button ${category(c.id)} data-composition-kind="${c.id}" style="--kind:var(--tt-context-${info[c.id].color})" ${c.items?'':'disabled'}><span class="home-key-label"><i></i>${label(c)} ${arrow}</span><span class="home-key-amount"><strong>${compact(c.tokens)}</strong><small>${c.share==null?'待组装':pct(c.tokens,s.total)}</small></span><span class="home-key-detail">${c.pending?c.pending+' 项待组装':detail(c)}</span></button>`).join('')}</div></section>`;
}

export function renderHomeOverview(p,data,info,groups){
  const usage=p.statistics.usage;
  return `<div class="layout-desk home-overview">${originSection(p,groups)}<div class="home-activity-grid"><section class="home-usage"><header class="home-section-heading"><h2>使用覆盖</h2><span>${(usage.period===1?'今天':'近 '+(usage.period??7)+' 天')+' · '+usage.sessions+' 个同预设会话'}</span></header><div class="home-usage-grid">${useGauge(p,'tools',data.progress?.loading)}${useGauge(p,'skills',data.progress?.loading)}</div><p class="home-usage-note">“未见使用”基于至少 3 个可见会话；其余单列为记录不足。</p></section>${instructions(p)}</div>${composition(p,info)}<button class="home-system-link" ${category('system')}><span class="home-system-symbol" aria-hidden="true">✳</span><span><strong>系统提示词</strong><small>身份前缀、Harness 与插件提供的片段</small></span>${arrow}</button></div>`;
}
