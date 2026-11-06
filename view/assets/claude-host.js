  // Claude local transcripts supply message usage, not a reconstructed request.
  const claudeUi = (zh, en) => window.__trajectoryLocale === 'en' ? en : zh;
  const claudeHeader = header;
  header = function() {
    claudeHeader();
    $('session-name').textContent = claudeUi('CLAUDE CODE · 本地记录', 'CLAUDE CODE · Local transcript');
    $('session-facts').innerHTML = session.totals.turns + claudeUi(' 轮', ' turns') + '<span>/</span>' + session.totals.steps + claudeUi(' 条助手记录', ' assistant records') + '<span>/</span>' + session.totals.calls + claudeUi(' 次工具调用', ' tool calls');
  };
  showSource = function() {
    const rows = [
      [claudeUi('来源', 'Source'), data.evidence.source?.file || claudeUi('显式选定的本地 transcript', 'Explicitly selected local transcript')],
      [claudeUi('单位', 'Units'), claudeUi('一条可见助手记录为一步；同一消息可含多条记录，用量按消息 ID 只计一次。工具调用与结果按 ID 配对。', 'Each visible assistant record is one step. A message can contain multiple records; usage is counted once per message ID. Tool calls and results are paired by ID.')],
      [claudeUi('用量', 'Usage'), claudeUi('读取记录中的 input、output、cache read 和 cache creation tokens；缺失字段保持未知。', 'Input, output, cache read and cache creation tokens come from the transcript; missing fields remain unknown.')],
      [claudeUi('上下文', 'Context'), claudeUi('未记录完整请求组成、工具定义和隐藏上下文，不能据此重建请求或来源比例。', 'The complete request, tool definitions and hidden context are not recorded, so request composition and source proportions cannot be reconstructed.')],
      [claudeUi('覆盖', 'Coverage'), claudeUi('仅当前文件中的可见内容；未重建分支与子代理记录。时间起止缺失时不推算耗时。', 'Only visible content in this file is included; branches and subagent transcripts are not reconstructed. Duration is not inferred when start or end times are missing.')],
    ];
    openDrawer(claudeUi('Claude Code 数据依据', 'Claude Code data sources'), claudeUi('本地 transcript · 只读', 'Local transcript · read only'), rows.map(([k, v]) => '<div class="source-row"><span>' + esc(k) + '</span>' + esc(v) + '</div>').join(''));
  };
  const claudeValue = n => Number.isFinite(n) ? String(n) : claudeUi('未记录', 'Not recorded');
  geistRenderContextOverview = function() {
    let region = $('geist-context-overview');
    if (!region) { region = document.createElement('section'); region.id = 'geist-context-overview'; region.className = 'geist-context-overview'; region.setAttribute('aria-label', claudeUi('当前上下文总览', 'Current context overview')); $('graph-scroll').before(region); }
    const latest = (reviewContextData.usage || []).at(-1)?.usage;
    region.innerHTML = '<header><h2>' + claudeUi('请求上下文', 'Request context') + ' <small>' + claudeUi('组成未记录', 'Composition not recorded') + '</small></h2></header><p class="review-quiet">' + claudeUi('Claude transcript 未提供完整请求组成或模型窗口，无法显示来源比例。', 'The Claude transcript does not provide the complete request composition or model window, so source proportions cannot be shown.') + '</p>' + (latest ? '<p class="review-quiet">' + claudeUi('最近一条已记录用量：输入 ', 'Latest recorded usage: input ') + claudeValue(latest.input) + claudeUi(' · 缓存读取 ', ' · cache read ') + claudeValue(latest.cacheRead) + claudeUi(' · 缓存创建 ', ' · cache creation ') + claudeValue(latest.cacheWrite) + claudeUi(' · 输出 ', ' · output ') + claudeValue(latest.output) + ' tokens.</p>' : '<p class="review-quiet">' + claudeUi('用量未记录。', 'Usage not recorded.') + '</p>');
  };
  reviewOpenContext = function(number) {
    const rows = (reviewContextData.usage || []).filter(u => u.turn === number);
    openDrawer(claudeUi('第 ' + number + ' 轮 · Claude 用量', 'Turn ' + number + ' · Claude usage'), claudeUi('原生消息记录', 'Native message records'), rows.length ? rows.map(({ usage: u }) => '<div class="source-row"><span>' + claudeUi('消息用量', 'Message usage') + '</span>' + claudeUi('输入 ', 'Input ') + claudeValue(u.input) + claudeUi(' · 缓存读取 ', ' · cache read ') + claudeValue(u.cacheRead) + claudeUi(' · 缓存创建 ', ' · cache creation ') + claudeValue(u.cacheWrite) + claudeUi(' · 输出 ', ' · output ') + claudeValue(u.output) + ' tokens</div>').join('') : '<p>' + claudeUi('用量未记录。', 'Usage not recorded.') + '</p>');
  };
  reviewOpenContextSources = function() { showSource(); };
  geistShowCurrentSource = function() { showSource(); };
  reviewOpenCompaction = function() { openDrawer(claudeUi('上下文压缩', 'Context compaction'), 'Claude Code', '<p>' + claudeUi('当前记录未重建压缩后的请求组成。', 'The request composition after compaction is not reconstructed from this transcript.') + '</p>'); };
  geistOpenTiming = function() { openDrawer(claudeUi('时间', 'Timing'), 'Claude Code transcript', '<p>' + claudeUi('工具开始与结束时间未完整记录，无法计算耗时。', 'Tool start and end times are not fully recorded, so duration cannot be calculated.') + '</p>'); };
  geistStatsByStep.clear();
  for (const t of session.turns) for (const s of t.steps) geistStatsByStep.set(t.number + ':' + s.number, { turn: t.number, step: s.number, model: null, toolWall: null, tool: null, calls: [], tools: s.calls.map(c => ({ name: c.name, count: 1 })), toolPending: s.calls.filter(c => c.status === 'unknown').length });
  const claudeCaption = geistArrangeCaption;
  geistArrangeCaption = function() {
    claudeCaption();
    $('review-all-retries')?.remove();
    $('graph-caption')?.querySelectorAll('[data-context-caption]').forEach(el => el.remove());
    if (!$('claude-source-link')) { const button = document.createElement('button'); button.id = 'claude-source-link'; button.className = 'geist-text-action quiet'; button.textContent = claudeUi('Claude 数据依据 ↗', 'Claude data sources ↗'); button.onclick = showSource; $('geist-legend')?.append(button); }
  };
  const claudeStyle = document.createElement('style');
  claudeStyle.textContent = '#geist-context-overview .study-source-actions{display:none}'; document.head.append(claudeStyle);
