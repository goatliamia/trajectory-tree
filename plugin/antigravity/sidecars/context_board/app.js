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
const POLL_MS = 1500;
const USAGE_POLL_MS = 15000;
const $ = (id) => document.getElementById(id);

const state = {
  selectedConv: '', // '' follows the host-bound conversation, never latest mtime
  etag: '',
  snap: null,
  usage: null,
  usageMode: '',
  usageProject: '', usageDays: '7', heatPage: 0,
  heatSelection: null,
  tab: 'surface',
  ccInstance: null,
  mountedSession: null,
  frames: { trace: null, eval: null },
};

const fmt = (n) => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
};
const pct = (n, total) => (total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '—');
const turnName = turn => turn > 0 ? `第 ${turn} 轮` : '未分轮';
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
  const currentTitle = conversations?.find(c => c.id === snap.conversationId)?.title || '当前对话';
  const options = [
    `<option value="">${state.selectedConv ? '跟随当前对话' : esc(currentTitle) + '（当前）'}</option>`,
    ...(conversations || []).filter(c => c.id !== (hostConv || (!state.selectedConv && snap.conversationId)) || c.id === state.selectedConv).map(
      (c) => `<option value="${esc(c.id)}" ${state.selectedConv === c.id ? 'selected' : ''}>${esc(c.title || '未命名对话')}</option>`
    ),
  ];
  select.innerHTML = options.join('');

  const pill = $('live-pill');
  pill.classList.remove('is-error');
  $('live-label').textContent = `已同步 · #${snap.cutSeq}`;
  $('source-note').textContent = snap.currentContext.available ? `最近请求 #${snap.usageSeq ?? '—'} · 可见来源文本约 ${fmt(snap.currentContext.totals.total)} Token` : snap.source.note;
  $('source-note').title = snap.source.note;

  $('m-win').textContent = fmt(snap.currentWindow);
  $('m-win-sub').textContent = `${turnName(snap.currentTurn)} · #${snap.usageSeq ?? '?'}`;
  $('m-win').title = `缓存读取 ${exact(snap.currentCached)} · 新增输入 ${exact(snap.currentUncached)} · 缓存写入 ${exact(snap.currentWrite)}`;
  const occ = snap.occupancy;
  const basis = occ?.basis === 'host-estimate' ? '宿主估算' : '实报输入';
  $('m-occupancy').textContent = occ?.percent == null ? '—' : occ.percent.toFixed(1) + '%';
  $('m-occupancy-sub').textContent = occ ? `${basis} ${fmt(occ.used)} / ${fmt(occ.capacity)}` : '未记录窗口上限';
  $('window-metric').title = occ ? `${basis} ${exact(occ.used)} / 同次请求窗口上限 ${exact(occ.capacity)} Token` : '宿主未记录本次请求的窗口上限';
  $('m-tps').textContent = speed(snap.currentTps);
  const route = snap.currentRoute;
  $('m-tps-sub').textContent = [route?.mode, route?.role, snap.timedRequests ? `会话均速 ${speed(snap.averageTps)}` : '暂无计时'].filter(Boolean).join(' · ');
  $('speed-metric').title = `${snap.currentResponseModel || route?.label || ''} · ${exact(snap.currentOutput)} 输出 Token / ${speedSeconds(snap.currentStreamSeconds)} 流式生成秒。会话均速按 ${snap.timedRequests} 次请求的流式生成时长加权。`;

  $('m-hit').textContent = snap.cacheHitRate == null ? '—' : `${snap.cacheHitRate}%`;
  $('m-hit-sub').textContent = `读缓 ${fmt(snap.totalCache)}`;

  if (snap.checkpoint) {
    $('m-cp').textContent = snap.checkpoint.turn ? turnName(snap.checkpoint.turn) : `#${snap.checkpoint.step}`;
    $('m-cp-sub').textContent = `#${snap.checkpoint.step} · ${fmt(snap.checkpoint.beforeWindow)} → ${fmt(snap.checkpoint.afterWindow)}`;
  } else {
    $('m-cp').textContent = '未压缩';
    $('m-cp-sub').textContent = `峰值 ${fmt(snap.peakWindow)}`;
  }

  $('m-out').textContent = fmt(snap.totalOut);
  $('m-out-sub').textContent = `${snap.turns} 轮 · ${snap.plannerSteps} 次请求`;
}

