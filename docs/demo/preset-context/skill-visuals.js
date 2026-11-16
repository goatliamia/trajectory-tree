import {tileLayout} from './treemap.js';
import {createZoomTreemap,zoomMapOverlay,zoomMapIndex} from './zoom-treemap.js';
import { renderOverlapOverview } from './overlap-preview.js';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=value=>value>=1000?(value/1000).toFixed(1)+'k':Number(value??0).toLocaleString('zh-CN');
export const skillModifiedAfterRead=skill=>skill.variants?.length?skill.variants.some(v=>v.freshness?.modifiedAfterLastRead):skill.usage?.lastLoadedAt!=null&&skill.modifiedAt>skill.usage.lastLoadedAt;
function coverage(skills,counts,ui){
  const used=skills.filter(s=>(counts.get(s.name)??0)>0).length,total=skills.length,changes=skills.filter(skillModifiedAfterRead).length;
  return `<section class="skill-reading-summary" aria-label="读取覆盖与文件更新"><div class="reading-coverage-group"><div class="reading-summary-label"><h3>读取覆盖</h3><span>${total} 项当前 Skill</span></div><div class="reading-coverage-values">${[['read','有读取记录',used],['unread','无读取记录',total-used]].map(([id,label,value])=>`<button data-skill-action="activity" data-value="${id}" aria-pressed="${ui.skillActivity===id}" ${value?'':'disabled'}><strong>${value}</strong><span>${label}</span><i>${ui.skillActivity===id?'✓':'↗'}</i></button>`).join('')}</div><div class="reading-coverage-bar" aria-hidden="true"><span style="width:${total?used/total*100:0}%"></span></div></div>
  <div class="reading-changes-group"><div class="reading-summary-label"><h3>文件更新</h3></div><button id="skill-changed-trigger" data-skill-action="changed" aria-pressed="${Boolean(ui.skillChanged)}" ${changes?'':'disabled'} title="文件修改时间晚于最近一次对应来源的读取"><strong>${changes}</strong><span>项在最近读取后有修改</span>${changes?'<i>↗</i>':''}</button></div></section>`;
}
function skillMatches(skill,counts,ui){return (!ui.skillActivity||ui.skillActivity==='all'||ui.skillActivity==='read'&&(counts.get(skill.name)??0)>0||ui.skillActivity==='unread'&&!(counts.get(skill.name)??0))&&(!ui.skillChanged||skillModifiedAfterRead(skill));}
function coverageSelection(skills,counts,ui){
  if((!ui.skillActivity||ui.skillActivity==='all')&&!ui.skillChanged)return '';
  const selected=skills.filter(s=>skillMatches(s,counts,ui));
  return `<div class="skill-coverage-selection" role="status"><div><strong>${ui.skillChanged?'最近读取后有修改':ui.skillActivity==='read'?'有读取记录':'无读取记录'} <span>${selected.length} 项</span></strong><button data-skill-action="clear-activity">清除选择 ×</button></div><div class="skill-selected-names">${selected.map(s=>`<button data-skill-action="open" data-name="${e(s.name)}">${e(s.name)} <span>${counts.get(s.name)??0} 次 ↗</span></button>`).join('')||'<span>当前范围没有符合条件的 Skill</span>'}</div></div>`;
}

