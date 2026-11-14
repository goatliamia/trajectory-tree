// Presets are navigation targets, separate from workspace/time filters.
// Keep the active target visible; an anchored search handles an arbitrary list.
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function installPresetNavigation(root,{getPresets,getCurrent,onSelect}){
  root.innerHTML='<nav class="preset-options" aria-label="选择当前预设"></nav><button type="button" class="preset-more" aria-haspopup="dialog" aria-expanded="false" aria-controls="preset-popover"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor"><rect x="2" y="2" width="4" height="4" rx="1"/><rect x="10" y="2" width="4" height="4" rx="1"/><rect x="2" y="10" width="4" height="4" rx="1"/><rect x="10" y="10" width="4" height="4" rx="1"/></svg>全部预设</button><section id="preset-popover" class="preset-popover" role="dialog" aria-label="全部预设" hidden><label class="preset-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="查找预设" aria-label="查找预设" autocomplete="off"></label><div class="preset-results"></div><footer></footer></section>';
  const options=root.querySelector('.preset-options'),trigger=root.querySelector('.preset-more'),popover=root.querySelector('.preset-popover'),search=root.querySelector('input'),results=root.querySelector('.preset-results');
  let queued=false;
  function fit(){
    const buttons=[...options.querySelectorAll('button')],active=buttons.find(b=>b.dataset.preset===getCurrent()),budget=options.clientWidth;
    buttons.forEach(b=>b.hidden=false);const widths=new Map(buttons.map(b=>[b,b.getBoundingClientRect().width+4]));
    let used=active?widths.get(active):0;
    for(const button of buttons){if(button===active)continue;used+=widths.get(button);if(used>budget){button.hidden=true;used-=widths.get(button);}}
  }
  function scheduleFit(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;fit();});}
  function renderResults(){
    const query=search.value.trim().toLocaleLowerCase(),rows=getPresets().filter(row=>[row.id,row.name].some(s=>String(s??'').toLocaleLowerCase().includes(query)));
    results.innerHTML=rows.length?rows.map(row=>`<button type="button" data-preset="${escape(row.id)}" aria-pressed="${row.id===getCurrent()}"><span><strong>${escape(row.name)}</strong>${row.name!==row.id?`<small>${escape(row.id)}</small>`:''}</span>${row.isDefault?'<small class="preset-default">默认</small>':''}<b aria-hidden="true">${row.id===getCurrent()?'✓':''}</b></button>`).join(''):'<p class="preset-empty">没有匹配的预设</p>';
    popover.querySelector('footer').textContent=`${rows.length} / ${getPresets().length} 个预设`;
  }
  function close(focus=false){popover.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus({preventScroll:true});}
  function render(){
    options.innerHTML=getPresets().map(row=>`<button type="button" data-preset="${escape(row.id)}" aria-pressed="${row.id===getCurrent()}" title="${escape(row.name)}${row.isDefault?' · 默认预设':''}">${escape(row.name)}</button>`).join('');
    scheduleFit();if(!popover.hidden)renderResults();
  }
  trigger.onclick=()=>{if(!popover.hidden){close();return;}search.value='';renderResults();popover.hidden=false;trigger.setAttribute('aria-expanded','true');search.focus({preventScroll:true});};
  root.addEventListener('click',event=>{const button=event.target.closest('[data-preset]');if(!button)return;const fromMenu=Boolean(button.closest('.preset-popover'));close();onSelect(button.dataset.preset);fit();if(fromMenu)options.querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});});
  search.oninput=renderResults;
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!popover.hidden){event.preventDefault();event.stopPropagation();close(true);return;}
    if(!popover.hidden&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      if(event.target===search&&['Home','End'].includes(event.key))return;
      event.preventDefault();const rows=[...results.querySelectorAll('button')],index=rows.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?rows.length-1:index<0?0:Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1)));rows[next]?.focus();return;
    }
    if(event.target.closest('.preset-options')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      event.preventDefault();const rows=getPresets(),index=rows.findIndex(p=>p.id===getCurrent()),next=event.key==='Home'?0:event.key==='End'?rows.length-1:(index+(event.key==='ArrowRight'?1:-1)+rows.length)%rows.length;
      if(rows[next]){onSelect(rows[next].id);fit();options.querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});}
    }
  });
  document.addEventListener('pointerdown',event=>{if(!root.contains(event.target))close();});
  root.addEventListener('focusout',event=>{if(event.relatedTarget&&!root.contains(event.relatedTarget))close();});
  new ResizeObserver(scheduleFit).observe(options);
  return {render};
}