const speedSeconds = n => n == null ? '—' : n.toLocaleString('zh-CN', {maximumFractionDigits:3});

function embedUrl(kind, sessionId, bust = false) {
  const qs = new URLSearchParams();
  if (sessionId) qs.set('session', sessionId);
  if (bust) qs.set('t', String(Date.now()));
  return `/${kind}${qs.toString() ? '?' + qs : ''}`;
}

function syncEmbedFrames({ force = false } = {}) {
  const isEmbed = state.tab === 'trace' || state.tab === 'eval';
  $('refresh-embed').classList.toggle('hidden', !isEmbed);
  if (!isEmbed) return;
  const kind = state.tab;
  const sessionId = effectiveSessionId();
  const url = embedUrl(kind, sessionId, force);
  const frame = $('frame-' + kind);
  if (!force && state.frames[kind]?.sessionId === sessionId) return;
  const request = { sessionId };
  state.frames[kind] = request;
  if (window.sidecar?.fetch) {
    frame.removeAttribute('src');
    frame.srcdoc = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;font:13px/1.6 Geist,-apple-system,sans-serif;color:#52627a;background:transparent}</style></head><body>正在读取会话记录…</body></html>';
    window.sidecar.fetch(url, { method: 'GET' })
      .then(res => { if (!res.ok) throw new Error(`${url}: ${res.status}`); return res.text(); })
      .then(html => { if (state.frames[kind] === request) frame.srcdoc = html; })
      .catch(err => {
        if (state.frames[kind] !== request) return;
        frame.srcdoc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;font:13px/1.6 Geist,-apple-system,sans-serif;color:#b42318;background:transparent}</style></head><body>加载失败：${esc(err?.message || err)}</body></html>`;
      });
  } else {
    frame.removeAttribute('srcdoc');
    frame.src = url;
  }
}

function renderAll() {
  if (state.tab === 'trace' || state.tab === 'eval') syncEmbedFrames();
}

const USAGE_PARTS = [
  ['inputTokens', '新增输入', 'var(--u-input)'], ['cacheReadTokens', '缓存读取', 'var(--u-read)'],
  ['cacheWriteTokens', '缓存写入', 'var(--u-write)'], ['outputTokens', '模型输出', 'var(--u-output)'],
];
const exact = n => n == null ? '—' : n.toLocaleString('zh-CN');
const speed = n => n == null ? '—' : n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });

function modelShare(tokens, total) {
  if (tokens == null || !(total > 0)) return '—';
  const percent = tokens / total * 100;
  return percent > 0 && percent < .1 ? '<0.1%' : speed(percent) + '%';
}

function selectHeatCell(chat, family, modeName = '') {
  const cell = modeName ? family.modes.find(m => m.name === modeName) : family;
  if (!cell) return;
  state.heatSelection = { id:chat.id, model:family.name, mode:modeName };
  for (const btn of $('usage-conversations').querySelectorAll('[data-heat-model]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.heatChat === chat.id &&
      btn.dataset.heatModel === family.name && btn.dataset.heatMode === modeName));
  }
  const modes = modeName ? [cell] : family.modes;
  const breakdown = modes.map(m => {
    const label = [m.name,...m.roles].join(' · ');
    const response = m.responseModels.length ? m.responseModels.join(' / ') : '响应模型未记录';
    return `<li><span>${esc(label)}</span><b>${esc(modelShare(m.totalTokens, family.totalTokens))}</b>
      <small>${esc(response)}</small></li>`;
  }).join('');
  $('heat-detail').innerHTML = `<div class="matrix-selection"><strong>${esc(chat.title || '未命名对话')} · ${esc(family.name)}${modeName ? ' · ' + esc(modeName) : ''}</strong>
    <span>${exact(cell.requests)} 次请求</span><span>${exact(cell.totalTokens)} Token</span><span>${speed(cell.tps)} tok/s</span></div>
    <div class="model-breakdown"><span>模型内占比</span><ul>${breakdown}</ul></div>`;
}