export function skillMapModel(skills,counts,ui={}){
  const totalReads=skills.reduce((sum,s)=>sum+(counts.get(s.name)??0),0),catalogTokens=skills.reduce((sum,s)=>sum+(Number.isFinite(s.catalogTokens)?s.catalogTokens:0),0);
  const level=share=>share===0?0:share<.1?1:share<.25?2:share<.5?3:4;
  const sorted=skills.filter(s=>s.bodyTokens>0).slice().sort((a,b)=>b.bodyTokens-a.bodyTokens||a.name.localeCompare(b.name));
  const items=sorted.map((skill,index)=>{
    const reads=counts.get(skill.name)??0,share=totalReads?reads/totalReads:0,shade=level(share);
    return {id:'skill:'+skill.name,name:skill.name,type:'Skill 正文',weight:skill.bodyTokens,reads,share,shade,percent:share?Math.round(share*100)+'%':'0%',code:String(index+1).padStart(2,'0'),dim:!skillMatches(skill,counts,ui),
      fill:'var(--skill-read-'+shade+')',stroke:'var(--tt-action)',ink:shade===4?'#fff':'var(--tt-ink)',secondary:n(skill.bodyTokens)+' tokens · '+reads+' 次读取',source:skill};
  });
  if(catalogTokens>0)items.push({id:'skill-catalog',name:'Skill Catalog',type:'Skill 目录',catalog:true,weight:catalogTokens,reads:null,fill:'color-mix(in srgb,var(--tt-action) 3%,var(--tt-surface))',stroke:'var(--tt-action)',
    secondary:skills.length+' 项名称与描述 · '+n(catalogTokens)+' tokens',searchText:'Skill Catalog 目录 '+skills.map(s=>s.name+' '+s.description).join(' ')});
  const total=items.reduce((sum,item)=>sum+item.weight,0);
  return {items,skills,total,catalogTokens,totalReads,layout(width=800,height=432){
    const catalog=items.find(item=>item.catalog),bodies=items.filter(item=>!item.catalog),groups=[],top=catalog?96:20;
    if(catalog)groups.push({id:'skill-directory',name:'Skill Catalog',x:0,y:0,w:width,h:60,frame:false,cells:[{...catalog,x:0,y:0,w:width,h:60}]});
    if(bodies.length)groups.push({id:'skill-bodies',name:'Skill 正文',caption:'Skill 正文 · 按需读取',x:0,y:top,w:width,h:height-top,
      cells:tileLayout(bodies,width,height-top)});
    return {width,height,groups};
  },
    getBody(item){
      if(item.catalog)return skills.map(s=>[s.name,s.description,s.whenToUse].filter(Boolean).join('\n')).join('\n\n');
      const skill=item.source;if(!skill)return '';
      return skill.variants?.length>1?skill.variants.map(v=>'# '+(v.path??v.name)+'\n'+(v.body??'')).join('\n\n'):skill.body??skill.variants?.[0]?.body??'';
    }};
}
function usageMap(skills,counts,ui,onMapModel){
  const model=skillMapModel(skills,counts,ui);onMapModel?.(model);
  if(!model.items.length)return '<div class="skill-graph-empty">当前没有可计量的目录或正文。</div>';
  const width=Math.max(310,globalThis.document?.getElementById('skill-management-panel')?.clientWidth||800),height=width<560?420:432;
  const compact=model.layout(width,height).groups.flatMap(g=>g.cells).filter(c=>!c.catalog&&(c.w<116||c.h<104));
  const first=[...model.items].sort((a,b)=>b.weight-a.weight)[0];
  return `<div class="skill-map-heading"><h3>目录与正文</h3><div class="skill-map-encoding"><span>正文面积 <b>tokens</b></span><span>蓝色 <b>正文读取占比</b></span></div></div>
    <div class="skill-body-plot" style="height:${height}px"><div class="skill-body-map zoom-treemap" style="height:${height}px" role="group" aria-label="上方为独立的 Skill Catalog 目录，下方正文面积表示 tokens，蓝色深浅表示正文读取占比"><canvas class="zoom-map-canvas" tabindex="0" aria-label="Skill 分布，单击查看内容，滚轮缩放，拖动平移，双击进入 / 返回"></canvas>${zoomMapOverlay()}${zoomMapIndex(model.items,cell=>cell.catalog?'data-skill-action="catalog"':`data-skill-action="open" data-name="${e(cell.name)}"`,'skill-body-tile')}</div></div>
    <div class="skill-map-focus" aria-live="polite">${skillMapFocus(first)}</div><p class="skill-catalog-entry">目录用于发现 Skill；下方面积只比较正文大小，正文按需读取。</p>
    <div class="skill-body-scale"><span>正文读取占比</span><div>${['0%','&lt;10%','10–25%','25–50%','≥50%'].map((label,index)=>`<span><i style="background:var(--skill-read-${index})"></i>${label}</span>`).join('')}</div><span class="skill-map-unit">单击详情 · 双击进入 / 返回 · 滚轮缩放</span></div>
    ${compact.length?`<div class="skill-map-key"><div class="skill-map-key-heading"><span>小面积正文</span><span>正文 tokens / 读取次数</span></div><div class="skill-map-key-grid">${compact.map(cell=>`<button class="skill-map-key-row ${cell.dim?'is-filter-muted':''}" data-skill-action="open" data-name="${e(cell.name)}"><span class="skill-key-index ${cell.shade===4?'high-usage':''}" style="--tile-fill:var(--skill-read-${cell.shade})">${cell.code}</span><span class="skill-key-name">${e(cell.name)}</span><span class="skill-key-reading"><b>${n(cell.weight)}</b><small>${cell.reads} 次</small></span></button>`).join('')}</div></div>`:''}`;
}
function skillMapFocus(item){return item?`<strong>${e(item.name)}</strong><span>${item.catalog?item.secondary:n(item.weight)+' tokens · '+item.reads+' 次读取 · 占正文读取 '+item.percent}</span> <button class="text-action" data-skill-action="${item.catalog?'catalog':'open'}" ${item.catalog?'':`data-name="${e(item.name)}"`}>查看${item.catalog?'目录':'正文'} ↗</button>`:'';}
export function renderSkillCatalog(skills){
  return `<div class="skill-detail-title"><h2>Skill Catalog</h2><p>${skills.length} 项名称与描述 · ≈ ${n(skills.reduce((sum,s)=>sum+(s.catalogTokens??0),0))} tokens。正文按需加载。</p></div><div class="skill-catalog-list">${skills.map(s=>`<button type="button" data-skill-action="open" data-name="${e(s.name)}"><strong>${e(s.name)}</strong><p>${e(s.description)}</p>${s.whenToUse?`<p>${e(s.whenToUse)}</p>`:''}</button>`).join('')}</div>`;
}
export function installSkillMap(root,{openSkill,openCatalog,onFrame}={}){
  let view=null,key=null,model=null;const saved=new Map();
  function unmount(){if(view){saved.set(key,view.getState());view.destroy();view=null;}}
  return {unmount,catalogSkills:()=>model?.skills??[],mount(next,presetId){
    unmount();model=next;key=presetId;const host=root.querySelector('.skill-body-map.zoom-treemap');if(!host||!model?.items.length)return;
    let selected=model.items.find(r=>r.id===saved.get(key)?.selection)??[...model.items].sort((a,b)=>b.weight-a.weight)[0];
    const show=item=>{const panel=root.querySelector('.skill-map-focus');if(panel&&item)panel.innerHTML=skillMapFocus(item);};
    view=createZoomTreemap(host,{model,selected:selected.id,viewState:saved.get(key),getBody:model.getBody,onFrame,
      onSelect:item=>{selected=item;view.select(item.id);show(item);},onHover:item=>show(item??selected),onOpen:item=>{if(item.catalog)openCatalog(model.skills);else openSkill(item.name);}});
    view.select(selected.id);show(selected);
  }};
}

