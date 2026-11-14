import {tileLayout} from './treemap.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compact=value=>value==null?'—':value>=1000?(value/1000).toFixed(1)+'k':Math.round(value).toLocaleString('zh-CN');
const percent=(value,total)=>total?(value/total*100).toFixed(1)+'%':'—';
const origins={official:{name:'DSH 官方',short:'官方'},personal:{name:'个人与项目',short:'个人'},plugin:{name:'我装的插件',short:'插件'},unknown:{name:'来源待确认',short:'待确认'}};

function itemLabel(row,kind){
  if(kind!=='instructions')return row.name??row.displayPath??'未命名内容';
  if(row.scope==='个人指令')return row.displayPath??row.name??'个人指令';
  const path=row.displayPath??row.name??'AGENTS.md',workspace=row.workspaceNames?.find(Boolean);
  return workspace&&!/^(?:[A-Za-z]:|[~/])/.test(path)?workspace+'/'+path:path;
}
function itemContext(row,kind){
  if(kind==='instructions')return row.scope==='个人指令'?'个人全局 · 各工作区共用':row.workspaceNames?.filter(Boolean).join('、')||'项目目录链';
  if(kind==='skills')return row.sourceLabel??'Skill 目录';
  return row.package??'当前预设';
}
export function compositionGroups(p){
  const groups=Object.entries(origins).map(([id,names])=>({id,...names,...(id==='personal'&&p.configurationScope==='global'?{name:'个人内容'}:{}),tokens:0,pending:0,categories:[],leaves:[]}));
  for(const category of p.statistics.categories){
    const rows=(p[category.id]??[]).flatMap((row,index)=>(category.id==='skills'?row.variants??[row]:[row]).map((variant,variantIndex)=>({row:variant,index,variantIndex})));
    for(const group of groups){
      const own=rows.filter(({row})=>(row.provenance?.origin??'unknown')===group.id);if(!own.length)continue;
      const measured=own.filter(({row})=>Number.isFinite(row.measuredTokens)&&row.measuredTokens>=0),tokens=measured.reduce((sum,{row})=>sum+row.measuredTokens,0);
      group.categories.push({...category,items:own.length,tokens:measured.length?tokens:null,pending:own.length-measured.length});
      group.tokens+=tokens;group.pending+=own.length-measured.length;
      for(const {row,index,variantIndex} of measured)if(row.measuredTokens>0)group.leaves.push({
        key:`${group.id}:${category.id}:${index}:${variantIndex}`,origin:group.id,originName:group.name,kind:category.id,index,variantIndex,
        name:itemLabel(row,category.id),type:category.id==='instructions'?(row.scope??'项目指令'):category.label,
        context:itemContext(row,category.id),path:row.path??row.file??'',tokens:row.measuredTokens,weight:row.measuredTokens,
      });
    }
  }
  return groups.filter(group=>group.categories.length);
}

