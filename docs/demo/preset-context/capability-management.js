import {apiFetch} from './workspace-api.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const switchHtml=(enabled,name,disabled=false)=>`<button type="button" class="capability-switch" role="switch" aria-checked="${enabled}" aria-label="${esc(name)}" data-capability-toggle ${disabled?'disabled':''}><span></span></button>`;
export function managementButton(kind,name,options={}){
  const enabled=options.enabled!==false;
  return `<section class="capability-control" data-capability-kind="${esc(kind)}" data-capability-name="${esc(name)}" ${options.preset?`data-capability-preset="${esc(options.preset)}"`:''}>
    <div class="capability-control-line"><div><strong>${kind==='tool'?'工具配置':'插件配置'}</strong><span class="capability-config-state">${enabled?'已启用':'已停用'}</span></div>${switchHtml(enabled,'启用 '+name)}</div><div class="capability-inline" hidden></div></section>`;
}
export function skillPresetControls(skill,data){
  if(!data?.presets)return '';
  return `<section class="skill-preset-controls"><div class="skill-preset-heading"><h3>预设中的可用状态</h3><span>按预设独立设置</span></div>
    <div class="skill-preset-rows">${data.presets.map(p=>{
      const row=[...p.skills,...p.disabledSkills??[]].find(s=>s.name===skill.name),enabled=Boolean(row&&!row.policyDisabled&&(row.invocation?.modelInvocable!==false||row.invocation?.userInvocable!==false)),count=row?.usage?.count??0;
      return `<div class="skill-preset-row capability-control" data-capability-kind="skill" data-capability-name="${esc(skill.name)}" data-capability-preset="${esc(p.id)}">
        <div class="capability-control-line"><div class="skill-preset-identity"><strong>${esc(p.name)}</strong><span>${row?count+' 次读取':p.skillsEnabled===false?'未加载 Skill 目录':'未提供这个 Skill'}</span></div><div class="skill-preset-state"><span class="capability-config-state">${row?enabled?'已启用':'已停用':'未提供'}</span>${switchHtml(enabled,p.name+' 中启用 '+skill.name,!row)}</div></div><div class="capability-inline" hidden></div></div>`;
    }).join('')}</div></section>`;
}

