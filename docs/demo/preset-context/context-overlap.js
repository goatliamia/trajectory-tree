import {apiFetch,wireDraftActions} from './workspace-api.js';
import {escapeHtml as e,contextKinds as kinds,itemName,coverageView,renderOverlapPair,renderOverlapPage} from './context-overlap-view.js';
const n=value=>Number(value||0).toLocaleString('zh-CN');

export function installContextOverlap(container){
  let data,preset,controller,revision=0,scopeOpen=false,filterOpen=false,filter={kind:'all',phase:'all',query:''};
  const dialog=document.createElement('dialog');dialog.className='co-dialog';dialog.setAttribute('aria-labelledby','co-detail-title');
  dialog.innerHTML='<header><div><span>加载项 · 文本对照</span><h2 id="co-detail-title"></h2></div><button type="button" data-co-close aria-label="关闭对照">×</button></header><div class="co-dialog-body"></div>';
  document.body.append(dialog);const body=dialog.querySelector('.co-dialog-body');
  dialog.querySelector('[data-co-close]').onclick=()=>dialog.close();
  const get=id=>data.items.find(i=>i.id===id);
  function open(title,html){dialog.querySelector('h2').textContent=title;body.innerHTML=html;if(!dialog.open)dialog.showModal();body.scrollTop=0;}
  function snippet(item,range){
    const start=Math.max(0,item.text.lastIndexOf('\n',Math.max(0,range.start-110))+1),next=item.text.indexOf('\n',range.end+110),end=next<0?item.text.length:next;
    return `<pre>${start?'…\n':''}${e(item.text.slice(start,range.start))}<mark>${e(item.text.slice(range.start,range.end))}</mark>${e(item.text.slice(range.end,end))}${end<item.text.length?'\n…':''}</pre>`;
  }
  function evidence(left,right,pair){
    const skipped=!pair&&['skills','catalog'].includes(left.kind)&&['skills','catalog'].includes(right.kind)&&left.origin==='official'&&right.origin==='official';
    return `<div class="co-evidence-headings">${coverageView(left,pair?.leftCoverage??(skipped?null:0),'A',{path:true})}${coverageView(right,pair?.rightCoverage??(skipped?null:0),'B',{path:true})}</div>
      <div class="co-comparison-metrics"><span><strong>${pair?n(pair.characters):skipped?'—':'0'}</strong> 字符相同</span>${pair?`<span>${pair.matches.length} 处片段</span>`:''}${pair?.reference?'<span>正文含引用</span>':''}</div>
      ${pair?pair.matches.map((match,index)=>`<section class="co-match"><header><strong>相同片段 ${index+1}</strong><span>${n(match.characters)} 字符</span></header><div class="co-evidence-columns">${[[left,match.left],[right,match.right]].map(([item,range])=>`<div><small>文本 L${range.line}${range.endLine!==range.line?'–'+range.endLine:''}</small>${snippet(item,range)}</div>`).join('')}</div></section>`).join(''):`<p class="co-empty">${skipped?'官方 Skill 之间未进行自动比对。':'未检出 64 字符以上的连续相同片段。'}</p>`}
      <details class="co-full-text" ${pair?'':'open'}><summary>查看完整文本</summary><div class="co-evidence-columns">${[left,right].map(i=>`<section><h4>${e(itemName(i))}</h4><pre>${e(i.text)}</pre></section>`).join('')}</div></details><button type="button" class="tt-button" data-co-diagnose="${e(JSON.stringify([left.id,right.id]))}">诊断这两项</button>`;
  }
  function prepare(ids=null){
    open('上下文诊断',`<p class="co-empty">${ids?ids.length+' 项所选内容':'当前预设的全部加载项'} · ${e(preset)}</p><label class="co-review-label">关注的问题<textarea id="co-question" rows="3" placeholder="例如：哪些约束重复出现，哪些能力缺少清晰的使用入口？"></textarea></label><label class="co-review-label">诊断方向<select id="co-direction"><option>综合分析供给与职责</option><option>核对重复与冲突</option><option>核对能力缺口</option><option>整理可复用方法</option></select></label><button type="button" class="tt-button" id="co-prepare">准备诊断草稿</button><span id="co-prepare-status" role="status"></span>`);
    body.querySelector('#co-prepare').onclick=async()=>{
      const button=body.querySelector('#co-prepare'),status=body.querySelector('#co-prepare-status'),question=body.querySelector('#co-question').value.trim(),direction=body.querySelector('#co-direction').value;
      button.disabled=true;
      try{
        const response=await apiFetch('/api/diagnosis-context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({preset,itemIds:ids})});
        if(!response.ok)throw Error('选区无法保存，请刷新后重试');const selected=await response.json();
        const pct=v=>v==null?'—':Math.round(v*100)+'%';
        const pairs=(selected.pairSummaries??[]).flatMap(p=>[
          `- 重合对：${p.left.name}（${p.left.phase}，覆盖 ${pct(p.left.coverage)}） ↔ ${p.right.name}（${p.right.phase}，覆盖 ${pct(p.right.coverage)}） · ${n(p.characters)} 字符相同${p.reference?' · 含显式引用':''}`,
          ...p.matches.map(m=>`  片段 ${m.leftLines} ↔ ${m.rightLines}（${n(m.characters)} 字符）："${m.excerpt}${m.characters>140?'…':''}"`),
        ]);
        const draft=[`使用 context-profile 分析 ${preset} 预设的当前上下文供给。`,
          `关注方向：${direction}。`,...(question?[`用户问题：${question}`]:[]),
          `工作目录：${selected.workspace?.path??data.workspace?.path??''}`,
          `配置采集时间：${new Date(selected.capturedAt).toISOString()}；所选 ${selected.count} 项，检出 ${selected.pairs} 组相同文本。`,
          '所选加载项：',
          ...selected.items.slice(0,8).map(i=>`- ${i.name} · ${i.field??i.kind} · ${i.phase}${i.tokens!=null?` · ≈${n(i.tokens)} tokens`:''} · ${i.path??i.package??''}`),
          ...(selected.count>8?[`其余 ${selected.count-8} 项见下方选区快照。`]:[]),
          ...(pairs.length?['检出的相同文本明细：',...pairs,...(selected.pairs>pairs.length?['其余重合对见下方选区快照。']:[])]:[]),
          `选区快照（需读取动态片段或未展开项全文时使用）：${selected.path}`,
          '按 context-profile 收口到明确出口：常驻重复合并留一处（指明保留与删除的文件及行号），常驻与按需 Skill 重复则常驻只留触发索引、步骤下沉到 Skill；涉及宿主官方工具或插件时，先阐述其核心职责与低频兜底用途，明确用户需求后给出预设级关闭或保留意见（严禁修改官方工具语义）。'].join('\n');
        open('诊断草稿',`<textarea class="analysis-draft" aria-label="诊断草稿">${e(draft)}</textarea>`);wireDraftActions(body);
      }catch(error){status.textContent=error.message;button.disabled=false;}
    };
  }
  body.addEventListener('click',event=>{const button=event.target.closest('[data-co-diagnose]');if(button)prepare(JSON.parse(button.dataset.coDiagnose));});
  function pairOpen(id){const pair=data.pairs.find(p=>p.id===id);if(pair)open('原文对照',evidence(get(pair.left),get(pair.right),pair));}
  function choose(){
    const options=data.items.map(i=>`<option value="${i.id}">${e(kinds[i.kind]+' · '+itemName(i))}</option>`).join('');
    open('选择内容对照',`<div class="co-choose"><label>内容 A<select data-co-select="left">${options}</select></label><label>内容 B<select data-co-select="right">${options}</select></label></div><div id="co-manual-result"></div>`);
    const left=body.querySelector('[data-co-select=left]'),right=body.querySelector('[data-co-select=right]');right.selectedIndex=Math.min(1,data.items.length-1);
    const update=()=>{const target=body.querySelector('#co-manual-result');if(left.value===right.value){target.innerHTML='<p class="co-empty">请选择两项不同内容。</p>';return;}
      const pair=data.pairs.find(p=>p.left===left.value&&p.right===right.value||p.left===right.value&&p.right===left.value);
      const ordered=pair&&pair.left!==left.value?{...pair,left:pair.right,right:pair.left,leftCoverage:pair.rightCoverage,rightCoverage:pair.leftCoverage,matches:pair.matches.map(m=>({...m,left:m.right,right:m.left}))}:pair;
      target.innerHTML=evidence(get(left.value),get(right.value),ordered);
    };left.onchange=right.onchange=update;update();
  }
  function method(){open('计算口径',`<div class="co-method"><p>比较当前预设中的系统片段、项目指令、工具说明、Skill 描述与正文、插件注入片段。每个原生文本字段只登记一次。</p><p>只合并连续空白，保留大小写、标点、数字和否定词。用文本指纹定位后，逐字符核对并延伸相同片段；当前最小长度为 <b>64 字符</b>。</p><p>覆盖比例＝本项中相同片段的字符并集 ÷ 本项字符数。多个对象命中同一段时不叠加计数。全文一致指忽略空白后的文本相同。</p><p>“涉及相同文本”包含对照两侧的文本量，不代表可节省 token。目录、正文与动态片段的加载位置分别显示；当前快照未连接请求级共现。</p><p>官方 Skill 之间不进行自动比较；明确引用会显示为关系，不排除其余相同正文。这里没有语义相似度、风险等级或处理建议。</p><dl><div><dt>文本项</dt><dd>${n(data.items.length)}</dd></div><div><dt>静态片段</dt><dd>${n(data.coverage.partial)}</dd></div>${data.method.limitedItems.length?`<div><dt>触发重复指纹预算</dt><dd>${n(data.method.limitedItems.length)} 项</dd></div>`:''}<div><dt>跳过的截断 / 未带入指令</dt><dd>${n(data.coverage.omittedInstructions)}</dd></div></dl><small>${e(data.method.id)} · 本地计算 · 无模型调用</small></div>`);}
  function renderPairs(){
    const list=data.pairs.filter(p=>{const items=[get(p.left),get(p.right)];return(filter.kind==='all'||items.some(i=>i.kind===filter.kind))&&(filter.phase==='all'||items.some(i=>i.phase===filter.phase))&&(!filter.query||items.some(i=>(itemName(i)+' '+i.package+' '+i.path).toLowerCase().includes(filter.query.toLowerCase())));});
    container.querySelector('.co-result-count').textContent=list.length+' 组';
    container.querySelector('.co-pairs').innerHTML=list.map(pair=>renderOverlapPair(pair,get(pair.left),get(pair.right))).join('')||'<div class="co-empty">当前范围未检出连续相同片段。</div>';
  }
  function paint(){
    container.innerHTML=renderOverlapPage(data,{scopeOpen,filterOpen,filter});
    renderPairs();
  }
  container.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.co&&button.dataset.co!=='clear-filters')container.querySelectorAll('.co-actions-menu[open]').forEach(menu=>menu.open=false);if(button.dataset.co==='retry'){render(preset);return;}if(!data)return;
    if(button.dataset.coPair)pairOpen(button.dataset.coPair);
    if(button.dataset.co==='method')method();if(button.dataset.co==='choose')choose();if(button.dataset.co==='retry')render(preset);if(button.dataset.co==='diagnose')prepare();
    if(button.dataset.co==='clear-filters'){filter={kind:'all',phase:'all',query:''};filterOpen=false;paint();}
    if(button.dataset.coKind){filter.kind=filter.kind===button.dataset.coKind?'all':button.dataset.coKind;filterOpen=false;paint();}
  });
  container.addEventListener('change',event=>{if(event.target.dataset.coFilter){filter[event.target.dataset.coFilter]=event.target.value;container.querySelectorAll('[data-co-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.coKind===filter.kind)));const active=filter.kind!=='all'||filter.phase!=='all';container.querySelector('.co-filter-menu>summary').firstChild.textContent=active?'筛选 · 已应用':'筛选';renderPairs();}});
  container.addEventListener('input',event=>{if(event.target.hasAttribute('data-co-query')){filter.query=event.target.value;renderPairs();}});
  document.addEventListener('pointerdown',event=>{for(const menu of container.querySelectorAll('.co-filter-menu[open],.co-actions-menu[open]'))if(!menu.contains(event.target))menu.open=false;});
  container.addEventListener('keydown',event=>{if(event.key==='Escape'){const menu=event.target.closest('.co-filter-menu[open],.co-actions-menu[open]');if(menu){menu.open=false;menu.querySelector('summary').focus({preventScroll:true});event.preventDefault();}}});
  container.addEventListener('toggle',event=>{if(event.target.classList.contains('co-distribution'))scopeOpen=event.target.open;if(event.target.classList.contains('co-filter-menu'))filterOpen=event.target.open;},true);
  async function render(nextPreset){
    if(preset!==nextPreset)filter={kind:'all',phase:'all',query:''};preset=nextPreset;controller?.abort();controller=new AbortController();const own=++revision;
    container.innerHTML='<p class="co-empty">正在读取当前加载项…</p>';
    try{const response=await apiFetch('/api/context-overlap?'+new URLSearchParams({preset}),{signal:controller.signal});if(!response.ok)throw Error('snapshot');const result=await response.json();if(own!==revision)return;data=result;paint();}
    catch(error){if(error.name!=='AbortError'&&own===revision)container.innerHTML='<p class="co-empty">当前加载项暂时无法读取。<button class="text-action" data-co="retry">重新读取</button></p>';}
  }
  return {render,cancel(){revision++;controller?.abort();}};
}
