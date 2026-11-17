(() => {
  'use strict';
  const $=id=>document.getElementById(id),sample=window.CONTEXT_LOADING_SAMPLE;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=value=>value.toLocaleString('en-US'),pad=value=>String(value).padStart(2,'0');
  const source=id=>sample.groups.find(group=>group.id===id).items;
  const providers=[
    {id:'host',title:'宿主预设',note:'系统与内置能力',description:'预设提供的系统说明与内置工具声明。'},
    {id:'plugins',title:'扩展插件',note:'工具与分析方法',description:'已启用插件提供的工具、Skill 目录，以及按需读取的正文。'},
    {id:'project',title:'个人与项目',note:'适用的目录内容',description:'沿当前工作目录适用的个人、项目指令与 Skill。'},
    {id:'session',title:'本次会话',note:'环境与当前任务',description:'本次请求所需的运行环境信息和用户输入。'}
  ];
  const definitions=[
    {id:'system',provider:'host',title:'系统提示',note:'身份与运行边界',phase:1,items:source('system')},
    {id:'builtin',provider:'host',title:'内置工具',note:'3 项工具声明',phase:2,items:source('tools').filter(item=>item.origin==='official')},
    {id:'extension',provider:'plugins',title:'扩展工具',note:'2 项工具声明',phase:2,items:source('tools').filter(item=>item.origin==='plugin')},
    {id:'skills',provider:'plugins',title:'Skill 目录',note:'名称与用途描述',phase:3,items:source('catalog').filter(item=>item.origin==='plugin')},
    {id:'instructions',provider:'project',title:'适用指令',note:'个人与项目规则',phase:4,items:source('instructions')},
    {id:'local-skills',provider:'project',title:'项目 Skill',note:'目录描述',phase:3,items:source('catalog').filter(item=>item.origin==='personal')},
    {id:'environment',provider:'session',title:'环境信息',note:'工作目录与平台',phase:5,items:source('runtime')},
    {id:'message',provider:'session',title:'用户输入',note:'当前任务',phase:6,items:source('user')}
  ];
  const body={id:'trace-body',name:'trace-analysis 正文',source:'轨迹树插件 / trace-analysis',origin:'plugin',tokens:2840,text:'这里演示读取后加入的 Skill 正文。目录描述已计入首次请求，不重复增加。',phase:7};
  const state={stage:6,body:false,selected:null,selectedProvider:null,item:null,playing:false,timer:null};
  const stages=()=>['系统提示','工具声明','Skill 目录','适用指令','环境信息','用户输入',...(state.body?['Skill 正文']:[])];
  function units(){return definitions.map(unit=>{const items=unit.items.map(item=>({...item,phase:unit.phase}));if(unit.id==='skills'&&state.body)items.push(body);const visible=items.filter(item=>item.phase<=state.stage);return {...unit,items,title:unit.id==='skills'&&state.body?'Skill 目录与正文':unit.title,note:unit.id==='skills'&&state.body?(state.stage>=7?'正文已按需加入':'正文等待装填'):unit.note,loaded:visible.length>0,visible,tokens:visible.reduce((n,item)=>n+item.tokens,0)};});}
  const total=(rows=units())=>rows.reduce((sum,unit)=>sum+unit.tokens,0);
  function currentIds(){return state.stage===7?['skills']:definitions.filter(unit=>unit.phase===state.stage).map(unit=>unit.id);}
  function isSelected(unit){return state.selected===unit.id||state.selectedProvider===unit.provider;}
  function geometry(){
    const w=$('scene').clientWidth,h=$('scene').clientHeight,mobile=matchMedia('(max-width: 800px)').matches,cx=w/2,cy=mobile?338:h*.475,pw=mobile?176:188,ph=mobile?198:216;
    const leaf=cx-pw/2-124,right=cx+pw/2+124,outer=Math.max(110,w*.12);
    const desktopPositions={system:[leaf,cy-146,'left',-63],builtin:[leaf,cy-69,'left',-37],extension:[leaf,cy+66,'left',37],skills:[leaf,cy+143,'left',63],instructions:[right,cy-146,'right',-63],'local-skills':[right,cy-69,'right',-37],environment:[right,cy+66,'right',37],message:[right,cy+143,'right',63]};
    const mobilePositions={system:[w*.21,112,'left',-63],builtin:[w*.3,176,'left',-37],extension:[w*.7,176,'right',-63],skills:[w*.79,112,'right',-37],instructions:[w*.21,537,'left',37],'local-skills':[w*.3,595,'left',63],environment:[w*.7,595,'right',37],message:[w*.79,537,'right',63]};
    const providerPositions=mobile?{host:[w*.26,31,'left'],plugins:[w*.74,31,'right'],project:[w*.26,665,'left'],session:[w*.74,665,'right']}:{host:[outer,cy-108,'left'],plugins:[outer,cy+105,'left'],project:[w-outer,cy-108,'right'],session:[w-outer,cy+105,'right']};
    return {w,h,mobile,cx,cy,pw,ph,positions:mobile?mobilePositions:desktopPositions,providerPositions};
  }
  function renderNodes(rows,g){
    const current=currentIds();
    $('providers').innerHTML=providers.map(provider=>{const [x,y,side]=g.providerPositions[provider.id],loaded=rows.some(unit=>unit.provider===provider.id&&unit.loaded);return `<button type="button" class="provider side-${side} ${loaded?'is-loaded':''}" data-provider="${provider.id}" style="left:${x}px;top:${y}px" aria-pressed="${state.selectedProvider===provider.id}" aria-label="查看${provider.title}提供的内容"><span class="node-copy"><strong class="node-title">${provider.title}</strong><span class="node-note">${provider.note}</span></span><i class="terminal"></i></button>`;}).join('');
    $('units').innerHTML=rows.map(unit=>{const [x,y,side]=g.positions[unit.id];return `<button type="button" class="unit side-${side} ${unit.loaded?'is-loaded':'is-waiting'} ${current.includes(unit.id)&&!state.selected&&!state.selectedProvider?'is-current':''}" data-unit="${unit.id}" style="left:${x}px;top:${y}px" aria-pressed="${state.selected===unit.id}" aria-label="${unit.title}，${unit.visible.length} 项已装填，${fmt(unit.tokens)} tokens"><span class="node-copy"><span class="node-title">${unit.title}</span><span class="node-note">${unit.note}</span></span><i class="terminal"></i></button>`;}).join('');
    $('request').style.left=g.cx+'px';$('request').style.top=g.cy+'px';
  }
  function fragmentPath(unit,index,g){
    const [, ,side,offset]=g.positions[unit.id],x=side==='left'?24:g.pw-78,y=g.ph/2+offset;
    const lengths=[43+(index%3)*7,31+(index%2)*9];
    return `M ${x} ${y-3} h ${lengths[0]} M ${x} ${y+3} h ${lengths[1]}`;
  }
  function renderPaper(rows,g){
    const w=g.pw,h=g.ph,current=currentIds();
    const fragments=rows.map((unit,index)=>{const side=g.positions[unit.id][2],y=h/2+g.positions[unit.id][3],selected=isSelected(unit),active=current.includes(unit.id)&&!state.selected&&!state.selectedProvider;return `<g data-fragment="${unit.id}"><path class="paper-fragment ${unit.loaded?'is-loaded':''} ${active?'is-current':''} ${selected?'is-selected':''}" d="${fragmentPath(unit,index,g)}"/><rect class="fragment-pin ${unit.loaded?'is-loaded':''} ${active?'is-current':''} ${selected?'is-selected':''}" x="${side==='left'?10:w-13}" y="${y-1.5}" width="3" height="3"/></g>`;}).join('');
    $('request-paper').setAttribute('viewBox',`0 0 ${w} ${h}`);
    $('request-paper').innerHTML=`<path class="paper-shadow" d="M 6 ${h+5} H ${w+5} V 37"/><path class="paper-outline" d="M 0 0 H ${w-30} L ${w} 30 V ${h} H 0 Z"/><path class="paper-fold" d="M ${w-30} 0 V 30 H ${w}"/><text class="paper-reference" x="15" y="23">REQUEST</text>${fragments}<path class="paper-fragment ${state.stage?'is-loaded':''}" d="M 24 ${h/2-6} h ${w-48} M 24 ${h/2+6} h ${w-67}"/>`;
  }
  function port(element,base){const r=element.getBoundingClientRect();return {x:r.left+r.width/2-base.left,y:r.top+r.height/2-base.top};}
  function drawWiring(rows=units(),g=geometry(),animate=false){
    const box=$('scene').getBoundingClientRect(),current=currentIds(),paths=[];
    const requestLeft=g.cx-g.pw/2,requestRight=g.cx+g.pw/2;
    for(const unit of rows){
      const node=document.querySelector(`[data-unit="${unit.id}"] .terminal`),provider=document.querySelector(`[data-provider="${unit.provider}"] .terminal`);if(!node||!provider)continue;
      const p=port(provider,box),n=port(node,box),[, ,side,offset]=g.positions[unit.id],end={x:side==='left'?requestLeft:requestRight,y:g.cy+offset};
      let branch,entry;
      if(!g.mobile){const split=p.x+(n.x-p.x)*.38;branch=`M ${p.x} ${p.y} H ${split} V ${n.y} H ${n.x}`;const lane=end.x+(side==='left'?-1:1)*(26+Math.abs(offset)*.12);entry=`M ${n.x} ${n.y} H ${lane} V ${end.y} H ${end.x}`;}
      else{const top=unit.provider==='host'||unit.provider==='plugins',junction=top?75:635;branch=`M ${p.x} ${p.y} V ${junction} H ${n.x} V ${n.y}`;const lane=end.x+(side==='left'?-1:1)*(20+Math.abs(offset)*.12);entry=top?`M ${n.x} ${n.y} V 228 H ${lane} V ${end.y} H ${end.x}`:`M ${n.x} ${n.y} H ${lane} V ${end.y} H ${end.x}`;}
      const selected=isSelected(unit),active=current.includes(unit.id)&&!state.selected&&!state.selectedProvider;
      const classes=`trace ${unit.loaded?'is-loaded':''} ${selected?'is-selected':''} ${active?'is-current':''}`;
      paths.push(`<path class="${classes}" data-branch="${unit.id}" d="${branch}"/><path class="${classes}" data-entry="${unit.id}" d="${entry}"/>`);
    }
    $('wiring').setAttribute('viewBox',`0 0 ${g.w} ${g.h}`);$('wiring').innerHTML=paths.join('');
    if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      for(const id of current){for(const selector of [`[data-entry="${id}"]`,`[data-branch="${id}"]`]){const path=$('wiring').querySelector(selector);if(path){const length=path.getTotalLength();path.animate([{strokeDasharray:`${length} ${length}`,strokeDashoffset:length},{strokeDasharray:`${length} ${length}`,strokeDashoffset:0}],{duration:240,easing:'linear'});}}
        const fragment=document.querySelector(`[data-fragment="${id}"]`);fragment?.animate([{transform:'translateY(-3px)',opacity:.35},{transform:'translateY(0)',opacity:1}],{duration:160,easing:'linear'});
      }
    }
  }
  function selectedRows(rows=units()){return state.selected?rows.filter(unit=>unit.id===state.selected):state.selectedProvider?rows.filter(unit=>unit.provider===state.selectedProvider):rows;}
  function renderReadout(rows){
    $('inspect').hidden=!state.selected&&!state.selectedProvider;$('read-body').hidden=state.selected!=='skills'||state.body;
    if(state.selected){const unit=rows.find(unit=>unit.id===state.selected);$('selection-copy').innerHTML=`<strong>${unit.title}</strong><span class="readout-amount">${fmt(unit.tokens)} tokens</span><span class="readout-state">${unit.loaded?'已加入请求':'尚未装填'} · ${unit.visible.length} 项</span>`;}
    else if(state.selectedProvider){const provider=providers.find(provider=>provider.id===state.selectedProvider),own=rows.filter(unit=>unit.provider===provider.id);$('selection-copy').innerHTML=`<strong>${provider.title}</strong><span class="readout-amount">${fmt(total(own))} tokens</span><span class="readout-state">${provider.note}</span>`;}
    else $('selection-copy').textContent='点选来源，查看它装入了什么。';
  }
  function renderDrawer(){
    const rows=selectedRows(),all=rows.flatMap(unit=>unit.items.map(item=>({...item,loaded:item.phase<=state.stage}))),visible=all.filter(item=>item.loaded);
    const unit=state.selected?rows[0]:null,provider=state.selectedProvider?providers.find(provider=>provider.id===state.selectedProvider):null;
    $('detail-title').textContent=unit?.title??provider?.title??'当前请求';$('detail-kind').textContent=unit?'CONTENT':provider?'SOURCE':'REQUEST';
    $('detail-description').textContent=unit?.id==='skills'?'名称与用途描述先进入目录。正文实际读取后再追加，目录不重复计量。':provider?.description??'这里保留每项内容的来源与装填状态。';
    $('detail-summary').innerHTML=`<span class="mono">${fmt(visible.reduce((n,item)=>n+item.tokens,0))} tokens</span><span>${visible.length} / ${all.length} 项已装填</span>`;
    $('detail-items').innerHTML=all.map(item=>`<button type="button" class="item-button" data-item="${item.id}" aria-pressed="${state.item===item.id}"><span><strong>${escape(item.name)}</strong><small>${escape(item.source)} · ${item.loaded?'已装填':'尚未装填'}</small></span><span class="mono">${fmt(item.tokens)}</span></button>`).join('');
    const selected=all.find(item=>item.id===state.item);$('item-text').innerHTML=selected?`<strong>${escape(selected.name)}</strong><p>${escape(selected.text)}</p>${selected.bodyTokens?`<p>目录描述 ${fmt(selected.tokens)} tokens；正文另有 ${fmt(selected.bodyTokens)} tokens，${state.body&&selected.id==='trace-skill'?'已单列到后续装填。':'尚未读取。'}</p>`:''}`:'';
    $('drawer-read-body').hidden=state.body||!(unit?.id==='skills'||provider?.id==='plugins'||!unit&&!provider);
  }
  function render({animate=false}={}){
    const rows=units(),g=geometry();renderNodes(rows,g);renderPaper(rows,g);drawWiring(rows,g,animate);
    $('total').textContent=fmt(total(rows));const count=rows.reduce((n,unit)=>n+unit.visible.length,0);$('request-note').textContent=count+' 项内容 · '+(state.stage===stages().length?'等待模型响应':'组装中');$('request').setAttribute('aria-label',`查看当前请求，${fmt(total(rows))} tokens，${count} 项内容`);
    $('position').textContent=pad(state.stage)+' / '+pad(stages().length);$('previous').disabled=state.stage===0;$('next').disabled=state.stage===stages().length;$('stage-label').textContent=state.stage?stages()[state.stage-1]+'已加入':'等待装填';
    $('play-label').textContent=state.playing?'暂停':'回放组装';$('play-symbol').textContent=state.playing?'Ⅱ':'▶';$('play').setAttribute('aria-pressed',state.playing);$('reset').hidden=!state.body;
    $('stages').innerHTML=stages().map((name,index)=>`<button type="button" data-stage="${index+1}" class="${index<state.stage?'is-past':''}" aria-current="${index===state.stage-1?'step':'false'}" aria-label="${pad(index+1)} ${name}"></button>`).join('');
    renderReadout(rows);if($('details').open)renderDrawer();
  }
  function stop(){clearInterval(state.timer);state.timer=null;state.playing=false;}
  function changeStage(value){state.stage=Math.max(0,Math.min(stages().length,value));state.selected=null;state.selectedProvider=null;state.item=null;render({animate:true});}
  function loadBody(){stop();state.body=true;state.stage=7;state.selected='skills';state.selectedProvider=null;state.item='trace-body';render({animate:true});}
  function openDetails(){if(state.playing){stop();render();}renderDrawer();$('details').showModal();}
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-unit],[data-provider],[data-stage],[data-item]');if(!button)return;
    if(button.dataset.unit){stop();state.selected=state.selected===button.dataset.unit?null:button.dataset.unit;state.selectedProvider=null;state.item=null;render();if(event.detail===0)document.querySelector(`[data-unit="${button.dataset.unit}"]`)?.focus({preventScroll:true});}
    else if(button.dataset.provider){stop();state.selectedProvider=state.selectedProvider===button.dataset.provider?null:button.dataset.provider;state.selected=null;state.item=null;render();if(event.detail===0)document.querySelector(`[data-provider="${button.dataset.provider}"]`)?.focus({preventScroll:true});}
    else if(button.dataset.stage){stop();changeStage(Number(button.dataset.stage));if(event.detail===0)document.querySelector(`[data-stage="${button.dataset.stage}"]`)?.focus({preventScroll:true});}
    else if(button.dataset.item){state.item=button.dataset.item;renderDrawer();if(event.detail===0)document.querySelector(`[data-item="${button.dataset.item}"]`)?.focus({preventScroll:true});}
  });
  $('inspect').onclick=openDetails;$('request').onclick=()=>{state.selected=null;state.selectedProvider=null;state.item=null;render();openDetails();};$('close-details').onclick=()=>$('details').close();$('read-body').onclick=loadBody;$('drawer-read-body').onclick=loadBody;
  $('previous').onclick=()=>{stop();changeStage(state.stage-1);};$('next').onclick=()=>{stop();changeStage(state.stage+1);};
  $('play').onclick=()=>{if(state.playing){stop();render();return;}state.playing=true;changeStage(0);state.timer=setInterval(()=>{changeStage(state.stage+1);if(state.stage===stages().length){stop();$('play-label').textContent='回放组装';$('play-symbol').textContent='▶';$('play').setAttribute('aria-pressed','false');}},900);};
  $('reset').onclick=()=>{stop();state.body=false;state.stage=6;state.selected=null;state.selectedProvider=null;state.item=null;render();};
  $('theme').onclick=()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';$('theme').textContent=dark?'深色':'浅色';$('theme').setAttribute('aria-label',dark?'切换为深色':'切换为浅色');};
  let lastWidth=0,lastHeight=0;new ResizeObserver(()=>{const w=$('scene').clientWidth,h=$('scene').clientHeight;if(w!==lastWidth||h!==lastHeight){lastWidth=w;lastHeight=h;render();}}).observe($('scene'));
  document.fonts.ready.then(()=>drawWiring());window.addEventListener('pagehide',stop);render();
})();
