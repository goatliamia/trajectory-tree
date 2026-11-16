import {ui as __ttUi} from "./ui-locale.js";
// Only controlled category/mode labels use UI translation; names and bodies stay raw.
const uiLabel=value=>globalThis.__trajectoryUi?.(value)??value;
import {tileLayout} from './treemap.js';
import {createZoomTreemap,zoomMapOverlay,zoomMapIndex} from './zoom-treemap.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compact=value=>value==null?'—':value>=1000?(value/1000).toFixed(1)+'k':Math.round(value).toLocaleString('zh-CN');
const percent=(value,total)=>total?(value/total*100).toFixed(1)+'%':'—';
const origins={official:{name:__ttUi('DSH 官方'),short:__ttUi('官方')},personal:{name:__ttUi('个人与项目'),short:__ttUi('个人')},plugin:{name:__ttUi('我装的插件'),short:__ttUi('插件')},unknown:{name:__ttUi('来源待确认'),short:__ttUi('待确认')}};

function itemLabel(row,kind){
  if(kind!=='instructions')return row.name??row.displayPath??__ttUi('未命名内容');
  if(row.scope==='个人指令')return row.displayPath??row.name??__ttUi('个人指令');
  const path=row.displayPath??row.name??'AGENTS.md',workspace=row.workspaceNames?.find(Boolean);
  return workspace&&!/^(?:[A-Za-z]:|[~/])/.test(path)?workspace+'/'+path:path;
}
function itemContext(row,kind){
  if(kind==='instructions')return row.scope==='个人指令'?__ttUi('个人全局 · 各工作区共用'):row.workspaceNames?.filter(Boolean).join('、')||__ttUi('项目目录链');
  if(kind==='skills')return row.sourceLabel??__ttUi('Skill 目录');
  return row.package??__ttUi('当前预设');
}
export function compositionGroups(p){
  const groups=Object.entries(origins).map(([id,names])=>({id,...names,...(id==='personal'&&p.configurationScope==='global'?{name:__ttUi('个人内容')}:{}),tokens:0,pending:0,categories:[],leaves:[]}));
  for(const category of p.statistics.categories){
    const rows=(p[category.id]??[]).flatMap((row,index)=>(category.id==='skills'?row.variants??[row]:[row]).map((variant,variantIndex)=>({row:variant,index,variantIndex})));
    for(const group of groups){
      const own=rows.filter(({row})=>(row.provenance?.origin??'unknown')===group.id);if(!own.length)continue;
      const measured=own.filter(({row})=>Number.isFinite(row.measuredTokens)&&row.measuredTokens>=0),tokens=measured.reduce((sum,{row})=>sum+row.measuredTokens,0);
      group.categories.push({...category,items:own.length,tokens:measured.length?tokens:null,pending:own.length-measured.length});
      group.tokens+=tokens;group.pending+=own.length-measured.length;
      for(const {row,index,variantIndex} of measured)if(row.measuredTokens>0)group.leaves.push({
        key:`${group.id}:${category.id}:${index}:${variantIndex}`,origin:group.id,originName:group.name,kind:category.id,index,variantIndex,
        name:itemLabel(row,category.id),type:category.id==='instructions'?(row.scope??__ttUi('项目指令')):category.label,
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
  return __ttUi`<span class="home-focus-origin"><i></i>${escape(item.originName??origins[item.origin].name)} · ${escape(uiLabel(item.type))}</span><strong class="home-focus-name">${escape(item.name)}</strong><p class="home-focus-context">${escape(item.context)}</p><div class="home-focus-amount"><strong>${compact(item.tokens)}</strong><span>tokens</span></div><span class="home-focus-share">占全部已计量内容 ${percent(item.tokens,total)}</span><p class="home-focus-scope">${item.kind==='skills'?__ttUi('这里计量名称与描述，正文按需加载。'):item.kind==='instructions'?(item.type==='个人指令'?__ttUi('通过个人全局指令链加载。'):__ttUi('按会话工作目录加载适用指令。')):item.kind==='tools'?__ttUi('工具说明与参数定义。'):__ttUi('当前可读取的静态片段。')}</p><button class="home-text-link" ${itemAction(item)}>查看当前内容 <span aria-hidden="true">↗</span></button>`;
}
export function composition(p,scope=null){
  const allGroups=compositionGroups(p),groups=scope?allGroups.filter(g=>g.id===scope):allGroups,total=allGroups.reduce((n,g)=>n+g.tokens,0),shown=groups.reduce((n,g)=>n+g.tokens,0),leaves=groups.flatMap(g=>g.leaves),largest=[...leaves].sort((a,b)=>b.tokens-a.tokens)[0];
  return __ttUi`<section class="home-composition"><header class="home-section-heading"><div><h2>静态内容分布</h2><p class="home-map-description">每块是一项工具、指令或提示 · 面积表示 tokens${p.configurationScope==='global'?__ttUi(' · 预设全局'):''}</p></div><span>${leaves.length} 项已计量 · ≈ ${compact(shown)} tokens</span></header>
    <div class="home-map-legend" role="group" aria-label="放大来源分区">${scope?__ttUi('<button data-action="composition-origin" data-origin=""><strong>全部来源</strong><span>↶</span></button>'):''}${allGroups.map(g=>__ttUi`<button data-action="composition-origin" data-origin="${g.id}" aria-pressed="${scope===g.id}" title="聚焦${g.name}" style="--group:var(--origin-${g.id},var(--tt-muted))"><i></i><strong>${g.name}</strong><span>${percent(g.tokens,total)}</span></button>`).join('')}<small>点击来源聚焦</small></div>
    ${largest?__ttUi`<div class="home-map-layout"><div class="home-map-plot zoom-treemap" role="group" aria-label="按具体内容及来源分区的矩形树图"><canvas class="zoom-map-canvas" tabindex="0" aria-label="上下文分布，滚轮缩放，拖动平移，双击进入 / 返回，回车查看当前内容"></canvas>${zoomMapOverlay()}${zoomMapIndex(leaves,c=>`${itemAction(c)} data-composition-key="${c.key}" aria-label="${escape(c.name)}，${escape(c.type)}，${compact(c.tokens)} tokens，${c.originName}"`,'home-composition-tile')}</div><aside class="home-map-focus" style="--group:var(--origin-${largest.origin},var(--tt-muted))" data-composition-total="${total}" data-default-item="${escape(JSON.stringify(largest))}">${focusContent(largest,total)}</aside></div><p class="home-map-hint">单击查看详情 · 双击进入 / 返回 · 滚轮缩放 · 拖动平移 · Escape 回全图</p>`:__ttUi('<p class="home-map-empty">当前没有可计量的静态内容。</p>')}
    <div class="home-composition-pending">${groups.flatMap(g=>g.categories.filter(c=>c.pending||c.tokens===0).map(c=>`<button data-action="category" data-kind="${c.id}" data-origin="${g.id}"><i style="background:var(--origin-${g.id},var(--tt-muted))"></i>${g.short} · ${c.label}<span>${c.pending?c.pending+__ttUi(' 项待组装'):'0 tokens'}</span><b aria-hidden="true">↗</b></button>`)).join('')}</div></section>`;
}
export function compositionBody(preset,item){
  const parent=preset[item.kind]?.[item.index],row=item.kind==='skills'?(parent?.variants?.[item.variantIndex]??parent):parent;
  if(!row)return '';
  if(item.kind==='skills')return [row.name,row.description,row.whenToUse].filter(Boolean).join('\n');
  if(item.kind==='tools')return JSON.stringify({name:row.name,description:row.description,parameters:row.staticParameters},null,2);
  return row.body??row.staticText??row.fragments?.join('\n\n')??'';
}
export function compositionModel(preset){
  const groups=compositionGroups(preset);
  return {layout(width=1000,height=420){return {width,height,groups:compositionLayout(groups,width,height).map(group=>({...group,cells:group.cells.map(item=>({...item,id:item.key,
    fill:`color-mix(in srgb,var(--origin-${item.origin},var(--tt-muted)) 23%,var(--tt-surface))`,stroke:`var(--origin-${item.origin},var(--tt-muted))`,
    secondary:compact(item.tokens)+' tokens · '+item.type,searchText:[item.name,item.type,item.context,item.originName,item.path].join(' ')}))}))};}};
}
export function installCompositionHover(root,getPreset,{open,onFrame}={}){
  let view=null,section=null,presetId=null,selection=null,activeOrigin=null;const saved=new Map();
  function unmount(){if(view){saved.set(presetId,{...view.getState(),origin:activeOrigin});view.destroy();view=null;}section=null;}
  function show(item){
    const panel=section?.querySelector('.home-map-focus');if(!panel||!item||panel.dataset.currentKey===item.key)return;
    panel.dataset.currentKey=item.key;panel.style.setProperty('--group',`var(--origin-${item.origin},var(--tt-muted))`);panel.innerHTML=focusContent(item,Number(panel.dataset.compositionTotal));
  }
  function legend(origin){activeOrigin=origin;section?.querySelectorAll('[data-action="composition-origin"]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.origin===origin)));}
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-action="composition-origin"]');if(!button||!view)return;
    const origin=button.dataset.origin;
    if(!origin||button.getAttribute('aria-pressed')==='true'){view.fitAll();legend(null);}else{
      const item=compositionGroups(getPreset()).find(group=>group.id===origin)?.leaves.slice().sort((a,b)=>b.tokens-a.tokens)[0];
      if(item){selection=item;view.select(item.key);show(item);}view.focusGroup(origin);legend(origin);
    }
  });
  return {unmount,mount(){
    unmount();section=root.querySelector('.home-composition');const host=section?.querySelector('.zoom-treemap');if(!host)return;
    const preset=getPreset(),model=compositionModel(preset),items=compositionGroups(preset).flatMap(g=>g.leaves);presetId=preset.id;
    selection=items.find(item=>item.key===saved.get(presetId)?.selection)??[...items].sort((a,b)=>b.tokens-a.tokens)[0];
    view=createZoomTreemap(host,{model,selected:selection?.key,viewState:saved.get(presetId),getBody:item=>compositionBody(preset,item),
      onSelect:item=>{selection=item;show(item);view.select(item.id);},onHover:item=>show(item??selection),onOpen:item=>open?.(item),onView:info=>{if(info.zoom<=1.01)legend(null);},onFrame});
    legend(saved.get(presetId)?.signature===view.getState().signature?saved.get(presetId).origin:null);
    if(selection){view.select(selection.key);show(selection);}
  }};
}
