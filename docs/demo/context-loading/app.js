(() => {
  'use strict';
  const sample = window.CONTEXT_LOADING_SAMPLE;
  const groups = sample.groups.map((group, index) => ({...group, index, tokens:group.items.reduce((n,item)=>n+item.tokens,0)}));
  const items = groups.flatMap(group=>group.items.map(item=>({...item,group:group.id,index:group.index})));
  const total = groups.reduce((n,group)=>n+group.tokens,0);
  const origins = sample.origins;
  const $ = id => document.getElementById(id);
  const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => Number(value).toLocaleString('en-US');
  const compact = value => value>=1000?(value/1000).toFixed(2)+'k':String(value);
  const percent = (n,d) => d?(n/d*100).toFixed(1)+'%':'—';
  const originColor = id => `var(--${id})`;
  const originName = id => origins.find(origin=>origin.id===id)?.name??id;
  const loaded = group => group.index<state.stage;
  const loadedTokens = () => groups.filter(loaded).reduce((n,g)=>n+g.tokens,0);
  const amountForOrigin = id => items.filter(item=>item.origin===id&&item.index<state.stage).reduce((n,item)=>n+item.tokens,0);
  const availableDesigns = {sequence:'看清每一步增加了什么。',flow:'看清谁提供内容，内容怎样汇入请求。',layers:'拆开看来源，合起来看一次请求。'};
  const initialDesign = new URLSearchParams(location.search).get('view');
  const state = {design:Object.hasOwn(availableDesigns,initialDesign)?initialDesign:'sequence',stage:6,selection:{group:'tools'},playing:false,merged:false,timer:null,motionGroup:null};
  let drawnStage=6,drawnDesign=state.design;
  let savedTheme;
  try{savedTheme=localStorage.getItem('context-loading-theme');}catch{}
  document.documentElement.dataset.theme=savedTheme==='dark'?'dark':'light';
  function legend(){return '<div class="origin-legend">'+origins.map(origin=>`<span style="--origin-color:${originColor(origin.id)}"><i></i>${origin.name}</span>`).join('')+'</div>';}
  function groupSelected(group){return state.selection.group===group.id&&!state.selection.item&&!state.selection.origin;}
  function classes(group,base){return base+(loaded(group)?' is-loaded':'')+(state.selection.group===group.id?' is-selected':'');}
  function groupButton(group,base,body){return `<button type="button" class="${classes(group,base)}" data-select-group="${group.id}" aria-pressed="${groupSelected(group)}" aria-label="${group.name}，${fmt(group.tokens)} tokens，${loaded(group)?'已装填':'尚未装填'}">${body}</button>`;}
  function sequence(){
    const wires=groups.map((group,i)=>{
      const y=73+i*45,dy=80+i*36;
      return `<path class="${classes(group,'structural-wire')}" d="M 228 ${y} C 278 ${y}, 293 ${dy}, 335 ${dy}"/>`;
    }).join('');
    const pulse=state.motionGroup&&state.stage>0?`<circle r="2.6" class="signal-packet" style="offset-path:path('M 228 ${73+(state.stage-1)*45} C 278 ${73+(state.stage-1)*45}, 293 ${80+(state.stage-1)*36}, 335 ${80+(state.stage-1)*36}')"/>`:'';
    return `<div class="sequence-scene"><svg class="sequence-wires" viewBox="0 0 1000 383" preserveAspectRatio="none" aria-hidden="true">${wires}${pulse}</svg><div class="sequence-source"><div class="section-caption">SOURCES / 按层展开</div><div class="source-rows">${groups.map(group=>groupButton(group,'source-row',`<span>0${group.index+1}</span><strong>${group.name}</strong><small>${compact(group.tokens)}</small>`)).join('')}</div>${legend()}</div><div class="request-shell"><div class="request-head"><strong>组装中的请求</strong><span>REQUEST / 001</span></div><div class="request-stack">${groups.map(group=>{
      const chunks=origins.map(origin=>({origin,tokens:group.items.filter(item=>item.origin===origin.id).reduce((n,item)=>n+item.tokens,0)})).filter(row=>row.tokens);
      const fillWidth=group.tokens/Math.max(...groups.map(g=>g.tokens))*100;
      return groupButton(group,'payload-row',`<span class="payload-label">${group.short}</span><span class="payload-track"><span class="payload-fill" style="width:${fillWidth}%">${chunks.map(row=>`<i style="flex:${row.tokens};--origin-color:${originColor(row.origin.id)}"></i>`).join('')}</span></span><span class="payload-value">${loaded(group)?compact(group.tokens):'—'}</span>`);
    }).join('')}<div class="request-foot"><span>条长表示各层 tokens</span><span>${state.stage===6?'就绪 · 等待模型响应':'装填中'}</span></div></div></div></div>`;
  }
  function flow(){
    const originY=[18,50,82],categoryY=[4,22,40,58,76,94];
    const wires=groups.flatMap((group,i)=>{
      const incoming=origins.flatMap((origin,j)=>{
        const count=group.items.filter(item=>item.origin===origin.id).reduce((n,item)=>n+item.tokens,0);
        if(!count)return [];
        const active=loaded(group),selected=state.selection.origin===origin.id||state.selection.group===group.id;
        return `<path class="${active?'is-loaded':''} ${selected?'is-selected':''}" style="--origin-color:${originColor(origin.id)}" d="M 155 ${originY[j]*3} C 285 ${originY[j]*3}, 315 ${categoryY[i]*3}, 430 ${categoryY[i]*3}"/>`;
      });
      incoming.push(`<path class="${loaded(group)?'is-loaded':''} ${state.selection.group===group.id?'is-selected':''}" d="M 570 ${categoryY[i]*3} C 700 ${categoryY[i]*3}, 720 150, 820 150"/>`);
      return incoming;
    }).join('');
    return `<div class="flow-scene"><div class="flow-captions"><span>PROVIDERS / 提供方</span><span>CONTENT / 内容</span><span>REQUEST</span></div><div class="flow-plot"><svg class="flow-wires" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">${wires}</svg>${origins.map((origin,i)=>`<button type="button" class="origin-node" style="top:${originY[i]}%;--origin-color:${originColor(origin.id)}" data-select-origin="${origin.id}" aria-pressed="${state.selection.origin===origin.id}"><span class="origin-title"><i></i>${origin.name}</span><small>${origin.note}</small><span class="origin-value">${fmt(amountForOrigin(origin.id))}</span></button>`).join('')}${groups.map((group,i)=>groupButton(group,'category-node',`<span>${group.name}</span><small>${loaded(group)?compact(group.tokens):'—'}</small>`).replace('class="category-node','style="top:'+categoryY[i]+'%" class="category-node')).join('')}<div class="flow-request"><p>本次请求</p><strong>${fmt(loadedTokens())}</strong><small>tokens</small><div class="flow-request-stack">${origins.map(origin=>`<i style="flex:${Math.max(1,items.filter(item=>item.origin===origin.id).reduce((n,item)=>n+item.tokens,0))};--origin-color:${originColor(origin.id)};height:${amountForOrigin(origin.id)/items.filter(item=>item.origin===origin.id).reduce((n,item)=>n+item.tokens,0)*100}%"></i>`).join('')}</div><p class="flow-request-note">提供方与内容类型分开看</p></div></div></div>`;
  }
  function planePoints(y,x=55,width=340,depth=95){return `${x},${y+depth*.4} ${x+width*.73},${y-depth*.15} ${x+width},${y+depth*.39} ${x+width*.27},${y+depth*.94}`;}
  function layers(){
    const planes=[...groups].reverse().map(group=>{
      const y=state.merged?234+(5-group.index)*6:38+group.index*45;
      const tokenWidth=group.tokens/Math.max(...groups.map(g=>g.tokens))*258;
      const bars=[];let offset=0;
      for(const origin of origins){const n=group.items.filter(item=>item.origin===origin.id).reduce((sum,item)=>sum+item.tokens,0);if(!n)continue;
        const width=tokenWidth*n/group.tokens;
        const point=(u,v)=>`${55+248.2*u+91.8*v},${38-52.25*u+51.3*v}`;
        const a=.1+offset/330,b=.1+(offset+width)/330;
        bars.push(`<polygon class="plane-volume" points="${point(a,.5)} ${point(b,.5)} ${point(b,.68)} ${point(a,.68)}" style="--origin-color:${originColor(origin.id)}"/>`);offset+=width+2;
      }
      return `<g class="${classes(group,'layer-plane')}" transform="translate(0 ${y})" role="button" tabindex="0" data-select-group="${group.id}" aria-pressed="${groupSelected(group)}" aria-label="${group.name}，${fmt(group.tokens)} tokens，${loaded(group)?'已装填':'尚未装填'}" style="opacity:${loaded(group)?1:.28}"><polygon class="plane-outline" points="${planePoints(0)}"/><path class="plane-line" d="M 80 47 L 325 -2"/>${loaded(group)?bars.join(''):''}<circle class="layer-corner" cx="55" cy="38" r="2"/></g>`;
    }).join('');
    return `<div class="layers-scene ${state.merged?'is-merged':''}"><div class="layers-heading"><span class="section-caption">${state.merged?'ONE REQUEST / 装配状态':'EXPLODED VIEW / 分层展开'}</span><button type="button" id="merge" class="view-toggle" aria-pressed="${state.merged}">${state.merged?'展开各层 ↗':'合为一次请求 ↙'}</button></div><svg class="layers-svg" viewBox="0 0 680 360" preserveAspectRatio="xMidYMid meet" role="group" aria-label="上下文各层装配视图，面内条长表示 tokens"><path class="plane-guide" d="M 55 76 L 55 340 M 395 75 L 395 340"/>${planes}<text class="layer-axis-label" x="65" y="353">${state.merged?'各层保留自己的身份与来源':'沿装填方向展开'}</text></svg><svg class="layer-leader-wires" aria-hidden="true">${groups.map(group=>`<path class="${classes(group,'structural-wire')}" data-layer-leader="${group.id}"/>`).join('')}</svg><div class="layer-labels">${groups.map(group=>groupButton(group,'layer-label',`<span>${group.name}</span><small>${loaded(group)?compact(group.tokens):'—'}</small>`)).join('')}</div><div class="layers-bottom-note">层位表达顺序 · 面内条长表达 tokens</div></div>`;
  }
  function inspector(){
    let title,description,tokens,metadata,list,indexLabel;
    const selected=state.selection;
    const group=groups.find(group=>group.id===selected.group)??groups[1];
    const item=items.find(item=>item.id===selected.item);
    if(selected.origin){const origin=origins.find(origin=>origin.id===selected.origin);title=origin.name;description=origin.note+'。同一提供方可以贡献多种内容。';list=items.filter(item=>item.origin===origin.id);tokens=list.reduce((n,item)=>n+item.tokens,0);metadata=[['观察维度','内容提供方'],['已装填',fmt(amountForOrigin(origin.id))+' tokens'],['覆盖内容',new Set(list.map(item=>item.group)).size+' 个类型']];indexLabel='PROVIDER';}
    else if(item){title=item.name;description=item.text;tokens=item.tokens;list=null;metadata=[['提供方',originName(item.origin)],['来源',item.source],['装填位置','0'+(item.index+1)+' · '+group.name],['当前状态',item.index<state.stage?'已加入本次请求':'尚未装填']];indexLabel='CONTENT';}
    else{title=group.name;description=group.note;tokens=group.tokens;list=group.items.map(item=>({...item,group:group.id,index:group.index}));metadata=[['内容类型',group.kind],['进入方式',group.loading],['当前状态',loaded(group)?'已加入本次请求':'尚未装填']];indexLabel='LAYER / 0'+(group.index+1);}
    return `<header><div class="inspector-eyebrow"><span>${indexLabel}</span>${item?`<button type="button" class="back-link" data-select-group="${group.id}">返回该层 ↶</button>`:'<span class="inspector-index">DETAIL</span>'}</div><h2>${esc(title)}</h2><p class="inspector-description">${esc(description)}</p></header><div class="inspector-value"><strong>${fmt(tokens)}</strong><span>tokens</span><small>${percent(tokens,total)}</small></div><dl class="inspector-meta">${metadata.map(([key,value])=>`<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${list?`<div class="detail-items">${list.map(item=>`<button type="button" class="detail-item" data-select-item="${item.id}" aria-pressed="${state.selection.item===item.id}" style="--origin-color:${originColor(item.origin)}"><i></i><span>${esc(item.name)}</span><small>${fmt(item.tokens)}</small></button>`).join('')}</div><p class="detail-caption">占比以完整示例请求 ${fmt(total)} tokens 为分母</p>`:''}${item?.bodyTokens?`<div class="inspector-body"><strong>目录已装填，正文尚未读取</strong><p>正文另有 ${fmt(item.bodyTokens)} tokens；调用后才进入上下文，未计入首次请求。</p></div>`:''}<button type="button" class="pending-button" data-pending><span>另有 2 项等待条件触发</span><b aria-hidden="true">↗</b></button>`;
  }
  function updateThemeLabel(){const dark=document.documentElement.dataset.theme==='dark';$('theme').textContent=dark?'浅色':'深色';$('theme').setAttribute('aria-label',dark?'切换为浅色主题':'切换为深色主题');}
  function drawConnections(){
    const scene=$('diagram'),svg=scene.querySelector('.sequence-wires,.flow-wires,.layer-leader-wires');
    if(!svg||getComputedStyle(svg).display==='none')return;
    const bounds=svg.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
    svg.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);
    const at=(element,edge)=>{const rect=element.getBoundingClientRect();return {x:(edge==='right'?rect.right:rect.left)-bounds.left,y:rect.top+rect.height/2-bounds.top};};
    const connect=(from,to)=>{const gap=(to.x-from.x)*.5;return `M ${from.x} ${from.y} C ${from.x+gap} ${from.y}, ${to.x-gap} ${to.y}, ${to.x} ${to.y}`;};
    if(state.design==='sequence'){
      const sources=[...scene.querySelectorAll('.source-row')],targets=[...scene.querySelectorAll('.payload-row')],paths=[...svg.querySelectorAll('path')];
      paths.forEach((path,i)=>path.setAttribute('d',connect(at(sources[i],'right'),at(targets[i],'left'))));
      const packet=svg.querySelector('.signal-packet');if(packet&&state.stage)packet.style.offsetPath=`path('${paths[state.stage-1].getAttribute('d')}')`;
    }else if(state.design==='flow'){
      const sourceNodes=[...scene.querySelectorAll('.origin-node')],categoryNodes=[...scene.querySelectorAll('.category-node')],request=scene.querySelector('.flow-request'),paths=[...svg.querySelectorAll('path')];let index=0;
      groups.forEach((group,i)=>{
        origins.forEach((origin,j)=>{if(group.items.some(item=>item.origin===origin.id))paths[index++].setAttribute('d',connect(at(sourceNodes[j],'right'),at(categoryNodes[i],'left')));});
        paths[index++].setAttribute('d',connect(at(categoryNodes[i],'right'),at(request,'left')));
      });
    }else if(state.design==='layers'){
      for(const group of groups){
        const plane=scene.querySelector(`.layer-plane[data-select-group="${group.id}"] .plane-outline`),label=scene.querySelector(`.layer-label[data-select-group="${group.id}"]`);
        const from=at(plane,'right'),to=at(label,'left');
        scene.querySelector(`[data-layer-leader="${group.id}"]`).setAttribute('d',connect(from,{x:to.x-12,y:to.y}));
      }
    }
  }
  function animateAssembly(previousPlanes,previousStage,previousDesign){
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    if(state.design==='sequence'&&state.stage>previousStage&&state.motionGroup){
      document.querySelector(`.payload-row[data-select-group="${state.motionGroup}"] .payload-fill`)?.animate([{transform:'scaleX(0)'},{transform:'scaleX(1)'}],{duration:650,easing:'cubic-bezier(.22,.8,.25,1)'});
    }
    if(state.design==='layers'&&previousDesign==='layers'){
      for(const plane of document.querySelectorAll('.layer-plane')){
        const id=plane.dataset.selectGroup,newY=Number(plane.getAttribute('transform').match(/translate\(0 ([\d.]+)\)/)?.[1]),oldY=previousPlanes.get(id);
        if(oldY!==undefined&&oldY!==newY){const animation=plane.animate([{transform:`translateY(${oldY}px)`},{transform:`translateY(${newY}px)`}],{duration:700,easing:'cubic-bezier(.22,.8,.25,1)'});animation.finished.then(drawConnections).catch(()=>{});}
        else if(state.stage>previousStage&&id===state.motionGroup)plane.animate([{transform:`translateY(${newY-22}px)`,opacity:.2},{transform:`translateY(${newY}px)`,opacity:1}],{duration:650,easing:'cubic-bezier(.22,.8,.25,1)'});
      }
    }
  }
  function render({diagram=true}={}){
    const previousPlanes=new Map([...document.querySelectorAll('.layer-plane')].map(plane=>[plane.dataset.selectGroup,Number(plane.getAttribute('transform').match(/translate\(0 ([\d.]+)\)/)?.[1])]));
    const previousStage=drawnStage,previousDesign=drawnDesign;
    const n=loadedTokens();
    $('loaded-tokens').textContent=fmt(n);
    $('loaded-items').textContent=items.filter(item=>item.index<state.stage).length;
    $('loaded-phases').textContent=state.stage;
    $('stage-counter').textContent='0'+state.stage+' / 06';
    $('window-percent').textContent=percent(n,sample.capacity);
    $('window-used').style.width=n/sample.capacity*100+'%';
    document.querySelector('.window-track').setAttribute('aria-valuenow',n);
    $('previous').disabled=state.stage===0;$('next').disabled=state.stage===6;
    $('play').innerHTML=state.playing?'暂停 <span aria-hidden="true">Ⅱ</span>':'回放装填 <span aria-hidden="true">↗</span>';
    $('play').setAttribute('aria-label',state.playing?'暂停装填回放':'从空请求开始回放装填');
    $('stage-range').value=state.stage;
    $('stage-name').textContent=state.stage?'0'+state.stage+' · '+groups[state.stage-1].name+'已加入':'00 · 等待装填';
    $('phase-buttons').innerHTML=groups.map(group=>`<button type="button" class="phase-button ${loaded(group)?'is-loaded':''} ${group.index===state.stage-1?'is-current':''}" data-phase="${group.index+1}" aria-current="${group.index===state.stage-1?'step':'false'}"><span>0${group.index+1}</span><span>${group.name}</span><small>+${compact(group.tokens)}</small></button>`).join('');
    document.querySelectorAll('[data-design]').forEach(button=>button.setAttribute('aria-selected',button.dataset.design===state.design));
    $('design-panel').setAttribute('aria-labelledby','tab-'+state.design);
    $('design-purpose').textContent=availableDesigns[state.design];
    if(diagram)$('diagram').innerHTML=({sequence,flow,layers})[state.design]();
    $('inspector').innerHTML=inspector();
    if(diagram){drawConnections();animateAssembly(previousPlanes,previousStage,previousDesign);drawnStage=state.stage;drawnDesign=state.design;}
    updateThemeLabel();
  }
  function stop(){clearInterval(state.timer);state.timer=null;state.playing=false;}
  function stage(value){state.stage=Math.max(0,Math.min(6,Number(value)));state.motionGroup=state.stage?groups[state.stage-1].id:null;state.selection={group:groups[Math.max(0,state.stage-1)].id};render();}
  function select(target){
    if(target.dataset.selectGroup){state.selection={group:target.dataset.selectGroup};}
    else if(target.dataset.selectItem){const item=items.find(item=>item.id===target.dataset.selectItem);state.selection={group:item.group,item:item.id};}
    else if(target.dataset.selectOrigin){state.selection={origin:target.dataset.selectOrigin};}
    else return;
    const isKeyboard=target.matches(':focus-visible');
    const selector=target.dataset.selectItem?`[data-select-item="${target.dataset.selectItem}"]`:target.dataset.selectGroup?`#diagram [data-select-group="${target.dataset.selectGroup}"]`:`[data-select-origin="${target.dataset.selectOrigin}"]`;
    state.motionGroup=null;render();
    if(isKeyboard)document.querySelector(selector)?.focus({preventScroll:true});
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest('button,[role=button]');if(!target)return;
    if(target.dataset.design){state.design=target.dataset.design;state.motionGroup=null;const url=new URL(location.href);url.searchParams.set('view',state.design);history.replaceState(null,'',url);render();}
    else if(target.dataset.phase){stop();stage(target.dataset.phase);}
    else if(target.matches('[data-select-group],[data-select-item],[data-select-origin]'))select(target);
    else if(target.hasAttribute('data-pending'))$('pending-dialog').showModal();
    else if(target.id==='merge'){state.merged=!state.merged;render();$('merge').focus({preventScroll:true});}
  });
  document.addEventListener('keydown',event=>{
    if(event.target.matches('svg [role=button]')&&['Enter',' '].includes(event.key)){event.preventDefault();select(event.target);}
    if(event.target.matches('[role=tab]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      event.preventDefault();const buttons=[...document.querySelectorAll('[data-design]')],index=buttons.indexOf(event.target);
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
      buttons[next].click();buttons[next].focus();
    }
  });
  $('play').onclick=()=>{
    if(state.playing){stop();render({diagram:false});return;}
    state.playing=true;stage(0);
    state.timer=setInterval(()=>{stage(state.stage+1);if(state.stage===6){stop();render({diagram:false});}},1150);
  };
  $('previous').onclick=()=>{stop();stage(state.stage-1);};
  $('next').onclick=()=>{stop();stage(state.stage+1);};
  $('stage-range').oninput=event=>{stop();stage(event.target.value);};
  $('theme').onclick=()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;try{localStorage.setItem('context-loading-theme',theme);}catch{}updateThemeLabel();};
  $('close-dialog').onclick=()=>$('pending-dialog').close();
  $('pending-dialog').addEventListener('click',event=>{if(event.target===$('pending-dialog')){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.target.close();}});
  window.addEventListener('pagehide',stop);
  render();
  new ResizeObserver(drawConnections).observe($('diagram'));
  document.fonts.ready.then(drawConnections);
  // Read-only state is available to local browser checks and later comparisons.
  window.contextLoadingDemo={getState:()=>({design:state.design,stage:state.stage,selection:{...state.selection},playing:state.playing,merged:state.merged,loadedTokens:loadedTokens(),total,items:items.length})};
})();
