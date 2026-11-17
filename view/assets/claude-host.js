  // Host evidence hooks; geometry and category interactions stay shared.
  const claudeUi = (zh, en) => window.__trajectoryLocale === 'en' ? en : zh;
  CONTEXT_CATEGORIES.find(category => category.key === 'assistant').label = claudeUi('助手消息', 'Assistant messages');
  const claudeValue = n => Number.isFinite(n) ? String(n) : claudeUi('未记录', 'Not recorded');
  const claudeEstimate = n => Number.isFinite(n) ? '≈' + geistContextNumber(n) : claudeUi('未记录', 'Not recorded');
  const claudeContextExplanation = () => claudeUi('按已记录请求中的系统提示、工具定义与消息估算来源文本；不含隐藏思考、媒体 tokens 和服务商序列化。实报用量单独展示。', 'Source text is estimated from recorded request system prompts, tool definitions and messages. Hidden reasoning, media tokens and provider serialization are excluded. Reported usage is shown separately.');
  const claudeHeader = header;
  header = function() {
    claudeHeader();
    $('session-name').textContent = claudeUi('CLAUDE CODE · 本地记录', 'CLAUDE CODE · Local transcript');
    $('session-facts').innerHTML = session.totals.turns + claudeUi(' 轮', ' turns') + '<span>/</span>' + session.totals.steps + claudeUi(' 条助手记录', ' assistant records') + '<span>/</span>' + session.totals.calls + claudeUi(' 次工具调用', ' tool calls');
  };
  showSource = function() {
    const capture = reviewContextData.capture;
    const rows = [
      [claudeUi('来源', 'Source'), data.evidence.source?.file || claudeUi('显式选定的本地 transcript', 'Explicitly selected local transcript')],
      [claudeUi('单位', 'Units'), claudeUi('一条可见助手记录为一步；同一消息可含多条记录，用量按消息 ID 只计一次。Skill 展开和本地命令不另起用户轮次。', 'Each visible assistant record is one step. Usage is counted once per message ID. Skill expansions and local commands do not start user turns.')],
      [claudeUi('用量', 'Usage'), claudeUi('读取 input、output、cache read 和 cache creation tokens；缺失字段保持未知，不把实报输入摊入来源估算。', 'Input, output, cache read and cache creation tokens come from recorded usage. Missing fields remain unknown; reported input is not distributed among estimated sources.')],
      [claudeUi('上下文', 'Context'), capture?.recorded ? claudeUi('请求还原 ', 'Requests reconstructed: ') + capture.reconstructed + '/' + capture.recorded + ' · ' + claudeContextExplanation() : claudeUi('当前文件没有 API 请求组成记录；不根据消息顺序虚构完整请求。', 'This file has no API request composition records; complete requests are not inferred from message order.')],
      [claudeUi('时间', 'Timing'), claudeUi('主线按记录时刻排列，轮间等待折叠。轮内记录跨度包含记录之间的等待，不作为确认耗时；缺少工具起止时不计算执行时间。', 'The timeline uses recorded timestamps with gaps between turns folded. Within-turn recorded spans include waits between records and are not measured execution durations. Missing tool intervals remain unknown.')],
      [claudeUi('覆盖', 'Coverage'), claudeUi('仅显式选定文件；未重建其他分支与子代理记录。', 'Only the explicitly selected file is included; other branches and subagent transcripts are not reconstructed.')],
    ];
    openDrawer(claudeUi('Claude Code 数据依据', 'Claude Code data sources'), claudeUi('本地 transcript · 只读', 'Local transcript · read only'), rows.map(([k, v]) => '<div class="source-row"><span>' + esc(k) + '</span>' + esc(v) + '</div>').join(''));
  };
  const claudeContextBase = geistRenderContextOverview;
  geistRenderContextOverview = function() {
    if (reviewContextData.current) {
      claudeContextBase();
      const region = $('geist-context-overview'), latest = reviewContextData.requests.at(-1);
      const key = latest.requestId + ':' + window.__trajectoryLocale;
      if (region.dataset.claudeRequest === key) return;
      region.dataset.claudeRequest = key;
      region.querySelector('h2').innerHTML = claudeUi('最近请求上下文 <small>请求发出时 · 来源估算</small>', 'Latest request context <small>At dispatch · estimated sources</small>');
      const total = region.querySelector('.geist-context-total');
      total.querySelector('strong').textContent = claudeEstimate(latest.total);
      total.querySelector('div>span').textContent = claudeUi(' tokens · 来源文本估算', ' tokens · estimated source text');
      const usage = (reviewContextData.usage || []).find(row => row.requestId === latest.requestId)?.usage;
      const input = usage && [usage.input, usage.cacheRead, usage.cacheWrite].every(Number.isFinite) ? usage.input + usage.cacheRead + usage.cacheWrite : null;
      total.querySelector(':scope>span').textContent = input == null ? claudeUi('容量未记录', 'Capacity not recorded') : claudeUi('实报输入 ', 'Reported input ') + geistContextNumber(input) + ' tokens';
      region.querySelector('.geist-context-occupied').style.width = '100%';
      region.querySelector('.geist-context-meter').setAttribute('aria-label', claudeUi('请求来源文本估算比例，不表示模型窗口占用', 'Estimated request source proportions, not model window occupancy'));
      region.querySelector('.claude-context-note')?.remove();
      const note = document.createElement('p'); note.className = 'review-quiet claude-context-note'; note.style.cssText = 'font-size:11px;margin:6px 0 0';
      const capture = reviewContextData.capture;
      note.textContent = claudeUi('请求还原 ', 'Requests reconstructed: ') + capture.reconstructed + '/' + capture.recorded + ' · ' + claudeContextExplanation(); region.append(note);
      return;
    }
    let region = $('geist-context-overview');
    if (!region) { region = document.createElement('section'); region.id = 'geist-context-overview'; region.className = 'geist-context-overview'; $('graph-scroll').before(region); }
    region.setAttribute('aria-label', claudeUi('当前上下文总览', 'Current context overview'));
    delete region.dataset.ready; delete region.dataset.claudeRequest;
    const latest = (reviewContextData.usage || []).at(-1)?.usage, capture = reviewContextData.capture;
    const reason = capture?.recorded
      ? claudeUi('最近请求的组成引用不完整，未沿用上一请求冒充当前构成。历史中已还原的请求仍可查看。', 'The latest request has unresolved composition references. An earlier request is not used as the current composition; reconstructed historical requests remain available.')
      : claudeUi('当前 transcript 没有 API 请求组成记录；上下文变化与趋势不可用。', 'This transcript has no API request composition records; context changes and trends are unavailable.');
    region.innerHTML = '<header><h2>' + claudeUi('请求上下文', 'Request context') + ' <small>' + claudeUi('组成未记录', 'Composition not recorded') + '</small></h2></header><p class="review-quiet">' + reason + '</p>' + (latest ? '<p class="review-quiet">' + claudeUi('最近一条已记录用量：输入 ', 'Latest recorded usage: input ') + claudeValue(latest.input) + claudeUi(' · 缓存读取 ', ' · cache read ') + claudeValue(latest.cacheRead) + claudeUi(' · 缓存创建 ', ' · cache creation ') + claudeValue(latest.cacheWrite) + claudeUi(' · 输出 ', ' · output ') + claudeValue(latest.output) + ' tokens.</p>' : '<p class="review-quiet">' + claudeUi('用量未记录。', 'Usage not recorded.') + '</p>');
  };
  reviewOpenContext = function(number, stepNumber) {
    const samples = (reviewContextData.requests || []).filter(row => row.turn === number && (stepNumber == null || row.contextSteps?.includes(stepNumber)));
    const ids = new Set(samples.map(row => row.requestId));
    const rows = (reviewContextData.usage || []).filter(row => row.turn === number && (stepNumber == null || ids.has(row.requestId) || row.step === stepNumber));
    const latest = samples.at(-1);
    let html = latest ? '<p class="review-explain">' + claudeContextExplanation() + '</p><div class="review-context-breakdown">' + CONTEXT_CATEGORIES.map(category => '<div class="source-row"><span>' + esc(category.label) + '</span>' + claudeEstimate(latest[category.key]) + ' tokens</div>').join('') + '</div>' : '';
    html += rows.length ? rows.map(({ usage: u }) => '<div class="source-row"><span>' + claudeUi('消息实报用量', 'Reported message usage') + '</span>' + claudeUi('输入 ', 'Input ') + claudeValue(u.input) + claudeUi(' · 缓存读取 ', ' · cache read ') + claudeValue(u.cacheRead) + claudeUi(' · 缓存创建 ', ' · cache creation ') + claudeValue(u.cacheWrite) + claudeUi(' · 输出 ', ' · output ') + claudeValue(u.output) + ' tokens</div>').join('') : '<p>' + claudeUi('用量未记录。', 'Usage not recorded.') + '</p>';
    openDrawer(claudeUi('第 ' + number + ' 轮 · Claude ' + (latest ? '请求上下文' : '用量'), 'Turn ' + number + ' · Claude ' + (latest ? 'request context' : 'usage')), latest ? claudeUi('请求发出时 · 来源文本估算', 'At request dispatch · estimated source text') : claudeUi('原生消息记录', 'Native message records'), html);
  };
  geistShowCurrentSource = function(key, summary) {
    const item = summary.categories.find(category => category.key === key), category = geistContextCategory(key);
    openDrawer(category.label, claudeUi('Claude 请求来源估算', 'Claude request source estimate'), '<div class="review-context-headline"><strong>' + claudeEstimate(item?.value) + '</strong><span>tokens</span></div><p class="review-explain">' + claudeContextExplanation() + '</p>');
  };
  reviewOpenContextSources = function(key = 'system') { if (reviewContextData.current) geistShowCurrentSource(key, contextOverview(null, null, reviewContextData.current)); else showSource(); };
  reviewOpenCompaction = function() { showSource(); };
  geistOpenTiming = function() { openDrawer(claudeUi('时间', 'Timing'), 'Claude Code transcript', '<p>' + claudeUi('工具开始与结束时间未完整记录，无法计算耗时。主线展示轮内记录跨度。', 'Tool start and end times are not fully recorded, so execution duration is unknown. The timeline shows within-turn recorded spans.') + '</p>'); };
  // The normalized data already marks these intervals as unavailable. Do not
  // fall back to result-time points and turn an unknown interval into zero.
  toolTiming = function() { return { status: 'missing', spans: [], coverage: null, cumulative: null }; };
  geistStatsByStep.clear();
  for (const t of session.turns) for (const s of t.steps) geistStatsByStep.set(t.number + ':' + s.number, { turn: t.number, step: s.number, model: null, toolWall: null, tool: null, calls: [], tools: s.calls.map(c => ({ name: c.name, count: 1 })), toolPending: s.calls.filter(c => c.status === 'unknown').length });
  const claudeCaption = geistArrangeCaption;
  geistArrangeCaption = function() {
    claudeCaption();
    $('graph-caption')?.querySelectorAll('[data-br-layer="duration"], [data-action-layer="duration"]').forEach(input => {
      const label = input.parentElement;
      const span = label.querySelector('span');
      if (span) span.textContent = view === 'overview' ? claudeUi('记录跨度', 'Recorded span') : claudeUi('执行耗时未记录', 'Execution timing unavailable');
      input.disabled = view !== 'overview';
      label.title = claudeUi('主线使用轮内记录跨度；未记录完整执行起止。', 'The timeline uses within-turn recorded spans; complete execution intervals are not recorded.');
    });
    $('review-all-retries')?.remove();
    $('graph-caption')?.querySelectorAll('[data-context-caption]').forEach(el => { if (reviewContextData.requests?.length) el.textContent = claudeUi('请求来源文本估算 · 非实报 tokens', 'Estimated request source text · not reported tokens'); else el.remove(); });
    let button = $('claude-source-link');
    if (!button) { button = document.createElement('button'); button.id = 'claude-source-link'; button.className = 'geist-text-action quiet'; button.onclick = showSource; $('geist-legend')?.append(button); }
    button.textContent = claudeUi('Claude 数据依据 ↗', 'Claude data sources ↗');
  };
  const claudeStyle = document.createElement('style');
  claudeStyle.textContent = '#geist-context-overview .study-source-actions{display:none}'; document.head.append(claudeStyle);
