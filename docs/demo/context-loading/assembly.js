(() => {
  'use strict';
  const $=id=>document.getElementById(id),sample=window.CONTEXT_LOADING_SAMPLE;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=value=>value.toLocaleString('en-US'),pad=value=>String(value).padStart(2,'0'),scale=10000;
  const originNames={official:'DSH 官方',plugin:'用户插件',personal:'个人与项目'},originShort={official:'官方',plugin:'插件',personal:'个人'};
  const base=sample.groups.map(group=>({...group,items:group.items.map(item=>({...item}))}));
  const body={id:'body',name:'Skill 正文',short:'正文',kind:'按需正文',note:'实际读取后才进入上下文；目录描述已经包含在首次装填中。',loading:'按需读取',items:[{id:'trace-body',name:'trace-analysis 正文',origin:'plugin',tokens:2840,source:'轨迹树插件 / trace-analysis',text:'演示读取后追加的 Skill 正文。目录中的 180 tokens 已在原请求中，不重复增加。'}]};
  const instruction={id:'conditional',name:'目录补充',short:'补充',kind:'条件指令',note:'访问更深目录后，加入新发现且适用的指令。',loading:'按目录条件补充',items:[{id:'directory-rules',name:'src/AGENTS.md',origin:'personal',tokens:420,source:'子目录指令链',text:'演示访问 src/ 后发现的适用指令。未触发的其他提供者保持未计量。'}]};
  const state={stage:6,body:false,instruction:false,playing:false,timer:null,group:'tools',item:null,origin:null,wire:false,moving:null};
  let renderedStage=6;
  function groups(){let start=0;return [...base,...(state.body?[body]:[]),...(state.instruction?[instruction]:[])].map((group,index)=>{const tokens=group.items.reduce((n,item)=>n+item.tokens,0),row={...group,index,start,tokens,loaded:index<state.stage};start+=tokens;return row;});}
  function items(rows=groups()){return rows.flatMap(group=>{let offset=group.start;return group.items.map((item,index)=>{const row={...item,index,group:group.id,groupIndex:group.index,start:offset,loaded:group.loaded};offset+=item.tokens;return row;});});}
  function loadedTotal(rows=groups()){return rows.filter(group=>group.loaded).reduce((n,group)=>n+group.tokens,0);}
  function selectedGroup(rows=groups()){return rows.find(group=>group.id===state.group)??rows[1];}
  function chooseGroup(id){state.group=id;state.item=null;state.origin=null;state.wire=false;state.moving=null;render();}
  function renderSources(all){
    $('source-list').innerHTML=sample.origins.map(origin=>{const own=all.filter(item=>item.origin===origin.id),loaded=own.filter(item=>item.loaded),tokens=loaded.reduce((n,item)=>n+item.tokens,0);return `<button type="button" class="source-row ${state.wire&&state.origin===origin.id?'is-linked':''}" data-origin="${origin.id}" aria-pressed="${state.origin===origin.id}"><i></i><strong>${origin.name}</strong><span class="source-amount">${fmt(tokens)}</span><small><b>${loaded.length}</b> / ${own.length} 项已装填</small></button>`;}).join('');
  }
  function renderMap(rows,all){
    $('segment-refs').innerHTML=rows.map(group=>`<button type="button" class="segment-ref" data-group="${group.id}" aria-pressed="${state.group===group.id}" style="left:${group.start/scale*100}%" aria-label="${pad(group.index+1)} ${group.name}，${fmt(group.tokens)} tokens">${pad(group.index+1)}</button>`).join('');
    $('request-map').innerHTML=rows.map(group=>`<div class="request-group" data-map-group="${group.id}" style="left:${group.start/scale*100}%;width:${group.tokens/scale*100}%">${all.filter(item=>item.group===group.id).map(item=>`<button type="button" data-piece="${item.id}" class="request-piece ${item.loaded?'':'is-planned'} ${state.item===item.id?'is-selected':''} ${state.origin===item.origin?'is-source':''} ${state.origin&&state.origin!==item.origin?'is-unrelated':''}" style="flex-grow:${item.tokens}" aria-label="${esc(item.name)}，${fmt(item.tokens)} tokens，${originNames[item.origin]}，${item.loaded?'已装填':'待装填'}" aria-pressed="${state.item===item.id}"></button>`).join('')}</div>`).join('');
    const n=loadedTotal(rows),cut=$('cut-marker');cut.style.left=n/scale*100+'%';cut.classList.toggle('at-zero',n===0);cut.querySelector('span').textContent=fmt(n);
    $('layer-key').innerHTML=rows.map(group=>`<button type="button" data-group="${group.id}" aria-pressed="${state.group===group.id}"><span>${pad(group.index+1)}</span><span>${group.name}</span></button>`).join('');
  }
  function renderDetail(rows,all){
    const group=selectedGroup(rows),own=all.filter(item=>item.group===group.id),current=own.find(item=>item.id===state.item);
    $('detail-index').textContent=pad(group.index+1);$('detail-heading').textContent=group.name;$('detail-count').textContent=own.length+' 项 / '+fmt(group.tokens)+' tokens';
    $('detail-pieces').innerHTML=own.map(item=>`<button type="button" class="detail-piece ${item.loaded?'':'is-planned'} ${state.origin&&state.origin!==item.origin?'is-unrelated':''}" data-detail-piece="${item.id}" style="flex-grow:${item.tokens}" aria-pressed="${state.item===item.id}" aria-label="${esc(item.name)}，${fmt(item.tokens)} tokens，${item.loaded?'已装填':'待装填'}"><span class="piece-ref"><span>${pad(group.index+1)}.${pad(item.index+1)}</span><span>${originShort[item.origin]}</span></span><h3>${esc(item.name)}</h3><span class="piece-tokens">${fmt(item.tokens)}</span><span class="piece-state">${item.loaded?'tokens':'待装填'}</span></button>`).join('');
    if(current){
      $('item-detail').innerHTML=`<div class="item-summary"><span class="mono">${pad(group.index+1)}.${pad(current.index+1)}</span><strong>${esc(current.name)}</strong><span>来源：${esc(current.source)}</span><span>${current.loaded?'已装填':'待装填'}</span></div><p>${esc(current.text)}${current.bodyTokens?` 正文另有 ${fmt(current.bodyTokens)} tokens，${current.id==='trace-skill'&&state.body?'在后续内容中单列。':'尚未读取。'}${current.id==='trace-skill'&&!state.body?'<button type="button" id="read-selected-skill">演示读取正文 ↗</button>':''}`:''}</p>`;
    }else if(state.origin){
      const ownOrigin=all.filter(item=>item.origin===state.origin&&item.loaded);$('item-detail').innerHTML=`<div class="item-summary"><strong>${originNames[state.origin]}</strong><span>${ownOrigin.length} 项已装填 · ${fmt(ownOrigin.reduce((n,item)=>n+item.tokens,0))} tokens</span></div><p>在请求中高亮该来源的内容。点选片段可继续查看具体提供方与装填状态。</p>`;
    }else{
      $('item-detail').innerHTML=`<div class="item-summary"><strong>${esc(group.kind)}</strong><span>${group.loaded?'已装填':'待装填'}</span><span>占当前已装填内容 ${group.loaded&&loadedTotal(rows)?(group.tokens/loadedTotal(rows)*100).toFixed(1)+'%':'—'}</span></div><p>${esc(group.note)} 点选片段查看具体来源。</p>`;
    }
  }
  function drawWire(){
    const svg=$('source-wire');if(!state.wire||!state.origin||innerWidth<=850){svg.setAttribute('hidden','');return;}
    const source=document.querySelector(`[data-origin="${state.origin}"]`),target=state.item?document.querySelector(`.request-piece[data-piece="${state.item}"]`):document.querySelector(`.segment-ref[data-group="${state.group}"]`);
    if(!source||!target){svg.setAttribute('hidden','');return;}
    const box=$('drawing-workspace').getBoundingClientRect(),from=source.getBoundingClientRect(),to=target.getBoundingClientRect(),clip=document.querySelector('.map-scroll').getBoundingClientRect();
    const tx=to.left+to.width/2-box.left,ty=(state.item?to.top:to.top+to.height/2)-box.top,sx=from.right-box.left,sy=from.top+from.height/2-box.top;
    if(to.left+to.width/2<clip.left||to.left+to.width/2>clip.right){svg.setAttribute('hidden','');return;}
    svg.removeAttribute('hidden');svg.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);
    const elbow=sx+12,upper=ty-10;svg.querySelector('path').setAttribute('d',`M ${sx} ${sy} H ${elbow} V ${upper} H ${tx} V ${ty}`);svg.querySelector('circle').setAttribute('cx',tx);svg.querySelector('circle').setAttribute('cy',ty);
  }
  function animateEntry(){
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||state.stage<=renderedStage)return;
    const group=groups()[state.stage-1],nodes=document.querySelectorAll(`[data-map-group="${group.id}"] .request-piece`);
    nodes.forEach(node=>node.animate([{transform:'translateY(-5px)',opacity:.35},{transform:'translateY(0)',opacity:1}],{duration:160,easing:'linear'}));
  }
  function render(){
    const rows=groups(),all=items(rows);if(!rows.some(group=>group.id===state.group)){state.group='tools';state.item=null;state.origin=null;state.wire=false;}
    $('total').textContent=fmt(loadedTotal(rows));$('item-count').textContent=all.filter(item=>item.loaded).length;$('layer-count').textContent=rows.filter(group=>group.loaded).length;
    $('request-state').textContent=state.body||state.instruction?'继续装填':'首次装填';
    $('stage').max=rows.length;$('stage').value=state.stage;$('step-count').textContent=pad(state.stage)+' / '+pad(rows.length);$('stage-label').textContent=state.stage?rows[state.stage-1].name+'已加入':'等待装填';
    $('previous').disabled=state.stage===0;$('next').disabled=state.stage===rows.length;$('play-label').textContent=state.playing?'暂停':'回放装填';$('play').setAttribute('aria-pressed',state.playing);$('play').querySelector('.play-icon').textContent=state.playing?'Ⅱ':'▶';
    $('load-body').checked=state.body;$('load-instruction').checked=state.instruction;
    renderSources(all);renderMap(rows,all);renderDetail(rows,all);drawWire();animateEntry();renderedStage=state.stage;
  }
  function stop(){clearInterval(state.timer);state.timer=null;state.playing=false;}
  function stage(value){state.stage=Math.max(0,Math.min(groups().length,Number(value)));state.item=null;state.origin=null;state.wire=false;state.group=groups()[Math.max(0,state.stage-1)].id;render();}
  function updateExtra(key,value){stop();state[key]=value;state.stage=groups().length;state.group=value?(key==='body'?'body':'conditional'):'tools';state.item=null;state.origin=null;state.wire=false;render();}
  function selectItem(id){const item=items().find(item=>item.id===id);if(!item)return;state.group=item.group;state.item=item.id;state.origin=item.origin;state.wire=true;render();}
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-group],[data-piece],[data-detail-piece],[data-origin],#read-selected-skill');if(!target)return;
    let restore;
    if(target.dataset.group){chooseGroup(target.dataset.group);restore=`.layer-key [data-group="${target.dataset.group}"]`;}
    else if(target.dataset.piece||target.dataset.detailPiece){const id=target.dataset.piece??target.dataset.detailPiece;selectItem(id);restore=`[data-detail-piece="${id}"]`;}
    else if(target.dataset.origin){state.origin=state.origin===target.dataset.origin?null:target.dataset.origin;state.item=null;state.wire=Boolean(state.origin);if(state.origin&&!selectedGroup().items.some(item=>item.origin===state.origin))state.group=groups().find(group=>group.items.some(item=>item.origin===state.origin)).id;render();restore=`[data-origin="${target.dataset.origin}"]`;}
    else updateExtra('body',true);
    if(event.detail===0&&restore)document.querySelector(restore)?.focus({preventScroll:true});
  });
  $('stage').oninput=event=>{stop();stage(event.target.value);};$('previous').onclick=()=>{stop();stage(state.stage-1);};$('next').onclick=()=>{stop();stage(state.stage+1);};
  $('play').onclick=()=>{if(state.playing){stop();render();return;}state.playing=true;stage(0);state.timer=setInterval(()=>{stage(state.stage+1);if(state.stage===groups().length){stop();render();}},900);};
  $('load-body').onchange=event=>updateExtra('body',event.target.checked);$('load-instruction').onchange=event=>updateExtra('instruction',event.target.checked);
  $('theme').onclick=()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';$('theme').textContent=dark?'深色':'浅色';$('theme').setAttribute('aria-label',dark?'切换为深色':'切换为浅色');};
  $('ruler').innerHTML=Array.from({length:21},(_,i)=>`<i class="tick ${i%4===0?'is-major':''}" style="left:${i*5}%">${i%4===0?`<span>${i===0?'0':i/2+'k'}</span>`:''}</i>`).join('');
  document.querySelector('.map-scroll').addEventListener('scroll',drawWire,{passive:true});new ResizeObserver(drawWire).observe($('drawing-workspace'));document.fonts.ready.then(drawWire);window.addEventListener('pagehide',stop);
  render();
})();
