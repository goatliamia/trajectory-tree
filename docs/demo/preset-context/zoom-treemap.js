// Fixed geometry, a continuous camera, and source text only for visible detail.
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function toggleZoomFocus(path,id,before,focused){
  const previous=path.at(-1);
  if(previous)return {path:[],camera:{...previous.camera}};
  return {path:[{id,camera:{...before}}],camera:{...focused}};
}
export function zoomMapOverlay(){return '<canvas class="zoom-map-mini" width="112" height="68" hidden aria-label="当前视野位置"></canvas>';}
export function zoomMapIndex(items,itemAttributes=()=>'',itemClass=''){
  return '<div class="zoom-map-index" hidden><input type="search" aria-label="查找图中内容" placeholder="查找名称、类型或来源"><div>'+items.map(item=>'<button type="button" class="'+itemClass+'" data-zoom-item="'+escape(item.id??item.key)+'" '+itemAttributes(item)+'><strong>'+escape(item.name)+'</strong><small>'+escape(item.type??item.secondary??'')+' · '+Math.round(item.weight??item.tokens).toLocaleString('zh-CN')+' tokens</small></button>').join('')+'</div></div>';
}
export function createZoomTreemap(host,{model,selected,onSelect=()=>{},onOpen=()=>{},onHover=()=>{},onView=()=>{},getBody=item=>item.body??'',viewState,onFrame}){
  const canvas=host.querySelector('.zoom-map-canvas'),ctx=canvas.getContext('2d');
  const minimap=host.querySelector('.zoom-map-mini'),mini=minimap.getContext('2d');
  const scene=model.layout?model.layout(host.clientWidth,host.clientHeight):model;
  const {width:W,height:H,groups:roots}=scene,MAX=40;
  const rects=roots.flatMap(g=>(g.cells??[]).map(r=>({...r,id:r.id??r.key,groupId:g.id,x:g.x+r.x,y:g.y+r.y,weight:r.weight??r.tokens})));
  const byId=new Map(rects.map(r=>[r.id,r])),bodyCache=new Map();
  const signature=JSON.stringify([W,H,rects.map(r=>[r.id,r.weight,r.x,r.y,r.w,r.h])]);
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)'),events=new AbortController();
  let palette={},paletteDirty=true;const colors=new Map();
  const probe=document.createElement('span');probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none';host.append(probe);
  function readColor(value){probe.style.color=value;return getComputedStyle(probe).color;}
  function readTheme(){
    palette={surface:readColor('var(--tt-surface)'),line:readColor('var(--tt-line)'),ink:readColor('var(--tt-ink)'),muted:readColor('var(--tt-muted)'),action:readColor('var(--tt-action)')};
    colors.clear();const references=new Set(rects.flatMap(r=>[r.fill??'var(--tt-soft)',r.stroke??'var(--tt-action)',r.ink??'var(--tt-ink)']));
    for(const value of references)colors.set(value,readColor(value));paletteDirty=false;
  }
  let width=0,height=0,fit=1,dpr=1,selection=selected,query='',matches=new Set(),hover=null;
  let camera={x:W/2,y:H/2,k:1},target={...camera},focusPath=[],raf=0,destroyed=false,drag=null,viewKey='',openTimer=0,lastClick=null,doubleClick=null;
  function cancelOpen(){clearTimeout(openTimer);openTimer=0;host.classList.remove('opening');}
  if(viewState?.signature===signature){camera={...viewState.camera};target={...(viewState.target??camera)};focusPath=(viewState.focusPath??[]).map(entry=>({...entry,camera:{...entry.camera}}));selection=byId.has(viewState.selection)?viewState.selection:selection;}
  const onInteract=()=>{
    cancelOpen();
    const panel=host.querySelector('.zoom-map-index');if(panel)panel.hidden=true;
    if(query){query='';matches.clear();const field=panel?.querySelector('input');if(field)field.value='';panel?.querySelectorAll('[data-zoom-item]').forEach(button=>button.hidden=false);requestDraw();}
  };
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const textWidth=(s,font)=>[...s].reduce((sum,ch)=>sum+(ch.codePointAt(0)>255?1:.61)*font,0);
  const screen=(r,c=camera)=>({x:(r.x-c.x)*fit*c.k+width/2,y:(r.y-c.y)*fit*c.k+height/2,w:r.w*fit*c.k,h:r.h*fit*c.k});
  const point=(x,y,c=target)=>({x:c.x+(x-width/2)/(fit*c.k),y:c.y+(y-height/2)/(fit*c.k)});
  function constrain(){
    target.k=clamp(target.k,1,MAX);
    if(target.k<=1.001){target.x=W/2;target.y=H/2;return;}
    const halfWidth=Math.min(W/2,width/(2*fit*target.k)),halfHeight=Math.min(H/2,height/(2*fit*target.k));
    target.x=clamp(target.x,halfWidth,W-halfWidth);target.y=clamp(target.y,halfHeight,H-halfHeight);
  }
  function requestDraw(){if(!raf&&!destroyed)raf=requestAnimationFrame(frame);}
  function frame(){
    raf=0;if(destroyed)return;
    const moving=Math.abs(camera.x-target.x)+Math.abs(camera.y-target.y)+Math.abs(camera.k-target.k)*100>.02;
    if(reducedMotion.matches||!moving)camera={...target};
    else{
      // Interpolate screen transforms together so the point under the pointer stays put.
      const k=camera.k+(target.k-camera.k)*.24;
      const tx=width/2-camera.x*fit*camera.k,ty=height/2-camera.y*fit*camera.k;
      const nextX=width/2-target.x*fit*target.k,nextY=height/2-target.y*fit*target.k;
      camera={k,x:(width/2-(tx+(nextX-tx)*.24))/(fit*k),y:(height/2-(ty+(nextY-ty)*.24))/(fit*k)};
    }
    draw();if(moving)requestDraw();
  }
  function wrapBody(text,font,maxWidth){
    const lines=[];
    for(const original of text.replace(/\t/g,'  ').split('\n')){
      let row='',length=0;
      for(const ch of original){const advance=(ch.codePointAt(0)>255?1:.61)*font;if(length+advance>maxWidth&&row){lines.push(row);row='';length=0;}row+=ch;length+=advance;}
      lines.push(row);
    }
    return lines;
  }
  function bodyFor(r){
    if(bodyCache.has(r.id)){const value=bodyCache.get(r.id);bodyCache.delete(r.id);bodyCache.set(r.id,value);return value;}
    const original=String(getBody(r)??''),text=original.length>100000?original.slice(0,100000)+'\n…完整内容请打开详情。':original;
    const pad=Math.min(5,r.w*.08,r.h*.08),top=Math.min(6,r.h*.12),w=r.w-2*pad,h=r.h-top-pad;
    let lo=.12,hi=4.5;
    for(let i=0;i<6;i++){const f=(lo+hi)/2,lines=wrapBody(text,f,w);if(lines.length*f*1.5<=h)lo=f;else hi=f;}
    const body={font:lo,lines:wrapBody(text,lo,w),pad,top,lineHeight:lo*1.5};bodyCache.set(r.id,body);
    while(bodyCache.size>12)bodyCache.delete(bodyCache.keys().next().value);return body;
  }
  function ellipsis(text,maxWidth,fontSize){
    if(textWidth(text,fontSize)<=maxWidth)return text;
    let out='';for(const ch of text){if(textWidth(out+ch+'…',fontSize)>maxWidth)break;out+=ch;}return out+'…';
  }
  function catalogHeader(r,b,fill,ink,dim){
    if(b.w<100||b.h<40)return;
    ctx.globalAlpha=dim?.2:1;ctx.fillStyle=fill;ctx.fillRect(b.x+2,b.y+2,b.w-20,Math.min(55,b.h-4));
    const left=b.x+44;ctx.strokeStyle=palette.muted;ctx.lineWidth=1;
    ctx.strokeRect(b.x+15.5,b.y+16.5,15,21);
    for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(b.x+19,b.y+22+i*5);ctx.lineTo(b.x+27,b.y+22+i*5);ctx.stroke();}
    ctx.fillStyle=ink;ctx.font='500 13px Geist,sans-serif';ctx.textBaseline='top';ctx.fillText(ellipsis(r.name,b.w-80,13),left,b.y+13);
    ctx.fillStyle=palette.muted;ctx.font='10px Geist,sans-serif';ctx.fillText(ellipsis(r.secondary,b.w-80,10),left,b.y+35);
    ctx.font='12px Geist,sans-serif';ctx.textAlign='right';ctx.fillText('↗',b.x+b.w-16,b.y+15);ctx.textAlign='left';
  }
  function draw(){
    const start=performance.now();if(paletteDirty)readTheme();
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle=palette.surface;ctx.fillRect(0,0,width,height);
    const scale=fit*camera.k;
    for(const g of roots){const b=screen(g);if(b.x>width||b.y>height||b.x+b.w<0||b.y+b.h<0)continue;
      if(g.frame!==false){ctx.strokeStyle=palette.line;ctx.lineWidth=1;ctx.strokeRect(b.x+.5,b.y+.5,b.w-1,b.h-1);}
      if(g.caption){ctx.fillStyle=palette.muted;ctx.font='10px Geist,sans-serif';ctx.textBaseline='top';ctx.fillText(g.caption,b.x,b.y-22);}
    }
    for(const r of rects){
      const b=screen(r);if(b.x>width||b.y>height||b.x+b.w<0||b.y+b.h<0||b.w<.6||b.h<.6)continue;
      const dim=r.dim||!!query&&!matches.has(r.id),fill=colors.get(r.fill??'var(--tt-soft)'),ink=colors.get(r.ink??'var(--tt-ink)');ctx.globalAlpha=dim?.2:1;
      ctx.fillStyle=fill;ctx.strokeStyle=r.id===selection||r.id===hover?colors.get(r.stroke??'var(--tt-action)'):r.catalog?palette.line:palette.surface;ctx.lineWidth=r.id===selection?1.5:.8;
      if(r.catalog){
        ctx.beginPath();ctx.moveTo(b.x+.5,b.y+.5);ctx.lineTo(b.x+b.w-10,b.y+.5);ctx.lineTo(b.x+b.w-.5,b.y+10);ctx.lineTo(b.x+b.w-.5,b.y+b.h-.5);ctx.lineTo(b.x+.5,b.y+b.h-.5);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.beginPath();ctx.moveTo(b.x+b.w-10,b.y+.5);ctx.lineTo(b.x+b.w-10,b.y+10);ctx.lineTo(b.x+b.w-.5,b.y+10);ctx.stroke();
      }else{ctx.fillRect(b.x,b.y,b.w,b.h);ctx.strokeRect(b.x+.5,b.y+.5,Math.max(0,b.w-1),Math.max(0,b.h-1));}
      ctx.save();ctx.beginPath();ctx.rect(b.x+2,b.y+2,Math.max(0,b.w-4),Math.max(0,b.h-4));ctx.clip();
      const body=camera.k>=1.65&&b.w>110&&b.h>85?bodyFor(r):null,fontPx=body?body.font*scale:0;
      if(body&&fontPx>=2.2){
        ctx.save();ctx.beginPath();ctx.rect(b.x+3,b.y+Math.min(28,b.h*.3),b.w-6,Math.max(0,b.h-Math.min(28,b.h*.3)-3));ctx.clip();
        ctx.translate(b.x,b.y);ctx.scale(scale,scale);ctx.font=body.font+'px GeistMono,monospace';ctx.textBaseline='top';
        ctx.globalAlpha=(dim?.2:1)*clamp((fontPx-1.5)/5,.15,1);
        const start=Math.max(0,Math.floor((-b.y/scale-body.top)/body.lineHeight));
        const end=Math.min(body.lines.length,Math.ceil(((height-b.y)/scale-body.top)/body.lineHeight)+1);
        ctx.fillStyle=ink;for(let i=start;i<end;i++)ctx.fillText(body.lines[i],body.pad,body.top+i*body.lineHeight);
        ctx.restore();
      }
      if(r.catalog)catalogHeader(r,b,fill,ink,dim);
      else if(b.w>45&&b.h>25){
        const font=b.w>95?12:10,left=b.x+Math.min(11,b.w*.1),top=b.y+Math.min(12,b.h*.1);
        // Titles keep a readable screen size; the source underneath follows world scale.
        ctx.fillStyle=fill;ctx.fillRect(b.x+2,b.y+2,b.w-4,Math.min(24,b.h*.3));
        ctx.globalAlpha=dim?.2:1;ctx.font='500 '+font+'px Geist,sans-serif';ctx.textBaseline='top';ctx.fillStyle=ink;
        ctx.fillText(ellipsis(r.name,b.w-(left-b.x)*2,font),left,top);
        if(fontPx<3&&b.w>85&&b.h>65){ctx.font='10px GeistMono,monospace';ctx.globalAlpha*=.75;ctx.fillText(ellipsis(r.secondary??(Math.round(r.weight).toLocaleString('zh-CN')+' tokens'),b.w-(left-b.x)*2,10),left,top+22);}
      }
      ctx.restore();ctx.globalAlpha=1;
    }
    drawMini();emitView();onFrame?.(performance.now()-start);
  }
  function drawMini(){
    const mw=112,mh=68;mini.clearRect(0,0,mw,mh);mini.fillStyle=palette.surface;mini.fillRect(0,0,mw,mh);
    for(const g of roots){mini.fillStyle=colors.get(g.cells?.[0]?.fill??'var(--tt-soft)')||palette.line;mini.fillRect(g.x/W*mw,g.y/H*mh,g.w/W*mw,g.h/H*mh);}
    const s=fit*camera.k;mini.strokeStyle=palette.action;mini.lineWidth=1;mini.strokeRect((camera.x-width/(2*s))/W*mw,(camera.y-height/(2*s))/H*mh,width/s/W*mw,height/s/H*mh);
    minimap.hidden=camera.k<1.1;
  }
  function emitView(){
    const center=rects.find(r=>camera.x>=r.x&&camera.x<=r.x+r.w&&camera.y>=r.y&&camera.y<=r.y+r.h);
    const parent=roots.find(g=>camera.x>=g.x&&camera.x<=g.x+g.w&&camera.y>=g.y&&camera.y<=g.y+g.h);
    const info={zoom:camera.k,groupId:camera.k>1.4?center?.groupId||parent?.id:null,leafId:null};
    if(center){const r=screen(center);if(camera.k>2&&r.w>width*.46&&r.h>height*.45)info.leafId=center.id;}
    const next=Math.round(camera.k*100)+'|'+info.groupId+'|'+info.leafId;
    if(next!==viewKey){viewKey=next;host.dataset.zoom=String(Math.round(camera.k*100));onView(info);}
  }
  function resize(){
    const b=host.getBoundingClientRect();if(!b.width||!b.height)return;width=b.width;height=b.height;dpr=Math.min(devicePixelRatio||1,2);fit=Math.min((width-4)/W,(height-4)/H);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.width=width+'px';canvas.style.height=height+'px';requestDraw();
  }
  function zoomAt(factor,x=width/2,y=height/2){
    const anchor=point(x,y,camera);target.k=clamp(target.k*factor,1,MAX);target.x=anchor.x-(x-width/2)/(fit*target.k);target.y=anchor.y-(y-height/2)/(fit*target.k);constrain();requestDraw();
  }
  function focusRect(r){
    target.k=clamp(Math.min((width-52)/r.w,(height-52)/r.h)/fit,1,MAX);target.x=r.x+r.w/2;target.y=r.y+r.h/2;constrain();requestDraw();
  }
  function focusLeaf(r,toggle=false){
    const focused={x:r.x+r.w/2,y:r.y+r.h/2,k:clamp(Math.min((width-52)/r.w,(height-52)/r.h)/fit,1,MAX)};
    if(focused.k<=target.k*1.35)focused.k=clamp(target.k*1.8,1,MAX);
    if(toggle){const next=toggleZoomFocus(focusPath,r.id,target,focused);focusPath=next.path;target=next.camera;}
    else{focusPath=[{id:r.id,camera:{...(focusPath[0]?.camera??target)}}];target=focused;}
    constrain();requestDraw();
  }
  function hit(event){const b=canvas.getBoundingClientRect(),p=point(event.clientX-b.left,event.clientY-b.top,camera);return rects.find(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h);}
  const listen=(node,type,fn,options={})=>node.addEventListener(type,fn,{...options,signal:events.signal});
  listen(canvas,'wheel',event=>{event.preventDefault();onInteract();const b=canvas.getBoundingClientRect(),delta=event.deltaY*(event.deltaMode===1?16:1);zoomAt(Math.exp(-clamp(delta,-500,500)*.002),event.clientX-b.left,event.clientY-b.top);},{passive:false});
  listen(canvas,'pointerdown',event=>{
    if(event.button!==0)return;onInteract();target={...camera};canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);
    drag={x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false};host.classList.add('holding');
  });
  listen(canvas,'pointermove',event=>{
    if(drag){const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>4)drag.moved=true;
      if(drag.moved){lastClick=null;doubleClick=null;target.x-=dx/(fit*target.k);target.y-=dy/(fit*target.k);constrain();camera={...target};requestDraw();}drag.x=event.clientX;drag.y=event.clientY;
    }else{const item=hit(event),next=item?.id||null;if(next!==hover){hover=next;host.classList.toggle('over-item',!!item);canvas.title=item?item.name+' · '+(item.secondary??Math.round(item.weight)+' tokens'):'';onHover(item??null);requestDraw();}}
  });
  listen(canvas,'pointerup',event=>{
    if(!drag)return;const click=!drag.moved;drag=null;host.classList.remove('holding');
    if(click){const r=hit(event);doubleClick=r?.id===lastClick?r.id:null;lastClick=r?.id??null;if(r){selection=r.id;onSelect(r);requestDraw();host.classList.add('opening');openTimer=setTimeout(()=>{openTimer=0;host.classList.remove('opening');if(!destroyed)onOpen(r);},280);}}
  });
  const cancelDrag=()=>{cancelOpen();lastClick=null;doubleClick=null;drag=null;host.classList.remove('holding');};
  listen(canvas,'pointercancel',cancelDrag);listen(canvas,'lostpointercapture',()=>{if(drag)cancelDrag();});
  listen(canvas,'pointerleave',()=>{hover=null;host.classList.remove('over-item');onHover(null);requestDraw();});
  listen(canvas,'dblclick',event=>{
    event.preventDefault();
    if(focusPath.length){onInteract();const next=toggleZoomFocus(focusPath,null,target,target);focusPath=next.path;target=next.camera;constrain();requestDraw();return;}
    const r=hit(event);if(!r||r.id!==doubleClick)return;onInteract();selection=r.id;onSelect(r);
    focusLeaf(r,true);
  });
  listen(canvas,'keydown',event=>{
    if(event.key==='/'){event.preventDefault();onInteract();if(index){index.hidden=false;input.focus();}return;}
    const step=event.shiftKey?110:42;
    if(['+','=','-','_','Escape','0','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();onInteract();}
    else return;
    if(['+','='].includes(event.key))zoomAt(1.45);else if(['-','_'].includes(event.key))zoomAt(1/1.45);
    else if(['Escape','0'].includes(event.key)){focusPath=[];target={x:W/2,y:H/2,k:1};requestDraw();}
    else if(event.key==='Enter'){const r=byId.get(selection);if(r)onOpen(r);}
    else{target.x+=({'ArrowLeft':-step,'ArrowRight':step}[event.key]||0)/(fit*target.k);target.y+=({'ArrowUp':-step,'ArrowDown':step}[event.key]||0)/(fit*target.k);constrain();requestDraw();}
  });
  listen(minimap,'pointerdown',event=>{event.preventDefault();onInteract();const b=minimap.getBoundingClientRect();target.x=(event.clientX-b.left)/b.width*W;target.y=(event.clientY-b.top)/b.height*H;constrain();requestDraw();});
  const index=host.querySelector('.zoom-map-index'),input=index?.querySelector('input');
  listen(host,'click',event=>{
    const button=event.target.closest('[data-zoom-item]');if(!button)return;
    const item=byId.get(button.dataset.zoomItem);if(!item)return;
    event.preventDefault();event.stopPropagation();onInteract();selection=item.id;onSelect(item);focusLeaf(item);canvas.focus({preventScroll:true});
  });
  if(input){
    listen(input,'input',()=>{
      query=input.value.trim().toLowerCase();matches=new Set(rects.filter(r=>(r.searchText??r.name+' '+(r.type??'')+' '+(r.context??'')).toLowerCase().includes(query)).map(r=>r.id));
      index.querySelectorAll('[data-zoom-item]').forEach(button=>button.hidden=!!query&&!matches.has(button.dataset.zoomItem));requestDraw();
    });
    listen(index,'keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onInteract();canvas.focus({preventScroll:true});}
      else if(event.target===input&&event.key==='Enter'){event.preventDefault();index.querySelector('[data-zoom-item]:not([hidden])')?.click();}
      else if(event.target===input&&event.key==='ArrowDown'){event.preventDefault();index.querySelector('[data-zoom-item]:not([hidden])')?.focus();}
    });
  }
  const observer=new ResizeObserver(resize);observer.observe(host);
  const themeObserver=new MutationObserver(()=>{paletteDirty=true;requestDraw();});
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-dsh-theme','style','class']});
  themeObserver.observe(document.body,{attributes:true,attributeFilter:['data-layout','style','class']});
  listen(reducedMotion,'change',requestDraw);document.fonts.ready.then(requestDraw);resize();
  return {
    select(id){selection=id;canvas.setAttribute('aria-label','矩形分布图，已选 '+(byId.get(id)?.name||'内容')+'。单击查看详情，双击进入或返回，滚轮缩放，拖动平移；回车查看详情，Escape 查看全图，斜杠查找。');requestDraw();},
    focusLeaf(id){onInteract();const r=byId.get(id);if(r)focusLeaf(r);},
    focusGroup(id){onInteract();focusPath=[];const r=roots.find(g=>g.id===id);if(r)focusRect(r);},
    fitAll(){onInteract();focusPath=[];target={x:W/2,y:H/2,k:1};requestDraw();},
    zoom(factor){onInteract();zoomAt(factor);},
    search(value,ids){query=value;matches=new Set(ids);requestDraw();},
    getState(){return {signature,camera:{...camera},target:{...target},focusPath:focusPath.map(entry=>({...entry,camera:{...entry.camera}})),selection};},
    destroy(){destroyed=true;cancelOpen();events.abort();observer.disconnect();themeObserver.disconnect();cancelAnimationFrame(raf);bodyCache.clear();probe.remove();}
  };
}