export function installCapabilityManagement({current,getData,onSaved,openSkill}){
  const dialog=document.createElement('dialog');dialog.id='capability-dialog';dialog.setAttribute('aria-label','加载项管理');document.body.append(dialog);
  let csrf,catalog,kind='tool',preset=null,filter='all',query='',catalogSequence=0;
  const labels={tool:'工具',bundle:'插件',skill:'Skill'},plans=new WeakMap(),pending=new WeakSet();
  async function request(path,body){
    const response=await apiFetch('/api/management/'+path,{method:body?'POST':'GET',cache:'no-store',headers:body?{'content-type':'application/json','x-trajectory-token':csrf}:{},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();if(!response.ok)throw Error(data.error??'操作未完成');if(!body&&data.token)csrf=data.token;return data;
  }
  async function load(){const sequence=++catalogSequence,next=await request('inventory?preset='+encodeURIComponent(preset));if(sequence===catalogSequence){catalog=next;render();}}
  function render(){
    const rows=catalog.targets.filter(t=>t.kind===kind&&(filter!=='disabled'||!t.enabled)&&(!query||[t.name,t.source].join(' ').toLowerCase().includes(query.toLowerCase())));
    dialog.innerHTML=`<div class="drawer-top"><span>Eval / 加载项管理</span><button data-management="close" aria-label="关闭加载项管理">×</button></div><div class="capability-drawer-body">
      <header class="capability-drawer-title"><h2>加载项管理</h2><select id="capability-preset" aria-label="管理哪个预设">${getData().presets.map(p=>`<option value="${esc(p.id)}" ${p.id===preset?'selected':''}>${esc(p.name)}</option>`).join('')}</select></header>
      <div class="capability-controls"><nav aria-label="管理类型">${Object.entries(labels).map(([id,label])=>`<button data-management="kind" data-kind="${id}" aria-pressed="${kind===id}">${label}</button>`).join('')}</nav><label><input type="checkbox" id="capability-disabled" ${filter==='disabled'?'checked':''}>已停用</label></div>
      <input id="capability-query" type="search" placeholder="查找${labels[kind]}" aria-label="查找加载项" value="${esc(query)}">
      <div class="capability-rows">${rows.map(t=>`<article class="capability-control" data-capability-kind="${t.kind}" data-capability-name="${esc(t.kind==='bundle'?t.source:t.name)}" data-capability-preset="${esc(preset)}">
        <div class="capability-control-line"><div class="capability-name"><div>${t.kind==='skill'?`<button class="capability-skill-open" data-open-managed-skill="${esc(t.name)}">${esc(t.name)} ↗</button>`:`<strong>${esc(t.name)}</strong>`}<span class="origin-badge ${esc(t.origin)}">${{official:'DSH 官方',plugin:'用户插件',personal:'我的内容',unknown:'来源待确认'}[t.origin]??'来源待确认'}</span></div><small>${esc(t.scope)}</small>${t.reason?`<small class="capability-reason">${esc(t.reason)}</small>`:''}</div><div class="skill-preset-state"><span class="capability-config-state">${t.enabled?'已启用':'已停用'}</span>${switchHtml(t.enabled,'启用 '+t.name,Boolean(t.reason))}</div></div><div class="capability-inline" hidden></div></article>`).join('')||'<p class="capability-empty">没有符合条件的加载项。</p>'}</div></div>`;
  }
  async function open(nextKind='tool'){
    kind=nextKind;preset=current().id;filter='all';query='';dialog.innerHTML='<div class="drawer-top"><span>加载项管理</span><button data-management="close">×</button></div><p class="capability-empty">读取当前配置…</p>';if(!dialog.open)dialog.showModal();
    try{await load();}catch(error){dialog.insertAdjacentHTML('beforeend',`<p class="capability-error" role="alert">${esc(error.message)}</p>`);}
  }
  function updateState(block,enabled){const button=block.querySelector('[data-capability-toggle]');button.setAttribute('aria-checked',String(enabled));block.querySelector('.capability-config-state').textContent=enabled?'已启用':'已停用';}
  async function preview(block){
    if(pending.has(block))return;pending.add(block);
    const button=block.querySelector('[data-capability-toggle]'),panel=block.querySelector('.capability-inline'),wanted=button.getAttribute('aria-checked')!=='true';
    const targetPreset=block.dataset.capabilityPreset??current().id,type=block.dataset.capabilityKind,name=block.dataset.capabilityName;
    button.disabled=true;panel.hidden=false;panel.innerHTML='<span class="capability-working">核对配置…</span>';
    try{
      let target;
      if(type==='skill')target=(await request('skill-scopes?name='+encodeURIComponent(name))).rows.find(r=>r.preset===targetPreset&&r.available);
      else target=(await request('inventory?preset='+encodeURIComponent(targetPreset))).targets.find(r=>r.kind===type&&(r.name===name||r.source===name));
      if(!target)throw Error('当前配置已变化，请刷新');if(target.reason)throw Error(target.reason);
      if(target.enabled===wanted){updateState(block,wanted);panel.innerHTML='<span>配置状态已更新。</span>';return;}
      const plan=await request('preview',{preset:targetPreset,id:target.id,enabled:wanted});plans.set(block,plan);
      const action=wanted?'启用':'停用',scope=plan.target.scope;
      panel.innerHTML=`<div class="capability-inline-copy"><strong>${esc(scope)} · ${action}${type==='skill'?'此 Skill':type==='tool'?'此工具':'此插件'}</strong>
        <p>${type==='skill'?'新会话生效，其他预设不变。':plan.target.affected.length>1?'将一同'+action+' '+esc(plan.target.affected.slice(0,6).join('、'))+(plan.target.affected.length>6?' 等能力。':'。'):'作用于'+esc(scope)+'。'}</p>
        ${type==='tool'||type==='bundle'?'<p class="capability-cache-note">工具声明变化会影响已有会话的缓存复用，建议相关对话不再使用时停用。</p>':''}</div><div class="capability-inline-actions"><button class="tt-button" data-capability-cancel>取消</button><button class="tt-button capability-primary" data-capability-commit>确认${action}</button></div>`;
    }catch(error){panel.innerHTML=`<p class="capability-error" role="alert">${esc(error.message)}</p>`;}
    finally{pending.delete(block);button.disabled=false;}
  }
  async function commit(block){
    const plan=plans.get(block);if(!plan||pending.has(block))return;pending.add(block);plans.delete(block);
    const panel=block.querySelector('.capability-inline');block.querySelectorAll('button').forEach(b=>b.disabled=true);
    panel.innerHTML='<span class="capability-working">保存中…</span>';
    try{
      const result=await request('commit',{token:plan.token});if(!result.configurationVerified)throw Error('配置核对未通过，请刷新查看');
      updateState(block,plan.enabled);
      panel.innerHTML=`<span class="capability-saved">${result.runtime==='applied'?'配置已应用':result.runtime==='restart-required'?'已保存 · 重启 DSH 后生效':'已保存 · 等待核对运行状态'}${plan.target.kind==='skill'&&result.runtime==='applied'?' · 新会话采用更新后的预设':''}</span>${result.recordWarning?'<p class="capability-error">'+esc(result.recordWarning)+'</p>':''}`;
      try{await onSaved();}catch{panel.insertAdjacentHTML('beforeend','<span>统计暂未刷新</span>');}
    }catch(error){panel.innerHTML=`<p class="capability-error" role="alert">${esc(error.message)}</p>`;}
    finally{pending.delete(block);block.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  document.addEventListener('click',event=>{
    const toggle=event.target.closest('[data-capability-toggle]'),cancel=event.target.closest('[data-capability-cancel]'),save=event.target.closest('[data-capability-commit]');
    if(toggle){event.preventDefault();preview(toggle.closest('.capability-control'));return;}
    if(cancel){const block=cancel.closest('.capability-control');plans.delete(block);block.querySelector('.capability-inline').hidden=true;return;}
    if(save){commit(save.closest('.capability-control'));return;}
    const entry=event.target.closest('[data-manage-kind]');if(entry){event.preventDefault();open(entry.dataset.manageKind);return;}
    const skill=event.target.closest('[data-open-managed-skill]');if(skill){dialog.close();openSkill?.(skill.dataset.openManagedSkill);}
  });
  dialog.addEventListener('click',event=>{const b=event.target.closest('[data-management]');if(!b)return;if(b.dataset.management==='close')dialog.close();if(b.dataset.management==='kind'){kind=b.dataset.kind;query='';render();}});
  dialog.addEventListener('change',async event=>{if(event.target.id==='capability-disabled'){filter=event.target.checked?'disabled':'all';render();}if(event.target.id==='capability-preset'){preset=event.target.value;await load();}});
  dialog.addEventListener('input',event=>{if(event.target.id==='capability-query'){query=event.target.value;const pos=event.target.selectionStart;render();const input=dialog.querySelector('#capability-query');input.focus();input.setSelectionRange(pos,pos);}});
  return {open};
}
