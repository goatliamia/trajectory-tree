(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('eval-data').textContent);
  const execution = data.codeExecution;
  if (!execution) return;
  const t = (zh, en) => globalThis.__trajectoryLocale === 'en' ? en : zh;
  const ui = text => globalThis.__trajectoryUi?.(text) ?? text;
  const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const number = new Intl.NumberFormat(globalThis.__trajectoryLocale ?? 'zh-CN');
  const fmt = value => number.format(value);
  const turnLabel = value => t(`第 ${value} 轮`, `Turn ${value}`);
  const phases = { syntax:t('语法与解析','Syntax and parsing'), arguments:t('参数与命令解析','Arguments and command resolution'),
    access:t('权限与访问','Permissions and access'), runtime:t('程序运行环境','Program runtime'),
    child:t('子程序反馈','Child program feedback'), program:t('程序异常','Program exception'),
    execution:t('执行反馈','Execution feedback'), unresolved:t('原因待确认','Cause unclassified') };
  const nav = document.createElement('nav');
  nav.className = 'ce-tabs'; nav.setAttribute('aria-label', t('Eval 分析视图','Eval analysis views'));
  nav.innerHTML = `<button type="button" data-ce-tab="metrics" aria-pressed="true">${t('运行指标','Run metrics')}</button><button type="button" data-ce-tab="code" aria-pressed="false">${t('代码执行','Code execution')}</button><a href="#eval-findings" data-ce-findings>${t('诊断线索','Diagnosis signals')} ↘</a>`;
  const panel = document.createElement('section');
  panel.className = 'ce-panel'; panel.id = 'code-execution'; panel.hidden = true;
  panel.setAttribute('aria-labelledby','ce-title');
  panel.innerHTML = `<header class="ce-heading"><div><h2 id="ce-title">${t('代码执行分析','Code execution analysis')}</h2><p>${t('从具体失败信号，核对代码、执行链和后续结果。','Inspect code, execution chains and follow-up results from recorded failure signals.')}</p></div><select id="ce-executor" aria-label="${t('执行器','Executor')}"><option value="">${t('全部执行器','All executors')}</option></select></header>
    <div id="ce-summary" class="ce-summary"></div><div class="ce-layout"><aside class="ce-signals"><h3 id="ce-signals-title">${t('失败信号','Failure signals')}</h3><div id="ce-groups" tabindex="0" role="region" aria-labelledby="ce-signals-title"></div></aside><div class="ce-main"><header class="ce-list-heading"><div><h3 id="ce-group-title"></h3><p id="ce-group-note"></p></div><button id="ce-ask-group" type="button" class="text-action">${t('分析这组','Analyze this group')}</button></header><div id="ce-calls" class="ce-calls"></div><div id="ce-detail" class="ce-detail" aria-live="polite"></div></div></div><p id="ce-status" class="ce-status" role="status"></p>`;
  document.querySelector('.workspace-head').after(nav); nav.after(panel);
  const $ = id => panel.querySelector('#' + id);
  const scope = document.getElementById('scope');
  const select = $('ce-executor');
  for (const name of [...new Set(execution.counts.map(row => row.executor))]) select.add(new Option(name,name));
  let selectedGroup = null, selectedSeq = null, groups = [], rows = [];
  const reason = row => ui(row.attribution?.label ?? (data.failureLabels[row.nativeCode] ?? [row.nativeCode || t('无细分错误码','Unspecified error')])[0]);
  const signal = row => row.attribution?.exception || (row.attribution?.runtimeKind==='exception'
    ? row.attribution.evidence : row.attribution?.program || row.attribution?.runtimeKind) || row.nativeCode || row.code;
  const position = site => site ? [site.file, Number.isSafeInteger(site.line) ? 'L'+site.line+(site.column?':'+site.column:'') : ''].filter(Boolean).join(' · ') : '';
  const ref = seq => Number.isSafeInteger(seq) ? `<button type="button" class="ce-ref" data-ce-read="${seq}">#${seq}</button>` : '—';
  function ask(chosen, button) {
    if (!chosen.length || !window.__diagnosisDemoAsk) return;
    window.__diagnosisDemoAsk({ kind:'execution', label:reason(chosen[0]), turn:scope.value?Number(scope.value):null,
      seqs:chosen.map(row=>row.seq), powerShellSeqs:chosen.filter(row=>row.executor==='PowerShell').map(row=>row.seq),
      signals:[...new Set(chosen.map(row=>row.code))], executor:chosen[0].executor }, button);
  }
  function detail(row) {
    selectedSeq = row.seq;
    for (const button of $('ce-calls').querySelectorAll('[data-ce-call]')) button.setAttribute('aria-pressed',String(Number(button.dataset.ceCall)===row.seq));
    const attribution = row.attribution;
    const rootPeers = row.root ? execution.rows.filter(other=>other.seq!==row.seq && (other.root?.seq===row.root.seq || other.seq===row.root.seq)) : execution.rows.filter(other=>other.root?.seq===row.seq);
    const site = position(attribution?.site);
    const source = row.source;
    $('ce-detail').innerHTML = `<header class="ce-detail-head"><div><span class="ce-eyebrow">${esc(phases[row.phase])}</span><h3>${esc(reason(row))}</h3><p>${esc(turnLabel(row.turn))} · <code>${esc(row.name)}</code> · ${ref(row.seq)} → ${ref(row.resultSeq)}</p></div><button type="button" class="text-action" id="ce-ask-call">${t('诊断这次','Diagnose this call')}</button></header>
      <dl class="ce-facts"><div><dt>${t('执行器','Executor')}</dt><dd>${esc(row.executor)}${row.edition?' · '+esc(row.edition):''}</dd></div><div><dt>${t('错误信号','Error signal')}</dt><dd><code>${esc(attribution?.exception || attribution?.runtimeKind || row.nativeCode || row.code)}</code></dd></div><div><dt>${t('反馈依据','Evidence')}</dt><dd>${esc(attribution?.evidence || t('仅有宿主退出状态','Host exit status only'))}</dd></div>${site?`<div><dt>${t('记录中的位置','Recorded location')}</dt><dd>${esc(site)}</dd></div>`:''}${attribution?.commandSite?`<div><dt>${t('调用命令的位置','Command invocation location')}</dt><dd>${esc(position(attribution.commandSite))}</dd></div>`:''}</dl>
      ${attribution?.guidance?`<p class="ce-guidance">${esc(ui(attribution.guidance))}</p>`:''}
      ${row.root||rootPeers.length?`<div class="ce-related"><span>${t('同一次 PTC 执行','Same PTC invocation')}</span>${row.root?ref(row.root.seq):ref(row.seq)} ${rootPeers.map(other=>`<span>${esc(other.executor)} ${ref(other.seq)}</span>`).join('')}<small>${t('父子调用关系；根因结合各自反馈核对。','Parent/child calls; inspect their feedback to establish the cause.')}</small></div>`:''}
      ${row.returned!=null?`<p class="ce-followup">${t('同轮同参后续非报错返回','Later same-argument non-error return in this turn')} ${ref(row.returned)}</p>`:`<p class="ce-followup">${t('此处未配到同轮同参返回，修改参数或跨轮解决可由诊断继续核对。','No same-argument return is paired here. Diagnosis can check changed arguments and later turns.')}</p>`}
      <div class="ce-code-grid"><section><h4>${source?.exact?t('原始脚本','Original script'):t('记录的命令','Recorded command')}</h4>${source?`<pre><code>${esc(source.text)}</code></pre>${source.omitted?`<p class="ce-clipped">${t(`另有 ${fmt(source.omitted)} 字符，沿原始调用续读。`,`${fmt(source.omitted)} more characters are available from the original call.`)}</p>`:''}`:`<p class="ce-empty">${t('从原始调用读取代码和参数。','Read code and arguments from the original call.')}</p>`}</section><section><h4>${t('执行反馈','Execution feedback')}</h4><pre><code>${esc(row.output?.text || t('无文字返回','No text output'))}</code></pre>${row.output?.omitted?`<p class="ce-clipped">${t(`另有 ${fmt(row.output.omitted)} 字符，沿返回记录续读。`,`${fmt(row.output.omitted)} more characters are available from the result record.`)}</p>`:''}</section></div>`;
    $('ce-ask-call').disabled = !window.__diagnosisDemoAsk;
    $('ce-ask-call').onclick = event => ask([row],event.currentTarget);
    const diagnosisScope = window.__trajectoryDiagnosisOptions?.source?.();
    if(diagnosisScope && globalThis.__trajectoryFindingHints){
      const entries=(data.findingCalls??[]).filter(item=>!scope.value||item.turn===Number(scope.value))
        .map(item=>({...item,source:{...diagnosisScope,host:execution.host}}));
      const group=globalThis.__trajectorySummarizeFindings(entries).groups.find(group=>group.kind==='error'&&group.entries.some(item=>item.seq===row.seq));
      if(group){
        const hints=document.createElement('section');hints.className='ce-disposition';
        $('ce-detail').querySelector('.ce-code-grid').before(hints);
        globalThis.__trajectoryFindingHints(hints,group,(selection,button,view)=>window.__diagnosisDemoAsk?.(selection,button,view));
      }
    }
  }
  function showGroup(group) {
    selectedGroup = group.key;
    const groupList = $('ce-groups');
    for (const button of groupList.querySelectorAll('[data-ce-group]')) {
      const active = Number(button.dataset.ceGroup)===groups.indexOf(group);
      button.setAttribute('aria-pressed',String(active));
      if (active) {
        const box = button.getBoundingClientRect(), viewport = groupList.getBoundingClientRect();
        if (box.top < viewport.top) groupList.scrollTop += box.top - viewport.top;
        else if (box.bottom > viewport.bottom) groupList.scrollTop += box.bottom - viewport.bottom;
        if (box.left < viewport.left) groupList.scrollLeft += box.left - viewport.left;
        else if (box.right > viewport.right) groupList.scrollLeft += box.right - viewport.right;
      }
    }
    $('ce-group-title').textContent = reason(group.rows[0]);
    const turns = new Set(group.rows.map(row=>row.turn));
    $('ce-group-note').textContent = signal(group.rows[0])+' · '+t(`${fmt(group.rows.length)} 条报错 · ${fmt(turns.size)} 轮 · 按相同失败信号归组`,`${fmt(group.rows.length)} errors · ${fmt(turns.size)} turns · grouped by the same failure signal`);
    $('ce-calls').innerHTML = group.rows.slice().reverse().map(row=>`<button type="button" class="ce-call" data-ce-call="${row.seq}" aria-pressed="false"><span>${esc(turnLabel(row.turn))}</span><code>#${row.seq} → #${row.resultSeq??'—'}</code><span>${esc(row.name)}</span><span>${esc(position(row.attribution?.site) || row.attribution?.exception || '')}</span></button>`).join('');
    $('ce-ask-group').hidden = false; $('ce-ask-group').disabled = !window.__diagnosisDemoAsk;
    const chosen = group.rows.find(row=>row.seq===selectedSeq) ?? group.rows.at(-1);
    detail(chosen);
  }
  function render() {
    const turn = scope.value?Number(scope.value):null;
    rows = execution.rows.filter(row=>(turn==null||row.turn===turn)&&(!select.value||row.executor===select.value));
    const counts = execution.counts.filter(row=>(turn==null||row.turn===turn)&&(!select.value||row.executor===select.value));
    const allCalls = counts.reduce((sum,row)=>sum+row.calls,0), allErrors = counts.reduce((sum,row)=>sum+row.errors,0);
    $('ce-summary').innerHTML = [[t('命令与程序调用','Command and program calls'),allCalls],[t('报错记录','Recorded errors'),allErrors],[t('识别到具体信号','Specific signal identified'),rows.filter(row=>row.attribution?.certainty==='confirmed').length]].map(([label,value])=>`<div><span>${label}</span><strong>${fmt(value)}</strong></div>`).join('');
    const map = new Map();
    for (const row of rows) { if (!map.has(row.fingerprint)) map.set(row.fingerprint,{key:row.fingerprint,rows:[]}); map.get(row.fingerprint).rows.push(row); }
    groups = [...map.values()].sort((a,b)=>b.rows.length-a.rows.length || b.rows.at(-1).seq-a.rows.at(-1).seq);
    $('ce-groups').innerHTML = groups.map((group,index)=>`<button type="button" class="ce-group" data-ce-group="${index}" aria-pressed="false"><span>${esc(reason(group.rows[0]))}<small>${esc(group.rows[0].executor)} · ${esc(signal(group.rows[0]))}</small></span><b>${fmt(group.rows.length)}</b></button>`).join('');
    if (!groups.length) {
      $('ce-group-title').textContent = t('此范围没有代码执行报错','No code execution errors in this scope');
      $('ce-group-note').textContent = ''; $('ce-calls').replaceChildren(); $('ce-detail').replaceChildren(); $('ce-ask-group').hidden = true;
      return;
    }
    showGroup(groups.find(group=>group.key===selectedGroup) ?? groups.find(group=>group.rows[0].code==='COMMAND_SYNTAX') ?? groups[0]);
  }
  nav.onclick = event => {
    if(event.target.closest('[data-ce-findings]')){
      event.preventDefault();nav.querySelector('[data-ce-tab="metrics"]').click();
      document.getElementById('eval-findings').scrollIntoView({block:'start'});return;
    }
    const button = event.target.closest('[data-ce-tab]'); if (!button) return;
    const code = button.dataset.ceTab==='code';
    document.body.dataset.evalSection = code?'code':'metrics'; panel.hidden = !code;
    for (const item of nav.querySelectorAll('button')) item.setAttribute('aria-pressed',String(item===button));
    if (code) render();
  };
  $('ce-groups').onclick = event => { const button=event.target.closest('[data-ce-group]'); if(button)showGroup(groups[Number(button.dataset.ceGroup)]); };
  $('ce-calls').onclick = event => { const button=event.target.closest('[data-ce-call]'); if(button)detail(rows.find(row=>row.seq===Number(button.dataset.ceCall))); };
  $('ce-ask-group').onclick = event => { const group=groups.find(group=>group.key===selectedGroup); if(group)ask(group.rows,event.currentTarget); };
  panel.addEventListener('click',async event => {
    const button=event.target.closest('[data-ce-read]'); if(!button)return;
    const source=window.__trajectoryDiagnosisOptions?.source?.() ?? execution;
    const args={session:execution.session,cut:execution.cut,seq:Number(button.dataset.ceRead),...(execution.host==='dsh'?{format:'linked'}:{linked:true,...(source.logId?{logId:source.logId}:{})})};
    const text=JSON.stringify({tool:'trajectory_read',args});
    try { await navigator.clipboard.writeText(text); $('ce-status').textContent=t('已复制这条记录的取证查询。','Evidence query copied for this record.'); }
    catch { $('ce-status').textContent=text; }
  });
  scope.addEventListener('change',render); select.addEventListener('change',render);
  render();
  if (location.hash === '#code' || globalThis.__trajectoryEvalInitialSection === 'code') nav.querySelector('[data-ce-tab="code"]').click();
})();