export function renderSkillBodyGroup(preset,names){const skills=preset.skills.filter(s=>names.includes(s.name)).sort((a,b)=>b.bodyTokens-a.bodyTokens);return `<div class="skill-detail-title"><h2>${skills.length} 项正文</h2><p>合计 ${n(skills.reduce((sum,s)=>sum+s.bodyTokens,0))} tokens</p></div>${skills.map(s=>`<button class="skill-pair-button" data-skill-action="open" data-name="${e(s.name)}"><span><strong>${e(s.name)}</strong><small>${e(s.description)}</small></span><b>${n(s.bodyTokens)}</b></button>`).join('')}`;}
export function renderSkillLandscape(preset,skills,counts,ui,trend,examples,onMapModel){
  const total=[...counts.values()].reduce((sum,v)=>sum+v,0),label=ui.skillRange?new Date(ui.skillRange.start+28800000).toISOString().slice(5,10).replace('-','/'):ui.skillPeriod==='all'?'全部记录':Number(ui.skillPeriod)===1?'今天':'近 '+(ui.skillPeriod??7)+' 天';
  return `<section class="skill-landscape skill-unified" data-view="usage"><div class="skill-landscape-title"><span>${label} · <strong>${total}</strong> 次读取</span><span>目录、正文与使用情况</span></div><div class="skill-landscape-grid"><div class="skill-activity-overview">${coverage(skills,counts,ui)}${coverageSelection(skills,counts,ui)}<section class="skill-inline-trend" id="skill-timeline-section">${trend}</section></div><section class="skill-landscape-chart" id="skill-composition-section">${usageMap(skills,counts,ui,onMapModel)}</section></div>
  <section class="skill-inline-checks" id="skill-overlap-section">${renderOverlapOverview(preset,examples,{...ui,compactExamples:true})}</section>
  </section>`;
}
