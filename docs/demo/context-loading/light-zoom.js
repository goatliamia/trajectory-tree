// A small camera over a fixed treemap. Text belongs to the same world as its cell.
window.createContextZoom=function(host,{data,layout,selected,onSelect,onView,onInteract,reducedMotion}){
  const canvas=host.querySelector('canvas'),ctx=canvas.getContext('2d');
  const minimap=host.querySelector('.zoom-minimap'),mini=minimap.getContext('2d');
  const initial=host.getBoundingClientRect(),W=1200,H=W*Math.max(260,initial.height)/Math.max(280,initial.width),MAX=40;
  const colors={tools:'#f3f6fc',system:'#f8f5fc',catalog:'#f1f8f5',instructions:'#fcf7ee',runtime:'#f5f7fa',message:'#f5f7fa'};
  const leaves=new Map(data.leaves.map(l=>[l.id,l]));
  const roots=layout([...data.groups].sort((a,b)=>b.tokens-a.tokens).map(g=>({...g,weight:g.tokens})),W,H);
  const rects=[];
  for(const g of roots){
    const pad=Math.min(3,g.w/7,g.h/7);
    for(const leaf of layout(g.items.map(id=>leaves.get(id)).sort((a,b)=>b.tokens-a.tokens).map(l=>({...l,weight:l.tokens})),g.w-2*pad,g.h-2*pad)){
      const gap=Math.min(1.2,leaf.w/5,leaf.h/5);
      rects.push({...leaf,x:g.x+pad+leaf.x+gap,y:g.y+pad+leaf.y+gap,w:leaf.w-2*gap,h:leaf.h-2*gap});
    }
  }
  const byId=new Map(rects.map(r=>[r.id,r])),bodyCache=new Map();
  let width=0,height=0,fit=1,dpr=1,selection=selected,query='',matches=new Set(),hover=null;
  let camera={x:W/2,y:H/2,k:1},target={...camera},raf=0,destroyed=false,drag=null,viewKey='';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const textWidth=(s,font)=>[...s].reduce((sum,ch)=>sum+(ch.codePointAt(0)>255?1:.61)*font,0);
  const screen=(r,c=camera)=>({x:(r.x-c.x)*fit*c.k+width/2,y:(r.y-c.y)*fit*c.k+height/2,w:r.w*fit*c.k,h:r.h*fit*c.k});
  const point=(x,y,c=target)=>({x:c.x+(x-width/2)/(fit*c.k),y:c.y+(y-height/2)/(fit*c.k)});
  function constrain(){
    target.k=clamp(target.k,1,MAX);
    if(target.k<=1.001){target.x=W/2;target.y=H/2;return;}
    target.x=clamp(target.x,0,W);target.y=clamp(target.y,0,H);
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
    if(bodyCache.has(r.id))return bodyCache.get(r.id);
    const pad=Math.min(5,r.w*.08,r.h*.08),top=Math.min(6,r.h*.12),w=r.w-2*pad,h=r.h-top-pad;
    let lo=.12,hi=4.5;
    for(let i=0;i<9;i++){const f=(lo+hi)/2,lines=wrapBody(r.body,f,w);if(lines.length*f*1.5<=h)lo=f;else hi=f;}
    const body={font:lo,lines:wrapBody(r.body,lo,w),pad,top,lineHeight:lo*1.5};bodyCache.set(r.id,body);return body;
  }
  function ellipsis(text,maxWidth,fontSize){
    if(textWidth(text,fontSize)<=maxWidth)return text;
    let out='';for(const ch of text){if(textWidth(out+ch+'…',fontSize)>maxWidth)break;out+=ch;}return out+'…';
  }
  function drawSourceLine(line,x,y,font,schema){
    if(!schema){ctx.fillStyle='#64768d';ctx.fillText(line,x,y);return;}
    const token=/"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b/g;
    let start=0,cursor=x;
    for(const match of line.matchAll(token)){
      const before=line.slice(start,match.index);ctx.fillStyle='#96a0ae';ctx.fillText(before,cursor,y);cursor+=textWidth(before,font);
      ctx.fillStyle=match[0][0]==='"'?/^\s*:/.test(line.slice(match.index+match[0].length))?'#5b7dae':'#718b80':'#a68d70';
      ctx.fillText(match[0],cursor,y);cursor+=textWidth(match[0],font);start=match.index+match[0].length;
    }
    ctx.fillStyle='#96a0ae';ctx.fillText(line.slice(start),cursor,y);
  }
  function draw(){
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle='#fcfdff';ctx.fillRect(0,0,width,height);
    const scale=fit*camera.k;
    for(const g of roots){const b=screen(g);if(b.x>width||b.y>height||b.x+b.w<0||b.y+b.h<0)continue;ctx.strokeStyle='#e5ebf3';ctx.lineWidth=1;ctx.strokeRect(b.x+.5,b.y+.5,b.w-1,b.h-1);}
    for(const r of rects){
      const b=screen(r);if(b.x>width||b.y>height||b.x+b.w<0||b.y+b.h<0||b.w<.6||b.h<.6)continue;
      const dim=!!query&&!matches.has(r.id);ctx.globalAlpha=dim?.17:1;
      ctx.fillStyle=r.id===selection?'#edf3fe':colors[r.kind]||colors.message;ctx.fillRect(b.x,b.y,b.w,b.h);
      ctx.strokeStyle=r.id===selection?'#769bf0':r.id===hover?'#a8bce5':'#e5ebf4';ctx.lineWidth=r.id===selection?1.5:.7;ctx.strokeRect(b.x+.5,b.y+.5,Math.max(0,b.w-1),Math.max(0,b.h-1));
      ctx.save();ctx.beginPath();ctx.rect(b.x+2,b.y+2,Math.max(0,b.w-4),Math.max(0,b.h-4));ctx.clip();
      const body=bodyFor(r),fontPx=body.font*scale;
      if(fontPx>=2.2&&b.w>42&&b.h>42){
        ctx.save();ctx.beginPath();ctx.rect(b.x+3,b.y+Math.min(28,b.h*.3),b.w-6,Math.max(0,b.h-Math.min(28,b.h*.3)-3));ctx.clip();
        ctx.translate(b.x,b.y);ctx.scale(scale,scale);ctx.font=body.font+'px GeistMono,monospace';ctx.textBaseline='top';
        ctx.globalAlpha=(dim?.17:1)*clamp((fontPx-1.5)/5,.15,1);
        const start=Math.max(0,Math.floor((-b.y/scale-body.top)/body.lineHeight));
        const end=Math.min(body.lines.length,Math.ceil(((height-b.y)/scale-body.top)/body.lineHeight)+1);
        for(let i=start;i<end;i++)drawSourceLine(body.lines[i],body.pad,body.top+i*body.lineHeight,body.font,r.basis==='schema-density');
        ctx.restore();
      }
      if(b.w>45&&b.h>25){
        const font=b.w>95?12:10,left=b.x+Math.min(11,b.w*.1),top=b.y+Math.min(12,b.h*.1);
        // Titles keep a readable screen size; the source underneath follows world scale.
        ctx.fillStyle=colors[r.kind]||colors.message;ctx.fillRect(b.x+2,b.y+2,b.w-4,Math.min(24,b.h*.3));
        ctx.globalAlpha=dim?.17:1;ctx.font='500 '+font+'px Geist,sans-serif';ctx.textBaseline='top';ctx.fillStyle='#536780';
        ctx.fillText(ellipsis(r.name,b.w-(left-b.x)*2,font),left,top);
        if(fontPx<3&&b.w>85&&b.h>65){ctx.font='10px GeistMono,monospace';ctx.fillStyle='#98a7ba';ctx.fillText(r.tokens>=1000?(r.tokens/1000).toFixed(1)+'k':String(Number(r.tokens.toFixed(1))),left,top+22);}
      }
      ctx.restore();ctx.globalAlpha=1;
    }
    drawMini();emitView();
  }
  function drawMini(){
    const mw=112,mh=68;mini.clearRect(0,0,mw,mh);mini.fillStyle='#fff';mini.fillRect(0,0,mw,mh);
    for(const g of roots){mini.fillStyle=g.kind==='tools'?'#e9effa':g.kind==='catalog'?'#e7f2ed':g.kind==='system'?'#eee9f7':'#edf0f4';mini.fillRect(g.x/W*mw,g.y/H*mh,g.w/W*mw,g.h/H*mh);}
    const s=fit*camera.k;mini.strokeStyle='#7a9cdd';mini.lineWidth=1;mini.strokeRect((camera.x-width/(2*s))/W*mw,(camera.y-height/(2*s))/H*mh,width/s/W*mw,height/s/H*mh);
    minimap.hidden=camera.k<1.1;
  }
  function emitView(){
    const center=rects.find(r=>camera.x>=r.x&&camera.x<=r.x+r.w&&camera.y>=r.y&&camera.y<=r.y+r.h);
    const parent=roots.find(g=>camera.x>=g.x&&camera.x<=g.x+g.w&&camera.y>=g.y&&camera.y<=g.y+g.h);
    const info={zoom:camera.k,groupId:camera.k>1.4?center?.groupId||parent?.id:null,leafId:null};
    if(center){const r=screen(center);if(camera.k>2&&r.w>width*.46&&r.h>height*.45)info.leafId=center.id;}
    const next=Math.round(camera.k*100)+'|'+info.groupId+'|'+info.leafId;
    if(next!==viewKey){viewKey=next;onView(info);}
  }
  function resize(){
    const b=host.getBoundingClientRect();width=b.width;height=b.height;dpr=Math.min(devicePixelRatio||1,2);fit=Math.min((width-8)/W,(height-8)/H);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.width=width+'px';canvas.style.height=height+'px';requestDraw();
  }
  function zoomAt(factor,x=width/2,y=height/2){
    const anchor=point(x,y,camera);target.k=clamp(target.k*factor,1,MAX);target.x=anchor.x-(x-width/2)/(fit*target.k);target.y=anchor.y-(y-height/2)/(fit*target.k);constrain();requestDraw();
  }
  function focusRect(r){
    target.k=clamp(Math.min((width-52)/r.w,(height-52)/r.h)/fit,1,MAX);target.x=r.x+r.w/2;target.y=r.y+r.h/2;constrain();requestDraw();
  }
  function hit(event){const b=canvas.getBoundingClientRect(),p=point(event.clientX-b.left,event.clientY-b.top,camera);return rects.find(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h);}
  canvas.addEventListener('wheel',event=>{event.preventDefault();onInteract();const b=canvas.getBoundingClientRect(),delta=event.deltaY*(event.deltaMode===1?16:1);zoomAt(Math.exp(-clamp(delta,-500,500)*.002),event.clientX-b.left,event.clientY-b.top);},{passive:false});
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;onInteract();target={...camera};canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);
    drag={x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false};host.classList.add('holding');
  });
  canvas.addEventListener('pointermove',event=>{
    if(drag){const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>4)drag.moved=true;
      if(drag.moved){target.x-=dx/(fit*target.k);target.y-=dy/(fit*target.k);camera={...target};constrain();requestDraw();}drag.x=event.clientX;drag.y=event.clientY;
    }else{const next=hit(event)?.id||null;if(next!==hover){hover=next;requestDraw();}}
  });
  canvas.addEventListener('pointerup',event=>{
    if(!drag)return;const click=!drag.moved;drag=null;host.classList.remove('holding');
    if(click){const r=hit(event);if(r){selection=r.id;onSelect(r.id);requestDraw();}}
  });
  canvas.addEventListener('pointercancel',()=>{drag=null;host.classList.remove('holding');});
  canvas.addEventListener('pointerleave',()=>{hover=null;requestDraw();});
  canvas.addEventListener('dblclick',event=>{
    event.preventDefault();const r=hit(event);if(!r)return;selection=r.id;onSelect(r.id);
    const desired=clamp(Math.min((width-52)/r.w,(height-52)/r.h)/fit,1,MAX);
    if(target.k>=desired*.9){const b=canvas.getBoundingClientRect();zoomAt(1.8,event.clientX-b.left,event.clientY-b.top);}else focusRect(r);
  });
  canvas.addEventListener('keydown',event=>{
    const step=event.shiftKey?110:42;
    if(['+','=','-','_','Escape','0','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();onInteract();}
    else return;
    if(['+','='].includes(event.key))zoomAt(1.45);else if(['-','_'].includes(event.key))zoomAt(1/1.45);
    else if(['Escape','0'].includes(event.key)){target={x:W/2,y:H/2,k:1};requestDraw();}
    else if(event.key==='Enter'){const r=byId.get(selection);if(r)focusRect(r);}
    else{target.x+=({'ArrowLeft':-step,'ArrowRight':step}[event.key]||0)/(fit*target.k);target.y+=({'ArrowUp':-step,'ArrowDown':step}[event.key]||0)/(fit*target.k);constrain();requestDraw();}
  });
  minimap.addEventListener('pointerdown',event=>{event.preventDefault();onInteract();const b=minimap.getBoundingClientRect();target.x=(event.clientX-b.left)/b.width*W;target.y=(event.clientY-b.top)/b.height*H;constrain();requestDraw();});
  const observer=new ResizeObserver(resize);observer.observe(host);document.fonts.ready.then(requestDraw);resize();
  return {
    select(id){selection=id;canvas.setAttribute('aria-label','上下文地图，已选 '+(leaves.get(id)?.name||'内容')+'。滚轮缩放，拖动平移，双击聚焦；键盘加减缩放，方向键平移，Escape 查看全图。');requestDraw();},
    focusLeaf(id){const r=byId.get(id);if(r)focusRect(r);},
    focusGroup(id){const r=roots.find(g=>g.id===id);if(r)focusRect(r);},
    fitAll(){target={x:W/2,y:H/2,k:1};requestDraw();},
    zoom(factor){zoomAt(factor);},
    search(value,ids){query=value;matches=new Set(ids);requestDraw();},
    destroy(){destroyed=true;observer.disconnect();cancelAnimationFrame(raf);}
  };
};
