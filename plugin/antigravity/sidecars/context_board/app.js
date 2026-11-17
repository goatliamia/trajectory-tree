(()=>{
"use strict";
const ui=(text,...values)=>Array.isArray(text)&&Object.hasOwn(text,"raw")?text.map((part,i)=>part+(i<values.length?values[i]:"")).join(""):String(text??"");
const {CONTEXT_CATEGORIES}=(()=>{
// Generated from the shared trajectory context categories.
const CONTEXT_CATEGORIES=[{"key":"system","label":"系统提示","color":"#7065c6"},{"key":"tools","label":"工具定义","color":"#bf8b32"},{"key":"user","label":"用户输入","color":"#4c946d"},{"key":"inject","label":"运行时注入","color":"#ab6ba4"},{"key":"skill","label":"技能内容","color":"#cf7950"},{"key":"assistant","label":"模型输出（含思考）","color":"#5286bf"},{"key":"tool","label":"工具输出","color":"#39a29b"}];

return {CONTEXT_CATEGORIES};
})();
const {tileLayout}=(()=>{
// Squarified layout shared by the Skill and context composition views.
function tileLayout(items,width,height){
  const usable=items.filter(row=>Number.isFinite(row.weight)&&row.weight>0),total=usable.reduce((sum,row)=>sum+row.weight,0);
  if(!total||width<=0||height<=0)return [];
  const pending=usable.map(row=>({...row,area:row.weight/total*width*height})),out=[];
  let x=0,y=0,w=width,h=height,cursor=0;
  const worst=(sum,min,max,side)=>Math.max(side*side*max/(sum*sum),sum*sum/(side*side*min));
  while(cursor<pending.length){
    const side=Math.min(w,h),start=cursor,first=pending[cursor++].area;
    let sum=first,min=first,max=first,score=worst(first,first,first,side);
    while(cursor<pending.length){
      const area=pending[cursor].area,nextSum=sum+area,nextMin=Math.min(min,area),nextMax=Math.max(max,area),nextScore=worst(nextSum,nextMin,nextMax,side);
      if(!(nextScore<=score))break;
      sum=nextSum;min=nextMin;max=nextMax;score=nextScore;cursor++;
    }
    if(w>=h){const rw=sum/h;let ry=y;for(let i=start;i<cursor;i++){const r=pending[i],rh=r.area/rw;out.push({...r,x,y:ry,w:rw,h:rh});ry+=rh;}x+=rw;w-=rw;}
    else{const rh=sum/w;let rx=x;for(let i=start;i<cursor;i++){const r=pending[i],rw=r.area/rh;out.push({...r,x:rx,y,w:rw,h:rh});rx+=rw;}y+=rh;h-=rh;}
  }
  return out;
}

return {tileLayout};
})();
const {toggleZoomFocus,zoomMapOverlay,zoomMapIndex,createZoomTreemap}=(()=>{
// Fixed geometry, a continuous camera, and source text only for visible detail.
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toggleZoomFocus(path,id,before,focused){
  const previous=path.at(-1);
  if(previous)return {path:[],camera:{...previous.camera}};
  return {path:[{id,camera:{...before}}],camera:{...focused}};
}
function zoomMapOverlay(){return '<canvas class="zoom-map-mini" width="112" height="68" hidden aria-label="当前视野位置"></canvas>';}
function zoomMapIndex(items,itemAttributes=()=>'',itemClass=''){
  return '<div class="zoom-map-index" hidden><input type="search" aria-label="查找图中内容" placeholder="查找名称、类型或来源"><div>'+items.map(item=>'<button type="button" class="'+itemClass+'" data-zoom-item="'+escape(item.id??item.key)+'" '+itemAttributes(item)+'><strong>'+escape(item.name)+'</strong><small>'+escape(item.type??item.secondary??'')+' · '+Math.round(item.weight??item.tokens).toLocaleString('zh-CN')+' tokens</small></button>').join('')+'</div></div>';
}
function createZoomTreemap(host,{model,selected,onSelect=()=>{},onOpen=()=>{},onHover=()=>{},onView=()=>{},getBody=item=>item.body??'',viewState,onFrame}){
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
    palette={surface:readColor('var(--tt-surface)'),line:readColor('var(--tt-line)'),ink:readColor('var(--tt-ink)'),muted:readColor('var(--tt-muted)'),action:readColor('var(--tt-action)'),sans:getComputedStyle(host).getPropertyValue('--tt-font-sans').trim()||'sans-serif',mono:getComputedStyle(host).getPropertyValue('--tt-font-mono').trim()||'monospace'};
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
  // Optional aggregate cells share fixed world bounds with their children.
  // Zoom changes the painted and hit-tested level, never the layout.
  const expanded=(r,c=camera)=>r.w*fit*c.k>=70&&r.h*fit*c.k>=50;
  const visibleLevel=r=>{if(r.aggregate)return !expanded(r);const parent=r.parentId&&byId.get(r.parentId);return !parent||expanded(parent);};
  const matchIds=ids=>{const result=new Set(ids);for(const id of result){const parent=byId.get(id)?.parentId;if(parent)result.add(parent);}return result;};
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
    // A readable map preview is bounded independently of the full source.
    // Keeping the whole document in the fitting loop makes long messages costly
    // even while their text is still too small to read.
    const original=String(getBody(r)??''),text=original.length>8192?original.slice(0,8192)+'\n…完整内容请打开详情。':original;
    const pad=Math.min(5,r.w*.08,r.h*.08),top=Math.min(6,r.h*.12),w=r.w-2*pad,h=r.h-top-pad;
    let lo=.12,hi=4.5;
    for(let i=0;i<6;i++){const f=(lo+hi)/2,lines=wrapBody(text,f,w);if(lines.length*f*1.5<=h)lo=f;else hi=f;}
    const body={font:lo,lines:wrapBody(text,lo,w),pad,top,lineHeight:lo*1.5};bodyCache.set(r.id,body);
    while(bodyCache.size>128)bodyCache.delete(bodyCache.keys().next().value);return body;
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
    ctx.fillStyle=ink;ctx.font='500 13px '+palette.sans;ctx.textBaseline='top';ctx.fillText(ellipsis(r.name,b.w-80,13),left,b.y+13);
    ctx.fillStyle=palette.muted;ctx.font='10px '+palette.sans;ctx.fillText(ellipsis(r.secondary,b.w-80,10),left,b.y+35);
    ctx.font='12px '+palette.sans;ctx.textAlign='right';ctx.fillText('↗',b.x+b.w-16,b.y+15);ctx.textAlign='left';
  }
  function draw(){
    const start=performance.now();if(paletteDirty)readTheme();
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle=palette.surface;ctx.fillRect(0,0,width,height);
    const scale=fit*camera.k;
    for(const g of roots){const b=screen(g);if(b.x>width||b.y>height||b.x+b.w<0||b.y+b.h<0)continue;
      if(g.frame!==false){ctx.strokeStyle=palette.line;ctx.lineWidth=1;ctx.strokeRect(b.x+.5,b.y+.5,b.w-1,b.h-1);}
      if(g.caption&&!g.timeline&&b.w>52){ctx.fillStyle=palette.muted;ctx.font='10px '+palette.sans;ctx.textBaseline='top';ctx.fillText(g.caption,b.x,b.y-22);}
    }
    for(const r of rects){
      if(!visibleLevel(r))continue;
      const b=screen(r);if(b.x>width||b.y>height||b.x+b.w<0||b.y+b.h<0||b.w<.6||b.h<.6)continue;
      const dim=r.dim||!!query&&!matches.has(r.id),fill=colors.get(r.fill??'var(--tt-soft)'),ink=colors.get(r.ink??'var(--tt-ink)');ctx.globalAlpha=dim?.2:1;
      ctx.fillStyle=fill;ctx.strokeStyle=r.id===selection||r.id===hover?colors.get(r.stroke??'var(--tt-action)'):r.catalog?palette.line:palette.surface;ctx.lineWidth=r.id===selection?1.5:.8;
      if(r.catalog){
        ctx.beginPath();ctx.moveTo(b.x+.5,b.y+.5);ctx.lineTo(b.x+b.w-10,b.y+.5);ctx.lineTo(b.x+b.w-.5,b.y+10);ctx.lineTo(b.x+b.w-.5,b.y+b.h-.5);ctx.lineTo(b.x+.5,b.y+b.h-.5);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.beginPath();ctx.moveTo(b.x+b.w-10,b.y+.5);ctx.lineTo(b.x+b.w-10,b.y+10);ctx.lineTo(b.x+b.w-.5,b.y+10);ctx.stroke();
      }else{ctx.fillRect(b.x,b.y,b.w,b.h);ctx.strokeRect(b.x+.5,b.y+.5,Math.max(0,b.w-1),Math.max(0,b.h-1));}
      // Tiny leaves only have a fill and outline. Avoid a clip stack for every
      // unreadable cell in a dense overview.
      if(!r.catalog&&(b.w<=45||b.h<=25)){ctx.globalAlpha=1;continue;}
      ctx.save();ctx.beginPath();ctx.rect(b.x+2,b.y+2,Math.max(0,b.w-4),Math.max(0,b.h-4));ctx.clip();
      const body=camera.k>=1.65&&b.w>110&&b.h>85?bodyFor(r):null,fontPx=body?body.font*scale:0;
      if(body&&fontPx>=2.2){
        ctx.save();ctx.beginPath();ctx.rect(b.x+3,b.y+Math.min(28,b.h*.3),b.w-6,Math.max(0,b.h-Math.min(28,b.h*.3)-3));ctx.clip();
        ctx.translate(b.x,b.y);ctx.scale(scale,scale);ctx.font=body.font+'px '+palette.mono;ctx.textBaseline='top';
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
        ctx.globalAlpha=dim?.2:1;ctx.font='500 '+font+'px '+palette.sans;ctx.textBaseline='top';ctx.fillStyle=ink;
        ctx.fillText(ellipsis(r.name,b.w-(left-b.x)*2,font),left,top);
        if(fontPx<3&&b.w>85&&b.h>65){ctx.font='10px '+palette.mono;ctx.globalAlpha*=.75;ctx.fillText(ellipsis(r.secondary??(Math.round(r.weight).toLocaleString('zh-CN')+' tokens'),b.w-(left-b.x)*2,10),left,top+22);}
      }
      ctx.restore();ctx.globalAlpha=1;
    }
    drawTimeline();drawGroupHeaders();drawMini();emitView();onFrame?.(performance.now()-start);
  }
  function drawGroupHeaders(){
    for(const group of roots){
      const header=group.header;if(!header||!Number.isFinite(header.height)||typeof header.label!=='string')continue;
      const b=screen({...group,h:header.height});
      if(b.w<60||b.h<12||b.x>width||b.x+b.w<0||b.y>height||b.y+b.h<0)continue;
      ctx.fillStyle=palette.surface;ctx.fillRect(b.x,b.y,b.w,b.h);
      ctx.fillStyle=colors.get(header.color)||palette.action;ctx.fillRect(b.x+3,b.y+Math.min(6,b.h*.22),2,Math.min(11,b.h*.55));
      const count=b.w>170?header.count+' 段':'';
      ctx.fillStyle=palette.ink;ctx.font='500 11px '+palette.sans;ctx.textBaseline='top';
      ctx.fillText(ellipsis(header.label,b.w-(count?65:20),11),b.x+12,b.y+Math.min(6,b.h*.22));
      if(count){ctx.fillStyle=palette.muted;ctx.font='10px '+palette.mono;ctx.textAlign='right';ctx.fillText(count,b.x+b.w-7,b.y+Math.min(6,b.h*.22));ctx.textAlign='left';}
      ctx.strokeStyle=palette.line;ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(b.x,b.y+b.h-.5);ctx.lineTo(b.x+b.w,b.y+b.h-.5);ctx.stroke();
    }
  }
  function drawTimeline(){
    if(!roots.some(group=>group.timeline))return;
    ctx.fillStyle=palette.surface;ctx.fillRect(0,0,width,26);ctx.strokeStyle=palette.line;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(0,22.5);ctx.lineTo(width,22.5);ctx.stroke();
    ctx.fillStyle=palette.muted;ctx.font='10px '+palette.sans;ctx.textBaseline='top';
    for(const group of roots){
      if(!group.timeline)continue;const b=screen(group);if(b.x>width||b.x+b.w<0)continue;
      ctx.beginPath();ctx.moveTo(b.x+.5,18);ctx.lineTo(b.x+.5,26);ctx.stroke();
      if(b.w>52)ctx.fillText(group.caption,Math.max(5,b.x+5),4);
    }
  }
  function drawMini(){
    const mw=112,mh=68;mini.clearRect(0,0,mw,mh);mini.fillStyle=palette.surface;mini.fillRect(0,0,mw,mh);
    for(const g of roots){mini.fillStyle=colors.get(g.cells?.[0]?.fill??'var(--tt-soft)')||palette.line;mini.fillRect(g.x/W*mw,g.y/H*mh,g.w/W*mw,g.h/H*mh);}
    const s=fit*camera.k;mini.strokeStyle=palette.action;mini.lineWidth=1;mini.strokeRect((camera.x-width/(2*s))/W*mw,(camera.y-height/(2*s))/H*mh,width/s/W*mw,height/s/H*mh);
    minimap.hidden=camera.k<1.1;
  }
  function emitView(){
    const center=rects.find(r=>visibleLevel(r)&&camera.x>=r.x&&camera.x<=r.x+r.w&&camera.y>=r.y&&camera.y<=r.y+r.h);
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
  function hit(event){const b=canvas.getBoundingClientRect(),p=point(event.clientX-b.left,event.clientY-b.top,camera);
    const header=roots.find(g=>g.header&&p.x>=g.x&&p.x<=g.x+g.w&&p.y>=g.y&&p.y<=g.y+g.header.height);
    return (header&&byId.get(header.header.id))||rects.find(r=>visibleLevel(r)&&p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h);}
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
      query=input.value.trim().toLowerCase();matches=matchIds(rects.filter(r=>(r.searchText??r.name+' '+(r.type??'')+' '+(r.context??'')).toLowerCase().includes(query)).map(r=>r.id));
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
  listen(reducedMotion,'change',requestDraw);
  const fontsReady=()=>{if(!destroyed){paletteDirty=true;bodyCache.clear();requestDraw();}};
  listen(document.fonts,'loadingdone',fontsReady);document.fonts.ready.then(fontsReady);resize();
  return {
    select(id){selection=id;canvas.setAttribute('aria-label','矩形分布图，已选 '+(byId.get(id)?.name||'内容')+'。单击查看详情，双击进入或返回，滚轮缩放，拖动平移；回车查看详情，Escape 查看全图，斜杠查找。');requestDraw();},
    focusLeaf(id){onInteract();const r=byId.get(id);if(r)focusLeaf(r);},
    focusGroup(id){onInteract();focusPath=[];const r=roots.find(g=>g.id===id);if(r)focusRect(r);},
    fitAll(){onInteract();focusPath=[];target={x:W/2,y:H/2,k:1};requestDraw();},
    zoom(factor){onInteract();zoomAt(factor);},
    search(value,ids){query=value;matches=matchIds(ids);requestDraw();},
    getState(){return {signature,camera:{...camera},target:{...target},focusPath:focusPath.map(entry=>({...entry,camera:{...entry.camera}})),selection};},
    destroy(){destroyed=true;cancelOpen();events.abort();observer.disconnect();themeObserver.disconnect();cancelAnimationFrame(raf);bodyCache.clear();probe.remove();}
  };
}

return {toggleZoomFocus,zoomMapOverlay,zoomMapIndex,createZoomTreemap};
})();
const {currentContextScene}=(()=>{

function currentContextScene(items, width = 440, height = 380) {
  const W = 1000, H = Math.max(180, Math.min(1800, W * height / Math.max(280, width)));
  const categories = new Map(), palette = new Map(CONTEXT_CATEGORIES.map(row => [row.key, row]));
  for (const item of items) {
    if (!(item.tokens > 0) || !palette.has(item.category)) continue;
    if (!categories.has(item.category)) categories.set(item.category, { id: item.category, weight: 0, items: [] });
    const group = categories.get(item.category); group.weight += item.tokens; group.items.push(item);
  }
  const scale = Math.min((width - 4) / W, (height - 4) / H), gap = 2 / scale;
  const ordered = [...categories.values()].sort((a, b) => b.weight - a.weight);
  return { width: W, height: H, groups: tileLayout(ordered, W, H).map(group => {
    const category = palette.get(group.id), id = 'category-' + group.id;
    const w = Math.max(.01, group.w - Math.min(gap, group.w * .08)), h = Math.max(.01, group.h - Math.min(gap, group.h * .08));
    const headerHeight = Math.min(22 / scale, h * .22), bodyHeight = h - headerHeight;
    const paint = { category: group.id, fill: `color-mix(in srgb,${category.color} 34%,var(--tt-surface))`, stroke: category.color, ink: 'var(--tt-ink)' };
    const cells = [{ ...paint, id, aggregate: true, x: 0, y: headerHeight, w, h: bodyHeight,
      name: ui(category.label), tokens: group.weight, weight: group.weight, itemCount: group.items.length,
      secondary: group.items.length + ' 段 · ' + Math.round(group.weight).toLocaleString() + ' tokens', preview: '' }];
    for (const item of tileLayout(group.items.map(item => ({ ...item, weight: item.tokens })), w, bodyHeight)) {
      cells.push({ ...item, ...paint, parentId: id, y: headerHeight + item.y,
        w: Math.max(.001, item.w - Math.min(.6, item.w * .06)), h: Math.max(.001, item.h - Math.min(.6, item.h * .06)),
        secondary: (item.seq == null ? '' : '#' + item.seq + ' · ') + Math.round(item.tokens).toLocaleString() + ' tokens' });
    }
    return { id: group.id, x: group.x, y: group.y, w, h, cells, frame: false,
      header: { id, label: ui(category.key==='assistant'?'模型输出':category.label), color: category.color, height: headerHeight, count: group.items.length } };
  }) };
}

return {currentContextScene};
})();
const {mountCurrentContext}=(()=>{

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const format = value => value >= 1000 ? (value / 1000).toFixed(value >= 100000 ? 0 : 1) + 'k' : Math.round(value).toLocaleString();
function stylesheet() {}

function mountCurrentContext(host, { sessionId, active = false, base = '/analysis-view/current-context' } = {}) {
  stylesheet('./panel.css'); stylesheet('./zoom-treemap.css');
  host.classList.add('current-context-panel');
  host.innerHTML = `<header class="cc-head"><div class="cc-heading"><h2>最近请求上下文</h2><div class="cc-total">—<small>tokens</small></div></div><div class="cc-summary"><span class="cc-count">请求来源 · 估算</span><span class="cc-status" role="status">等待打开</span></div><nav class="cc-legend" aria-label="轨迹图内容分类">${CONTEXT_CATEGORIES.map(row => `<button type="button" data-category="${row.key}" aria-pressed="false" style="--category:${row.color}"><i></i>${escape(ui(row.key === 'assistant' ? '模型输出' : row.label))}</button>`).join('')}</nav></header>
    <div class="cc-map-wrap"><div class="cc-map zoom-treemap" role="group" aria-label="最近请求上下文构成，按内容分类分区"></div><div class="cc-empty">正在读取请求来源内容…</div></div>
    <div class="cc-controls"><button type="button" data-action="fit">全图</button><button type="button" data-action="refresh">刷新</button><span class="cc-help">滚轮缩放 · 拖动 · 双击进入 / 返回</span></div>
    <label class="cc-search"><input type="search" placeholder="查找内容或来源" aria-label="查找最近请求上下文"></label>
    <section class="cc-detail" aria-label="选中内容"><div class="cc-detail-heading"><h3>查看最近请求上下文构成</h3><button class="cc-open" type="button" hidden>查看正文 ↗</button></div><div class="cc-meta">沿用轨迹图的七类划分</div><p>面积表示估算 tokens。缩放查看片段，单击阅读；压缩后保留的摘要和内容也在图中。</p></section>
    <section class="cc-body" aria-label="上下文正文" hidden><header><button type="button" data-action="back">← 返回图</button><h3></h3></header><pre tabindex="0"></pre><footer><span></span><button type="button" data-action="more" hidden> 继续显示</button></footer></section>`;
  const find = selector => host.querySelector(selector), map = find('.cc-map'), empty = find('.cc-empty'), status = find('.cc-status');
  const detail = find('.cc-detail'), bodyPane = find('.cc-body'), search = find('input');
  const events = new AbortController();
  let requestedActive = active, visible = false, destroyed = false, timer = 0, resizeTimer = 0, request, bodyRequest, api, data, selected, viewState;
  let paintedSize = '';
  let category = null, bodyText = '', bodyShown = 0, paintFrames = 0;
  const bodyCache = new Map();
  function note(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
  function select(item) {
    selected = item;
    const label = ui(CONTEXT_CATEGORIES.find(row => row.key === item.category)?.label ?? '');
    detail.querySelector('h3').textContent = item.name;
    const share = data?.totals.total > 0 ? ' · ' + ((item.tokens ?? item.weight) / data.totals.total * 100).toFixed(1) + '%' : '';
    detail.querySelector('.cc-meta').textContent = `${label} · ${format(item.tokens ?? item.weight)} tokens${share}${item.seq != null ? ' · #' + item.seq : ''}`;
    detail.querySelector('p').textContent = item.aggregate ? '请求来源 ' + item.itemCount + ' 段' + label + '，双击或滚轮放大查看。' : item.preview || '此片段包含结构化内容。';
    const button = detail.querySelector('.cc-open'); button.hidden = Boolean(item.aggregate); button.disabled = data?.bodyAvailable === false;
  }
  function applySearch() {
    const query = search.value.trim().toLowerCase();
    const ids = (data?.items ?? []).filter(item => (!category || category === item.category) && (!query || (item.name + ' ' + item.preview + ' ' + item.category).toLowerCase().includes(query))).map(item => item.id);
    api?.search(query || category || '', ids);
  }
  function clearSearch() {
    category = null; search.value = '';
    host.querySelectorAll('[data-category]').forEach(node => node.setAttribute('aria-pressed', 'false'));
  }
  function paint() {
    if (!visible || !data?.items.length) return;
    viewState = api?.getState() ?? viewState; api?.destroy();
    paintedSize = Math.round(map.clientWidth) + ':' + Math.round(map.clientHeight);
    map.innerHTML = '<canvas class="zoom-map-canvas" tabindex="0" aria-label="最近请求上下文，滚轮缩放，拖动平移，双击进入或返回"></canvas>' + zoomMapOverlay();
    api = createZoomTreemap(map, { model: currentContextScene(data.items, map.clientWidth, map.clientHeight), selected: selected?.id,
      viewState, getBody: item => item.preview || '', onSelect: select, onOpen: item => { if (!item.aggregate) openBody(item); },
      onFrame() { host.dataset.drawFrames = String(++paintFrames); } });
    host.dataset.items = String(data.items.length); host.dataset.version = data.version;
    applySearch();
  }
  async function load() {
    if (!visible || destroyed) return;
    request?.abort(); const controller = new AbortController(); request = controller;
    note(data ? '更新中…' : '读取中…');
    try {
      const next = await window.__ttLoadCurrentContext(sessionId);
      if (controller.signal.aborted || destroyed) return;
      if (!next.available) {
        data = null; api?.destroy(); api = null; map.replaceChildren(); empty.hidden = false; empty.textContent = '当前记录尚不能还原保留上下文。';
        find('.cc-total').innerHTML = '—<small>tokens</small>'; find('.cc-count').textContent = '请求来源 · 估算'; note('暂不可用'); return;
      }
      if (next.version !== data?.version) {
        const wasZoomed = api && api.getState().camera.k > 1.05, selectedId = selected?.id;
        data = next; bodyCache.clear(); bodyRequest?.abort(); bodyPane.hidden = true; bodyText = '';
        const current = data.items.find(item => item.id === selectedId); selected = current;
        paint();
        if (current) { select(current); if (wasZoomed) api?.focusLeaf(current.id); }
        else { selected = null; detail.querySelector('h3').textContent = '选择一个内容片段'; detail.querySelector('.cc-meta').textContent = '请求来源 · 按内容分类分区'; detail.querySelector('p').textContent = '单击阅读内容，双击进入或返回，滚轮连续缩放。'; detail.querySelector('.cc-open').hidden = true; }
      }
      empty.hidden = data.items.length > 0; empty.textContent = '当前还没有保留内容。';
      find('.cc-total').innerHTML = format(data.totals.total) + '<small>tokens</small>';
      const categories = new Set(data.items.map(item => item.category));
      find('.cc-count').textContent = data.items.length + ' 段 · ' + categories.size + ' 类 · 估算';
      note(data.contextWindow ? (data.totals.total / data.contextWindow * 100).toFixed(1) + '% 窗口' : '已同步');
    } catch (error) {
      if (!controller.signal.aborted && !destroyed) {
        note('读取失败 · 可刷新', true);
        if (!data) { empty.hidden = false; empty.textContent = '无法读取最近请求上下文：' + error.message; }
      }
    }
  }
  function refresh(delay = 400) { clearTimeout(timer); if (visible && !destroyed) timer = setTimeout(load, delay); }
  function showBody() {
    bodyShown = Math.min(bodyText.length, bodyShown + 65536);
    bodyPane.querySelector('pre').textContent = bodyText.slice(0, bodyShown);
    bodyPane.querySelector('footer span').textContent = `${bodyShown.toLocaleString()} / ${bodyText.length.toLocaleString()} 字符`;
    bodyPane.querySelector('[data-action=more]').hidden = bodyShown >= bodyText.length;
  }
  async function openBody(item) {
    if (!visible || !data || data.bodyAvailable === false) return;
    select(item); bodyRequest?.abort(); const controller = new AbortController(); bodyRequest = controller;
    const version = data.version;
    bodyPane.hidden = false; bodyPane.querySelector('h3').textContent = item.name;
    bodyPane.querySelector('pre').textContent = '读取正文…'; bodyPane.querySelector('footer span').textContent = ''; bodyPane.querySelector('[data-action=more]').hidden = true;
    try {
      let text = bodyCache.get(item.id);
      if (text === undefined) {
        text = await window.__ttLoadContextBody(sessionId, version, item.id);
        if (text.length <= 65536) { bodyCache.set(item.id, text); while (bodyCache.size > 4) bodyCache.delete(bodyCache.keys().next().value); }
      }
      if (controller.signal.aborted || destroyed || data?.version !== version) return;
      bodyText = text; bodyShown = 0; showBody(); bodyPane.querySelector('[data-action=back]').focus({ preventScroll: true });
    } catch (error) { if (!controller.signal.aborted && !destroyed) bodyPane.querySelector('pre').textContent = error.message; }
  }
  function closeBody() { bodyRequest?.abort(); bodyPane.hidden = true; bodyText = ''; bodyPane.querySelector('pre').textContent = ''; map.querySelector('canvas')?.focus({ preventScroll: true }); }
  const listen = (target, name, callback) => target.addEventListener(name, callback, { signal: events.signal });
  const resizeObserver = new ResizeObserver(() => {
    const size = Math.round(map.clientWidth) + ':' + Math.round(map.clientHeight);
    clearTimeout(resizeTimer);
    if (!visible || size === paintedSize) return;
    resizeTimer = setTimeout(() => {
      const currentSize = Math.round(map.clientWidth) + ':' + Math.round(map.clientHeight);
      if (!visible || destroyed || currentSize === paintedSize) return;
      const focused = api?.getState().camera.k > 1.05 ? selected?.id : null;
      paint(); if (focused) api?.focusLeaf(focused);
    }, 100);
  });
  resizeObserver.observe(map);
  listen(map, 'pointerdown', clearSearch);
  map.addEventListener('wheel', clearSearch, { passive: true, signal: events.signal });
  // A sidebar can reflow between the two gestures. Its return destination is
  // always the whole retained surface, independent of the old column width.
  map.addEventListener('dblclick', event => {
    if (!api?.getState().focusPath.length) return;
    event.preventDefault(); event.stopPropagation(); api.fitAll();
  }, { capture: true, signal: events.signal });
  listen(host, 'click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'fit') { clearSearch(); api?.fitAll(); }
    if (action === 'refresh') refresh(0);
    if (action === 'back') closeBody();
    if (action === 'more') showBody();
    const button = event.target.closest('[data-category]');
    if (button) {
      category = category === button.dataset.category ? null : button.dataset.category;
      host.querySelectorAll('[data-category]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.category === category))); applySearch();
    }
    if (event.target.closest('.cc-open') && selected) openBody(selected);
  });
  listen(search, 'input', applySearch);
  listen(search, 'keydown', event => {
    if (event.key !== 'Enter') return;
    const query = search.value.trim().toLowerCase(), item = data?.items.find(item => (!category || category === item.category) && (item.name + ' ' + item.preview).toLowerCase().includes(query));
    if (item) { select(item); api?.select(item.id); api?.focusLeaf(item.id); applySearch(); }
  });
  listen(host, 'keydown', event => { if (event.key === 'Escape' && !bodyPane.hidden) { event.stopPropagation(); closeBody(); } });
  function visibility() {
    const next = requestedActive && document.visibilityState !== 'hidden';
    if (next === visible || destroyed) return;
    visible = next; host.dataset.active = String(visible);
    if (visible) { paint(); refresh(0); }
    else { clearTimeout(timer); clearTimeout(resizeTimer); request?.abort(); bodyRequest?.abort(); viewState = api?.getState() ?? viewState; api?.destroy(); api = null; bodyCache.clear(); bodyText = ''; bodyPane.querySelector('pre').textContent = ''; bodyPane.hidden = true; }
  }
  listen(document, 'visibilitychange', visibility); visibility();
  return {
    refresh,
    setActive(value) { requestedActive = Boolean(value); visibility(); },
    destroy() { requestedActive = false; visibility(); destroyed = true; clearTimeout(timer); clearTimeout(resizeTimer); resizeObserver.disconnect(); request?.abort(); bodyRequest?.abort(); api?.destroy(); events.abort(); bodyCache.clear(); data = null; host.replaceChildren(); host.classList.remove('current-context-panel'); },
  };
}

return {mountCurrentContext};
})();
const {compactTrendPolyline}=(()=>{
// Match the existing SVG's two-decimal geometry exactly. Remove only duplicate
// or collinear points in the same direction; keep corners and reversals.
function compactTrendPolyline(points) {
  const line = [];
  for (const point of points) {
    const next = point.map(value => Math.round(Number(value.toFixed(2)) * 100));
    const last = line.at(-1);
    if (last && last[0] === next[0] && last[1] === next[1]) continue;
    while (line.length > 1) {
      const a = line.at(-2), b = line.at(-1);
      const dx = b[0] - a[0], dy = b[1] - a[1], nx = next[0] - b[0], ny = next[1] - b[1];
      if (dx * ny !== dy * nx || dx * nx + dy * ny < 0) break;
      line.pop();
    }
    line.push(next);
  }
  return line.map(([x, y]) => x / 100 + ',' + y / 100);
}

// A retained-text snapshot holds until the next recorded change. Never draw a
// slope that suggests gradual growth (or compaction) between observations.
function stepTrendPolyline(points) {
  const stairs = [];
  for (const [x,y] of points) {
    if (stairs.length) stairs.push([x,stairs.at(-1)[1]]);
    stairs.push([x,y]);
  }
  return compactTrendPolyline(stairs);
}

function chronologicalContextSamples(rows) {
  return rows.filter(row => Number.isFinite(row.time)).slice().sort((a,b) =>
    a.time-b.time || (a.ordinal ?? a.contextLine ?? a.seq ?? 0)-(b.ordinal ?? b.contextLine ?? b.seq ?? 0));
}

return {compactTrendPolyline};
})();
const POLL_MS = 1500;
const $ = (id) => document.getElementById(id);

const SERIES_META = [
  { key: 'cacheReadTokens', label: '缓存读取', color: '#39a29b' },
  { key: 'inputTokens', label: '新增输入', color: '#5286bf' },
  { key: 'cacheWriteTokens', label: '缓存写入', color: '#bf8b32' },
];

const state = {
  selectedConv: '', // '' follows the host-bound conversation, never latest mtime
  etag: '',
  snap: null,
  tab: 'surface',
  filter: '',
  activeSources: new Set(SERIES_META.map((s) => s.key)),
  activeLayers: new Set(['total']),
  ccInstance: null,
  mountedSession: null,
};

const fmt = (n) => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
};
const pct = (n, total) => (total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '—');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Exact same GET helper as Antigravity's built-in swarm_board/app.js (never overwrites window.fetch!)
async function getJson(path, signal) {
  const f = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
  const res = await f(path, { method: 'GET', signal });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// The shared panel reads the same resolved snapshot as the header and charts.
window.__ttLoadCurrentContext = async sessionId => {
  if (state.snap?.conversationId !== sessionId) return { available: false };
  return state.snap.currentContext;
};
window.__ttLoadContextBody = async (sessionId, version, itemId) => {
  const qs = new URLSearchParams({ session: sessionId, version, item: itemId });
  return (await getJson('/api/current-context/body?' + qs)).text;
};

function syncScheme() {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, #f7f7f8)';
  document.documentElement.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const nums = (c.match(/[\d.]+/g) || []).map(Number);
  if (nums.length < 3) return;
  const scale = c.startsWith('color(') ? 1 : 255;
  const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const theme = lum < 0.5 ? 'dark' : 'light';
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
}
syncScheme();
new MutationObserver(syncScheme).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

function effectiveSessionId() {
  return state.snap?.conversationId || state.selectedConv || window.sidecar?.conversationId || '';
}

function ensureNativeTreemapMounted() {
  const session = effectiveSessionId();
  if (!state.snap || !session) return;
  if (state.ccInstance && state.mountedSession === session) {
    state.ccInstance.setActive(state.tab === 'surface');
    return;
  }
  state.ccInstance?.destroy();
  state.mountedSession = session;
  state.ccInstance = mountCurrentContext($('cc-host'), {
    sessionId: session,
    active: state.tab === 'surface',
    base: '/api/current-context',
  });
}

function renderHeader(snap, conversations) {
  const select = $('conv-select');
  const hostConv = window.sidecar?.conversationId || '';
  const options = [
    `<option value="">当前会话 (${esc(snap.shortId)} · #${snap.cutSeq})</option>`,
    ...(conversations || []).map(
      (c) => `<option value="${esc(c.id)}" ${state.selectedConv === c.id ? 'selected' : ''}>${esc(c.shortId)}${c.id === hostConv ? ' (当前)' : ''}</option>`
    ),
  ];
  select.innerHTML = options.join('');

  const pill = $('live-pill');
  pill.classList.remove('is-error');
  $('live-label').textContent = `已同步 · #${snap.cutSeq}`;
  $('source-note').textContent = snap.source.note + (snap.currentContext.available ? ` 来源文本约 ${fmt(snap.currentContext.totals.total)} tokens。` : '');

  $('m-win').textContent = fmt(snap.currentWindow);
  $('m-win-sub').textContent = `#${snap.usageSeq ?? '?'} · 缓 ${fmt(snap.currentCached)} · 新 ${fmt(snap.currentUncached)}${snap.currentWrite ? ' · 写 ' + fmt(snap.currentWrite) : ''}`;

  $('m-hit').textContent = snap.cacheHitRate == null ? '—' : `${snap.cacheHitRate}%`;
  $('m-hit-sub').textContent = `读缓 ${fmt(snap.totalCache)}`;

  if (snap.checkpoint) {
    $('m-cp').textContent = `#${snap.checkpoint.step}`;
    $('m-cp-sub').textContent = `${fmt(snap.checkpoint.beforeWindow)} → ${fmt(snap.checkpoint.afterWindow)}`;
  } else {
    $('m-cp').textContent = '未压缩';
    $('m-cp-sub').textContent = `峰值 ${fmt(snap.peakWindow)}`;
  }

  $('m-out').textContent = fmt(snap.totalOut);
  $('m-out-sub').textContent = `${snap.turns} 轮 · ${snap.plannerSteps} 次请求`;
  $('step-count').textContent = snap.recentSteps?.length || 0;
}

function renderNativeContextChart(snap) {
  const rows = (snap.trendSeries || []).filter(r => r.windowTokens != null);
  const host = $('fig-context-canvas');
  if (!rows.length) {
    host.innerHTML = '<p class="chart-caption">当前范围暂无请求用量记录。</p>';
    return;
  }
  $('fig-context-scope').textContent = `${snap.plannerSteps} 次请求 · ${rows.length} 个采样点`;

  const W = Math.max(280, Math.round(host.clientWidth || 760));
  const leftPad = 56;
  const rightPad = 18;
  const plotW = W - leftPad - rightPad;

  const activeSeries = SERIES_META.filter((s) => state.activeSources.has(s.key));
  const seriesKeys = activeSeries.length ? activeSeries.map((s) => s.key) : SERIES_META.map((s) => s.key);
  const colorOf = (key) => SERIES_META.find((s) => s.key === key)?.color || '#2378dc';

  const totals = rows.map((r) => seriesKeys.reduce((acc, k) => acc + (Number(r[k]) || 0), 0));
  const max = Math.max(1, ...totals);
  const first = rows[0].seq;
  const last = Math.max(first + 1, rows.at(-1).seq);
  const px = (seq) => leftPad + ((seq - first) / Math.max(1, last - first)) * plotW;
  const py = (val) => 204 - (val / max) * 156;
  const rule = (y) => `<path class="plot-grid" d="M${leftPad} ${y.toFixed(1)}H${W - rightPad}"/>`;
  const tx = (x, y, v, cl = 'plot-axis', anchor = 'start') =>
    `<text class="${cl}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${esc(v)}</text>`;

  const controlsHtml = `<div class="report-context-controls">
    <div class="report-source-toggles">${SERIES_META.map(
      (s) =>
        `<button type="button" data-report-source="${s.key}" aria-pressed="${seriesKeys.includes(s.key)}" style="--source-color:${s.color}"><i></i>${esc(s.label)}</button>`
    ).join('')}</div>
    <div class="report-layer-toggles">${[
      ['total', '请求输入'],
      ['delta', '增减'],
    ]
      .map(
        ([k, label]) =>
          `<button type="button" data-report-layer="${k}" aria-pressed="${state.activeLayers.has(k)}">${label}</button>`
      )
      .join('')}</div>
  </div>`;

  let totalSvg = '';
  if (state.activeLayers.has('total')) {
    let b = '';
    for (let i = 0; i <= 3; i++) {
      const n = (max * i) / 3;
      b += rule(py(n)) + tx(leftPad - 8, py(n) + 4, fmt(n), 'plot-axis', 'end');
    }
    let lower = rows.map(() => 0);
    for (const key of seriesKeys) {
      const upper = rows.map((r, i) => lower[i] + (Number(r[key]) || 0));
      const upperLine = compactTrendPolyline(rows.map((r, i) => [px(r.seq), py(upper[i])])).join('L');
      const lowerLine = compactTrendPolyline(rows.map((r, i) => [px(r.seq), py(lower[i])]).reverse()).join('L');
      b += `<path d="M${upperLine}L${lowerLine}Z" fill="${colorOf(key)}" opacity="0.24"/>`;
      b += `<path d="M${upperLine}" fill="none" stroke="${colorOf(key)}" stroke-width="1.35"/>`;
      lower = upper;
    }
    const tickCount = Math.min(8, Math.max(4, Math.floor(plotW / 120)));
    for (let i = 0; i <= tickCount; i++) {
      const n = first + ((last - first) * i) / tickCount;
      b += tx(px(n), 228, `#${Math.round(n)}`, 'plot-axis', 'middle');
    }
    if (snap.checkpoint) {
      const cpRow = rows.find((r) => r.seq >= snap.checkpoint.step) || rows.at(-1);
      if (cpRow) {
        const idx = rows.indexOf(cpRow);
        const xx = px(cpRow.seq), yy = py(totals[idx]);
        b += `<circle class="context-pin" cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="3.8"/>`;
        b += tx(Math.min(W - 140, xx + 8), Math.max(20, yy - 10), `CHECKPOINT #${snap.checkpoint.step}`, 'context-annotation');
      }
    }
    const hitW = Math.max(12, plotW / Math.max(1, rows.length));
    rows.forEach((r, idx) => {
      b += `<g class="plot-mark" data-trend-idx="${idx}"><rect class="context-hit" x="${(px(r.seq) - hitW / 2).toFixed(1)}" y="32" width="${hitW.toFixed(1)}" height="178"/></g>`;
    });
    totalSvg = `<svg viewBox="0 0 ${W} 238" role="img" aria-label="实报请求输入">${b}</svg>`;
  }

  let deltaSvg = '';
  if (state.activeLayers.has('delta') && rows.length > 1) {
    const deltas = rows.map(r => r.deltaBySource ? seriesKeys.reduce((n, key) => n + r.deltaBySource[key], 0) : null);
    const limit = Math.max(1, ...deltas.map(v => Math.abs(v || 0)));
    const axis = (y, label) => tx(leftPad - 8, y + 3, label, 'plot-axis', 'end');
    let d = axis(18, '+' + fmt(limit)) + axis(70, '0') + axis(122, '−' + fmt(limit));
    d += '<path class="plot-grid" d="M' + leftPad + ' 70H' + (W - rightPad) + '"/>';
    const barW = Math.max(3, Math.min(14, plotW / rows.length * .62));
    deltas.forEach((delta, i) => {
      if (delta == null) return;
      const size = Math.abs(delta) / limit * 50;
      d += '<g class="plot-mark" data-trend-idx="' + i + '"><rect x="' + (px(rows[i].seq) - barW / 2).toFixed(1) + '" y="' + (delta >= 0 ? 70 - size : 70).toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + size.toFixed(1) + '" fill="' + (delta >= 0 ? '#5286bf' : '#bf8b32') + '"/></g>';
    });
    deltaSvg = '<div class="context-delta-label">与前一次请求的输入净变化 · 包含压缩带来的减少</div><svg viewBox="0 0 ' + W + ' 138" role="img" aria-label="相邻请求输入变化">' + d + '</svg>';
  }

  host.innerHTML = controlsHtml + totalSvg + deltaSvg;
}

function renderNativeComparison(snap) {
  const host = $('fig-comparison-canvas');
  const comp = snap.comparison;
  if (!comp || comp.before?.windowTokens == null || comp.after?.windowTokens == null) {
    host.innerHTML = '<p class="chart-caption">暂无足够步数生成前后对照。</p>';
    return;
  }
  const a = comp.before, b = comp.after;
  const labelA = snap.checkpoint ? `压缩后起点 (#${a.seq})` : `会话起点 (#${a.seq})`;
  const labelB = `当前最新 (#${b.seq})`;
  $('fig-comparison-scope').textContent = `${labelA} → ${labelB}`;

  const totalA = SERIES_META.reduce((s, m) => s + (Number(a[m.key]) || 0), 0);
  const totalB = SERIES_META.reduce((s, m) => s + (Number(b[m.key]) || 0), 0);
  const netDelta = totalB - totalA;
  const maxCell = Math.max(1, ...SERIES_META.flatMap((m) => [Number(a[m.key]) || 0, Number(b[m.key]) || 0]));

  const summaryHtml = `<div class="comparison-summary">
    <div><span>${esc(labelA)}</span><strong>${fmt(totalA)}</strong><small>tokens</small></div>
    <span class="comparison-arrow">→</span>
    <div><span>${esc(labelB)}</span><strong>${fmt(totalB)}</strong><small>tokens</small></div>
    <div class="comparison-delta-card">
      <span>合计净变化</span>
      <strong>${netDelta >= 0 ? '+' : '−'}${fmt(Math.abs(netDelta))}</strong>
      <small>tokens · ${totalA > 0 ? (netDelta >= 0 ? '增长 ' : '减少 ') + pct(Math.abs(netDelta), totalA) : '—'}</small>
    </div>
  </div>`;

  const rowsHtml = SERIES_META.map((m) => {
    const va = Number(a[m.key]) || 0;
    const vb = Number(b[m.key]) || 0;
    const d = vb - va;
    const amount = (d > 0 ? '+' : d < 0 ? '−' : '') + fmt(Math.abs(d));
    const rel = va === 0 ? (d > 0 ? '从零新增' : '未变化') : d === 0 ? '未变化' : (d > 0 ? '增加 ' : '减少 ') + pct(Math.abs(d), va);
    return `<tr>
      <th scope="row"><i class="composition-swatch" style="background:${m.color}"></i>${esc(m.label)}</th>
      <td><span class="comparison-measure" style="--measure-width:${((va / maxCell) * 100).toFixed(1)}%"><span>${fmt(va)}</span><i></i></span></td>
      <td><span class="comparison-measure" style="--measure-width:${((vb / maxCell) * 100).toFixed(1)}%"><span>${fmt(vb)}</span><i></i></span></td>
      <td><span class="comparison-change"><b>${esc(amount)}</b><small>${esc(rel)}</small></span></td>
    </tr>`;
  }).join('');

  host.innerHTML = `${summaryHtml}<div class="comparison-scroll"><table class="comparison-table">
    <thead><tr><th>实报输入 · tokens</th><th>${esc(labelA)}</th><th>${esc(labelB)}</th><th>净变化</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;
}

function renderNativeTopSteps(snap) {
  const host = $('fig-top-steps-canvas');
  const rows = (snap.topSteps || []).slice(0, 8);
  if (!rows.length) {
    host.innerHTML = '<p class="chart-caption">暂无单步增长记录。</p>';
    return;
  }
  const maxD = Math.max(1, ...rows.map((r) => r.d));
  const barsHtml = rows
    .map((r, idx) => {
      const catColor = 'var(--tt-metric)';
      const widthPct = Math.max(1, (r.d / maxD) * 100).toFixed(1);
      return `<button type="button" class="report-bar-row" data-jump-step="${r.s}" ${r.retained ? '' : 'disabled'} title="${r.retained ? '定位来源片段' : '该请求的来源片段未保留在最近请求中'}">
        <span class="report-bar-label"><small class="report-bar-rank">${String(idx + 1).padStart(2, '0')}</small>#${r.s} · ${esc(r.tl)}</span>
        <span class="report-bar-track"><i style="left:0%;width:${widthPct}%;background:${catColor}"></i></span>
        <b>+${fmt(r.d)}</b>
        <small>${fmt(r.w)}</small>
      </button>`;
    })
    .join('');

  host.innerHTML = `<div class="report-bars has-detail">
    <div class="report-bar-unit"><span>步骤与动作</span><span>请求输入净增 · 请求总输入</span></div>
    ${barsHtml}
  </div>`;
}

function renderSteps(snap) {
  const q = state.filter.trim().toLowerCase();
  const list = (snap.recentSteps || []).filter((r) => !q || (r.tl || '').toLowerCase().includes(q) || `#${r.s}`.includes(q));
  $('step-feed').innerHTML = list
    .map(
      (r) => `
    <button type="button" class="step-row" data-jump-step="${r.s}" ${r.retained ? '' : 'disabled'} title="${r.retained ? '定位来源片段' : '该请求的来源片段未保留在最近请求中'}">
      <span class="step-left"><span class="step-seq">#${r.s}</span><span class="step-tl">${esc(r.tl)}</span></span>
      <span class="step-right">${r.d == null ? '—' : (r.d >= 0 ? '+' : '−') + fmt(Math.abs(r.d))}<span class="step-win">${fmt(r.w)}</span></span>
    </button>`
    )
    .join('');
}

function renderAll() {
  if (!state.snap) return;
  if (state.tab === 'curve') { renderNativeContextChart(state.snap); renderNativeComparison(state.snap); renderNativeTopSteps(state.snap); }
  if (state.tab === 'steps') renderSteps(state.snap);
}

function switchTab(nextTab) {
  state.tab = nextTab;
  for (const btn of document.querySelectorAll('[data-tab]')) {
    const active = btn.dataset.tab === state.tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
  }
  for (const name of ['surface', 'curve', 'steps']) {
    $('panel-' + name).classList.toggle('hidden', name !== state.tab);
  }
  state.ccInstance?.setActive(state.tab === 'surface');
  renderAll();
}

let curveResizeTimer = 0;
new ResizeObserver(() => {
  if (state.tab !== 'curve' || !state.snap) return;
  clearTimeout(curveResizeTimer);
  curveResizeTimer = setTimeout(() => renderNativeContextChart(state.snap), 60);
}).observe($('fig-context-canvas'));

let pollTimer, pollRequest, pollEpoch = 0;
function clearSnapshot(message) {
  state.snap = null; state.etag = ''; state.mountedSession = null;
  state.ccInstance?.destroy(); state.ccInstance = null;
  $('cc-host').textContent = message;
  for (const id of ['m-win','m-hit','m-cp','m-out','m-win-sub','m-hit-sub','m-cp-sub','m-out-sub']) $(id).textContent = '—';
  for (const id of ['fig-context-canvas','fig-comparison-canvas','fig-top-steps-canvas','step-feed']) $(id).replaceChildren();
  $('source-note').textContent = ''; $('step-count').textContent = '';
}
async function poll() {
  clearTimeout(pollTimer);
  if (document.visibilityState === 'hidden') return;
  pollRequest?.abort();
  const controller = new AbortController(), epoch = ++pollEpoch;
  pollRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const conv = state.selectedConv || window.sidecar?.conversationId || '';
    const qs = new URLSearchParams({ conversationId: conv });
    if (state.etag) qs.set('etag', state.etag);
    const res = await getJson('/api/context?' + qs, controller.signal);
    if (epoch !== pollEpoch) return;
    if (res.empty) {
      clearSnapshot('当前会话暂无请求记录，请选择要查看的会话。');
      $('conv-select').innerHTML = '<option value="">当前会话</option>' + (res.conversations || []).map(c => '<option value="' + esc(c.id) + '">' + esc(c.shortId) + '</option>').join('');
      $('live-label').textContent = '暂无记录';
    } else {
      if (!res.unchanged) { state.etag = res.etag; state.snap = res; }
      if (state.snap) {
        renderHeader(state.snap, res.conversations);
        if (!res.unchanged) { renderAll(); ensureNativeTreemapMounted(); state.ccInstance?.refresh(0); }
      }
    }
  } catch (error) {
    if (epoch !== pollEpoch) return;
    $('live-pill').classList.add('is-error');
    $('live-label').textContent = state.snap ? '同步失败 · 保留上次读数' : '读取失败 · 正在重试';
    if (!state.snap) $('cc-host').textContent = '暂时无法读取请求记录。';
  } finally {
    clearTimeout(timeout);
    if (epoch === pollEpoch && document.visibilityState !== 'hidden') pollTimer = setTimeout(poll, POLL_MS);
  }
}
document.addEventListener('visibilitychange', () => {
  clearTimeout(pollTimer); ++pollEpoch; pollRequest?.abort();
  if (document.visibilityState !== 'hidden') poll();
});

document.querySelector('.tabs').addEventListener('keydown', e => {
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const current = tabs.indexOf(e.target);
  if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const index = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
    : (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  switchTab(tabs[index].dataset.tab); tabs[index].focus();
});

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    switchTab(tabBtn.dataset.tab);
    return;
  }

  const srcBtn = e.target.closest('[data-report-source]');
  if (srcBtn && state.snap) {
    const key = srcBtn.dataset.reportSource;
    if (state.activeSources.has(key) && state.activeSources.size > 1) {
      state.activeSources.delete(key);
    } else {
      state.activeSources.add(key);
    }
    renderNativeContextChart(state.snap);
    return;
  }

  const layerBtn = e.target.closest('[data-report-layer]');
  if (layerBtn && state.snap) {
    const key = layerBtn.dataset.reportLayer;
    if (state.activeLayers.has(key) && state.activeLayers.size > 1) {
      state.activeLayers.delete(key);
    } else {
      state.activeLayers.add(key);
    }
    renderNativeContextChart(state.snap);
    return;
  }

  const jumpBtn = e.target.closest('[data-jump-step]');
  if (jumpBtn) {
    const stepSeq = jumpBtn.dataset.jumpStep;
    switchTab('surface');
    const searchInput = document.querySelector('#cc-host .cc-search input');
    if (searchInput) {
      searchInput.value = `#${stepSeq} ·`;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  }
});

$('fig-context-canvas').addEventListener('mousemove', (e) => {
  const mark = e.target.closest('[data-trend-idx]');
  if (!mark || !state.snap?.trendSeries) return;
  const row = state.snap.trendSeries.filter(r => r.windowTokens != null)[Number(mark.dataset.trendIdx)];
  if (!row) return;
  const readout = $('fig-context-readout');
  readout.dataset.state = 'active';
  readout.innerHTML = `<strong>#${row.seq}</strong> (第 ${row.turn} 轮 · ${esc(row.at)}) · 实报输入 <strong>${fmt(row.windowTokens)}</strong> (读缓 ${fmt(row.cacheReadTokens)} + 新增输入 ${fmt(row.inputTokens)} + 缓存写入 ${fmt(row.cacheWriteTokens)} · 输出 ${fmt(row.outputTokens)}) · ${esc(row.label)}`;
});

$('conv-select').addEventListener('change', (e) => {
  state.selectedConv = e.target.value;
  ++pollEpoch; pollRequest?.abort(); clearTimeout(pollTimer);
  clearSnapshot('读取会话…');
  poll();
});

$('step-filter').addEventListener('input', (e) => {
  state.filter = e.target.value;
  if (state.snap) renderSteps(state.snap);
});

poll();

})();
