import {apiFetch,wireDraftActions} from './workspace-api.js';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=value=>Number(value||0).toLocaleString('zh-CN');
const compact=value=>value>=1000?(value/1000).toFixed(1)+'k':n(value);
const percent=value=>(value*100).toFixed(value&&value<.01?2:1)+'%';
const origins={official:'DSH 官方',plugin:'用户插件',personal:'个人 / 项目',unknown:'来源未归属'};
const phases={startup:'开场配置','on-demand':'按需加载',dynamic:'动态注入片段','tool-directory':'PTC 工具目录'};
const kinds={system:'系统提示',instructions:'项目指令',tools:'工具说明',catalog:'Skill 目录',skills:'Skill 正文',injections:'插件注入'};
const relation={same:'全文一致',contains:'包含相同文本',fragments:'局部相同'};
const itemName=item=>item.name+(item.field==='body'?'':item.field==='description'?' · 描述':item.field==='whenToUse'?' · 使用条件':' · '+item.field.replace('parameters/',''));
const badges=item=>`<span class="co-origin" data-origin="${e(item.origin)}">${origins[item.origin]||origins.unknown}</span><span>${phases[item.phase]}</span>${item.evidence==='static-fragment'?'<span>静态片段</span>':''}`;
const documentIcon='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3.5h7l4 4v13H6V3.5h1Zm7 0v4h4M9 12h6M9 15.5h6" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
function coverageView(item,coverage,side,{path=false}={}){
  return `<section class="co-document" data-kind="${item.kind}"><div class="co-document-heading"><span class="co-document-icon">${documentIcon}</span><div><div class="co-document-name"><span class="co-document-side">${side}</span><h3>${e(itemName(item))}</h3></div><div class="co-source-tags"><span>${kinds[item.kind]}</span>${badges(item)}</div></div></div><div class="co-document-scale"><div><span>相同文字占全文</span><strong>${coverage==null?'—':percent(coverage)}</strong></div><div class="co-document-track" role="img" aria-label="${e(itemName(item))}：${coverage==null?'未进行自动比对':percent(coverage)+' 的文字相同'}"><span style="width:${(coverage||0)*100}%"></span></div><small>全文 ${n(item.characters)} 字符</small></div>${path?`<details class="co-source-location"><summary>来源位置</summary><code>${e(item.path||item.package||'当前配置')}</code>${item.package?`<small>${e(item.package)}</small>`:''}</details>`:''}</section>`;
}

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
        const draft=[`使用 context-profile 分析 ${preset} 预设的当前上下文供给。`,
          `关注方向：${direction}。`,...(question?[`用户问题：${question}`]:[]),
          `工作目录：${selected.workspace?.path??data.workspace?.path??''}`,
          `配置采集时间：${new Date(selected.capturedAt).toISOString()}；所选 ${selected.count} 项，检出 ${selected.pairs} 组相同文本。`,
          '选区快照（含完整文本、来源、加载位置、内容哈希和指标）：',selected.path,
          '这是当前配置的静态材料，加载位置不代表已经进入同一个模型请求。',
          ...selected.items.slice(0,8).map(i=>`- ${i.name} · ${i.field??i.kind} · ${i.phase} · ${i.path??i.package??''}`),
          ...(selected.count>8?[`其余 ${selected.count-8} 项见选区快照。`]:[]),
          '核对职责与任务用途；给出建议及验证方法，是否调整由用户决定。'].join('\n');
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
    container.querySelector('.co-pairs').innerHTML=list.map((pair,index)=>{
      const left=get(pair.left),right=get(pair.right);
      const excerpt=left.text.slice(pair.matches[0].left.start,pair.matches[0].left.end),quote=Array.from(excerpt.replace(/^[\s，。,:;；]+/u,'')).slice(0,180).join('');
      return `<article class="co-pair"><header class="co-pair-heading"><span class="co-case-number">${String(index+1).padStart(2,'0')}</span><span>${pair.matches.length} 处相同片段${pair.reference?' · 正文含引用':''}</span><button type="button" data-co-pair="${pair.id}" class="co-open-pair">展开原文对照 <span aria-hidden="true">↗</span></button></header><div class="co-comparison-layout"><div class="co-document-pair">${coverageView(left,pair.leftCoverage,'A')}${coverageView(right,pair.rightCoverage,'B')}</div><section class="co-common"><div class="co-common-heading"><span>两份内容中相同的文字</span><strong>${n(pair.characters)}<small> 字符</small></strong></div><blockquote class="co-shared-quote">${e(quote)}${Array.from(excerpt.replace(/^[\s，。,:;；]+/u,'')).length>180?'…':''}</blockquote><div class="co-quote-caption">${pair.matches.length>1?'另有 '+(pair.matches.length-1)+' 处片段，可展开查看':'原文摘录'}</div></section></div></article>`;
    }).join('')||'<div class="co-empty">当前范围未检出连续相同片段。</div>';
  }
  function paint(){
    const groups=Object.entries(kinds).map(([kind,label])=>{const items=data.items.filter(i=>i.kind===kind);return{kind,label,characters:items.reduce((n,i)=>n+i.characters,0),matched:items.reduce((n,i)=>n+i.matchedCharacters,0),count:items.length};}).filter(g=>g.count);
    const max=Math.max(1,...groups.map(g=>g.characters));
    const matched=data.items.filter(i=>i.matchedCharacters),matchedKinds=[...new Set(matched.map(i=>kinds[i.kind]))];
    const location=matched.length&&matched.every(i=>i.kind==='skills'&&i.phase==='on-demand')?'当前匹配均来自按需加载的 Skill 正文。':matched.length?'匹配涉及'+matchedKinds.join('、')+'。':'当前已读文本中未检出达到阈值的相同片段。';
    container.innerHTML=`<section class="co-page"><header class="co-page-heading"><div><h2>上下文重合 <span class="co-heading-count">${n(data.summary.pairs)} 组</span></h2><p>${n(data.summary.involved)} 项内容含相同片段。${e(location)}</p></div><div class="co-page-actions"><button type="button" class="tt-button" data-co="diagnose">诊断当前加载项</button><button type="button" class="co-choose-button" data-co="choose">选择两项对照 <span aria-hidden="true">↗</span></button><button class="text-action" data-co="method">指标说明</button></div></header>
      <div class="co-results-toolbar"><div class="co-filter-heading"><button type="button" class="co-filter-toggle" data-co="filters" aria-expanded="${filterOpen}" aria-controls="co-filters">筛选 <span aria-hidden="true">⌄</span></button><span class="co-result-count"></span></div><div class="co-scale-key"><span><i class="co-key-match"></i>相同文字</span><span><i class="co-key-total"></i>其余原文</span></div></div><div class="co-filters" id="co-filters" ${filterOpen?'':'hidden'}><input type="search" data-co-query aria-label="查找加载项" placeholder="查找名称、文件或插件" value="${e(filter.query)}"><select data-co-filter="kind" aria-label="内容类型"><option value="all">全部内容类型</option>${Object.entries(kinds).map(([id,name])=>`<option value="${id}" ${filter.kind===id?'selected':''}>${name}</option>`).join('')}</select><select data-co-filter="phase" aria-label="加载位置"><option value="all">全部加载位置</option>${Object.entries(phases).map(([id,name])=>`<option value="${id}" ${filter.phase===id?'selected':''}>涉及${name}</option>`).join('')}</select></div><div class="co-pairs"></div>
      <details class="co-distribution" ${scopeOpen?'open':''}><summary><span>本次比对范围</span><small>${n(data.summary.items)} 项文本 · ${compact(data.summary.characters)} 字符</small></summary><div class="co-distribution-rows">${groups.map(g=>`<button data-co-kind="${g.kind}" aria-pressed="${filter.kind===g.kind}"><span>${g.label}<small>${g.count} 项</small></span><span class="co-bar-track"><i style="width:${g.characters/max*100}%"><b style="width:${g.matched/(g.characters||1)*100}%"></b></i></span><span class="co-bar-value">${compact(g.characters)}<small>${g.matched?compact(g.matched)+' 相同':'—'}</small></span></button>`).join('')}</div></details>
      <p class="co-snapshot">当前配置与本地正文 · ${e(data.workspace?.name||'当前项目')} · ${new Date(data.capturedAt).toLocaleString('zh-CN',{hour12:false})}</p></section>`;
    renderPairs();
  }
  container.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.co==='retry'){render(preset);return;}if(!data)return;
    if(button.dataset.coPair)pairOpen(button.dataset.coPair);
    if(button.dataset.co==='method')method();if(button.dataset.co==='choose')choose();if(button.dataset.co==='retry')render(preset);if(button.dataset.co==='diagnose')prepare();
    if(button.dataset.co==='filters'){filterOpen=!filterOpen;container.querySelector('.co-filters').hidden=!filterOpen;button.setAttribute('aria-expanded',String(filterOpen));}
    if(button.dataset.coKind){filter.kind=filter.kind===button.dataset.coKind?'all':button.dataset.coKind;filterOpen=true;paint();}
  });
  container.addEventListener('change',event=>{if(event.target.dataset.coFilter){filter[event.target.dataset.coFilter]=event.target.value;container.querySelectorAll('[data-co-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.coKind===filter.kind)));renderPairs();}});
  container.addEventListener('input',event=>{if(event.target.hasAttribute('data-co-query')){filter.query=event.target.value;renderPairs();}});
  container.addEventListener('toggle',event=>{if(event.target.classList.contains('co-distribution'))scopeOpen=event.target.open;},true);
  async function render(nextPreset){
    if(preset!==nextPreset)filter={kind:'all',phase:'all',query:''};preset=nextPreset;controller?.abort();controller=new AbortController();const own=++revision;
    container.innerHTML='<p class="co-empty">正在读取当前加载项…</p>';
    try{const response=await apiFetch('/api/context-overlap?'+new URLSearchParams({preset}),{signal:controller.signal});if(!response.ok)throw Error('snapshot');const result=await response.json();if(own!==revision)return;data=result;paint();}
    catch(error){if(error.name!=='AbortError'&&own===revision)container.innerHTML='<p class="co-empty">当前加载项暂时无法读取。<button class="text-action" data-co="retry">重新读取</button></p>';}
  }
  return {render,cancel(){revision++;controller?.abort();}};
}