// Both levels retain measured area. Titles and labels sit outside the plot;
// gutters are borders, never minimum token sizes or an aggregated "other" tile.
export function compositionLayout(groups,width=1000,height=420){
  function partition(rows,x,y,w,h,vertical){
    if(rows.length===1)return [{...rows[0],x,y,w,h}];
    const total=rows.reduce((n,r)=>n+r.tokens,0);let sum=rows[0].tokens,i=1;
    while(i<rows.length-1&&Math.abs(sum+rows[i].tokens-total/2)<Math.abs(sum-total/2))sum+=rows[i++].tokens;
    const share=sum/total;
    return vertical?[...partition(rows.slice(0,i),x,y,w*share,h,false),...partition(rows.slice(i),x+w*share,y,w*(1-share),h,false)]:[...partition(rows.slice(0,i),x,y,w,h*share,true),...partition(rows.slice(i),x,y+h*share,w,h*(1-share),true)];
  }
  const measured=groups.filter(g=>g.tokens>0).sort((a,b)=>b.tokens-a.tokens);
  if(!measured.length||width<=0||height<=0)return [];
  return partition(measured,0,0,width,height,width>=height).map(group=>({...group,
    cells:tileLayout([...group.leaves].sort((a,b)=>b.tokens-a.tokens||a.key.localeCompare(b.key)),group.w,group.h),
  }));
}
function itemAction(item){
  return `data-action="composition-item" data-kind="${item.kind}" data-origin="${item.origin}" data-index="${item.index}" data-variant="${item.variantIndex}"`;
}
function focusContent(item,total){
  return `<span class="home-focus-origin"><i></i>${escape(item.originName??origins[item.origin].name)} · ${escape(item.type)}</span><strong class="home-focus-name">${escape(item.name)}</strong><p class="home-focus-context">${escape(item.context)}</p><div class="home-focus-amount"><strong>${compact(item.tokens)}</strong><span>tokens</span></div><span class="home-focus-share">占全部已计量内容 ${percent(item.tokens,total)}</span><p class="home-focus-scope">${item.kind==='skills'?'这里计量名称与描述，正文按需加载。':item.kind==='instructions'?(item.type==='个人指令'?'通过个人全局指令链加载。':'按会话工作目录加载适用指令。'):item.kind==='tools'?'工具说明与参数定义。':'当前可读取的静态片段。'}</p><button class="home-text-link" ${itemAction(item)}>查看当前内容 <span aria-hidden="true">↗</span></button>`;
}
export function composition(p,scope=null){
  const allGroups=compositionGroups(p),groups=scope?allGroups.filter(g=>g.id===scope):allGroups,total=allGroups.reduce((n,g)=>n+g.tokens,0),shown=groups.reduce((n,g)=>n+g.tokens,0),leaves=groups.flatMap(g=>g.leaves),largest=[...leaves].sort((a,b)=>b.tokens-a.tokens)[0];
  const width=1000,height=420,layout=compositionLayout(groups,width,height),small=leaves.filter(l=>l.tokens/total<.01).length;
  return `<section class="home-composition"><header class="home-section-heading"><div><h2>静态内容分布</h2><p class="home-map-description">每块是一项工具、指令或提示 · 面积表示 tokens${p.configurationScope==='global'?' · 预设全局':''}</p></div><span>${leaves.length} 项已计量 · ≈ ${compact(shown)} tokens</span></header>
    <div class="home-map-legend" role="group" aria-label="放大来源分区">${scope?'<button data-action="composition-origin" data-origin=""><strong>全部来源</strong><span>↶</span></button>':''}${allGroups.map(g=>`<button data-action="composition-origin" data-origin="${g.id}" aria-pressed="${scope===g.id}" title="${scope===g.id?'恢复全部来源':'放大'+g.name}" style="--group:var(--origin-${g.id},var(--tt-muted))"><i></i><strong>${g.name}</strong><span>${percent(g.tokens,total)}</span></button>`).join('')}<small>点击来源放大</small></div>
    ${largest?`<div class="home-map-layout"><div class="home-map-plot" role="group" aria-label="按具体内容及来源分区的矩形树图">${layout.map(g=>`<div class="home-map-origin" style="left:${g.x/width*100}%;top:${g.y/height*100}%;width:${g.w/width*100}%;height:${g.h/height*100}%;--group:var(--origin-${g.id},var(--tt-muted))" aria-label="${g.name}">${g.cells.map(c=>`<button class="home-composition-tile" ${itemAction(c)} data-composition-key="${c.key}" data-composition-item="${escape(JSON.stringify(c))}" style="left:${c.x/g.w*100}%;top:${c.y/g.h*100}%;width:${c.w/g.w*100}%;height:${c.h/g.h*100}%" aria-label="${escape(c.name)}，${escape(c.type)}，${compact(c.tokens)} tokens，${g.name}" title="${escape(c.name)} · ${compact(c.tokens)} tokens"><span class="home-tile-content"><small class="home-tile-type">${escape(c.type)}</small><strong class="home-tile-name">${escape(c.name)}</strong><span class="home-tile-amount">${compact(c.tokens)}<small> tokens</small></span></span></button>`).join('')}</div>`).join('')}</div><aside class="home-map-focus" style="--group:var(--origin-${largest.origin},var(--tt-muted))" data-composition-total="${total}" data-default-item="${escape(JSON.stringify(largest))}">${focusContent(largest,total)}</aside></div><p class="home-map-hint">${small?'小块也保留独立来源，指向或聚焦可查看名称与体积。':'指向或聚焦查看内容，点击打开详情。'}</p>`:'<p class="home-map-empty">当前没有可计量的静态内容。</p>'}
    <div class="home-composition-pending">${groups.flatMap(g=>g.categories.filter(c=>c.pending||c.tokens===0).map(c=>`<button data-action="category" data-kind="${c.id}" data-origin="${g.id}"><i style="background:var(--origin-${g.id},var(--tt-muted))"></i>${g.short} · ${c.label}<span>${c.pending?c.pending+' 项待组装':'0 tokens'}</span><b aria-hidden="true">↗</b></button>`)).join('')}</div></section>`;
}

export function installCompositionHover(root,getPreset){
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-action="composition-origin"]');if(!button)return;
    const origin=button.dataset.origin,scope=button.getAttribute('aria-pressed')==='true'?null:origin||null;
    button.closest('.home-composition').outerHTML=composition(getPreset(),scope);
    if(document.body.dataset.input==='keyboard')([...root.querySelectorAll('[data-action="composition-origin"]')].find(b=>b.dataset.origin===origin)??root.querySelector('[data-action="composition-origin"]'))?.focus({preventScroll:true});
  });
  function show(target){
    const section=target?.closest('.home-composition'),panel=section?.querySelector('.home-map-focus');if(!panel)return;
    const tile=target.closest('[data-composition-item]'),item=JSON.parse(tile?.dataset.compositionItem??panel.dataset.defaultItem);
    if(panel.dataset.currentKey===item.key)return;
    panel.dataset.currentKey=item.key;panel.style.setProperty('--group',`var(--origin-${item.origin},var(--tt-muted))`);panel.innerHTML=focusContent(item,Number(panel.dataset.compositionTotal));
    section.querySelectorAll('[data-composition-key]').forEach(node=>node.classList.toggle('is-linked',node.dataset.compositionKey===item.key));
  }
  for(const event of ['pointerover','focusin'])root.addEventListener(event,event=>{if(event.target.closest('[data-composition-item]'))show(event.target);});
  root.addEventListener('pointerout',event=>{if(!event.target.closest('.home-map-plot'))return;const next=event.relatedTarget instanceof Element?event.relatedTarget:null;if(next?.closest('.home-map-layout')===event.target.closest('.home-map-layout'))return;show(event.target.closest('.home-composition'));});
  root.addEventListener('focusout',event=>{if(!event.target.closest('[data-composition-item]'))return;const next=event.relatedTarget instanceof Element?event.relatedTarget:null;if(!next?.closest('.home-map-layout'))show(event.target.closest('.home-composition'));});
}
