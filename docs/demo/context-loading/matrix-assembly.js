// Direct manipulation of a recorded request. Dragging never edits its contents.
class ContextAssembly {
  constructor({map,svg,groups,total,onSelect,onChange,onTranslate,onStatus}){
    Object.assign(this,{map,svg,groups,total,onSelect,onChange,onTranslate,onStatus});
    this.key='trajectory-context-assembly-positions-v1';this.models={};this.rects=new Map();this.targets=new Map();this.active=false;this.selected='tools';
    let saved={};try{saved=JSON.parse(localStorage.getItem(this.key)||'{}');}catch{}
    for(const group of groups){const old=saved[group.id];this.models[group.id]=old&&typeof old.snapped==='boolean'?old:{snapped:group.id!=='tools',x:.027,y:.07};}
    this.map.addEventListener('pointerdown',event=>this.startDrag(event));
    this.map.addEventListener('pointermove',event=>this.moveDrag(event));
    this.map.addEventListener('pointerup',event=>this.endDrag(event));
    this.map.addEventListener('pointercancel',event=>this.endDrag(event,true));
    this.map.addEventListener('keydown',event=>this.keyMove(event));
  }
  save(){try{localStorage.setItem(this.key,JSON.stringify(this.models));}catch{}}
  clamp(n,a,b){return Math.max(a,Math.min(Math.max(a,b),n));}
  floatingSize(group){
    const sizes={tools:[350,238],system:[212,151],catalog:[214,148],runtime:[188,101],instructions:[192,106],message:[162,92]};
    const [w,h]=sizes[group.kind]||sizes.message;
    return {w:Math.min(w,this.width-32),h};
  }
  layout(width,height){
    this.active=true;this.width=width;this.height=height;
    const bw=Math.min(width-38,Math.max(285,width*.68)),bh=Math.min(350,height*.55),bx=width-bw-20,by=height-bh-24;
    this.board={x:bx,y:by,w:bw,h:bh};
    const messages=this.groups.filter(g=>g.id!=='tools'),sum=messages.reduce((s,g)=>s+g.tokens,0),gap=9,mw=(bw-gap)*sum/this.total;
    const targets=[...tileLayout(messages.map(g=>({...g,weight:g.tokens})),mw,bh).map(r=>({...r,x:r.x+bx,y:r.y+by})),{...this.groups.find(g=>g.id==='tools'),x:bx+mw+gap,y:by,w:bw-mw-gap,h:bh}];
    this.targets=new Map(targets.map(r=>[r.id,r]));this.rects=new Map();
    for(const target of targets){
      const group=this.groups.find(g=>g.id===target.id),model=this.models[group.id],size=this.floatingSize(group);
      const rect=model.snapped?{...target,snapped:true}:{...target,...size,x:this.clamp((model.x??.03)*width,14,width-size.w-14),y:this.clamp((model.y??.07)*height,33,height-size.h-14),snapped:false};
      this.rects.set(group.id,rect);
    }
    return [...this.rects.values()];
  }
  shape(w,h){
    const c=Math.min(10,w*.13,h*.13),p=Math.min(6,w*.07,h*.08),cy=h*.54;
    return `M ${c} 0 H ${w-c} L ${w} ${c} V ${cy-p} H ${w-p} V ${cy+p} H ${w} V ${h-c} L ${w-c} ${h} H ${c} L 0 ${h-c} V ${cy+p} H ${p} V ${cy-p} H 0 V ${c} Z`;
  }
  decorate(){
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    for(const region of this.map.querySelectorAll('.region')){
      const id=region.dataset.group,r=this.rects.get(id),g=this.groups.find(g=>g.id===id);
      region.classList.add('piece',r.snapped?'is-snapped':'is-detached');
      if(r.w<110||r.h<64)region.classList.add('is-small-piece');
      region.querySelector('.region-caption')?.remove();
      const face=document.createElement('div');face.className='piece-face';
      while(region.firstChild)face.append(region.firstChild);
      const outline=this.shape(r.w,r.h);face.style.clipPath='path("'+outline+'")';region.append(face);
      region.insertAdjacentHTML('beforeend','<svg class="piece-shell" viewBox="0 0 '+r.w+' '+r.h+'" aria-hidden="true"><path class="piece-outline" d="'+outline+'"/><path class="piece-fold" d="M 8 5 H '+Math.max(8,r.w-17)+' l 9 9 M 4 14 V '+Math.max(14,r.h-11)+' l 7 7"/><path class="piece-terminal" d="M '+(r.w-4)+' '+(r.h*.54-3)+' h 7 v 6 h -7"/></svg><button type="button" class="piece-handle" data-piece="'+id+'" data-action="piece-select" data-group="'+id+'" aria-label="拖动'+esc(g.name)+'模块；Enter 归位"><i aria-hidden="true"></i><b>'+g.seq+'</b><strong>'+esc(g.name)+'</strong><small>≈ '+(g.tokens>=1000?(g.tokens/1000).toFixed(1)+'k':g.tokens)+'</small></button>'+(!r.snapped?'<button type="button" class="piece-snap" data-action="snap-piece" data-group="'+id+'" aria-label="拼合'+esc(g.name)+'">归位 ↘</button>':''));
      if(!r.snapped&&g.items.length===1){
        const preview=document.createElement('div');preview.className='piece-preview';preview.textContent=g.body.replace(/\s+/g,' ').slice(0,190);face.append(preview);face.classList.add('single-preview');
      }
      if(r.snapped&&r.w>110&&r.h>64)face.querySelector('.tile')?.classList.add('first-in-region');
    }
    this.draw();
  }
  setSelected(id){this.selected=id;if(this.active)this.draw();}
  port(a,b,from){
    const dx=b.x+b.w/2-a.x-a.w/2,dy=b.y+b.h/2-a.y-a.h/2;
    if(Math.abs(dx)>Math.abs(dy))return from?{x:a.x+(dx>0?a.w:0),y:a.y+a.h*.54,axis:'h'}:{x:b.x+(dx>0?0:b.w),y:b.y+b.h*.54,axis:'h'};
    return from?{x:a.x+a.w/2,y:a.y+(dy>0?a.h:0),axis:'v'}:{x:b.x+b.w/2,y:b.y+(dy>0?0:b.h),axis:'v'};
  }
  route(a,b,shift=0){
    return a.axis==='h'?`M ${a.x} ${a.y} H ${(a.x+b.x)/2+shift} V ${b.y} H ${b.x}`:`M ${a.x} ${a.y} V ${(a.y+b.y)/2+shift} H ${b.x} V ${b.y}`;
  }
  draw(){
    if(!this.active){this.svg.innerHTML='';return;}
    const b=this.board,esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let content='<defs><marker id="assembly-flow-arrow" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M1 1L7 4.5 1 8" fill="none" stroke="#acbda6" stroke-width=".9"/></marker></defs>';
    content+=`<path class="receiver-plate" d="M ${b.x+10} ${b.y-10} H ${b.x+b.w-12} l 12 12 V ${b.y+b.h+5} l -10 10 H ${b.x+9} l -10 -10 V ${b.y+1} Z"/><text class="receiver-label" x="${b.x+6}" y="${b.y-26}">本次请求</text><text class="receiver-meta" x="${b.x+b.w-6}" y="${b.y-26}" text-anchor="end">messages[] + tools[]</text>`;
    for(const g of this.groups){
      const t=this.targets.get(g.id),r=this.rects.get(g.id);if(r.snapped)continue;
      const ready=this.drag?.id===g.id&&this.drag.near;
      content+=`<g transform="translate(${t.x} ${t.y})" class="piece-socket${g.id===this.selected?' is-selected':''}${ready?' is-ready':''}"><path d="${this.shape(t.w,t.h)}"/>`;
      if(t.w>100&&t.h>60)content+=`<text class="socket-field" x="${t.w/2}" y="${t.h/2-4}" text-anchor="middle">${esc(g.field)}</text><text class="socket-note" x="${t.w/2}" y="${t.h/2+18}" text-anchor="middle">${ready?'松手拼合':g.name+' · seq '+g.seq}</text>`;
      content+='</g>';
    }
    for(let i=1;i<this.groups.length;i++){
      const before=this.rects.get(this.groups[i-1].id),after=this.rects.get(this.groups[i].id);
      if(before.snapped&&after.snapped)continue;
      const a=this.port(before,after,true),z=this.port(before,after,false);
      content+=`<path class="record-flow" d="${this.route(a,z,(i%3-1)*6)}" marker-end="url(#assembly-flow-arrow)"/>`;
    }
    const selected=this.rects.get(this.selected),target=this.targets.get(this.selected);
    if(selected&&!selected.snapped&&target){
      const a=this.port(selected,target,true),z=this.port(selected,target,false);
      content+=`<path class="docking-lead" d="${this.route(a,z)}"/><circle class="docking-pin" cx="${a.x}" cy="${a.y}" r="3"/><circle class="docking-pin" cx="${z.x}" cy="${z.y}" r="3"/>`;
    }
    this.svg.setAttribute('viewBox','0 0 '+this.width+' '+this.height);this.svg.innerHTML=content;
    const n=Object.values(this.models).filter(m=>m.snapped).length;
    this.onStatus(this.drag?.near?'松手拼回对应接口':'图中对齐 '+n+' / '+this.groups.length,n===this.groups.length);
  }
  region(id){return [...this.map.querySelectorAll('.region')].find(el=>el.dataset.group===id);}
  startDrag(event){
    if(!this.active||event.button!==0)return;
    const handle=event.target.closest('.piece-handle');if(!handle)return;
    event.preventDefault();const id=handle.dataset.piece;
    this.map.setPointerCapture(event.pointerId);this.onSelect(id);
    const old=this.rects.get(id);
    if(old.snapped){this.models[id]={snapped:false,x:old.x/this.width,y:old.y/this.height};this.onChange();}
    const r=this.rects.get(id);
    this.drag={id,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:r.x,y:r.y,moved:false,near:false};
    this.region(id)?.classList.add('is-dragging');this.map.classList.add('drag-in-progress');
  }
  moveDrag(event){
    const d=this.drag;if(!d||event.pointerId!==d.pointerId)return;
    const r=this.rects.get(d.id),oldX=r.x,oldY=r.y;
    r.x=this.clamp(d.x+event.clientX-d.startX,12,this.width-r.w-12);r.y=this.clamp(d.y+event.clientY-d.startY,33,this.height-r.h-12);
    d.moved ||= Math.abs(event.clientX-d.startX)+Math.abs(event.clientY-d.startY)>4;
    const element=this.region(d.id);element.style.left=r.x+'px';element.style.top=r.y+'px';
    this.models[d.id]={snapped:false,x:r.x/this.width,y:r.y/this.height};
    const target=this.targets.get(d.id),distance=Math.hypot(r.x+r.w/2-target.x-target.w/2,r.y+r.h/2-target.y-target.h/2);
    d.near=distance<Math.max(35,Math.min(target.w,target.h)*.25);
    this.onTranslate(d.id,r.x-oldX,r.y-oldY);this.draw();
  }
  endDrag(event,cancel=false){
    const d=this.drag;if(!d||event.pointerId!==d.pointerId)return;
    if(d.near&&!cancel)this.models[d.id].snapped=true;
    this.ignoreClick=!!d.moved;this.drag=null;this.map.classList.remove('drag-in-progress');
    if(this.map.hasPointerCapture(event.pointerId))this.map.releasePointerCapture(event.pointerId);
    this.save();this.onChange();
    setTimeout(()=>{this.ignoreClick=false;},100);
  }
  snap(id){if(!this.models[id])return;this.models[id].snapped=true;this.save();this.onChange();}
  lift(id){
    const r=this.targets.get(id);if(!r)return;
    this.models[id]={snapped:false,x:Math.max(.025,(r.x-80)/this.width),y:Math.max(.07,(r.y-70)/this.height)};
    this.save();this.onChange();
  }
  scatter(){
    const positions=[[.025,.055],[.025,.345],[.025,.515],[.025,.685],[.3,.055],[.57,.055],[.79,.34],[.4,.575]];
    this.groups.forEach((g,i)=>{this.models[g.id]={snapped:false,x:positions[i][0],y:positions[i][1]};});this.save();this.onChange();
  }
  gather(){for(const model of Object.values(this.models))model.snapped=true;this.save();this.onChange();}
  keyMove(event){
    const handle=event.target.closest('.piece-handle');if(!this.active||!handle)return;
    const id=handle.dataset.piece;
    if(event.key==='Enter'){event.preventDefault();this.snap(id);return;}
    const vectors={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(!vectors[event.key])return;
    event.preventDefault();const [dx,dy]=vectors[event.key];
    const old=this.rects.get(id);this.models[id]={snapped:false,x:(old.x+dx*12)/this.width,y:(old.y+dy*12)/this.height};this.save();this.onChange();
    this.region(id)?.querySelector('.piece-handle')?.focus({preventScroll:true});
  }
}
