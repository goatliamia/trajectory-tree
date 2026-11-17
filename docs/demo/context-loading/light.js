document.addEventListener('DOMContentLoaded',()=>{
  const data=window.LIGHT_CONTEXT,$=id=>document.getElementById(id);
  if(!data||typeof tileLayout!=='function'){$('app').textContent='请打开 scripts/build-context-light-demos.mjs 生成的独立 HTML。';return;}
  const design=document.documentElement.dataset.design;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const compact=n=>n>=1000?(n/1000).toFixed(1)+'k':Number(n.toFixed(1)).toLocaleString('zh-CN');
  const amount=n=>Number(n.toFixed(2)).toLocaleString('zh-CN');
  const percent=n=>(n/data.total*100).toFixed(n/data.total<.001?2:1)+'%';
  const groups=new Map(data.groups.map(g=>[g.id,g])),leaves=new Map(data.leaves.map(l=>[l.id,l]));
  const members=g=>g.items.map(id=>leaves.get(id));
  const first=data.leaves.find(l=>l.name==='pwsh')||data.leaves[0];
  const roundIds=['user-approval','user','runtime-context','time-context'];
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const admissions=[...data.groups].sort((a,b)=>a.seq-b.seq);
  const firstAdmission=admissions[0].time,admissionSpan=admissions.at(-1).time-firstAdmission;
  let arrivalRunning=false,arrivalTimers=[],arrivalAnimations=[];
  let saved={};try{saved=JSON.parse(localStorage.getItem('context-light-v1:'+design)||'{}');}catch{}
  const state={selected:leaves.has(saved.selected)?saved.selected:first.id,filter:'all',reader:leaves.has(saved.reader?.slice(2))||groups.has(saved.reader?.slice(2))?saved.reader:'g|system-prompt',readerMode:'read',query:'',modalKey:null,modalMode:'read',indexScope:null};
  const mapViews=new Map();let geometry=new Map(),zoomView=null;
  const keyLeaf=id=>'l|'+id,keyGroup=id=>'g|'+id;
  const entity=key=>{
    if(key?.startsWith('l|')){const leaf=leaves.get(key.slice(2));if(leaf)return {key,leaf,group:groups.get(leaf.groupId),name:leaf.name,body:leaf.body,tokens:leaf.tokens};}
    const group=groups.get(key?.slice(2));return group?{key,group,name:group.name,body:group.body,tokens:group.tokens}:null;
  };
  const selected=()=>leaves.get(state.selected)||first;
  const activeGroups=()=>state.filter==='all'?data.groups:state.filter==='round'?data.groups.filter(g=>roundIds.includes(g.id)):data.groups.filter(g=>g.id===state.filter);
  const matches=(leaf,query=state.query)=>!query||String(leaf.name+' '+leaf.description+' '+leaf.path+' '+leaf.body+' '+groups.get(leaf.groupId).name).toLocaleLowerCase().includes(query.toLocaleLowerCase().trim());
  const save=()=>{try{localStorage.setItem('context-light-v1:'+design,JSON.stringify({selected:state.selected,reader:state.reader}));}catch{}};
  const searchMarkup=()=>'<div class="search-wrap"><label class="search-field"><span aria-hidden="true">⌕</span><input class="global-search" type="search" value="'+esc(state.query)+'" placeholder="查找名称或原文" autocomplete="off" aria-label="查找上下文内容"></label><div class="search-popover" hidden></div></div>';
  const pageFooter=()=>'<footer class="page-footer"><span>冻结会话 · '+esc(data.source.date)+' · seq '+data.source.cut+'</span><span>文本体积估算，非供应商实报用量。</span></footer>';
  function pageHeading(title,subtitle){return '<header class="page-heading"><div><p class="eyebrow">CONTEXT / FIRST REQUEST</p><h1>'+title+'</h1><p class="subtitle">'+subtitle+'</p></div><div class="total-metric"><span>上下文估算</span><strong>'+compact(data.total)+'<small>tokens</small></strong><small>'+data.messageCount+' 条消息 · '+data.toolCount+' 项工具</small></div></header>';}
  function recordText(e){
    const g=e.group,field=e.leaf?.groupId==='tools'&&!e.leaf.auxiliary?e.leaf.path:g.field;
    const queue=g.queue?'seq '+g.queue.queued+' 入队 → '+g.queue.claimed+' 取出 → '+g.seq+' 写入':'seq '+g.seq+(g.id==='tools'?' 记录声明':' 写入消息');
    return field+' · '+queue+' · 首次写入后 +'+(g.time-firstAdmission)+'ms'+(g.role?' · role='+g.role:' · 独立请求字段');
  }
  function contentHTML(e,mode='read'){
    if(mode==='raw')return '<pre>'+esc(e.body)+'</pre>';
    if(e.leaf?.basis==='schema-density'){
      const tool=JSON.parse(e.body),parameters=tool.parameters?.properties||{},required=tool.parameters?.required||[];
      return '<p class="tool-description">'+esc(tool.description||'')+'</p><h3>参数</h3>'+Object.entries(parameters).map(([name,p])=>'<dl class="param"><dt><code>'+esc(name)+'</code><span>'+esc(p.type||(p.anyOf?'联合类型':''))+'</span>'+(required.includes(name)?'<em>必填</em>':'')+'</dt><dd>'+esc(p.description||'')+(p.enum?'<br><code>'+esc(p.enum.join(' / '))+'</code>':'')+(p.items?.type?'<br><span>数组项：'+esc(p.items.type)+'</span>':'')+'</dd></dl>').join('')+(Object.keys(parameters).length?'':'<p class="muted">该声明没有参数。</p>');
    }
    if(!e.leaf&&e.group.id==='skill-catalog')return members(e.group).filter(l=>!l.auxiliary).map(l=>'<h3>'+esc(l.name)+'</h3><p>'+esc(l.description)+'</p>').join('');
    if(!e.leaf&&e.group.id==='runtime-context')return members(e.group).filter(l=>!l.auxiliary).map(l=>'<h3>'+esc(l.name)+'</h3><p>'+esc(l.body)+'</p>').join('');
    if(!e.leaf&&e.group.id==='tools')return '<p>'+data.toolCount+' 项工具声明。可从左侧或内容索引选择单项。</p><pre>'+esc(e.body)+'</pre>';
    const body=e.body.replace(/<\/?(?:system-reminder|available_skills)>\s*/g,'').trim();
    return body.split(/\n{2,}/).map(p=>'<p>'+esc(p).replace(/\n/g,'<br>')+'</p>').join('');
  }
  function openContent(key){
    const e=entity(key);if(!e)return;
    state.modalKey=key;state.modalMode='read';renderModal();hideTooltip();$('content-dialog').showModal();
  }
  function renderModal(){
    const e=entity(state.modalKey);if(!e)return;
    $('dialog-location').textContent=e.group.name+' / '+(e.leaf?.path||e.group.field);
    $('dialog-title').textContent=e.name;
    $('dialog-metric').textContent='≈ '+amount(e.tokens)+' tokens · 占全请求 '+percent(e.tokens)+' · '+e.body.length.toLocaleString('zh-CN')+' 字符';
    $('dialog-body').innerHTML=contentHTML(e,state.modalMode);
    $('dialog-record').textContent=recordText(e)+(e.group.id==='skill-catalog'?' · 本次目录不包含 Skill 正文。':e.group.id==='system-prompt'?' · 内部片段的装配时刻未记录。':'');
    $('content-dialog').querySelectorAll('[data-action="modal-mode"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===state.modalMode)));
  }
  function drawMap(id,sourceGroups){
    const host=$(id);if(!host)return;
    const width=host.clientWidth,height=host.clientHeight,total=sourceGroups.reduce((sum,g)=>sum+g.tokens,0);
    if(!width||!height||!total)return;
    const roots=tileLayout([...sourceGroups].sort((a,b)=>b.tokens-a.tokens).map(g=>({...g,weight:g.tokens})),width,height);
    const ownGeometry=new Map();
    host.innerHTML='<div class="treemap-inner">'+roots.map(g=>{
      const pad=Math.min(2,g.w/6,g.h/6),gw=g.w-pad*2,gh=g.h-pad*2;
      const cells=tileLayout(members(g).sort((a,b)=>b.tokens-a.tokens||a.order-b.order).map(l=>({...l,weight:l.tokens})),gw,gh);
      return '<div class="tm-group" data-group="'+g.id+'" style="left:'+(g.x+pad)+'px;top:'+(g.y+pad)+'px;width:'+gw+'px;height:'+gh+'px" aria-label="'+esc(g.name)+'，估算 '+amount(g.tokens)+' tokens">'+cells.map(c=>{
        const gap=Math.min(1.3,c.w/5,c.h/5),x=c.x+gap,y=c.y+gap,w=c.w-2*gap,h=c.h-2*gap;
        ownGeometry.set(c.id,{x:g.x+pad+x,y:g.y+pad+y,w,h});
        const label=w>=57&&h>=30,small=w<90||h<65,metric=w>=88&&h>=62,short=!label&&w>=36&&h>=20;
        return '<button type="button" class="tm-cell '+c.kind+(small?' small':'')+(c.auxiliary?' auxiliary':'')+(c.id===state.selected?' selected':'')+(state.query&&!matches(c)?' dim':'')+'" data-map="'+id+'" data-leaf="'+c.id+'" tabindex="'+(c.id===state.selected?0:-1)+'" style="left:'+x+'px;top:'+y+'px;width:'+w+'px;height:'+h+'px" aria-label="'+esc(c.name)+'，估算 '+amount(c.tokens)+' tokens">'+(label?'<span class="tm-text"><strong class="tm-name">'+esc(c.name).replaceAll('_','_<wbr>')+'</strong>'+(metric?'<span class="tm-amount">'+compact(c.tokens)+'</span>':'')+'</span>':short?'<span class="tm-short">'+esc(c.name)+'</span>':'')+'</button>';
      }).join('')+'</div>';
    }).join('')+'</div>';
    if(!host.querySelector('.tm-cell[tabindex="0"]')){const first=host.querySelector('.tm-cell');if(first)first.tabIndex=0;}
    mapViews.set(id,{groups:sourceGroups,geometry:ownGeometry,width,height});if(id==='main-map')geometry=ownGeometry;
  }
  function redrawMaps(){
    for(const [id,m] of mapViews){const host=$(id);if(host&&(m.width!==host.clientWidth||m.height!==host.clientHeight)){stopArrival();drawMap(id,m.groups);}}
  }
  const mapObserver=new ResizeObserver(()=>redrawMaps());
  function observeMaps(){mapObserver.disconnect();for(const id of mapViews.keys())if($(id))mapObserver.observe($(id));}
  function updateMapSelection(){
    if(zoomView){zoomView.select(state.selected);zoomView.search(state.query,data.leaves.filter(l=>matches(l)).map(l=>l.id));}
    document.querySelectorAll('.tm-cell').forEach(el=>{el.classList.toggle('selected',el.dataset.leaf===state.selected);el.tabIndex=el.dataset.leaf===state.selected?0:-1;el.classList.toggle('dim',!!state.query&&!matches(leaves.get(el.dataset.leaf)));});
    document.querySelectorAll('.treemap').forEach(host=>{if(!host.querySelector('.tm-cell[tabindex="0"]')){const first=host.querySelector('.tm-cell');if(first)first.tabIndex=0;}});
  }
  function hideTooltip(){$('map-tooltip').hidden=true;}
  function showTooltip(tile,event){
    if(!matchMedia('(pointer:fine)').matches)return;
    const leaf=leaves.get(tile.dataset.leaf),g=groups.get(leaf.groupId),box=tile.getBoundingClientRect();
    $('map-tooltip').innerHTML='<strong>'+esc(leaf.name)+'</strong>'+esc(g.name)+' · '+amount(leaf.tokens)+' tokens · '+percent(leaf.tokens);
    $('map-tooltip').hidden=false;const w=$('map-tooltip').offsetWidth,h=$('map-tooltip').offsetHeight;
    const x=event?.clientX??box.left+box.width/2,y=event?.clientY??box.bottom;
    $('map-tooltip').style.left=Math.max(7,Math.min(innerWidth-w-8,x+13))+'px';$('map-tooltip').style.top=Math.max(7,Math.min(innerHeight-h-8,y+13))+'px';
  }
  function renderPeek(){
    const leaf=selected(),group=groups.get(leaf.groupId);
    const groupControl=design==='zoom'?'<button type="button" class="text-button" data-action="zoom-group" data-group="'+group.id+'">聚焦分组</button>':state.filter===group.id?'<button type="button" class="text-button" data-action="filter" data-filter="all">返回全图</button>':'<button type="button" class="text-button" data-action="zoom" data-group="'+group.id+'">放大分组</button>';
    if($('peek'))$('peek').innerHTML='<div class="peek-main"><div class="peek-title"><strong>'+esc(leaf.name)+'</strong><span class="mono">'+esc(group.name)+' / '+esc(leaf.path)+'</span></div><p class="peek-description">'+esc(leaf.description||leaf.body.replace(/\s+/g,' ').slice(0,180))+'</p></div><div class="peek-amount"><strong>'+compact(leaf.tokens)+'</strong><small>全请求 '+percent(leaf.tokens)+'</small></div><div class="peek-actions">'+groupControl+'<button type="button" class="primary-button" data-action="open" data-entity="'+keyLeaf(leaf.id)+'">'+(design==='zoom'?'阅读原文':'查看内容')+' ↗</button></div>';
    if($('tools-peek'))$('tools-peek').innerHTML='<div><strong>'+esc(leaf.groupId==='tools'?leaf.name:'工具声明')+'</strong><p>'+(leaf.groupId==='tools'?'≈ '+amount(leaf.tokens)+' tokens · '+esc(leaf.path):'49 项名称、用途与参数定义')+'</p></div><button type="button" data-action="open" data-entity="'+keyLeaf(leaf.groupId==='tools'?leaf.id:first.id)+'">查看说明 ↗</button>';
  }
  function navigateLeaf(id,{locate=false}={}){
    const leaf=leaves.get(id);if(!leaf)return;state.selected=id;
    if(design==='zoom'){zoomView.select(id);if(locate)zoomView.focusLeaf(id);updateMapSelection();renderPeek();}
    else if(design==='reader'){state.reader=keyLeaf(id);state.readerMode='read';renderApp();}
    else if(design==='matrix'){
      const within=activeGroups().some(g=>g.id===leaf.groupId),r=geometry.get(id);
      if(!within||locate&&(!r||r.w<45||r.h<28)){state.filter=leaf.groupId;renderApp();}else{updateMapSelection();renderPeek();}
    }else{updateMapSelection();renderPeek();if(locate)openContent(keyLeaf(id));}
    save();closeSearch();hideTooltip();
  }
  function renderSearch(){
    const popup=document.querySelector('.search-popover');if(!popup)return;
    if(!state.query){popup.hidden=true;return;}
    const query=state.query.toLocaleLowerCase(),found=data.leaves.filter(l=>matches(l)).sort((a,b)=>Number(b.name.toLocaleLowerCase().includes(query))-Number(a.name.toLocaleLowerCase().includes(query))||b.tokens-a.tokens);
    popup.innerHTML=found.slice(0,6).map(l=>'<button type="button" class="search-result" data-action="search-pick" data-leaf="'+l.id+'"><span><strong>'+esc(l.name)+'</strong><small>'+esc(groups.get(l.groupId).name)+' · '+esc(l.path)+'</small></span><span class="mono">'+compact(l.tokens)+'</span></button>').join('')+(found.length>6?'<button type="button" class="search-result" data-action="index-search">查看全部 '+found.length+' 个匹配 ↗</button>':!found.length?'<p class="empty-note">没有匹配内容，试试工具名、字段或原文关键词。</p>':'');popup.hidden=false;
  }
  function closeSearch(){document.querySelectorAll('.search-popover').forEach(el=>el.hidden=true);}
  function openIndex(scope=null,query=''){
    state.indexScope=scope;$('index-query').value=query;
    $('index-title').textContent=scope?groups.get(scope).name+' · 内容索引':'全部内容 · '+data.leaves.length+' 项';
    renderIndex();closeSearch();hideTooltip();$('index-dialog').showModal();$('index-query').focus();
  }
  function renderIndex(){
    const query=$('index-query').value.trim(),scope=state.indexScope?[groups.get(state.indexScope)]:data.groups;
    $('index-list').innerHTML=scope.map(g=>{
      const list=members(g).filter(l=>matches(l,query));if(!list.length)return '';
      return '<h3 class="index-group-title">'+esc(g.name)+' · '+list.length+' 项</h3>'+list.map(l=>'<button type="button" class="index-row" data-action="index-pick" data-leaf="'+l.id+'"><span><strong>'+esc(l.name)+'</strong><small>'+esc(l.path)+(l.auxiliary?' · 封装与引导':'')+'</small></span><span class="mono">'+compact(l.tokens)+'</span></button>').join('');
    }).join('')||'<p class="empty-note">没有匹配内容。</p>';
  }
  function renderMatrix(){
    const scope=activeGroups(),total=scope.reduce((s,g)=>s+g.tokens,0),count=scope.reduce((s,g)=>s+g.items.length,0);
    const breadcrumb=state.filter==='all'?'<span>全部内容</span>':'<button type="button" data-action="filter" data-filter="all">全部内容</button><span class="crumb-divider">/</span><strong>'+esc(state.filter==='round'?'本轮信息':scope[0].name)+'</strong>';
    $('app').innerHTML='<section class="page matrix-page">'+pageHeading('上下文','首次请求中实际出现的内容。')+
      '<div class="matrix-toolbar"><nav class="matrix-breadcrumb" aria-label="当前查看范围">'+breadcrumb+'</nav><div class="matrix-actions">'+searchMarkup()+
      '<button type="button" class="text-button replay-button" data-action="arrival" title="按原始记录顺序放慢呈现；实际写入跨度 '+admissionSpan+'ms。"><span aria-hidden="true">↻</span> 装填回放</button><button type="button" class="text-button" data-action="index">内容索引 ↗</button></div></div>'+
      '<div id="main-map" class="treemap" role="group" aria-label="上下文体积矩阵"></div><div class="map-caption"><span id="arrival-note">面积表示估算体积；颜色区分内容类型。</span><span>'+count+' 个片段'+(state.filter==='all'?'':' · ≈ '+compact(total)+' tokens · 全请求 '+percent(total))+' · 双击放大分组</span></div>'+
      '<section id="peek" class="peek" aria-label="选中内容" aria-live="polite"></section>'+pageFooter()+'</section>';
    drawMap('main-map',scope);
  }
  function updateZoomView(info){
    if(!$('zoom-percent'))return;
    $('zoom-percent').textContent=Math.round(info.zoom*100)+'%';
    const nav=$('zoom-breadcrumb'),path=(info.groupId||'')+'|'+(info.leafId||'');
    if(nav.dataset.path===path)return;nav.dataset.path=path;
    nav.innerHTML=info.groupId?'<button type="button" data-action="zoom-all">全部内容</button><span class="crumb-divider">/</span>'+(info.leafId?'<button type="button" data-action="zoom-group" data-group="'+info.groupId+'">'+esc(groups.get(info.groupId).name)+'</button><span class="crumb-divider">/</span><strong>'+esc(leaves.get(info.leafId).name)+'</strong>':'<strong>'+esc(groups.get(info.groupId).name)+'</strong>'):'<span>全部内容</span>';
  }
  function renderZoom(){
    $('app').innerHTML='<section class="page matrix-page zoom-page">'+pageHeading('上下文','从整体占用，一直看到原文。')+
      '<div class="matrix-toolbar"><nav id="zoom-breadcrumb" class="matrix-breadcrumb" aria-label="当前视野"><span>全部内容</span></nav><div class="matrix-actions">'+searchMarkup()+'<button type="button" class="text-button" data-action="index">内容索引 ↗</button></div></div>'+
      '<div id="zoom-stage" class="zoom-stage"><canvas tabindex="0" aria-label="上下文地图：滚轮缩放，拖动平移，双击聚焦；键盘加减缩放，方向键平移，Escape 查看全图。"></canvas><div class="zoom-controls" aria-label="地图缩放"><button type="button" data-action="zoom-out" aria-label="缩小">−</button><output id="zoom-percent" aria-live="off">100%</output><button type="button" data-action="zoom-in" aria-label="放大">+</button><button type="button" data-action="zoom-all" aria-label="查看全图" title="查看全图 · Escape">⤢</button></div><canvas class="zoom-minimap" width="112" height="68" hidden aria-label="当前视野在完整请求中的位置"></canvas></div>'+
      '<div class="map-caption"><span>面积按完整请求估算；放大后显示声明与正文。</span><span>滚轮缩放 · 拖动平移 · 双击聚焦</span></div><section id="peek" class="peek" aria-label="选中内容" aria-live="polite"></section>'+pageFooter()+'</section>';
    zoomView=window.createContextZoom($('zoom-stage'),{data,layout:tileLayout,selected:state.selected,onSelect:id=>navigateLeaf(id),onView:updateZoomView,onInteract:()=>{hideTooltip();closeSearch();},reducedMotion});
  }
  function readerGroup(g,active){
    const expanded=g.id===active&&g.items.length>1;
    return '<button type="button" class="outline-group '+(g.id===active?'active':'')+'" data-action="reader-group" data-group="'+g.id+'" aria-expanded="'+expanded+'"><span class="index">'+(g.id==='tools'?'↗':g.messageIndex)+'</span><span>'+esc(g.name)+'</span><small>'+compact(g.tokens)+'</small></button>'+(expanded?'<div class="outline-leaves">'+members(g).map(l=>'<button type="button" class="outline-leaf '+(state.reader===keyLeaf(l.id)?'active':'')+'" data-action="reader-leaf" data-leaf="'+l.id+'" title="'+esc(l.name)+'">'+esc(l.name)+'</button>').join('')+'</div>':'');
  }
  function renderReader(){
    const e=entity(state.reader)||entity(keyGroup('system-prompt')),g=e.group;
    $('app').innerHTML='<section class="reader-shell"><aside class="outline" aria-label="请求内容目录"><h2 class="outline-heading">上下文</h2><nav class="outline-groups" aria-label="原生请求字段"><p class="outline-label">messages[]</p>'+data.groups.filter(g=>g.id!=='tools').map(item=>readerGroup(item,g.id)).join('')+'<p class="outline-label">tools[]</p>'+readerGroup(groups.get('tools'),g.id)+'</nav><div class="outline-total">首次请求 · 文本体积估算<strong>'+compact(data.total)+' <span style="font:11px Geist,sans-serif">tokens</span></strong>'+data.messageCount+' 条消息 · '+data.toolCount+' 项工具</div></aside><article class="reader-workspace"><div class="reader-toolbar"><p class="location">'+esc(e.leaf?.path||g.field)+'<br><span>seq '+g.seq+' · '+(g.role?'role='+esc(g.role):'独立请求字段')+'</span></p>'+searchMarkup()+'</div><div class="document-page"><header class="document-header"><div><p class="eyebrow">'+(g.id==='tools'?'TOOL DEFINITION':'MESSAGE / '+g.messageIndex)+'</p><h1>'+esc(e.name)+'</h1><p class="doc-meta">'+esc(g.name)+(e.leaf?' · 第 '+(e.leaf.order+1)+' 个片段':' · '+g.items.length+' 个片段')+'</p></div><div class="document-metric"><strong>'+compact(e.tokens)+'</strong><small>全请求 '+percent(e.tokens)+'</small></div></header><nav class="document-nav" aria-label="阅读操作"><div class="content-tabs"><button type="button" data-action="reader-mode" data-mode="read" aria-pressed="'+(state.readerMode==='read')+'">阅读</button><button type="button" data-action="reader-mode" data-mode="raw" aria-pressed="'+(state.readerMode==='raw')+'">原始文本</button></div><div class="doc-nav-actions"><button type="button" data-action="reader-next" data-step="-1" aria-label="上一个内容">← 上一项</button><button type="button" data-action="reader-next" data-step="1" aria-label="下一个内容">下一项 →</button><button type="button" data-action="index" data-group="'+g.id+'">索引</button></div></nav><div class="doc-content">'+contentHTML(e,state.readerMode)+'</div><footer class="document-record">'+esc(recordText(e))+'<br>冻结会话 '+esc(data.source.date)+' · 文本体积估算，非供应商实报用量。'+(g.id==='skill-catalog'?'<br>此处为方法目录，尚未加载 Skill 正文。':'')+'</footer></div></article></section>';
  }
  function renderOverview(){
    const toolGroup=groups.get('tools'),catalog=groups.get('skill-catalog'),rules=['system-prompt','agent-instructions'].map(id=>groups.get(id)),round=roundIds.map(id=>groups.get(id));
    const ruleTotal=rules.reduce((s,g)=>s+g.tokens,0),roundTotal=round.reduce((s,g)=>s+g.tokens,0);
    $('app').innerHTML='<section class="page">'+pageHeading('上下文概览','工具、规则与方法，分别查看。')+'<div class="overview-top-actions">'+searchMarkup()+'<button type="button" class="text-button" style="margin-left:18px" data-action="index">全部内容 ↗</button></div><div class="overview-grid"><section class="panel tools-panel"><header class="panel-heading"><div><h2>工具声明</h2><p>'+data.toolCount+' 项 · 名称、用途与参数</p></div><div class="panel-amount"><strong>'+compact(toolGroup.tokens)+'</strong><small>全请求 '+percent(toolGroup.tokens)+'</small></div></header><div id="tools-map" class="treemap" role="group" aria-label="工具声明体积矩阵"></div><div class="panel-links"><span>此区域内，面积表示工具声明体积。</span><button type="button" data-action="index" data-group="tools">查看 '+data.toolCount+' 项工具 ↗</button></div><div id="tools-peek" class="tools-peek" aria-live="polite"></div></section><section class="panel rules-panel"><header class="panel-heading"><div><h2>系统与指令</h2><p>模型的基础约束</p></div><div class="panel-amount"><strong>'+compact(ruleTotal)+'</strong><small>'+percent(ruleTotal)+'</small></div></header>'+rules.map(g=>'<button type="button" class="rule-row" data-action="open" data-entity="'+keyGroup(g.id)+'"><span><strong>'+esc(g.name)+'</strong><small>'+esc(g.field)+' · seq '+g.seq+'</small></span><span class="mono">'+compact(g.tokens)+' ↗</span></button>').join('')+'</section><section class="panel round-panel"><header class="panel-heading"><div><h2>本轮信息</h2><p>输入、环境与运行约束</p></div><div class="panel-amount"><strong>'+compact(roundTotal)+'</strong><small>'+percent(roundTotal)+'</small></div></header><p class="context-quote">'+esc(groups.get('user').body)+'</p><div class="context-groups">'+round.map(g=>'<button type="button" data-action="open" data-entity="'+keyGroup(g.id)+'">'+esc(g.name)+' ↗</button>').join('')+'</div></section><section class="panel skills-panel"><header class="skills-heading"><h2>方法目录 <small>'+members(catalog).filter(l=>!l.auxiliary).length+' SKILLS</small></h2><p>≈ '+compact(catalog.tokens)+' tokens · 本次仅包含目录与说明</p></header><div class="skill-cloud">'+members(catalog).filter(l=>!l.auxiliary).map(l=>'<button type="button" class="skill-chip" data-action="open" data-entity="'+keyLeaf(l.id)+'">'+esc(l.name)+'</button>').join('')+'</div></section></div>'+pageFooter()+'</section>';
    drawMap('tools-map',[toolGroup]);
  }
  function captureMatrix(){
    return new Map([...document.querySelectorAll('#main-map .tm-cell')].map(el=>[el.dataset.leaf,el.getBoundingClientRect()]));
  }
  function animateMatrix(previous){
    if(reducedMotion.matches||!previous.size)return;
    document.querySelectorAll('#main-map .tm-cell').forEach(el=>{
      const from=previous.get(el.dataset.leaf),to=el.getBoundingClientRect();
      if(!to.width||!to.height)return;
      const start=from?{transform:'translate('+(from.left-to.left)+'px,'+(from.top-to.top)+'px) scale('+(from.width/to.width)+','+(from.height/to.height)+')',opacity:.75}:{transform:'translateY(4px)',opacity:0};
      el.animate([start,{transform:'none',opacity:1}],{duration:260,easing:'cubic-bezier(.2,.75,.2,1)',fill:'backwards'});
    });
  }
  function stopArrival(){
    arrivalTimers.forEach(clearTimeout);arrivalTimers=[];
    arrivalAnimations.forEach(animation=>animation.cancel());arrivalAnimations=[];
    arrivalRunning=false;
    const button=document.querySelector('[data-action="arrival"]');if(button){button.innerHTML='<span aria-hidden="true">↻</span> 装填回放';button.classList.remove('playing');}
    if($('arrival-note')){$('arrival-note').textContent='面积表示估算体积；颜色区分内容类型。';$('arrival-note').classList.remove('playing');}
  }
  function playArrival(){
    if(design!=='matrix')return;
    stopArrival();
    if(reducedMotion.matches){if($('arrival-note'))$('arrival-note').textContent='已遵循系统的减少动态效果设置。';return;}
    state.query='';document.querySelectorAll('.global-search').forEach(input=>input.value='');updateMapSelection();
    if(state.filter!=='all'){state.filter='all';renderApp({motion:false});}
    arrivalRunning=true;hideTooltip();closeSearch();
    const button=document.querySelector('[data-action="arrival"]');button.textContent='结束回放';button.classList.add('playing');
    const note=$('arrival-note');note.classList.add('playing');
    const scale=admissionSpan>0?620/admissionSpan:0;
    let end=0;
    admissions.forEach((g,index)=>{
      const node=document.querySelector('#main-map .tm-group[data-group="'+g.id+'"]');if(!node)return;
      // Timestamp spacing is expanded for legibility; sequence breaks millisecond ties.
      // All children share their recorded parent's admission, including the whole tools array.
      const delay=(g.time-firstAdmission)*scale+index*16,duration=270;end=Math.max(end,delay+duration);
      arrivalAnimations.push(node.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'none'}],{delay,duration,easing:'cubic-bezier(.2,.7,.2,1)',fill:'both'}));
      arrivalTimers.push(setTimeout(()=>{if(arrivalRunning)note.textContent=g.name+' · '+g.field+' · seq '+g.seq+' · +'+(g.time-firstAdmission)+'ms';},delay));
    });
    arrivalTimers.push(setTimeout(()=>{stopArrival();if($('arrival-note'))$('arrival-note').textContent='面积表示估算体积 · 原始装填跨度 '+admissionSpan+'ms，回放已放慢。';},end+100));
  }
  function renderApp({motion=true}={}){
    const previous=design==='matrix'&&motion?captureMatrix():new Map();
    stopArrival();zoomView?.destroy();zoomView=null;mapObserver.disconnect();mapViews.clear();hideTooltip();
    if(design==='zoom')renderZoom();else if(design==='reader')renderReader();else if(design==='overview')renderOverview();else renderMatrix();
    renderPeek();updateMapSelection();observeMaps();
    if(design==='matrix'&&motion)animateMatrix(previous);
    const active=document.querySelector('.outline-leaf.active'),list=active?.parentElement;
    if(active&&list.clientHeight)list.scrollTop+=active.getBoundingClientRect().top-list.getBoundingClientRect().top-(list.clientHeight-active.clientHeight)/2;
  }
  function chooseReaderGroup(id){
    const g=groups.get(id);if(!g)return;
    const current=entity(state.reader);
    state.reader=id==='tools'?keyLeaf(current?.group.id===id&&current.leaf?current.leaf.id:members(g).find(l=>!l.auxiliary).id):keyGroup(id);
    state.readerMode='read';renderApp();save();
  }
  function stepReader(step){
    const e=entity(state.reader),list=e.leaf?members(e.group).map(l=>keyLeaf(l.id)):data.groups.map(g=>keyGroup(g.id));
    const index=list.indexOf(state.reader),key=list[(index+step+list.length)%list.length];
    if(key===keyGroup('tools'))chooseReaderGroup('tools');else{state.reader=key;state.readerMode='read';renderApp();save();}
  }
  async function copyOriginal(button){
    const e=entity(state.modalKey);if(!e)return;
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(e.body);
      else{const textarea=document.createElement('textarea');textarea.value=e.body;textarea.style.position='fixed';textarea.style.opacity='0';document.body.append(textarea);textarea.select();const copied=document.execCommand('copy');textarea.remove();if(!copied)throw new Error('copy');}
      button.textContent='已复制';setTimeout(()=>{button.textContent='复制原文';},1400);
    }catch{button.textContent='请从原始文本复制';state.modalMode='raw';renderModal();}
  }
  function filterTo(id){
    if(state.filter===id)return;
    state.filter=id;
    const scope=activeGroups();if(!scope.some(g=>g.id===selected().groupId))state.selected=members([...scope].sort((a,b)=>b.tokens-a.tokens)[0]).sort((a,b)=>b.tokens-a.tokens)[0].id;
    renderApp();save();
  }
  document.addEventListener('click',event=>{
    const tile=event.target.closest('.tm-cell');
    if(tile){navigateLeaf(tile.dataset.leaf);if(design==='overview')openContent(keyLeaf(tile.dataset.leaf));return;}
    const button=event.target.closest('[data-action]');
    if(!button){if(!event.target.closest('.search-wrap'))closeSearch();return;}
    const {action}=button.dataset;
    if(action==='zoom-in')zoomView.zoom(1.5);
    else if(action==='zoom-out')zoomView.zoom(1/1.5);
    else if(action==='zoom-all')zoomView.fitAll();
    else if(action==='zoom-group')zoomView.focusGroup(button.dataset.group);
    else if(action==='arrival'){if(arrivalRunning)stopArrival();else playArrival();}
    else if(action==='filter')filterTo(button.dataset.filter);
    else if(action==='zoom')filterTo(button.dataset.group);
    else if(action==='open')openContent(button.dataset.entity);
    else if(action==='index')openIndex(button.dataset.group||null);
    else if(action==='index-search')openIndex(null,state.query);
    else if(action==='search-pick'||action==='index-pick'){
      if($('index-dialog').open)$('index-dialog').close();
      state.query='';document.querySelectorAll('.global-search').forEach(el=>el.value='');navigateLeaf(button.dataset.leaf,{locate:true});
    }else if(action==='reader-group')chooseReaderGroup(button.dataset.group);
    else if(action==='reader-leaf')navigateLeaf(button.dataset.leaf);
    else if(action==='reader-mode'){
      const workspace=document.querySelector('.reader-workspace'),position=workspace.scrollTop;
      state.readerMode=button.dataset.mode;renderApp();document.querySelector('.reader-workspace').scrollTop=position;
    }else if(action==='reader-next')stepReader(Number(button.dataset.step));
    else if(action==='modal-mode'){state.modalMode=button.dataset.mode;renderModal();}
    else if(action==='copy')copyOriginal(button);
  });
  document.addEventListener('pointerdown',event=>{if(arrivalRunning&&!event.target.closest('[data-action="arrival"]'))stopArrival();},true);
  document.addEventListener('keydown',event=>{if(arrivalRunning&&event.key!=='Shift'&&(event.key==='Escape'||!event.target.closest('[data-action="arrival"]')))stopArrival();},true);
  reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)stopArrival();});
  document.addEventListener('dblclick',event=>{
    const tile=event.target.closest('.tm-cell');if(tile&&design==='matrix')filterTo(leaves.get(tile.dataset.leaf).groupId);
  });
  document.addEventListener('input',event=>{
    if(event.target.matches('.global-search')){stopArrival();state.query=event.target.value.trim();updateMapSelection();renderSearch();}
    else if(event.target.id==='index-query')renderIndex();
  });
  document.addEventListener('focusin',event=>{
    if(event.target.matches('.global-search'))renderSearch();
    const tile=event.target.closest('.tm-cell');if(tile)showTooltip(tile);
  });
  document.addEventListener('pointerover',event=>{const tile=event.target.closest('.tm-cell');if(tile)showTooltip(tile,event);});
  document.addEventListener('pointermove',event=>{const tile=event.target.closest('.tm-cell');if(tile)showTooltip(tile,event);});
  document.addEventListener('pointerout',event=>{if(event.target.closest('.tm-cell')&&!event.relatedTarget?.closest('.tm-cell'))hideTooltip();});
  document.addEventListener('keydown',event=>{
    if(event.key==='/'&&!event.target.closest('input,textarea,[contenteditable=true]')&&!document.querySelector('dialog[open]')){event.preventDefault();document.querySelector('.global-search')?.focus();return;}
    if(event.key==='Escape'){
      closeSearch();hideTooltip();
      if(event.target.matches('.global-search')){event.target.value='';state.query='';updateMapSelection();}
      return;
    }
    if(event.target.matches('.global-search')&&event.key==='ArrowDown'){event.preventDefault();document.querySelector('.search-popover .search-result')?.focus();return;}
    if(design==='zoom'&&event.target.matches('.global-search')&&event.key==='Enter'){event.preventDefault();document.querySelector('.search-popover:not([hidden]) [data-action="search-pick"]')?.click();return;}
    const tile=event.target.closest('.tm-cell');if(!tile||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    const view=mapViews.get(tile.dataset.map),current=view?.geometry.get(tile.dataset.leaf);if(!current)return;
    event.preventDefault();const entries=[...view.geometry];let target;
    if(event.key==='Home'||event.key==='End')target=entries[event.key==='Home'?0:entries.length-1]?.[0];
    else{
      const vertical=event.key==='ArrowUp'||event.key==='ArrowDown',positive=event.key==='ArrowRight'||event.key==='ArrowDown',cx=current.x+current.w/2,cy=current.y+current.h/2;
      target=entries.filter(([id])=>id!==tile.dataset.leaf).map(([id,r])=>{const dx=r.x+r.w/2-cx,dy=r.y+r.h/2-cy,forward=(vertical?dy:dx)*(positive?1:-1),side=Math.abs(vertical?dx:dy);return {id,forward,score:Math.hypot(dx,dy)+side*1.8};}).filter(r=>r.forward>1).sort((a,b)=>a.score-b.score)[0]?.id;
    }
    if(target){navigateLeaf(target);document.querySelector('.tm-cell[data-leaf="'+target+'"]')?.focus({preventScroll:true});}
  });
  $('dialog-close').addEventListener('click',()=>$('content-dialog').close());
  $('index-close').addEventListener('click',()=>$('index-dialog').close());
  $('source-close').addEventListener('click',()=>$('source-dialog').close());
  $('source-open').addEventListener('click',()=>{
    const s=data.source;
    $('source-body').innerHTML='<p>本页绑定 '+esc(s.date)+' 的 DSH 冻结会话首次请求，切点 seq '+s.cut+'。它不是当前本机配置。</p><h3>消息与顺序</h3><p>'+data.messageCount+' 条逻辑消息与 '+data.toolCount+' 项工具声明，按原始事件和 SurfaceManager 消息位置整理。消息写入为 seq 15–21，工具声明为 seq '+s.toolsHeaderSeq+'。工具数组位置不代表注册时间；系统提示内部片段的装配时刻未记录。</p><h3>面积与估算</h3><p>合计约 '+amount(data.total)+' tokens，采用当前 DSH 固定文本密度估算。各片段与引导、封装项相加等于所属分组。矩阵面积表达估算体积；总览版只在工具矩阵内部按面积编码，各面板大小服务于阅读。</p><h3>可复核记录</h3><pre>'+esc(s.log)+'\n'+esc(s.session)+'\ncut='+s.cut+' · firstModelSeq='+s.firstModelSeq+'\n'+esc(s.estimator)+'</pre>';
    if(design==='zoom')$('source-body').insertAdjacentHTML('afterbegin','<h3>缩放与原文</h3><p>缩放改变视野，矩形的位置和估算占比保留在同一布局中。放大后，实际声明与消息正文在原来的矩形内出现；封装项展示计量说明。搜索可定位小项，阅读原文可打开完整内容。</p>');
    else $('source-body').insertAdjacentHTML('afterbegin','<h3>动效的依据</h3><p>按 seq '+admissions[0].seq+'–'+admissions.at(-1).seq+' 的记录顺序呈现，原始写入跨度 '+admissionSpan+'ms，播放已放慢。同一条消息内的片段同时入场，全部工具声明作为一次记录整体入场。图中位置和面积保持最终请求的体积关系。</p><p>正式 Eval 首页是当前配置的静态计量，动态内容保留为待组装；它没有这份会话的装填时间线，也不保证所有注册项每轮进入请求。</p>');
    hideTooltip();closeSearch();$('source-dialog').showModal();
  });
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
  document.querySelectorAll('[data-design-link]').forEach(link=>{if(link.dataset.designLink===design){link.classList.add('active');link.setAttribute('aria-current','page');}});
  $('source-date').textContent=data.source.date;
  renderApp();
  if(design==='matrix'&&!reducedMotion.matches)requestAnimationFrame(()=>playArrival());
});
