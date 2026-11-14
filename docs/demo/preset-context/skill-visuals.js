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
function tileLayout(items,width,height){
  const total=items.reduce((sum,row)=>sum+row.weight,0),pending=items.map(row=>({...row,area:row.weight/total*width*height})),out=[];
  let x=0,y=0,w=width,h=height;
  const worst=(row,side)=>{const areas=row.map(r=>r.area),sum=areas.reduce((a,b)=>a+b,0);return Math.max(side*side*Math.max(...areas)/(sum*sum),sum*sum/(side*side*Math.min(...areas)));};
  while(pending.length){
    const side=Math.min(w,h),row=[pending.shift()];
    while(pending.length&&worst([...row,pending[0]],side)<=worst(row,side))row.push(pending.shift());
    const sum=row.reduce((n,r)=>n+r.area,0);
    if(w>=h){const rw=sum/h;let ry=y;for(const r of row){const rh=r.area/rw;out.push({...r,x,y:ry,w:rw,h:rh});ry+=rh;}x+=rw;w-=rw;}
    else{const rh=sum/w;let rx=x;for(const r of row){const rw=r.area/rh;out.push({...r,x:rx,y,w:rw,h:rh});rx+=rw;}y+=rh;h-=rh;}
  }
  return out;
}
function usageMap(skills,counts,ui){
  const sorted=skills.filter(s=>s.bodyTokens>0).slice().sort((a,b)=>b.bodyTokens-a.bodyTokens),totalReads=skills.reduce((sum,s)=>sum+(counts.get(s.name)??0),0);
  if(!sorted.length)return '<div class="skill-graph-empty">当前没有可计量的正文。</div>';
  const shades=['#f1f1f1','#e4f1ff','#bddcff','#7fbafa','#3485ed'],level=share=>share===0?0:share<.1?1:share<.25?2:share<.5?3:4;
  const width=Math.max(310,globalThis.document?.getElementById('skill-management-panel')?.clientWidth||800),height=width<560?340:352;
  const cells=tileLayout(sorted.map((s,index)=>({name:s.name,weight:s.bodyTokens,reads:counts.get(s.name)??0,code:String(index+1).padStart(2,'0'),matches:skillMatches(s,counts,ui)})),width,height).map(cell=>{
    const share=totalReads?cell.reads/totalReads:0;
    return {...cell,share,shade:level(share),percent:share?Math.round(share*100)+'%':'0%',compact:cell.w<116||cell.h<104,tiny:cell.w<23||cell.h<25};
  });
  const compact=cells.filter(c=>c.compact),tiny=cells.filter(c=>c.tiny);
  const buttonAttributes=cell=>`data-skill-action="open" data-name="${e(cell.name)}" data-map-name="${e(cell.name)}" aria-label="${e(cell.name)}，正文 ${cell.weight} tokens，${cell.reads} 次读取，占 ${cell.percent}" title="${e(cell.name)} · ${cell.weight} tokens · ${cell.reads} 次读取（${cell.percent}）"`;
  return `<div class="skill-map-heading"><h3>正文构成与读取</h3><div class="skill-map-encoding"><span>面积 <b>正文 tokens</b></span><span>颜色 <b>读取占比</b></span></div></div>
  <div class="skill-body-plot" style="height:${height+(tiny.length?26:0)}px"><div class="skill-body-map" style="height:${height}px" role="group" aria-label="每个矩形代表一个 Skill；面积表示正文 tokens，蓝色深浅表示读取占比">${cells.map(cell=>`<button class="skill-body-tile ${cell.matches?'':'is-filter-muted'} ${cell.compact?'numbered-tile':''} ${cell.tiny?'tiny-tile':''} ${cell.reads?'was-read':''} ${cell.shade===4?'high-usage':''}" style="left:${cell.x/width*100}%;top:${cell.y/height*100}%;width:${cell.w/width*100}%;height:${cell.h/height*100}%;--tile-fill:${shades[cell.shade]}" ${buttonAttributes(cell)}>${cell.compact?(cell.tiny?'':`<span class="skill-tile-index">${cell.code}</span>`):`<span class="skill-body-name">${e(cell.name).replaceAll('-','-<wbr>')}</span><div class="skill-body-values"><strong>${n(cell.weight)}<small> tokens</small></strong><span class="skill-body-read"><b>${cell.reads}</b> 次读取${cell.reads?' · '+cell.percent:''}</span></div>`}</button>`).join('')}</div>
  ${tiny.length?`<svg class="skill-map-callouts" viewBox="0 0 ${width} ${height+26}" aria-label="小面积 Skill 编号">${tiny.map((cell,index)=>{const cx=cell.x+cell.w/2,tx=Math.min(width-9,cx);return `<g role="button" tabindex="0" ${buttonAttributes(cell)}><path d="M${cx} ${cell.y+cell.h/2} L${cx} ${height+8} L${tx} ${height+8}"/><text x="${tx}" y="${height+22}" text-anchor="middle">${cell.code}</text></g>`;}).join('')}</svg>`:''}</div>
  <div class="skill-body-scale"><span>读取占比</span><div>${['0%','&lt;10%','10–25%','25–50%','≥50%'].map((label,index)=>`<span><i style="background:${shades[index]}"></i>${label}</span>`).join('')}</div><span class="skill-map-unit">一格一项 Skill</span></div>
  ${compact.length?`<div class="skill-map-key"><div class="skill-map-key-heading"><span>小面积项</span><span>正文 tokens / 读取次数</span></div><div class="skill-map-key-grid">${compact.map(cell=>`<button class="skill-map-key-row ${cell.matches?'':'is-filter-muted'}" ${buttonAttributes(cell)}><span class="skill-key-index ${cell.shade===4?'high-usage':''}" style="--tile-fill:${shades[cell.shade]}">${cell.code}</span><span class="skill-key-name">${e(cell.name)}</span><span class="skill-key-reading"><b>${n(cell.weight)}</b><small>${cell.reads} 次</small></span></button>`).join('')}</div></div>`:''}`;
}
export function renderSkillBodyGroup(preset,names){const skills=preset.skills.filter(s=>names.includes(s.name)).sort((a,b)=>b.bodyTokens-a.bodyTokens);return `<div class="skill-detail-title"><h2>${skills.length} 项正文</h2><p>合计 ${n(skills.reduce((sum,s)=>sum+s.bodyTokens,0))} tokens</p></div>${skills.map(s=>`<button class="skill-pair-button" data-skill-action="open" data-name="${e(s.name)}"><span><strong>${e(s.name)}</strong><small>${e(s.description)}</small></span><b>${n(s.bodyTokens)}</b></button>`).join('')}`;}
export function renderSkillLandscape(preset,skills,counts,ui,trend,examples){
  const total=[...counts.values()].reduce((sum,v)=>sum+v,0),label=ui.skillRange?new Date(ui.skillRange.start+28800000).toISOString().slice(5,10).replace('-','/'):ui.skillPeriod==='all'?'全部记录':Number(ui.skillPeriod)===1?'今天':'近 '+(ui.skillPeriod??7)+' 天';
  return `<section class="skill-landscape skill-unified" data-view="usage"><div class="skill-landscape-title"><span>${label} · <strong>${total}</strong> 次读取</span><span>目录、正文与使用情况</span></div><div class="skill-landscape-grid"><div class="skill-activity-overview">${coverage(skills,counts,ui)}${coverageSelection(skills,counts,ui)}<section class="skill-inline-trend" id="skill-timeline-section">${trend}</section></div><section class="skill-landscape-chart" id="skill-composition-section">${usageMap(skills,counts,ui)}</section></div>
  <section class="skill-inline-checks" id="skill-overlap-section">${renderOverlapOverview(preset,examples,{...ui,compactExamples:true})}</section>
  </section>`;
}