function renderModelMatrix(data) {
  const catalogue = new Map();
  for (const chat of data.conversations) {
    for (const family of chat.modelUsage) {
      if (!catalogue.has(family.name)) catalogue.set(family.name, {modes:new Set(), tokens:0});
      const item = catalogue.get(family.name);
      item.tokens += family.totalTokens ?? 0;
      for (const m of family.modes) item.modes.add(m.name);
    }
  }
  const groups = [...catalogue].map(([name, item]) => ({name, tokens:item.tokens,
    modes:data.models.filter(mode => item.modes.has(mode))})).sort((a,b) =>
      Number(a.name === '未记录模型') - Number(b.name === '未记录模型') || b.tokens-a.tokens || a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
  const canSplit = groups.some(g => g.modes.length > 1);
  $('matrix-split-label').hidden = !canSplit;
  const split = canSplit && $('matrix-split').checked;
  const columns = groups.flatMap(g => (split ? g.modes : ['']).map(mode => ({family:g.name,mode})));
  const pages = Math.max(1,Math.ceil(data.conversations.length / 10));
  state.heatPage = Math.min(state.heatPage,pages-1);
  const visible = data.conversations.slice(state.heatPage*10,state.heatPage*10+10);
  $('heat-pages').innerHTML = pages > 1 ? `<button data-page="-1" ${state.heatPage ? '' : 'disabled'}>上一页</button><span>${state.heatPage+1} / ${pages}</span><button data-page="1" ${state.heatPage+1 < pages ? '' : 'disabled'}>下一页</button>` : '';
  const rowSpan = split ? ' rowspan="2"' : '';
  $('usage-columns').innerHTML = `<tr><th scope="col"${rowSpan}>对话</th>` + groups.map(g =>
    `<th class="model-head" ${split ? 'scope="colgroup" colspan="' + g.modes.length + '"' : 'scope="col"'}>${esc(g.name)}</th>`).join('') +
    `<th class="matrix-total" scope="col"${rowSpan}>${data.model ? '所选 Token' : '累计 Token'}</th></tr>` +
    (split ? '<tr class="matrix-modes">' + columns.map(c => `<th scope="col">${esc(c.mode)}</th>`).join('') + '</tr>' : '');
  $('usage-conversations').innerHTML = visible.map(chat => {
    const name = chat.title || '未命名对话';
    const families = new Map(chat.modelUsage.map(f => [f.name, f]));
    const heat = columns.map(({family,mode}) => {
      const model = families.get(family);
      const cell = mode ? model?.modes.find(m => m.name === mode) : model;
      if (!cell) return '<td class="matrix-empty" aria-label="无独立请求">—</td>';
      const share = chat.allModeTokens > 0 ? cell.totalTokens / chat.allModeTokens : 0;
      const percent = esc(modelShare(cell.totalTokens, chat.allModeTokens));
      const level = !share ? 0 : share <= .1 ? 1 : share <= .3 ? 2 : share <= .65 ? 3 : 4;
      const label = esc([family,mode].filter(Boolean).join(' · '));
      return `<td class="matrix-value"><button type="button" class="heat-cell" data-level="${level}" data-heat-chat="${esc(chat.id)}"
        data-heat-model="${esc(family)}" data-heat-mode="${esc(mode)}" aria-controls="heat-detail" aria-pressed="false"
        aria-label="${esc(name)}，${label}，${exact(cell.requests)} 次请求，${exact(cell.totalTokens)} Token，占比 ${percent}"
        title="${label} · ${exact(cell.totalTokens)} Token · ${exact(cell.requests)} 次请求"><span class="mobile-mode">${label}</span>${percent}</button></td>`;
    }).join('');
    return `<tr><th scope="row" class="chat-heading"><button type="button" data-usage-chat="${esc(chat.id)}" title="打开对话 · ${esc(name)}">${esc(name)} <i aria-hidden="true">↗</i></button>
      <small>${exact(chat.requests)} 次请求 · ${speed(chat.tps)} tok/s${chat.children ? ' · 含子会话' : ''}</small></th>${heat}
      <td class="matrix-total"><span class="mobile-token-label">Token </span>${exact(chat.totalTokens)}</td></tr>`;
  }).join('');
  const previous = state.heatSelection;
  const chat = visible.find(c => c.id === previous?.id && c.modelUsage.length) || visible.find(c => c.modelUsage.length);
  if (!chat) { state.heatSelection = null; $('heat-detail').replaceChildren(); return; }
  const largest = rows => rows.reduce((a,b) => (a.totalTokens ?? -1) >= (b.totalTokens ?? -1) ? a : b);
  const family = chat.modelUsage.find(f => f.name === previous?.model) || largest(chat.modelUsage);
  const mode = split ? family.modes.find(m => m.name === previous?.mode) || largest(family.modes) : null;
  selectHeatCell(chat, family, mode?.name);
}

function renderUsage(data) {
  const t = data.totals, chats = data.conversations;
  const select = $('usage-model');
  const project = $('usage-project');
  project.innerHTML = '<option value="">全部项目</option>' + data.projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  project.value = state.usageProject;
  select.innerHTML = '<option value="">全部模式</option>' + data.models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  select.value = data.model;
  state.usageMode = data.model;
  $('usage-scope').textContent = `${$('usage-days').selectedOptions[0].text} · ${exact(chats.length)} 个主对话 · ${exact(t.requests)} 次请求`;
  $('usage-content').classList.toggle('hidden', !chats.length);
  $('u-total').textContent = exact(t.totalTokens);
  $('u-total-note').textContent = t.completeRequests === t.requests && t.requests ? '含缓存读取与写入' : `${exact(t.completeRequests)} / ${exact(t.requests)} 次请求有完整用量`;
  $('u-tps').textContent = speed(t.tps);
  $('u-tps-note').textContent = t.timedRequests ? `${exact(t.timedRequests)} 次有流式计时` : '暂无流式计时样本';
  $('u-first').textContent = t.firstTokenSeconds == null ? '—' : t.firstTokenSeconds.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  $('u-first-note').textContent = t.firstRequests ? `${exact(t.firstRequests)} 次有首 Token 计时` : '暂无首 Token 计时样本';

  const ring = $('usage-ring'), stops = [];
  let start = 0, largest = null;
  $('usage-legend').innerHTML = USAGE_PARTS.map(([key, label, color]) => {
    const value = t[key], share = value == null ? '—' : pct(value, t.totalTokens);
    if (value > 0) {
      const end = start + value / t.totalTokens * 100;
      stops.push(`${color} ${start}% ${end}%`);
      start = end;
      if (!largest || value > largest.value) largest = { label, value, share };
    }
    return `<li><i style="background:${color}"></i><span>${label}</span><b>${exact(value)}</b><small>${share}</small></li>`;
  }).join('');
  ring.style.background = stops.length ? `conic-gradient(${stops.join(',')})` : 'var(--sw-fill)';
  ring.setAttribute('aria-label', 'Token 构成，' + USAGE_PARTS.map(([key, label]) => label + ' ' + exact(t[key])).join('，'));
  $('u-largest-label').textContent = largest?.label || '占比';
  $('u-largest-share').textContent = largest?.share || '—';

  const routes = data.speeds.filter(r => r.timedRequests);
  const max = Math.max(1,...routes.map(r => r.tps));
  $('usage-speeds').innerHTML = routes.map((r,i) => `<tr title="${esc([...r.raw,...r.responseModels].join(' · '))}">
    <td>${routes[i-1]?.mode !== r.mode ? esc(r.mode) : `<span class="sr-mode">${esc(r.mode)}</span>`}</td><th scope="row">${esc(r.label)}</th>
    <td><div class="rate"><span aria-hidden="true"><i style="width:${r.tps / max * 100}%"></i></span><b>${speed(r.tps)}</b></div></td>
    <td>${exact(r.timedRequests)}</td></tr>`).join('') || '<tr><td colspan="4">当前范围暂无流式计时。</td></tr>';
  renderModelMatrix(data);
  const notes = ['输出速度按有计时请求的输出 Token 总和除以流式生成总秒数计算。'];
  if (data.undatedRequests) notes.push(`${data.undatedRequests} 次请求缺少日期，可在「全部时间」查看。`);
  if (data.sharedRequests) notes.push(`已合并 ${exact(data.sharedRequests)} 条具有相同响应 ID 的重复记录。`);
  if (data.transcriptChats) notes.push(`本机有 ${exact(data.transcriptChats)} 个对话使用 transcript，用量以已记录分项为准。`);
  if (data.unavailableChats) notes.push(`有 ${exact(data.unavailableChats)} 个对话暂不可读。`);
  if (data.staleChats) notes.push(`有 ${exact(data.staleChats)} 个对话暂用上次统计。`);
  $('usage-footnote').textContent = notes.join(' ');
}

function usageStatus(message, label, error = false) {
  $('usage-live').classList.toggle('is-error', error);
  $('usage-live-label').textContent = label;
  $('usage-message').textContent = message;
  $('usage-message').classList.toggle('hidden', !message);
}

let chooseStartTab = true;
function switchTab(nextTab) {
  chooseStartTab = false;
  const wasUsage = state.tab === 'usage', isUsage = nextTab === 'usage';
  const isEmbed = nextTab === 'trace' || nextTab === 'eval';
  state.tab = nextTab;
  document.querySelector('.header').classList.toggle('usage-active', isUsage);
  document.querySelector('.header').classList.toggle('embed-active', isEmbed);
  $('app').classList.toggle('is-embed-view', isEmbed);
  for (const btn of document.querySelectorAll('[data-tab]')) {
    const active = btn.dataset.tab === state.tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
  }
  for (const name of ['surface', 'trace', 'eval', 'usage']) {
    $('panel-' + name).classList.toggle('hidden', name !== state.tab);
  }
  state.ccInstance?.setActive(state.tab === 'surface');
  if (wasUsage !== isUsage) poll();
  renderAll();
}

let pollTimer, pollRequest, pollEpoch = 0;
function clearSnapshot(message, sessionChanged = false) {
  state.snap = null; state.etag = ''; state.mountedSession = null;
  if (sessionChanged) state.frames = { trace: null, eval: null };
  state.ccInstance?.destroy(); state.ccInstance = null;
  $('cc-host').textContent = message;
  for (const id of ['m-win','m-hit','m-cp','m-out','m-occupancy','m-tps','m-win-sub','m-hit-sub','m-cp-sub','m-out-sub','m-occupancy-sub','m-tps-sub']) $(id).textContent = '—';
  $('source-note').textContent = '';
  for (const id of ['source-note','m-win','window-metric','speed-metric']) $(id).removeAttribute('title');
}
async function poll() {
  clearTimeout(pollTimer);
  if (document.visibilityState === 'hidden') return;
  pollRequest?.abort();
  const controller = new AbortController(), epoch = ++pollEpoch;
  pollRequest = controller;
  const isUsage = state.tab === 'usage';
  const timeout = setTimeout(() => controller.abort(), isUsage ? 60000 : 12000);
  try {
    if (isUsage) {
      const qs = new URLSearchParams({group:'mode',project:state.usageProject,days:state.usageDays, mode: state.usageMode, etag: state.usage?.etag || '' });
      const result = await getJson('/api/usage?' + qs, controller.signal);
      if (epoch !== pollEpoch) return;
      if (!result.unchanged) { state.usage = result; renderUsage(result); }
      usageStatus(state.usage.conversations.length ? '' : '当前筛选范围没有请求记录。可调整项目、模式或时间。', '已同步');
      return;
    }
    const conv = state.selectedConv || window.sidecar?.conversationId || '';
    const qs = new URLSearchParams({ conversationId: conv, list:'all' });
    if (state.etag) qs.set('etag', state.etag);
    const res = await getJson('/api/context?' + qs, controller.signal);
    if (epoch !== pollEpoch) return;
    if (res.empty) {
      clearSnapshot('当前会话暂无请求记录，请选择要查看的会话。', Boolean(state.snap));
      $('conv-select').innerHTML = '<option value="">当前对话</option>' + (res.conversations || []).map(c => '<option value="' + esc(c.id) + '">' + esc(c.title || '未命名对话') + '</option>').join('');
      $('live-label').textContent = '暂无记录';
      if (chooseStartTab && !conv) switchTab('usage');
      renderAll();
    } else {
      if (!res.unchanged) {
        state.etag = res.etag; state.snap = res;
      }
      if (state.snap) {
        renderHeader(state.snap, res.conversations);
        if (!res.unchanged) { renderAll(); ensureNativeTreemapMounted(); state.ccInstance?.refresh(0); }
      }
    }
    chooseStartTab = false;
  } catch (error) {
    if (epoch !== pollEpoch) return;
    if (isUsage) {
      usageStatus(state.usage ? '更新失败，显示上次统计。' : '暂时无法读取用量，正在重试。', '读取失败', true);
      return;
    }
    $('live-pill').classList.add('is-error');
    $('live-label').textContent = state.snap ? '同步失败 · 保留上次读数' : '读取失败 · 正在重试';
    if (!state.snap) $('cc-host').textContent = '暂时无法读取请求记录。';
  } finally {
    clearTimeout(timeout);
    if (epoch === pollEpoch && document.visibilityState !== 'hidden') pollTimer = setTimeout(poll, isUsage ? USAGE_POLL_MS : POLL_MS);
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
  if (e.target.closest('#refresh-embed')) {
    syncEmbedFrames({ force: true });
    return;
  }
  const pager = e.target.closest('[data-page]');
  if (pager && state.usage) { state.heatPage += Number(pager.dataset.page); renderModelMatrix(state.usage); return; }
  const heat = e.target.closest('[data-heat-model]');
  if (heat && state.usage) {
    const chat = state.usage.conversations.find(c => c.id === heat.dataset.heatChat);
    const family = chat?.modelUsage.find(m => m.name === heat.dataset.heatModel);
    if (family) selectHeatCell(chat, family, heat.dataset.heatMode);
    return;
  }
  const usageChat = e.target.closest('[data-usage-chat]');
  if (usageChat) {
    state.selectedConv = usageChat.dataset.usageChat;
    clearSnapshot('读取会话…', true);
    switchTab('trace');
    $('tab-trace').focus();
    return;
  }
});

$('conv-select').addEventListener('change', (e) => {
  chooseStartTab = false;
  state.selectedConv = e.target.value;
  ++pollEpoch; pollRequest?.abort(); clearTimeout(pollTimer);
  clearSnapshot('读取会话…', true);
  if (state.tab === 'trace' || state.tab === 'eval') syncEmbedFrames({ force: true });
  poll();
});

$('matrix-split').addEventListener('change', () => {
  if (state.usage) renderModelMatrix(state.usage);
});

for (const id of ['usage-model','usage-project','usage-days']) $(id).addEventListener('change', () => {
  state.usageMode = id === 'usage-model' ? $('usage-model').value : '';
  state.usageProject = $('usage-project').value;
  state.usageDays = $('usage-days').value;
  state.heatPage = 0;
  state.usage = null;
  $('usage-content').classList.add('hidden');
  $('usage-scope').textContent = $('usage-days').selectedOptions[0].text;
  usageStatus('正在汇总所选范围…', '读取中');
  poll();
});

poll();

})();
