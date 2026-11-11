(() => {
  'use strict';
  const t = (zh,en) => globalThis.__trajectoryLocale === 'en' ? en : zh;
  const ui = text => globalThis.__trajectoryUi?.(text) ?? text;
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const fmt = value => new Intl.NumberFormat(globalThis.__trajectoryLocale ?? 'zh-CN').format(value);
  const directions = () => [
    ['repair',t('修复环境与实现','Environment and implementation'),t('修复实现','Fix')],
    ['recover',t('恢复与观察','Recovery and observation'),t('恢复观察','Recover')],
    ['capability',t('补齐能力','Capability availability'),t('补齐能力','Capability')],
    ['knowledge',t('保留可复用方法','Reusable methods'),t('保留方法','Methods')],
  ];
  const title = group => group.kind === 'wait' ? t(`${group.tool || '工具'} · ≥30 秒调用`,`${group.tool || 'Tool'} · calls ≥30 seconds`)
    : ui(group.label || group.code || t('未细分反馈','Unclassified feedback'));
  const sourceKey = source => JSON.stringify([source.host,source.session,source.cut,source.logId]);
  function sourcesFor(entries) {
    const groups = new Map();
    for (const row of entries) {
      if (!row.source?.session) continue;
      const key=sourceKey(row.source);
      if(!groups.has(key))groups.set(key,{...row.source,seqs:[],powerShellSeqs:[]});
      const source=groups.get(key);source.seqs.push(row.seq);
      if(row.powerShell||row.program==='PowerShell'||/^(pwsh|powershell)$/i.test(row.tool))source.powerShellSeqs.push(row.seq);
    }
    return [...groups.values()].map(source=>({...source,seqs:[...new Set(source.seqs)],powerShellSeqs:[...new Set(source.powerShellSeqs)]}));
  }
  function selection(group,direction) {
    return {kind:'finding',label:title(group),sources:sourcesFor(group.entries),direction,method:group.method,
      codeExecution:group.entries.some(row=>/^(pwsh|powershell|bash|shell|exec_command|commandExecution|run_code|runcode)$/i.test(row.tool)),
      facts:[t(`程序按相同信号归组：${group.count} 条记录，${group.turns} 轮，${group.sessions} 段会话。`,`Program-grouped signal: ${group.count} records, ${group.turns} turns, ${group.sessions} sessions.`),
        group.kind==='wait'?t('这里只观察到长调用，是否影响推进需要沿任务核对。','Long calls are observed; investigate whether they held up the task.'):
          t(`其中 ${group.paired} 条有同轮同参非报错返回；改参和跨轮处理仍需核对。`,`${group.paired} have later same-argument non-error returns in the same turn; changed arguments and later turns need investigation.`)]};
  }
  function hints(group) {
    const focus=group.focus;
    return group.directions.map(id=>{
      const name=directions().find(row=>row[0]===id)[1];
      const explanation=id==='knowledge'?t('重复出现时，先核对触发条件及当时已有的指导。','For repeated signals, check triggers and guidance already supplied.')
        :id==='capability'?t('核对能力是否存在、已加载且当前可用。','Check whether the capability exists, is loaded and callable.')
        :id==='recover'&&focus==='cancellation'?t('核对中止来源与用户意图，确认是否需要继续。','Check the cancellation source and user intent before continuing.')
        :id==='recover'?t('沿后续查看如何继续，恢复前核对已产生的效果。','Trace how work continued and check effects before recovery.')
        :focus==='guard'?t('按现有保护机制核对读取、版本和调用流程。','Check reads, versions and workflow under the existing guard.')
        :focus==='arguments'?t('对照原代码、参数与实际执行器。','Compare original code, arguments and the actual executor.')
        :focus==='availability'?t('检查实际路径、依赖和宿主配置。','Check the actual path, dependencies and host configuration.')
        :focus==='latency'?t('核对这次等待在任务中的作用和可调整的执行安排。','Check the wait’s purpose and possible changes to execution.')
        :focus==='validation'?t('区分产物问题、检查脚本和测试环境。','Distinguish deliverable, check-script and test-environment issues.')
        :t('核对自有实现、执行条件和后续结果。','Inspect the implementation, execution conditions and follow-up.');
      return {id,name,explanation};
    });
  }
  globalThis.__trajectoryFindingHints = (root,group,onAsk) => {
    if(!group){root.replaceChildren();return;}
    if(group.focus==='lookup'){
      root.innerHTML=`<p class="df-observation">${t('先核对搜索或探测目的；未命中可能已经回答了原问题。','Check the search or probe’s purpose first; no match may already answer the question.')}</p>`;
      root.onclick=null;return;
    }
    root.innerHTML=`<p class="df-kicker">${t('可调查的处理方向','Disposition directions to investigate')}</p><div class="df-hint-list">${hints(group).map(row=>`<button type="button" data-df-direction="${row.id}"><strong>${esc(row.name)}</strong><span>${esc(row.explanation)}</span><i>↗</i></button>`).join('')}</div>`;
    root.onclick=event=>{const button=event.target.closest('[data-df-direction]');if(button)onAsk(selection(group,button.dataset.dfDirection),button,button.dataset.dfDirection);};
  };
  globalThis.__trajectoryFindingSelection=selection;
  globalThis.__mountEvalFindings = (root,{getEntries,onDiagnose}={}) => {
    let selected=null,filter='all',layout='matrix',expanded=false,model,current;
    root.classList.add('df-root');
    const headingId=(root.id||'eval-findings')+'-title';
    root.setAttribute('aria-labelledby',headingId);
    root.innerHTML=`<header class="df-heading"><div><p class="df-eyebrow">${t('程序信号 · Agent 深入诊断','Program signals · agent investigation')}</p><h2 id="${headingId}">${t('诊断与处理线索','Diagnosis and disposition signals')}</h2><p>${t('从记录中归纳大致原因与可调查方向，具体判断沿原始证据继续。','Recorded signals suggest where to investigate; follow the evidence for a diagnosis.')}</p></div><span class="df-basis">${t('同一统计范围','Same selected scope')}</span></header><div class="df-stats"></div><div class="df-toolbar"><div class="df-filters"></div><div class="df-views" role="group" aria-label="${t('线索排版','Signal layout')}"><button type="button" data-df-view="matrix">${t('处置矩阵','Matrix')}</button><button type="button" data-df-view="directions">${t('按去向看','By direction')}</button></div></div><div class="df-layout"><div class="df-main"><div class="df-list"></div><button type="button" class="df-more" hidden></button><button type="button" class="df-unknown" hidden></button></div><aside class="df-detail" aria-label="${t('所选线索','Selected signal')}"></aside></div><p class="df-status" role="status"></p>`;
    const $=selector=>root.querySelector(selector);
    const counts = group => t(`${fmt(group.count)} 次 · ${fmt(group.turns)} 轮 · ${fmt(group.sessions)} 会话`,`${fmt(group.count)} calls · ${fmt(group.turns)} turns · ${fmt(group.sessions)} sessions`);
    const ask=(group,button,direction)=>onDiagnose?.(selection(group,direction),button,direction);
    function detail(group){
      selected=group.key;current=group;
      root.querySelectorAll('[data-df-pick]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.dfPick===selected)));
      const evidence=group.entries.find(row=>row.evidence)?.evidence;
      $('.df-detail').innerHTML=`<div class="df-detail-head"><span>${group.kind==='wait'?t('耗时线索','Timing signal'):group.certainty==='candidate'?t('候选信号','Tentative signal'):t('已识别反馈信号','Identified feedback signal')}</span><h3>${esc(title(group))}</h3><p>${esc(counts(group))}</p></div><div class="df-detail-body">${group.kind==='error'?`<dl class="df-facts"><div><dt>${t('程序依据','Recorded evidence')}</dt><dd>${esc(evidence||group.code)}</dd></div><div><dt>${t('后续线索','Follow-up signal')}</dt><dd>${t(`${fmt(group.paired)} 条有同轮同参非报错返回`,`${fmt(group.paired)} have same-turn, same-argument non-error returns`)}</dd></div></dl>`:`<p class="df-observation">${t('长调用可能包含必要工作，先核对它是否阻断推进。','A long call may be necessary work. Check whether it blocked progress.')}</p>`}<div class="df-directions"></div><p class="df-kicker df-records-heading">${t('相关记录','Related records')}</p><div class="df-records">${group.entries.slice(0,5).map((row,index)=>`<button type="button" data-df-record="${index}"><span>${row.source?.label?esc(row.source.label)+' · ':''}${t('第 '+row.turn+' 轮','Turn '+row.turn)}</span><code>#${row.seq} → #${row.result??'—'}</code><small>${esc(row.exception||row.program||row.evidence||row.code)}</small></button>`).join('')}</div><div class="df-actions"><button type="button" class="df-primary" data-df-ask="overall">${t('交给 Agent 诊断','Diagnose with agent')}</button><button type="button" data-df-ask="result">${t('核对后续','Check follow-up')}</button></div></div>`;
      globalThis.__trajectoryFindingHints($('.df-directions'),group,(_selection,button,id)=>ask(group,button,id));
      $('.df-detail').onclick=event=>{
        const button=event.target.closest('[data-df-ask]');if(button)ask(group,button,button.dataset.dfAsk);
        const ref=event.target.closest('[data-df-record]');if(ref){const row=group.entries[Number(ref.dataset.dfRecord)];ask({...group,count:1,turns:1,sessions:1,entries:[row],paired:Number(Number.isSafeInteger(row.returned))},ref,'overall');}
      };
    }
    function draw(){
      model=globalThis.__trajectorySummarizeFindings(getEntries?.()??[]);
      const own=model.groups.filter(group=>filter==='all'||filter==='repeated'&&group.repeated||filter==='paired'&&group.paired);
      const shown=expanded?own:own.slice(0,8);
      $('.df-stats').innerHTML=[[t('可查看的信号组','Signal groups'),model.groups.length],[t('报错记录','Error records'),model.observedErrors],[t('未细分反馈','Unclassified feedback'),model.unclassified.length],[t('结果未知','Unconfirmed outcomes'),model.pending.length]].map(([label,value])=>`<span>${label}<strong>${fmt(value)}</strong></span>`).join('');
      $('.df-filters').innerHTML=[['all',t('全部线索','All signals')],['repeated',t('重复出现','Repeated')],['paired',t('同参有返回','Same-argument returns')]].map(([id,label])=>`<button type="button" data-df-filter="${id}" aria-pressed="${filter===id}">${label}</button>`).join('');
      root.querySelectorAll('[data-df-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.dfView===layout)));
      const blank=t('此范围没有可归组的相关信号。','No matching signal groups in this scope.');
      $('.df-list').innerHTML=!shown.length?`<p class="df-empty">${blank}</p>`:layout==='matrix'?`<div class="df-table-scroll"><table class="df-table"><thead><tr><th scope="col">${t('可查看的信号','Recorded signal')}</th>${directions().map(row=>`<th scope="col" title="${esc(row[1])}">${row[2]}</th>`).join('')}</tr></thead><tbody>${shown.map(group=>`<tr role="button" tabindex="0" data-df-pick="${esc(group.key)}" aria-pressed="${selected===group.key}"><td><strong>${esc(title(group))}</strong><span>${esc(counts(group))}</span><small>${esc(group.tool)}${group.exception?' · '+esc(group.exception):''}</small></td>${directions().map(([id])=>`<td>${group.directions.includes(id)?`<span class="df-pill">${t('可查','Explore')}</span>`:'<span class="df-dash">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:`<div class="df-cards">${directions().map(([id,label])=>{const groups=shown.filter(group=>group.directions.includes(id));return `<section><h3>${label}<span>${groups.length}</span></h3>${groups.length?groups.map(group=>`<button type="button" data-df-pick="${esc(group.key)}" aria-pressed="${selected===group.key}"><strong>${esc(title(group))}</strong><small>${esc(counts(group))}</small></button>`).join(''):`<p class="df-empty">${t('暂无相关线索','No related signals')}</p>`}</section>`;}).join('')}</div>`;
      const more=$('.df-more');more.hidden=own.length<=8;more.textContent=expanded?t('收起','Show less'):t(`查看全部 ${fmt(own.length)} 组`,`View all ${fmt(own.length)} groups`);
      const unclassified=[...model.unclassified,...model.pending];
      $('.df-unknown').hidden=!unclassified.length;$('.df-unknown').innerHTML=`<span>${t(`${fmt(unclassified.length)} 条记录还需沿原文核对`,`${fmt(unclassified.length)} records need original-evidence review`)}</span><span>${t('交给 Agent 查证','Investigate with agent')} ↗</span>`;
      $('.df-detail').hidden=!shown.length;
      if(shown.length)detail(shown.find(group=>group.key===selected)??shown[0]);
    }
    root.addEventListener('click',event=>{
      const button=event.target.closest('[data-df-filter],[data-df-view],[data-df-pick]');if(!button)return;
      if(button.dataset.dfFilter){filter=button.dataset.dfFilter;expanded=false;draw();}
      if(button.dataset.dfView){layout=button.dataset.dfView;draw();}
      if(button.dataset.dfPick){const group=model.groups.find(row=>row.key===button.dataset.dfPick);if(group)detail(group);}
    });
    root.addEventListener('keydown',event=>{const row=event.target.closest('tr[data-df-pick]');if(row&&['Enter',' '].includes(event.key)){event.preventDefault();const group=model.groups.find(group=>group.key===row.dataset.dfPick);if(group)detail(group);}});
    $('.df-more').onclick=()=>{expanded=!expanded;draw();};
    $('.df-unknown').onclick=event=>{
      const entries=[...model.unclassified,...model.pending];
      ask({key:'unclassified',kind:'unclassified',code:'UNCLASSIFIED_OUTPUT',label:t('未细分反馈与结果未知','Unclassified feedback and unconfirmed outcomes'),focus:'unclassified',entries,count:entries.length,turns:new Set(entries.map(row=>JSON.stringify([row.source?.session,row.turn]))).size,sessions:new Set(entries.map(row=>row.source?.session)).size,paired:0,method:'disposition',directions:[]},event.currentTarget,'overall');
    };
    draw();
    return {refresh:draw,select(seq){const group=model.groups.find(group=>group.entries.some(row=>row.seq===seq));if(group){selected=group.key;filter='all';expanded=true;draw();root.scrollIntoView({block:'start'});}},get current(){return current;}};
  };
})();
