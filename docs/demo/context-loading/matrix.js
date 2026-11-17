document.addEventListener('DOMContentLoaded',()=>{
  const data=window.CONTEXT_MATRIX,$=id=>document.getElementById(id);
  if(!data||typeof tileLayout!=='function'){
    document.querySelector('main').textContent='请运行 node scripts/build-context-loading-matrix.mjs，打开生成的 .dsh/context-loading-matrix/index.html。';return;
  }
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const compact=n=>n>=1000?(n/1000).toFixed(1)+'k':Number(n.toFixed(1)).toLocaleString('zh-CN');
  const amount=n=>Number(n.toFixed(2)).toLocaleString('zh-CN');
  const pct=n=>(n/data.total*100).toFixed(n/data.total<.001?2:1)+'%';
  const leafById=new Map(data.leaves.map(l=>[l.id,l])),groupById=new Map(data.groups.map(g=>[g.id,g]));
  const own=g=>g.items.map(id=>leafById.get(id));
  let stored={};try{stored=JSON.parse(localStorage.getItem('trajectory-context-drag-workbench-v1')||'{}');}catch{}
  const initial=data.leaves.find(l=>l.name==='trajectory_read')||data.leaves.find(l=>l.name==='read')||data.leaves[0];
  const state={scope:stored.scope==='messages'||groupById.has(stored.scope)?stored.scope:null,selected:leafById.has(stored.selected)?stored.selected:initial.id,group:groupById.has(stored.group)?stored.group:null,query:'',detailTab:'text',indexGroup:null};
  if(state.group)state.selected=null;
  let geometry=new Map(),groupGeometry=new Map();
  const selectedLeaf=()=>leafById.get(state.selected);
  const selectedGroup=()=>groupById.get(state.group||selectedLeaf()?.groupId);
  const normalized=s=>String(s??'').toLocaleLowerCase();
  const matches=(leaf,query=state.query)=>!query||normalized(leaf.name+' '+leaf.path+' '+leaf.description+' '+leaf.body+' '+groupById.get(leaf.groupId).name).includes(normalized(query.trim()));
  const save=()=>{try{localStorage.setItem('trajectory-context-drag-workbench-v1',JSON.stringify({scope:state.scope,selected:state.selected,group:state.group}));}catch{}};
  const includesGroup=(groupId,scope=state.scope)=>!scope||scope===groupId||scope==='messages'&&groupId!=='tools';
  const visibleGroups=(scope=state.scope)=>data.groups.filter(g=>includesGroup(g.id,scope));
  const visibleLeaves=()=>data.leaves.filter(l=>includesGroup(l.groupId));
  const assembly=new ContextAssembly({map:$('map'),svg:$('assembly-wires'),groups:data.groups,total:data.total,onSelect:id=>selectGroup(id),onChange:()=>{renderMap();renderInspector();save();},onTranslate:(id,dx,dy)=>{
    for(const rect of geometry.values())if(rect.groupId===id){rect.x+=dx;rect.y+=dy;}
    const r=groupGeometry.get(id);if(r){r.x+=dx;r.y+=dy;}drawPins();hideTooltip();
  },onStatus:(text,complete)=>{
    $('assembly-status').textContent=text;
    $('map-encoding').textContent=complete?'拼合面积 ≈ tokens · 连线按原始记录先后':'分离模块独立放大 · 实线是记录先后 · 虚线是插入位置';
  }});
  function texture(leaf,w,h){
    if(w<56||h<39||leaf.auxiliary)return '';
    let art='',right=Math.max(0,w-9),bottom=h-11;
    const left=Math.max(9,w-Math.min(112,w*.58)),top=Math.max(23,h-Math.min(49,h*.38));
    const line=(d,cls='')=>'<path '+(cls?'class="'+cls+'"':'')+' d="'+d+'"/>';
    if(leaf.kind==='tools'){
      const count=Math.min(5,Math.max(3,leaf.parameters?.length||3));
      for(let i=0;i<count;i++){
        const y=bottom-i*5,bend=left+13+i*6;
        art+=line('M '+left+' '+y+' H '+bend+' l 6 -6 H '+right);
        if(i===1||i===count-1)art+='<circle class="via" cx="'+right+'" cy="'+(y-6)+'" r="1.7"/>';
      }
    }else if(leaf.kind==='catalog'){
      for(let i=0;i<6;i++){const x=right-9-i*7;art+=line('M '+x+' '+bottom+' v -'+(9+(i%3)*5)+' l 4 -4')+'<circle class="via" cx="'+(x+4)+'" cy="'+(bottom-13-(i%3)*5)+'" r="1.5"/>';}
    }else if(leaf.kind==='runtime'){
      for(let i=0;i<4;i++){const y=bottom-i*5;art+=line('M '+left+' '+y+' h '+(right-left-12)+' l 6 -6 h 6');}
    }else{
      for(let i=0;i<5;i++){const y=bottom-i*4.5;art+=line('M '+left+' '+y+' H '+(right-20-i%3*8)+' l 5 -4 h '+(15+i%3*8));}
      if(leaf.kind==='instructions')art+=line('M '+(left+4)+' '+bottom+' v -25 h '+Math.max(0,right-left-14));
    }
    return '<svg class="tile-texture" viewBox="0 0 '+w+' '+h+'" aria-hidden="true">'+art+'</svg>';
  }
  function selectedMarkup(){
    const group=selectedGroup();
    assembly.setSelected(group?.id);
    document.querySelectorAll('.sequence-item').forEach(el=>el.classList.toggle('is-selected',el.dataset.group===group?.id));
    document.querySelectorAll('.region').forEach(el=>el.classList.toggle('is-selected',state.group===el.dataset.group));
    document.querySelectorAll('.tile').forEach((el,i)=>{el.classList.toggle('selected',el.dataset.item===state.selected);el.tabIndex=el.dataset.item===state.selected||!state.selected&&i===0?0:-1;});
    document.querySelectorAll('.field-selection').forEach(el=>{
      const applies=group&&(el.dataset.field==='messages'?group.id!=='tools':el.dataset.field===group.id);
      el.textContent=applies?(selectedLeaf()?.name||group.name):'';
      el.hidden=!applies;
    });
    drawPins();
  }
  function drawPins(){
    const svg=$('plot-pins'),r=geometry.get(state.selected)||groupGeometry.get(state.group);
    if(!r){svg.innerHTML='';return;}
    const x=r.x+1,y=r.y+1,w=r.w,h=r.h,n=Math.min(8,w/3,h/3);
    const path='M '+(x+n)+' '+y+' H '+x+' V '+(y+n)+' M '+(x+w-n)+' '+(y+h)+' H '+(x+w)+' V '+(y+h-n);
    svg.setAttribute('viewBox','0 0 '+($('map').clientWidth+2)+' '+($('map').clientHeight+2));
    svg.innerHTML='<path d="'+path+'"/>'+(w>15&&h>15?'<circle cx="'+(x+w)+'" cy="'+(y+h/2)+'" r="2.5"/>':'');
  }
  function renderSequence(){
    $('sequence').innerHTML=data.groups.map(g=>'<button type="button" class="sequence-item'+(g.id==='tools'?' is-tools':'')+'" data-action="select-group" data-group="'+g.id+'" aria-label="查看 '+esc(g.name)+'，原始事件 seq '+g.seq+'"><span><b class="seq">'+g.seq+'</b>'+esc(g.name)+'</span><small>≈ '+compact(g.tokens)+'</small></button>').join('');
  }
  function renderMap(){
    const assembling=!state.scope;
    $('map-plot').classList.toggle('is-assembly',assembling);
    $('assembly-controls').hidden=!assembling;$('field-scopes').hidden=assembling;
    assembly.active=assembling;
    const width=$('map').clientWidth,height=$('map').clientHeight;
    if(!width||!height)return;
    const focus=document.activeElement?.dataset?.item;
    const groups=visibleGroups();let roots,fields;
    const messageGroups=data.groups.filter(g=>g.id!=='tools'),messageTokens=messageGroups.reduce((sum,g)=>sum+g.tokens,0);
    if(assembling){
      roots=assembly.layout(width,height);fields=[];
    }else if(!state.scope){
      const gap=12,left=(width-gap)*messageTokens/data.total;
      roots=[...tileLayout(messageGroups.map(g=>({...g,weight:g.tokens})),left,height),{...groupById.get('tools'),x:left+gap,y:0,w:width-gap-left,h:height}];
      fields=[{id:'messages',key:'messages[]',label:data.messageCount+' 段消息',x:0,w:left,tokens:messageTokens},{id:'tools',key:'tools[]',label:data.toolCount+' 项工具 · seq '+groupById.get('tools').seq,x:left+gap,w:width-gap-left,tokens:groupById.get('tools').tokens}];
    }else{
      roots=tileLayout(groups.map(g=>({...g,weight:g.tokens})),width,height);
      const g=groupById.get(state.scope);
      fields=[{id:state.scope,key:state.scope==='messages'?'messages[]':g.field,label:state.scope==='messages'?data.messageCount+' 段消息':g.name+' · seq '+g.seq,x:0,w:width,tokens:groups.reduce((sum,g)=>sum+g.tokens,0)}];
    }
    $('field-scopes').innerHTML=fields.map(f=>'<button type="button" class="field-scope" data-action="field" data-group="'+f.id+'" style="left:'+f.x+'px;width:'+f.w+'px" aria-label="放大 '+esc(f.key)+'"><span class="field-key"><b>'+esc(f.key)+'</b><small>'+esc(f.label)+'</small></span><span class="field-selection" data-field="'+f.id+'" hidden></span><span class="field-amount">≈ '+compact(f.tokens)+'<small>全请求 '+pct(f.tokens)+'</small></span></button>').join('');
    geometry=new Map();groupGeometry=new Map();
    $('map').innerHTML=roots.map(rect=>{
      const g=groupById.get(rect.id),members=own(g).sort((a,b)=>b.tokens-a.tokens||a.order-b.order);
      groupGeometry.set(g.id,{x:rect.x,y:rect.y,w:rect.w,h:rect.h});
      const caption=g.id!=='tools'&&rect.w>142&&rect.h>82&&members.length>1;
      const cells=tileLayout(members.map(l=>({...l,weight:l.tokens})),rect.w,rect.h);
      return '<section class="region" data-group="'+g.id+'" aria-label="'+esc(g.name)+'，估算 '+amount(g.tokens)+' tokens">'+cells.map((cell,i)=>{
        const gap=Math.min(.7,cell.w/4,cell.h/4),w=cell.w-gap*2,h=cell.h-gap*2;
        const x=cell.x+gap,y=cell.y+gap;
        geometry.set(cell.id,{x:rect.x+x,y:rect.y+y,w,h,groupId:g.id});
        const label=w>=63&&h>=29,large=w>170&&h>120,compactCell=h<59||w<90,address=!label&&g.id==='tools'&&Number.isInteger(cell.nativeIndex)&&w>=27&&h>=19;
        const captionFirst=caption&&cell.x<1&&cell.y<1;
        const canAmount=h>(captionFirst?72:49)&&w>90;
        const isSelected=cell.id===state.selected;
        return '<button type="button" class="tile '+cell.kind+(cell.auxiliary?' auxiliary':'')+(large?' large':'')+(compactCell?' compact':'')+(captionFirst?' first-in-region':'')+(isSelected?' selected':'')+'" data-item="'+cell.id+'" tabindex="'+(isSelected||!state.selected&&i===0?0:-1)+'" style="left:'+x+'px;top:'+y+'px;width:'+w+'px;height:'+h+'px" aria-label="'+esc(cell.name)+'，'+esc(g.name)+'，估算 '+amount(cell.tokens)+' tokens">'+texture(cell,w,h)+(label?'<span class="tile-content"><strong class="tile-name">'+esc(cell.name)+'</strong>'+(canAmount?'<span class="tile-amount">≈ '+compact(cell.tokens)+'</span>':'')+(large?'<span class="tile-desc">'+esc(cell.description.slice(0,150))+'</span>':'')+'</span>':address?'<span class="tile-address">['+cell.nativeIndex+']</span>':'')+'</button>';
      }).join('')+(caption?'<span class="region-caption"><b>'+g.seq+'</b>'+esc(g.name)+(g.id==='tools'?' · '+data.toolCount:'')+'</span>':'')+'</section>';
    }).map((html,i)=>{
      const r=roots[i];return html.replace('class="region"','class="region" style="left:'+r.x+'px;top:'+r.y+'px;width:'+r.w+'px;height:'+r.h+'px"');
    }).join('');
    if(assembling)assembly.decorate();else{$('assembly-wires').innerHTML='';$('map-encoding').innerHTML='<i class="legend-area" aria-hidden="true"></i>面积 ≈ tokens<span class="legend-divider">·</span>纹理区分内容形态';}
    $('breadcrumbs').innerHTML='<button type="button" data-action="all">本次请求</button>'+(state.scope?'<span>/</span>'+(state.scope!=='messages'&&state.scope!=='tools'?'<button type="button" data-action="field" data-group="messages">messages[]</button><span>/</span>':'')+'<strong>'+esc(state.scope==='messages'?'messages[]':state.scope==='tools'?'tools[]':groupById.get(state.scope).name)+'</strong>':'<span>/</span><strong>拖动组装</strong>');
    $('zoom-out').hidden=!state.scope;
    const shown=groups.reduce((sum,g)=>sum+g.tokens,0);
    $('scope-amount').textContent=(state.scope?'本分区 ':'全请求 ')+'≈ '+compact(shown)+' tokens';
    $('index-count').textContent=visibleLeaves().length;
    if(focus){const target=[...$('map').querySelectorAll('[data-item]')].find(el=>el.dataset.item===focus);target?.focus({preventScroll:true});}
    applyQuery();selectedMarkup();
  }
  function record(group,leaf){
    const nodes=group.queue?[{seq:group.queue.queued,label:'入队'},{seq:group.queue.claimed,label:'取出'},{seq:group.seq,label:'写入'}]:[{seq:group.seq,label:group.id==='tools'?'声明记录':'写入消息'}];
    const field=leaf&&!leaf.auxiliary&&group.id==='tools'?leaf.path:group.field;
    const note=group.id==='tools'?'独立于 messages[]；工具在数组中的次序不代表注册时刻。':group.id==='system-prompt'?'这段系统提示一次整体写入；内部片段的先后仅为原文顺序。':group.id==='skill-catalog'?'本次写入的是目录名称与描述；不包含 Skill 正文。':'原始消息位置保持不变，分区放大只改变显示范围。';
    return '<div class="detail-record"><div class="detail-section-label"><span>怎样进入请求</span><span>OBSERVED</span></div><div class="native-track">'+nodes.map(n=>'<div class="native-node"><b>seq '+n.seq+'</b>'+n.label+'</div>').join('')+'</div><div class="native-field"><span>'+esc(field)+'</span><small>'+esc(group.role||'request field')+'</small></div><p class="native-note">'+esc(note)+'</p></div>';
  }
  function basisText(leaf,group){
    if(leaf.basis==='schema-density')return '该项声明的紧凑 JSON 为 '+JSON.stringify(JSON.parse(leaf.body)).length+' 个字符，按 4 字符 / token 的固定密度估算为 '+amount(leaf.tokens)+' tokens。数组分隔符和封装独立计入「工具数组封装」。这是声明体积估算，不是每次工具调用的用量。';
    if(leaf.basis==='text-density')return '这一段保留文本为 '+leaf.body.length+' 个字符，按 4 字符 / token 估算为 '+amount(leaf.tokens)+' tokens。角色封装、引导和分隔未混入本段，保留为同组独立项。';
    if(leaf.basis==='message-estimate')return '整段消息由 DSH 的 estimateMessage 估算为 '+amount(leaf.tokens)+' tokens，包含角色与内容封装。这里的面积不是供应商实报用量，也不表示模型使用了其中哪些内容。';
    return '同一原始消息或字段的总估算 '+amount(group.tokens)+' tokens，减去已独立拆出的原文或声明，余量为 '+amount(leaf.tokens)+' tokens。它包含未拆出的引导文本、分隔、角色结构与估算取整；不代表新增了一次注入。';
  }
  function renderInspector(){
    const leaf=selectedLeaf(),group=selectedGroup();if(!group)return;
    const title=leaf?.name||group.name,tokens=leaf?.tokens??group.tokens;
    const description=leaf?leaf.description||leaf.body.slice(0,190):group.id==='tools'?data.toolCount+' 项名称、用途与参数说明，作为独立字段随本次请求记录。':group.id==='skill-catalog'?'本次可见的 Skill 名称与用途描述；正文在需要时另外读取。':group.id==='system-prompt'?'系统提示中的原文片段，按实际文本拆分，保留整段消息。':group.body.replace(/\s+/g,' ').slice(0,190);
    const liftAction=assembly.models[group.id].snapped||state.scope?'<button type="button" data-action="lift" data-group="'+group.id+'">拿起模块 ↗</button>':'';
    let content='';
    if(!leaf){
      const members=own(group).filter(l=>!l.auxiliary).sort((a,b)=>b.tokens-a.tokens);
      content='<div class="detail-preview"><div class="detail-section-label"><span>本分区较大的内容</span><span>'+members.length+' ITEMS</span></div><div class="group-members">'+members.slice(0,5).map(l=>'<button type="button" class="group-member" data-action="select-leaf" data-item="'+l.id+'"><span>'+esc(l.name)+'</span><span class="mono">≈ '+compact(l.tokens)+'</span></button>').join('')+'</div><p class="group-members-note">'+(members.length>5?'其余内容可从内容索引选择，也可放大本分区查看。':'完整原文按原始记录保留，可展开阅读。')+'</p><button type="button" class="detail-more" data-action="index-group" data-group="'+group.id+'">查看全部 '+group.items.length+' 项 ↗</button></div>';
    }else{
      const body=state.detailTab==='basis'?basisText(leaf,group):leaf.body;
      content='<div class="detail-preview"><div class="detail-tabs" role="tablist" aria-label="片段详情"><button type="button" role="tab" data-action="detail-tab" data-tab="text" aria-selected="'+(state.detailTab==='text')+'">原文</button><button type="button" role="tab" data-action="detail-tab" data-tab="basis" aria-selected="'+(state.detailTab==='basis')+'">计量依据</button></div><div class="detail-body'+(group.id==='tools'&&state.detailTab==='text'?' code':'')+'" role="tabpanel">'+esc(body.slice(0,6500))+'</div><div class="detail-more"><span>'+leaf.body.length.toLocaleString('zh-CN')+' 字符'+(body.length>6500?' · 此处节选':'')+'</span><button type="button" data-action="read">展开原文 ↗</button></div></div>';
    }
    $('inspector').innerHTML='<div class="detail-summary"><div class="detail-location"><span>'+esc(group.name)+(leaf?' / '+(leaf.auxiliary?'结构':'片段'):' / 分区')+'</span><button type="button" data-action="read">'+(leaf?'完整内容':'整段原文')+' ↗</button></div><div class="detail-heading"><h2>'+esc(title)+'</h2>'+(leaf?.auxiliary?'<span class="aux-note">封装</span>':'')+'</div><p class="detail-description">'+esc(description)+'</p><div class="detail-metrics"><strong>≈ '+compact(tokens)+'</strong><span>tokens</span></div><p class="detail-share">占全请求 '+pct(tokens)+(leaf?' · 占本分区 '+(tokens/group.tokens*100).toFixed(1)+'%':' · '+group.items.length+' 项可查看内容')+'</p><div class="detail-actions">'+(state.scope===group.id?'<button type="button" data-action="all">返回全部构成 ↶</button>':'<button type="button" data-action="zoom" data-group="'+group.id+'">放大'+esc(group.name)+' ↗</button>')+liftAction+(leaf?'<button type="button" data-action="copy">复制内容</button>':'')+'</div></div>'+record(group,leaf)+content;
  }
  function selectLeaf(id,{locate=false}={}){
    const leaf=leafById.get(id);if(!leaf)return;
    if(!includesGroup(leaf.groupId))state.scope=leaf.groupId;
    if(locate){const r=geometry.get(id);if(!r||r.w<65||r.h<32)state.scope=leaf.groupId;}
    state.selected=id;state.group=null;state.detailTab='text';
    if(locate||!geometry.has(id))renderMap();else selectedMarkup();
    renderInspector();save();$('search-results').hidden=true;hideTooltip();
  }
  function selectGroup(id){
    const group=groupById.get(id);if(!group)return;
    if(!includesGroup(id)){state.scope=null;renderMap();}
    state.group=id;state.selected=null;state.detailTab='text';selectedMarkup();renderInspector();save();
  }
  function setScope(id){
    if(id&&id!=='messages'&&!groupById.has(id))return;
    state.scope=id||null;
    if(!includesGroup(selectedGroup()?.id)){state.group=id==='messages'?'system-prompt':id;state.selected=null;}
    renderMap();renderInspector();save();hideTooltip();
  }
  function applyQuery(){
    const found=data.leaves.filter(l=>matches(l)),ids=new Set(found.map(l=>l.id));
    $('map').querySelectorAll('[data-item]').forEach(el=>{el.classList.toggle('search-miss',!!state.query&&!ids.has(el.dataset.item));el.classList.toggle('search-hit',!!state.query&&ids.has(el.dataset.item));});
    const shown=visibleLeaves().filter(l=>ids.has(l.id));
    $('query-status').textContent=state.query?'匹配 '+found.length+' 项':'';
    $('map-empty').hidden=!state.query||shown.length>0;
    $('map-empty').textContent=state.scope?'本分区没有匹配内容':'没有匹配内容';
  }
  function searchResults(){
    const query=state.query.trim();if(!query){$('search-results').hidden=true;return;}
    const matchesAll=data.leaves.filter(l=>matches(l)).sort((a,b)=>Number(normalized(b.name).includes(normalized(query)))-Number(normalized(a.name).includes(normalized(query)))||b.tokens-a.tokens);
    $('search-results').innerHTML=matchesAll.slice(0,7).map(l=>'<button type="button" data-action="locate" data-item="'+l.id+'"><span><strong>'+esc(l.name)+'</strong><small>'+esc(groupById.get(l.groupId).name)+' · '+esc(l.path)+'</small></span><span class="mono">≈ '+compact(l.tokens)+'</span></button>').join('')+(matchesAll.length>7?'<button type="button" data-action="index-search">在内容索引查看全部 '+matchesAll.length+' 项 ↗</button>':!matchesAll.length?'<p>没有匹配项目。试试工具名、文件名或原文关键词。</p>':'');
    $('search-results').hidden=false;
  }
  function hideTooltip(){$('tooltip').hidden=true;}
  function showTooltip(element,event){
    if(!matchMedia('(pointer:fine)').matches)return;
    const leaf=leafById.get(element.dataset.item),group=groupById.get(leaf.groupId);
    $('tooltip').innerHTML='<strong>'+esc(leaf.name)+'</strong><span>'+esc(group.name)+' · ≈ '+amount(leaf.tokens)+' tokens · '+pct(leaf.tokens)+'</span>';
    $('tooltip').hidden=false;
    const box=element.getBoundingClientRect(),x=event?.clientX??box.left+box.width/2,y=event?.clientY??box.bottom;
    const tw=$('tooltip').offsetWidth,th=$('tooltip').offsetHeight;
    $('tooltip').style.left=Math.max(8,Math.min(innerWidth-tw-8,x+13))+'px';
    $('tooltip').style.top=Math.max(8,Math.min(innerHeight-th-8,y+14))+'px';
  }
  function openReader(){
    const leaf=selectedLeaf(),group=selectedGroup();if(!group)return;
    $('reader-kind').textContent=group.id==='tools'?'TOOL DECLARATION':'RECORDED TEXT';
    $('reader-title').textContent=leaf?.name||group.name;
    $('reader-meta').textContent='seq '+group.seq+' · '+(leaf?.path||group.field)+' · '+(leaf?.body||group.body).length.toLocaleString('zh-CN')+' 字符';
    $('reader-body').textContent=leaf?.body||group.body;
    hideTooltip();$('reader').showModal();
  }
  function renderIndex(){
    const query=$('index-search').value.trim();
    const groups=visibleGroups(state.indexGroup);
    const rows=groups.flatMap(group=>{
      const members=own(group).filter(l=>matches(l,query));if(!members.length)return [];
      return ['<h3 class="index-group">'+esc(group.name)+' · seq '+group.seq+' · '+members.length+' 项</h3>'+members.map(l=>'<button type="button" class="index-row" data-action="index-pick" data-item="'+l.id+'"><span><strong>'+esc(l.name)+'</strong><small>'+esc(l.path)+(l.auxiliary?' · 结构开销':'')+'</small></span><span class="mono">≈ '+compact(l.tokens)+'</span></button>').join('')];
    });
    $('index-list').innerHTML=rows.join('')||'<p class="index-empty">没有匹配内容。</p>';
  }
  function openIndex(group=null,query=''){
    state.indexGroup=group;
    document.querySelector('#content-index h2').textContent=group?(group==='messages'?'消息历史':groupById.get(group).name)+'的全部内容':'请求中的全部片段';
    $('index-search').value=query;renderIndex();$('search-results').hidden=true;hideTooltip();$('content-index').showModal();$('index-search').focus();
  }
  async function copySelected(button){
    const text=selectedLeaf()?.body||selectedGroup()?.body||'';let copied=false;
    try{await navigator.clipboard.writeText(text);copied=true;}catch{
      const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();
      try{copied=document.execCommand('copy');}catch{}input.remove();button.focus();
    }
    if(copied){button.textContent='已复制';setTimeout(()=>{if(button.isConnected)button.textContent='复制内容';},1700);}else openReader();
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button)return;
    const action=button.dataset.action;
    if(action==='piece-select'){if(!assembly.ignoreClick)selectGroup(button.dataset.group);return;}
    if(action==='snap-piece'){assembly.snap(button.dataset.group);return;}
    if(action==='scatter'){assembly.scatter();return;}
    if(action==='gather'){assembly.gather();return;}
    if(action==='lift'){if(state.scope)setScope(null);assembly.lift(button.dataset.group);return;}
    if(action==='select-group')selectGroup(button.dataset.group);
    if(action==='select-leaf')selectLeaf(button.dataset.item);
    if(action==='locate')selectLeaf(button.dataset.item,{locate:true});
    if(action==='zoom')setScope(button.dataset.group);
    if(action==='field')setScope(button.dataset.group);
    if(action==='all')setScope(null);
    if(action==='detail-tab'){state.detailTab=button.dataset.tab;renderInspector();$('inspector').querySelector('[data-tab="'+state.detailTab+'"]').focus({preventScroll:true});}
    if(action==='read')openReader();
    if(action==='copy')copySelected(button);
    if(action==='index-group')openIndex(button.dataset.group);
    if(action==='index-search')openIndex(null,state.query);
    if(action==='index-pick'){
      $('content-index').close();state.query='';$('search').value='';selectLeaf(button.dataset.item,{locate:true});
      const target=[...$('map').querySelectorAll('[data-item]')].find(el=>el.dataset.item===state.selected);target?.focus({preventScroll:true});
    }
  });
  $('map').addEventListener('click',event=>{const tile=event.target.closest('[data-item]');if(tile)selectLeaf(tile.dataset.item);});
  $('map').addEventListener('dblclick',event=>{const tile=event.target.closest('[data-item]');if(tile)setScope(leafById.get(tile.dataset.item).groupId);});
  $('map').addEventListener('pointerover',event=>{const tile=event.target.closest('[data-item]');if(tile)showTooltip(tile,event);});
  $('map').addEventListener('pointermove',event=>{const tile=event.target.closest('[data-item]');if(tile)showTooltip(tile,event);});
  $('map').addEventListener('pointerleave',hideTooltip);
  $('map').addEventListener('focusin',event=>{const tile=event.target.closest('[data-item]');if(tile)showTooltip(tile);});
  $('map').addEventListener('focusout',hideTooltip);
  $('map').addEventListener('keydown',event=>{
    const current=event.target.closest('[data-item]');if(!current)return;
    const r=geometry.get(current.dataset.item);if(!r)return;
    const keys={ArrowRight:[1,0],ArrowLeft:[-1,0],ArrowDown:[0,1],ArrowUp:[0,-1]};
    let target;
    if(event.key==='Home')target=geometry.keys().next().value;
    else if(event.key==='End')target=[...geometry.keys()].at(-1);
    else if(keys[event.key]){
      const [dx,dy]=keys[event.key],cx=r.x+r.w/2,cy=r.y+r.h/2;
      target=[...geometry.entries()].filter(([id,c])=>id!==current.dataset.item&&(!state.query||matches(leafById.get(id)))).map(([id,c])=>{
        const x=c.x+c.w/2-cx,y=c.y+c.h/2-cy,forward=x*dx+y*dy,cross=Math.abs(x*dy-y*dx);
        return {id,forward,score:forward+cross*1.8};
      }).filter(c=>c.forward>1).sort((a,b)=>a.score-b.score)[0]?.id;
    }else return;
    event.preventDefault();if(!target)return;
    selectLeaf(target);const element=[...$('map').querySelectorAll('[data-item]')].find(el=>el.dataset.item===target);element?.focus({preventScroll:true});
  });
  $('search').addEventListener('input',event=>{state.query=event.target.value.trim();applyQuery();searchResults();});
  $('search').addEventListener('focus',()=>{if(state.query)searchResults();});
  $('search').addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'){const first=$('search-results').querySelector('button');if(first){event.preventDefault();first.focus();}}
    if(event.key==='Escape'){state.query='';$('search').value='';$('search-results').hidden=true;applyQuery();}
  });
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.map-query'))$('search-results').hidden=true;});
  document.addEventListener('keydown',event=>{
    if(document.querySelector('dialog[open]'))return;
    const editing=/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if(event.key==='/'&&!editing){event.preventDefault();$('search').focus();}
    if(event.key==='Escape'&&!editing){hideTooltip();$('search-results').hidden=true;if(state.query){state.query='';$('search').value='';applyQuery();}else if(state.scope)setScope(null);}
  });
  $('zoom-out').addEventListener('click',()=>setScope(null));
  $('index-open').addEventListener('click',()=>openIndex(state.scope));
  $('index-search').addEventListener('input',renderIndex);
  $('reader-close').addEventListener('click',()=>$('reader').close());
  $('index-close').addEventListener('click',()=>$('content-index').close());
  $('source-close').addEventListener('click',()=>$('source-dialog').close());
  $('evidence').addEventListener('click',()=>{
    $('source-body').innerHTML='<h3>同一个请求切点</h3><p>'+esc(data.source.date)+' 的冻结 DSH 会话，截于 seq '+data.source.cut+'；首条模型消息为 seq '+data.source.firstModelSeq+'。图中有 '+data.messageCount+' 段逻辑消息与 '+data.toolCount+' 项工具声明，不代表当前本机配置。</p><h3>顺序与体积，各自有依据</h3><p>上方按原始事件 seq 排列；消息位置沿用官方 SurfaceManager 的逻辑历史。工具来自 request/header.tools，是独立字段。树图位置用于面积比较，坐标不表示时间或供应商字节偏移。</p><p>组内拆分遵循原文段落、记录中的环境分节、Skill 目录条目或工具声明。系统提示内部各节的装配时刻没有记录，因此不赋予不同的加载时间。工具的数组次序也不是插件注册时序。</p><h3>估算与封装</h3><p>分区总量由本机 DSH 估算器计算。拆出的文本与紧凑 JSON 使用 4 字符 / token 的密度；未拆出的引导、分隔、角色开销与取整保留为独立项，所有面积加总为 '+amount(data.total)+' tokens。它不是供应商分词、结算或模型使用证明。</p><p>纹理只区分内容形态，不表示风险、加载率或缓存命中。搜索保留原有面积；放大分区后，占全请求的比例仍以 '+amount(data.total)+' 为分母。</p><p><code>'+esc(data.source.session)+'</code><br><code>'+esc(data.source.estimator)+'</code></p>';
    hideTooltip();$('source-dialog').showModal();
  });
  $('total').innerHTML='≈ '+compact(data.total)+'<small>tokens</small>';
  $('request-count').textContent=data.messageCount+' 段消息 / '+data.toolCount+' 项工具声明';
  $('snapshot-date').textContent=data.source.date+' · 冻结记录';
  $('source-cut').textContent=data.source.cut;
  if(!includesGroup(selectedGroup()?.id))state.scope=null;
  renderSequence();renderMap();renderInspector();
  new ResizeObserver(()=>renderMap()).observe($('map'));
});
