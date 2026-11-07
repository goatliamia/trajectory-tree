  let geistOfficialStats = data.officialStats?.snapshot;
  let geistStatsByStep = new Map((geistOfficialStats?.turns || []).flatMap(t => t.steps.map(s => [t.turn + ':' + s.step, s])));
  let geistOutcomes = collectToolResults(session, reviewContextData.callFacts || {}, reviewFileOperations);
  let geistOutcomeBranches = [];
  const geistOutcomeLayoutCache = new Map();
  const geistReportIcon = '<path d="M-4-6h5l3 3v9h-8zM1-6v3h3M-1-0.5h3M-1 2.5h3"/>';
  const geistOperationKindBase = callKind;
  callKind = function(call) { const family = reviewContextData.callFacts?.[call.seq]?.operation?.family; return ({ read: 'read', write: 'write', search: 'query', web: 'query', command: 'run', process: 'run' })[family] || geistOperationKindBase(call); };
  const geistOperationIconBase = stepIcon;
  stepIcon = function(step) { const family = reviewContextData.callFacts?.[step.calls[0]?.seq]?.operation?.family; return family === 'read' ? geistReportIcon : family === 'search' ? STEP_ICON.read : geistOperationIconBase(step); };
  const geistOperationStepLabelBase = reviewActionStepLabel;
  reviewActionStepLabel = function(step) {
    if (!step.calls.some(call => reviewContextData.callFacts?.[call.seq]?.operation)) return geistOperationStepLabelBase(step);
    const names = [...new Set(step.calls.map(call => call.name))];
    return names.slice(0, 2).join(' / ') + (names.length > 2 ? ui(' 等') : '');
  };
  function geistOutcomeText(members) {
    if (members.length === 1) {
      const r = members[0].result;
      const text = r.kind === 'incident' ? reviewBranchLabel([{ e: r.incident }]) : toolResultLabel(r);
      return shorten(view === 'path' ? text.replace(/^\d+\s*·\s*/, '') : text, r.recorded ? 22 : 17);
    }
    const errors = members.filter(m => ['incident', 'error'].includes(m.result.kind)).length;
    const recovered = members.filter(m => m.result.kind === 'incident' && m.result.incident.complete).length;
    if (members.some(m => m.result.recorded)) {
      const calls = members.flatMap(m => m.result.calls), counts = new Map();
      for (const call of calls) counts.set(call.name, (counts.get(call.name) || 0) + 1);
      const labels = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name, n]) => n === 1 ? compactToolLabel(calls.find(c => c.name === name)) : name + ' ×' + n);
      if (errors) labels.push(errors + (recovered === errors ? ui(' 处已恢复') : ui(' 处受阻')));
      if (members.some(m => m.result.kind === 'pending')) labels.push(ui('有待返回'));
      return labels.join(' · ');
    }
    const names = { read: ui('取回内容'), change: ui('文件改动'), check: ui('检查输出'), query: ui('查询结果') };
    const kinds = ['check', 'change', 'read', 'query'].filter(kind => members.some(m => m.result.kind === kind)).slice(0, errors ? 1 : 2);
    return kinds.map(kind => names[kind]).join(' · ') + (errors ? (kinds.length ? ' · ' : '') + errors + (recovered === errors ? ui(' 处已恢复') : ui(' 处受阻')) : '');
  }
  function geistOutcomeGlyph(result, x, y) {
    if (result.kind === 'incident') {
      return brCap(x, y, result.incident.condition);
    }
    if (result.kind === 'error') return brCap(x, y);
    if (result.kind === 'recovered') return brCap(x, y);
    if (result.recorded) {
      const kind = result.kind === 'pending' ? 'pending' : result.family || result.kind;
      const glyph = kind === 'read' ? geistReportIcon : kind === 'write' ? STEP_ICON.write : kind === 'search' ? STEP_ICON.read : kind === 'command' ? STEP_ICON.run : kind === 'pending' || kind === 'process' ? '<circle r="5"/><path d="M0-3v3l2 1"/>' : kind === 'coordination' ? '<path d="M-4-5v7q0 3 4 3h4M-4-1h5q3 0 3-4"/><circle cx="-4" cy="-5" r="1"/><circle cx="4" cy="-5" r="1"/>' : STEP_ICON.query;
      return '<g transform="translate(' + x + ' ' + y + ')" class="geist-result-glyph ' + (kind === 'write' ? 'change' : kind) + '">' + glyph + '</g>';
    }
    if (result.kind === 'check') {
      const failed = result.calls.some(c => /^命令输出报告：FAIL\b/i.test(c.fact?.outcome || '') || /^\s*FAIL\b/im.test(c.result?.text || ''));
      return '<g transform="translate(' + x + ' ' + y + ')" class="geist-result-glyph ' + (failed ? 'error' : 'check') + '">' + geistReportIcon + '</g>';
    }
    return '<g transform="translate(' + x + ' ' + y + ')" class="geist-result-glyph ' + result.kind + '">' + STEP_ICON[result.kind === 'change' ? 'write' : result.kind === 'read' ? 'read' : 'query'] + '</g>';
  }
  function geistResultBranchBody(p, base) {
    const y = base + p.dy, sign = p.dy > 0 ? 1 : -1;
    const twig = 'M' + p.x + ' ' + (base + sign * 2) + 'V' + (y - sign * 10) + 'Q' + p.x + ' ' + y + ' ' + (p.x + 10) + ' ' + y + 'H' + (p.x + 14);
    const endpoint = toolResultEndpoint(p.members);
    const glyph = '<g class="geist-branch-tip" data-endpoint-kind="' + endpoint.kind + '" aria-hidden="true">' + geistOutcomeGlyph(endpoint, p.x + 20, y) + '</g>';
    const body = '<rect class="br-hit" x="' + (p.left - 4) + '" y="' + (base + p.top - 3) + '" width="' + (p.right - p.left + 8) + '" height="' + (p.bottom - p.top + 6) + '"/>' +
      '<path d="' + twig + '" class="br-connector"/>' + glyph + brText(p.cx, p.dy > 0 ? y + 21 : y - 14, p.label, 'br-label');
    return body;
  }
  function geistDrawResultBranches(items, base, left, right, visible, options = {}) {
    if (!items.length) { geistOutcomeBranches = []; return { html: '', bottom: base + 42 }; }
    const key = [view, view === 'path' ? turn().number : overviewScale, right, overviewLayers.has('context'), reviewStress, document.fonts.status, options.reservedKey || ''].join(':');
    let packed = geistOutcomeLayoutCache.get(key);
    if (!packed) {
      const reserved = options.reserved || [], obstacles = [...reserved, ...(options.obstacles || [])];
      try { packed = layoutBranches(items, { left, right, measure: reviewMeasure, labelOf: geistOutcomeText, ...options, obstacles }); }
      catch (error) {
        if (!options.obstacles?.length) throw error;
        packed = layoutBranches(items, { left, right, measure: reviewMeasure, labelOf: geistOutcomeText, ...options, obstacles: reserved });
      }
      if (view === 'path' && options.obstacles?.length && packed.some(p => new Set(p.members.map(m => m.result.step)).size > 1)) {
        packed = layoutBranches(items, { left, right, measure: reviewMeasure, labelOf: geistOutcomeText, ...options, obstacles: reserved });
      }
      if (geistOutcomeLayoutCache.size > 20) geistOutcomeLayoutCache.clear();
      geistOutcomeLayoutCache.set(key, packed);
    }
    geistOutcomeBranches = packed;
    let html = '', bottom = base + 42;
    packed.forEach((p, index) => {
      const y = base + p.dy, sign = p.dy > 0 ? 1 : -1;
      bottom = Math.max(bottom, y + 25);
      if (!visible(p.left, p.right)) return;
      const body = geistResultBranchBody(p, base);
      html += brGroup('class="br-incident geist-result-branch" data-tool-result="' + index + '"', body, p.label + ui('；点击查看执行结果及关联对象'));
    });
    return { html, bottom };
  }
  reviewBranches = function(mapTime, base, visible, left, right, width) {
    const records = reviewStress ? collectToolResults(session, reviewContextData.callFacts || {}, reviewFileOperations) : geistOutcomes;
    const items = records.map(result => ({ id: result.id, at: reviewActiveTime(result.turn, result.time), x: mapTime(result.time), result }));
    const result = geistDrawResultBranches(items, base, 20, width - 20, visible);
    reviewBranchesNow = geistOutcomeBranches;
    return result;
  };
  reviewOverviewSummary = () => session.turns.length + ui(' 轮执行记录');
  function geistOutcomeFocus() {
    const relevant = new Set(reviewFileSelection ? reviewFileOperations.filter(o => fileIdentity(o.path) === reviewFileSelection).map(o => o.seq) : []);
    $('graph').querySelectorAll('[data-tool-result]').forEach(el => {
      const p = geistOutcomeBranches[Number(el.dataset.toolResult)];
      el.classList.toggle('file-related', p.members.some(m => m.result.seqs.some(seq => relevant.has(seq))));
    });
  }
  const geistFileFocusBase = reviewApplyFileFocus;
  reviewApplyFileFocus = function() { geistFileFocusBase(); geistOutcomeFocus(); };
  // 失败与恢复的配对来自会话里的 episode:抽屉里把"哪一步补上的"落到具体一步。
  function geistRecovery(seq) {
    for (const episode of session.overview.episodes || []) for (const pair of episode.pairs || []) {
      if (pair.failedSeq !== seq || pair.successSeq == null) continue;
      for (const t of session.turns) for (const step of t.steps) if (step.calls.some(call => call.seq === pair.successSeq)) return { turn: t.number, step: step.number };
    }
    return null;
  }
  // 参数摘要:工具名 + 目标或关键参数,一行等宽。路径只留末两段,纯工具名不单独占一行。
  function geistCallSubject(call) {
    let args = call.args;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = null; } }
    const hint = args && typeof args === 'object'
      ? [args.file_path, args.path, args.command, args.query, args.pattern, args.url, args.description].find(value => typeof value === 'string' && value.trim())
      : '';
    let subject = String(call.target || hint || (call.files?.length ? call.files[0].path : '') || '').replace(/\s+/g, ' ').trim();
    if (!subject) return '';
    if (/[\\/]/.test(subject)) subject = subject.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
    if (subject.length > 64) subject = subject.slice(0, 64) + '…';
    return [call.name, subject].filter(Boolean).join(' · ');
  }
  // 组抽屉与单条抽屉共用同一套状态词:只在异常时出现,正常项不加标记。
  function geistResultState(result) {
    if (result.kind === 'incident') return result.incident?.complete ? [ui('已恢复'), 'good'] : [ui('受阻'), 'bad'];
    if (result.kind === 'pending') return [ui('等待返回'), 'warn'];
    if (result.kind === 'error') return [ui('受阻'), 'bad'];
    return ['', 'quiet'];
  }
  function geistOpenResult(result) {
    if (view === 'path' && turn().number === result.turn) {
      const index = turn().steps.findIndex(step => step.number === result.step);
      if (index >= 0) selectStep(index);
    }
    const seqs = new Set(result.seqs);
    $('graph').querySelectorAll('[data-file-group]').forEach(el => {
      const group = reviewFileGroups[Number(el.dataset.fileGroup)];
      el.classList.toggle('branch-related', group.members.some(m => m.file.operations.some(op => seqs.has(op.seq))));
    });
    if (result.kind === 'incident') { reviewOpenBranch([result.incident]); return; }
    const names = { read: ui('取回文件内容'), change: ui('文件修改'), query: ui('查询结果'), check: ui('检查输出'), error: ui('操作受阻'), command: ui('命令输出'), process: ui('后台任务'), web: ui('网页返回'), coordination: ui('协作返回'), pending: ui('等待工具返回'), other: ui('工具返回') };
    const paths = [...new Set(result.calls.flatMap(c => c.files?.length ? c.files.map(file => file.path) : [c.file]).filter(Boolean))];
    const blocked = result.calls.filter(call => call.fact?.tone === 'bad').length;
    const recovered = result.calls.filter(call => call.fact?.tone === 'bad' && geistRecovery(call.seq)).length;
    let html = result.calls.map(call => {
      const tone = call.fact?.tone === 'bad' ? 'bad' : call.fact?.tone === 'unknown' ? 'warn' : 'quiet';
      const state = tone === 'bad' ? ui('受阻 · ') : tone === 'warn' ? ui('未确认 · ') : '';
      const recovery = tone === 'bad' ? geistRecovery(call.seq) : null, subject = geistCallSubject(call);
      return '<div class="geist-outcome-record" data-tone="' + tone + '"><div class="geist-outcome-head">' +
        (state ? '<span class="geist-outcome-state">' + esc(state) + '</span>' : '') +
        '<strong>' + esc(call.fact?.title || call.name) + '</strong></div>' +
        '<p>' + esc(call.fact?.outcome || ui('工具结果已记录')) + '</p>' +
        (subject ? '<p class="geist-outcome-meta">' + esc(subject) + '</p>' : '') +
        (recovery ? '<button class="geist-text-action recovery" data-result-recovery="' + call.seq + '">' + ui('第 ') + recovery.step + ui(' 步恢复 ↗') + '</button>' : '') +
        (call.fact?.preview ? '<button class="geist-text-action" data-result-diff="' + call.seq + '">' + (call.fact.tone === 'bad' || call.fact.tone === 'unknown' ? ui('查看原计划') : ui('查看改动片段')) + ' ↗</button>' : '') +
        (result.recorded ? '<p class="review-quiet">' + (call.inner ? ui('内部工具 · ') : '') + 'seq ' + call.seq + (call.rootSeq != null ? ui(' · 外层调用 #') + call.rootSeq : '') + '</p>' + callEntry(call) : '') + '</div>';
    }).join('');
    if (paths.length) html += '<div class="geist-outcome-files">' + paths.map((path, i) => '<button class="geist-text-action" data-result-file="' + i + '">' + esc(path.split(/[\\/]/).at(-1)) + ui(' · 全程记录 ↗</button>')).join('') + '</div>';
    const embedded = window.parent !== window && data.traceCapabilities?.chatJump === true;
    html += ui('<div class="drawer-actions"><button class="action-button primary" id="geist-result-step">在行动路径中查看 ↗</button><button class="action-button" id="geist-result-context">本轮上下文变化</button>') +
      (embedded ? ui('<button class="action-button" id="geist-result-chat">跳到第 ') + result.turn + ui(' 轮对话 ↗</button>') : '') + '</div>';
    if (result.kind === 'check') html += ui('<p class="review-quiet">按检查命令实际输出展示，不代表整个任务已经完成。</p>');
    if (result.calls.some(call => call.name === 'grep')) html += ui('<p class="review-quiet">搜索记录关联实际返回的匹配片段，不表示读入了整份文件。</p>');
    const counts = [result.calls.length + ui(' 项操作'), blocked ? blocked + ui(' 处受阻') : '', recovered ? recovered + ui(' 处已恢复') : ''].filter(Boolean).join(' · ');
    openDrawer(result.recorded ? toolResultLabel(result) : names[result.kind], ui`第 ${result.turn} 轮 · 第 ${result.step} 步` + ' · ' + counts, html);
    $('geist-result-step').onclick = () => { closeDrawer(); reviewEnterPath(result.turn, result.step); };
    $('geist-result-context').onclick = () => reviewOpenContext(result.turn);
    // 跳到对话由宿主视图完成(切到对话并滚到该轮),页面只把轮次交出去。
    $('geist-result-chat')?.addEventListener('click', () => window.parent.postMessage({ type: 'analysis-trace-jump', turn: result.turn }, location.origin));
    $('drawer-body').querySelectorAll('[data-result-file]').forEach(el => el.onclick = () => {
      const file = fileObjects(reviewFileOperations).find(f => f.id === fileIdentity(paths[Number(el.dataset.resultFile)]));
      if (file) { reviewSelectFile(file.id); closeDrawer(); reviewOpenFileHistory(file); }
    });
    $('drawer-body').querySelectorAll('[data-result-diff]').forEach(el => el.onclick = () => {
      const call = result.calls.find(c => c.seq === Number(el.dataset.resultDiff)), t = brRound(result.turn), step = t.steps.find(s => s.number === result.step);
      reviewOpenChange(t, step, call.fact);
    });
    $('drawer-body').querySelectorAll('[data-result-recovery]').forEach(el => el.onclick = () => {
      const recovery = geistRecovery(Number(el.dataset.resultRecovery));
      if (!recovery) return;
      closeDrawer(); reviewEnterPath(recovery.turn, recovery.step);
    });
  }
  // 出错条目没有 calls:工具名从它所在那一步的调用里取,列表里就能看见是哪个工具。
  function geistMemberTools(member) {
    const names = (member.result.calls || []).map(call => call.name).filter(Boolean);
    if (!names.length) {
      const turn = session.turns.find(row => row.number === member.result.turn);
      const step = turn && turn.steps.find(row => row.number === member.result.step);
      if (step) names.push(...step.calls.map(call => call.name));
    }
    return [...new Set(names)].slice(0, 2).join(' / ');
  }
  function geistOpenResultGroup(members) {
    if (members.length === 1) { geistOpenResult(members[0].result); return; }
    const states = members.map(member => geistResultState(member.result));
    const blocked = states.filter(state => state[1] === 'bad').length;
    const recovered = states.filter(state => state[1] === 'good').length;
    const counts = [members.length + ui(' 项结果'), blocked ? blocked + ui(' 处受阻') : '', recovered ? recovered + ui(' 处已恢复') : ''].filter(Boolean).join(' · ');
    openDrawer(ui('这段执行的工具结果'), counts + ui(' · 同一主干上的不同返回'), '<div class="review-list">' + members.map((member, i) => {
      const state = states[i];
      const label = member.result.kind === 'incident' ? episodeMeaning(member.result.incident).short : toolResultLabel(member.result);
      const tools = geistMemberTools(member);
      return '<button data-result-item="' + i + '" data-tone="' + state[1] + '">' +
        (state[0] ? '<span class="geist-outcome-state">' + esc(state[0]) + ' · </span>' : '') +
        esc(label) +
        '<small>' + ui('第 ') + member.result.turn + ui(' 轮 · 第 ') + member.result.step + ui(' 步') + (tools ? ' · ' + esc(tools) : '') + '</small></button>';
    }).join('') + '</div>');
    $('drawer-body').querySelectorAll('[data-result-item]').forEach(el => el.onclick = () => geistOpenResult(members[Number(el.dataset.resultItem)].result));
  }
  function geistBindResults() {
    $('graph').querySelectorAll('[data-tool-result]').forEach(el => {
      const open = () => geistOpenResultGroup(geistOutcomeBranches[Number(el.dataset.toolResult)].members);
      el.onclick = e => { e.stopPropagation(); open(); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
    geistOutcomeFocus();
  }
  const geistResultsBindBase = reviewBind;
  reviewBind = function() { geistResultsBindBase(); geistBindResults(); };

  function geistTimingLayer(t, step, mapTime, base, interactive = false) {
    if (!overviewLayers.has('duration')) return '';
    // 褐色时段标记在总览与路径都撤掉:路径看构成条,总览看柱与结果,重复。
    return '';
    const stats = geistStatsByStep.get(t.number + ':' + step.number), timing = toolTiming(stats, step);
    if (timing.status !== 'measured' || !timing.spans.length) return '';
    let body = '';
    for (const span of timing.spans) {
      const a = mapTime(span.start), b = mapTime(span.end);
      body += '<path d="M' + a + ' ' + (base + 3) + 'H' + Math.max(a + .6, b) + '" class="geist-tool-time"/>';
    }
    const a = mapTime(step.start), b = mapTime(step.end);
    if (interactive) body += '<rect x="' + a + '" y="' + (base + 1) + '" width="' + Math.max(1, b - a) + '" height="6" fill="transparent"/>';
    return brGroup('class="geist-tool-timing"' + (interactive ? ' data-tool-timing="' + t.number + ':' + step.number + '"' : ' style="pointer-events:none" tabindex="-1"'), body, ui('工具执行覆盖 ') + preciseTime(timing.coverage) + ui('；各调用累计 ') + preciseTime(timing.cumulative) + (timing.partial ? ui('；图中只展示已列出的调用区间') : ''));
  }
  function geistOpenTiming(number, stepNumber) {
    const t = brRound(number), step = t.steps.find(s => s.number === stepNumber);
    const stats = geistStatsByStep.get(number + ':' + stepNumber) || {}, timing = toolTiming(stats, step);
    const total = Math.max(0, step.end - step.start);
    const tool = timing.status === 'measured' ? timing.coverage : null;
    const ttft = Number.isFinite(stats.ttft) ? stats.ttft : null;
    const decode = Number.isFinite(stats.decode) ? stats.decode : null;
    const model = ttft !== null && decode !== null ? Math.min(total, ttft + decode) : null;
    const rest = model !== null && tool !== null ? Math.max(0, total - model - tool) : null;
    const rows = [[ui('首字'), ttft, 'wait'], [ui('解码'), decode, 'model'], [ui('工具'), tool, 'tool'], [ui('其它'), rest, 'rest']]
      .filter(([, value]) => value !== null && value >= 0)
      .map(([name, value, kind]) => '<div class="geist-timing-row ' + kind + '"><dt><i></i>' + name + '</dt><dd>' + preciseTime(value) + '</dd></div>');
    let html = ui('<dl class="geist-timing-facts"><div class="geist-timing-row total"><dt>这一步</dt><dd>') + preciseTime(total) + '</dd></div>' + rows.join('') + '</dl>';
    html += ui('<p class="review-quiet">覆盖时间把重叠执行的区间只算一次') + (timing.cumulative != null && timing.coverage != null && Math.abs(timing.cumulative - timing.coverage) > 1 ? ui('；累计时间把每次调用分别相加,重叠部分会重复计入') : ui('；本步调用之间没有重叠,累计与覆盖相同')) + ui('。全部直接读取官方统计结果。</p>');
    html += ui('<div class="drawer-actions"><button class="action-button" id="geist-timing-path">查看这一步 ↗</button></div>');
    openDrawer(ui('工具执行时间'), ui('第 ') + number + ui(' 轮 · ') + stepNumber + ui(' 步'), html);
    $('geist-timing-path').onclick = () => { closeDrawer(); reviewEnterPath(number, stepNumber); };
  }
  function geistBindTiming() {
    $('graph').querySelectorAll('[data-tool-timing]').forEach(el => {
      const open = () => geistOpenTiming(...el.dataset.toolTiming.split(':').map(Number));
      el.onclick = e => { e.stopPropagation(); open(); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
  }
  const geistOverviewResultsBase = renderOverview;
  renderOverview = function(...args) {
    const value = geistOverviewResultsBase(...args), p = overviewProjection;
    if (p && overviewLayers.has('duration')) {
      const svg = '<g class="geist-tool-time-layer">' + p.layout.filter(l => l.end >= p.visibleLeft && l.x <= p.visibleRight).map(l => l.turn.steps.map(step => geistTimingLayer(l.turn, step, p.mapTime, p.mainY)).join('')).join('') + '</g>';
      $('graph').insertAdjacentHTML('beforeend', svg); geistBindTiming();
    }
    return value;
  };
  const geistActionResultsBase = renderActionPath;
  renderActionPath = function(...args) {
    // 概览的结果布局不能留给行动路径充当障碍物;步骤结果由节点与详情承载。
    geistOutcomeBranches = [];
    reviewBranchesNow = [];
    const value = geistActionResultsBase(...args), frame = reviewActionFileFrame;
    if (!frame) return value;
    const { t, x, base } = frame, halfGap = t.steps.length > 1 ? (x(1) - x(0)) / 2 : 56;
    {
      const contextLabels = [...$('graph').querySelectorAll('.review-context-overflow-label')];
      // 数值仍避让独立的子代理线路,不依赖概览的工具结果开关。
      const occupiedNumbers = [];
      const childLines = typeof geistPlanAgentForks === 'function' ? geistPlanAgentForks() : [];
      for (const el of contextLabels) {
        const ox = Number(el.getAttribute('x')), oy = Number(el.getAttribute('y')), anchor = el.getAttribute('text-anchor') || 'middle';
        const choices = [[ox, oy, anchor], [ox - 24, oy, 'end'], [ox + 24, oy, 'start'], [ox, oy - 16, anchor], [ox, oy + 16, anchor]];
        let fit = false;
        for (const [nx, ny, align] of choices) {
          el.setAttribute('x', nx); el.setAttribute('y', ny); el.setAttribute('text-anchor', align);
          const b = el.getBBox();
          const hitsNumber = occupiedNumbers.some(q => b.x < q.x + q.width + 4 && b.x + b.width > q.x - 4 && b.y < q.y + q.height + 3 && b.y + b.height > q.y - 3);
          const hitsChildLine = childLines.some(p => b.x < p.end + 3 && b.x + b.width > p.x - 3 && b.y < base + p.dy + 6 && b.y + b.height > base + p.dy - 6);
          if (!hitsNumber && !hitsChildLine && b.x >= 2 && b.y >= 95) { occupiedNumbers.push(b); fit = true; break; }
        }
        if (!fit) { el.setAttribute('x', ox); el.setAttribute('y', oy); el.setAttribute('text-anchor', anchor); occupiedNumbers.push(el.getBBox()); }
      }
    }
    let timing = '';
    for (const [i, step] of t.steps.entries()) {
      const start = x(i) - halfGap + 7, span = halfGap * 2 - 14;
      timing += geistTimingLayer(t, step, time => start + Math.max(0, Math.min(1, (time - step.start) / Math.max(1, step.end - step.start))) * span, 65, true);
    }
    $('graph').insertAdjacentHTML('beforeend', '<g class="geist-tool-time-layer">' + timing + '</g>'); geistBindTiming();
    geistUpdateStepTiming(t);
    return value;
  };
  function geistUpdateStepTiming(t) {
    const meta = $('step-panel').querySelector('.geist-step-meta>span');
    if (meta && t.steps[selectedStep].calls.length && overviewLayers.has('duration') && !meta.querySelector('[data-native-tool-time]')) {
      const step = t.steps[selectedStep], timing = toolTiming(geistStatsByStep.get(t.number + ':' + step.number), step);
      const button = document.createElement('button'); button.className = 'geist-text-action geist-time-breakdown'; button.dataset.nativeToolTime = '';
      // 底部栏给出构成:首字 / 解码 / 工具 / 其它,点开看口径。
      const stats = geistStatsByStep.get(t.number + ':' + step.number) || {};
      const total = Math.max(0, step.end - step.start);
      const tool = timing.status === 'measured' ? timing.coverage : null;
      const ttft = Number.isFinite(stats.ttft) ? stats.ttft : null;
      const decode = Number.isFinite(stats.decode) ? stats.decode : null;
      const model = ttft !== null && decode !== null ? Math.min(total, ttft + decode) : null;
      const rest = model !== null && tool !== null ? Math.max(0, total - model - tool) : null;
      const parts = [[ui('首字'), ttft, 'wait'], [ui('解码'), decode, 'model'], [ui('工具'), tool, 'tool'], [ui('其它'), rest, 'rest']].filter(([, value]) => value !== null && value >= 0);
      button.innerHTML = parts.length
        ? parts.map(([name, value, kind]) => '<span class="geist-time-part ' + kind + '"><i></i>' + name + ' ' + preciseTime(value) + '</span>').join('')
        : ui('耗时未记录');
      button.onclick = () => geistOpenTiming(t.number, step.number); meta.append(button);
    }
  }
  const geistCaptionResultsBase = geistArrangeCaption;
  geistArrangeCaption = function() {
    geistCaptionResultsBase();
    const caption = $('graph-caption'), layers = caption.querySelector('.br-layers');
    const existing = layers?.querySelector('[data-br-layer="failures"],[data-action-layer="failures"]');
    if (existing) existing.parentElement.lastChild.textContent = ui('工具结果');
    const key = caption.querySelector('.br-key');
    key?.querySelectorAll('.br-key-item').forEach(item => {
      if (item.querySelector('.br-check') || [ui('结果还不清楚'), ui('结果未确认')].some(label => item.textContent.includes(label))) item.remove();
    });
    if (key && !key.querySelector('.geist-result-key')) {
      key.insertAdjacentHTML('afterbegin', '<span class="geist-result-key"><svg viewBox="-8 -8 16 16" class="geist-result-glyph read">' + STEP_ICON.read + ui('</svg>取回内容</span><span class="geist-result-key"><svg viewBox="-8 -8 16 16" class="geist-result-glyph change">') + STEP_ICON.write + ui('</svg>写入修改</span><span class="geist-result-key"><svg viewBox="-8 -8 16 16" class="geist-result-glyph check">') + geistReportIcon + ui('</svg>检查输出</span>'));
    }
    if (key && overviewLayers.has('duration') && view !== 'path' && !key.querySelector('.geist-tool-time-key')) {
      key.insertAdjacentHTML('beforeend', ui('<span class="geist-tool-time-key" title="官方记录中工具从调用到返回的时间区间；点击本步工具时间查看覆盖与累计口径"><i></i>') + (view === 'path' ? ui('步内工具时段') : ui('工具执行区间')) + '</span>');
    }
  };
