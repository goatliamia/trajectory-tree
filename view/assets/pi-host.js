  // Pi uses the common objects and renderer; native provenance stays explicit.
  const piUi = (zh, en) => window.__trajectoryLocale === 'en' ? en : zh;
  const piSynthetic = data.synthetic === true, piPrefix = piSynthetic ? piUi('模拟', 'Synthetic ') : '';
  const piEvidence = data.evidence, piSource = piEvidence.source || {};
  const piNumber = value => value == null ? piUi('未记录', 'Not recorded') : Math.abs(value) >= 1000 ? (value / 1000).toFixed(1) + 'k' : String(Math.round(value));
  const piHeaderBase = header;
  header = function() { piHeaderBase(); $('review-state').textContent = session.totals.turns + piUi(' 轮', ' turns · ') + (piSynthetic ? piUi('模拟记录', 'synthetic') : piUi('原生记录', 'native')); };
  showSource = function() {
    openDrawer(piUi('Pi 数据依据', 'Pi data provenance'), piSynthetic ? piUi('按源码格式生成的合成样本', 'Synthetic sample in native format') : piUi('Session v3 · 只读原生记录', 'Session v3 · read-only native record'), [
      [piUi('来源','Source'), piSynthetic ? piUi('全部内容、时长、用量与结果均为模拟；没有调用模型。','All content, timing, usage and results are synthetic; no model was called.') : piSource.file || piUi('当前 SessionManager 选中分支','Branch selected in SessionManager')],
      [piUi('版本依据','Version'), piSource.revision ? (piSource.version || '') + ' · ' + piSource.revision : piUi('Pi Session v3；消息、分支与工具结果保留原生身份。','Pi Session v3; messages, branches and tool results retain native identities.')],
      [piUi('步骤','Steps'), piUi('一次 assistant cycle 与随后的工具结果；不同于 Codex 的可见动作。','An assistant cycle and subsequent tool results; distinct from Codex visible actions.')],
      [piUi('用量','Usage'), piUi('直接读取 AssistantMessage.usage。input、cacheRead、cacheWrite 相加得到该次输入；来源分色另作可见文本估算。','AssistantMessage.usage supplies input, cacheRead and cacheWrite; source colors separately estimate visible text.')],
      [piUi('上下文','Context'), piUi('按 parentId 分支、压缩的 firstKeptEntryId/systemMessage 和追加式 context_edit 回放；扩展 custom 状态不当作模型输入。','Replayed by parentId, compaction and context edits; extension custom state is excluded from model input.')],
      [piUi('文件与命令','Files and commands'), piUi('原生 read/edit/write 与 bash 的字面读取、搜索、执行分别保留。脚本里的读取意图不证明每个条件分支都执行。','Native file operations and literal bash reads, searches and executions are retained. A scripted read does not prove every conditional branch ran.')],
      [piUi('时间','Timing'), piUi('有 tool_execution_start/end 采集时按 toolCallId 配对；只有原生 durationMs 时单独显示执行计量，不倒推起点。扩展仅保留近期计时元数据。','Captured start and end events are paired by toolCallId. Native duration is retained separately without inferring a start; only recent timing metadata is kept.')],
      [piUi('工具与 Skill','Tools and skills'), piUi('SDK 当前目录与历史声明分别取证；Skill 目录、明确引用、正文读取分开，不推断影响区间。','Current SDK inventory and historical declarations are separate; skill catalogs, references and reads do not imply a period of influence.')],
      [piUi('边界','Limits'), piUi('可见文本估算不包含隐藏思考、媒体 tokens 和服务商序列化；未记录容量不画虚构比例。子代理仅展示明确记录的扩展活动。','Visible-text estimates exclude hidden reasoning, media tokens and provider serialization. Missing capacity is not invented. Subagents show only recorded extension activity.')],
    ].map(([label, value]) => '<div class="source-row"><span>' + esc(label) + '</span>' + esc(value) + '</div>').join(''));
  };
  const piContextBase = geistRenderContextOverview;
  geistRenderContextOverview = function() {
    piContextBase(); const region = $('geist-context-overview'); region.querySelector('.pi-context-note')?.remove();
    region.querySelector('h2').innerHTML = piSynthetic ? piUi('模拟请求输入 <small>Usage 示例 · 来源另作估算</small>', 'Synthetic request input <small>Example usage · estimated sources</small>') : piUi('最近请求输入 <small>Pi 实报用量 · 来源另作估算</small>', 'Latest request input <small>Pi reported usage · estimated sources</small>');
    const pressure = geistContextSnapshot?.pressure;
    if (piSynthetic || !pressure?.contextWindow) {
      region.querySelector('.geist-context-total>span').textContent = piSynthetic ? piUi('模拟用量', 'Synthetic usage') : piUi('容量未记录', 'Capacity not recorded');
      region.querySelector('.geist-context-total>div>span').textContent = piUi(' tokens · 来源构成见分色', ' tokens · colors show source mix');
      region.querySelector('.geist-context-occupied').style.width = '100%';
    }
    region.querySelector('.geist-context-meter').setAttribute('aria-label', piUi('可见文本来源构成估算；实际用量单独读取 Pi usage', 'Estimated visible-text sources; actual usage is read separately from Pi'));
    const note = document.createElement('p'); note.className = 'review-quiet pi-context-note'; note.style.cssText = 'font-size:11px;margin:6px 0 0';
    note.textContent = piSynthetic ? piUi('全部数据均为模拟；色条展示可见来源比例。', 'All data is synthetic; colors show visible source proportions.') : piUi('总数取自 Pi 实报输入；分色与趋势为可见文本估算。', 'Total input is reported by Pi; colors and trends estimate visible text.'); region.append(note);
  };
  geistShowCurrentSource = function(key, summary) {
    const category = geistContextCategory(key), item = summary.categories.find(i => i.key === key);
    openDrawer(category.label, 'Pi ' + piPrefix + piUi(' · 可见文本估算', ' · visible-text estimate'), '<p class="review-explain">' + piUi('约 ', 'Approximately ') + piNumber(item?.value) + piUi(' tokens 的文本估算量，来自当前保留的 Session v3 内容。中文字符计 1，其余字符除以 4；未包含隐藏思考、图片或服务商序列化。', ' estimated tokens from retained Session v3 content. Chinese characters count as one, others as one quarter; hidden reasoning, images and provider serialization are excluded.') + '</p>');
  };
  reviewOpenContextSources = function(key = 'system') { geistShowCurrentSource(key, contextOverview(null, null, reviewContextData.current)); };
  reviewOpenContext = function(number) {
    const row = reviewContextMap.get(number), changed = row ? CONTEXT_CATEGORIES.filter(c => row.isBaseline ? row.parts[c.key].after > 0 : row.parts[c.key].delta !== 0) : [];
    openDrawer(piUi('第 ', 'Turn ') + number + piUi(' 轮 · ', ' · ') + piPrefix + piUi('来源变化', 'source changes'), piUi('Pi 可见文本估算', 'Pi visible-text estimate'), '<p class="review-explain">' + piUi('比较请求前可见材料，不等同于服务商精确 token。','Compares visible material before requests, not exact provider tokens.') + '</p>' + changed.map(c => '<div class="source-row"><span>' + c.label + '</span>' + piUi('末次 ≈','Latest ≈') + piNumber(row.parts[c.key].after) + (row.isBaseline ? '' : piUi(' · 变化 ', ' · change ') + reviewSigned(row.parts[c.key].delta)) + '</div>').join(''));
  };
  reviewOpenCompaction = function(seqs) {
    openDrawer('Pi ' + piPrefix + piUi('压缩','compaction'), 'Session v3 · compaction', reviewContextData.boundaries.filter(e => seqs.includes(e.seq)).map(e => '<div class="source-row"><span>' + piUi('第 ', 'Turn ') + e.turn + piUi(' 轮 · tokensBefore=', ' · tokensBefore=') + piNumber(e.tokensBefore) + '</span>' + esc(e.summary) + '<p>firstKeptEntryId=' + esc(e.firstKeptEntryId) + piUi('；压缩前记录量不当作实际节省量。','; the recorded pre-compaction amount is not a measure of savings.') + '</p></div>').join(''));
  };
  const piCaptionBase = geistArrangeCaption;
  const piSourceButton = document.createElement('button'); piSourceButton.className = 'geist-text-action quiet'; piSourceButton.textContent = piUi('Pi 数据依据 ↗','Pi data provenance ↗'); piSourceButton.onclick = showSource;
  geistArrangeCaption = function() { piCaptionBase(); $('geist-legend')?.append(piSourceButton); };
  const piChangeBase = reviewOpenChange, piSummaryBase = reviewRenderStepSummary;
  reviewRenderStepSummary = function(t, step) { piSummaryBase(t, step); $('step-panel').querySelectorAll('[data-insight-change]').forEach(button => { if (step.calls.find(c => c.seq === Number(button.dataset.insightChange))?.nativeName === 'write') button.textContent = piUi('查看写入内容 ↗','View written content ↗'); }); };
  reviewOpenChange = function(t, step, fact, nested = false) {
    if (step.calls.find(c => c.seq === fact.seq)?.nativeName !== 'write') return piChangeBase(t, step, fact, nested);
    reviewOpenDetail({ title: piPrefix + piUi('写入内容','written content'), subtitle: fact.target + ' · Pi write.content', html: '<p class="review-quiet">' + piUi('展示完整写入参数；原生结果没有旧文件快照，不据此虚构完整差异。','Shows the complete write parameter. No prior file snapshot is available to construct a full diff.') + '</p>' + block({ text: fact.preview.after, omitted: 0 }) }, nested);
  };
  const piKnownSum = values => { const known = values.filter(n => Number.isFinite(n) && n >= 0); return known.length ? known.reduce((n, v) => n + v, 0) : null; };
  // Shared DSH fallback treats result-time point markers as measured intervals and
  // cumulative duration as wall time. Pi only has coverage for captured spans.
  toolTiming = function(stats) {
    if (!Number.isFinite(stats?.toolWall)) return { status: 'missing', spans: [], coverage: null, cumulative: stats?.tool ?? null };
    const spans = (stats.calls || []).map(c => ({ start: c.startedAt, end: c.endedAt, seq: c.seq }));
    return { status: 'measured', spans, coverage: stats.toolWall, cumulative: stats.tool, pending: stats.toolPending, partial: (stats.tools || []).reduce((n, t) => n + t.count, 0) > spans.length };
  };
  geistStatsByStep.clear();
  for (const t of session.turns) for (const s of t.steps) {
    const calls = s.calls.filter(c => /capture$/.test(c.timingSource) && c.end != null), spans = calls.map(c => [c.start, c.end]).sort((a, b) => a[0] - b[0]);
    let coverage = 0, end = -Infinity; for (const [a, b] of spans) { coverage += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
    geistStatsByStep.set(t.number + ':' + s.number, { turn: t.number, step: s.number, model: s.assistantDurationMs, toolWall: calls.length ? coverage : null, tool: piKnownSum(s.calls.map(c => c.durationMs)), calls: calls.map(c => ({ seq: c.seq, startedAt: c.start, endedAt: c.end })), tools: s.calls.map(c => ({ name: c.name, count: 1 })), toolPending: s.calls.filter(c => c.status === 'unknown').length });
  }
  geistOpenTiming = function(number, stepNumber) {
    const step = brRound(number).steps.find(s => s.number === stepNumber);
    openDrawer('Pi ' + piPrefix + piUi('时间','timing'), piUi('原生 durationMs 与采集起止分别保留','Native duration and captured timestamps are kept separately'), '<p>' + piUi('助手原生耗时：','Native assistant duration: ') + (step.assistantDurationMs == null ? piUi('未记录','Not recorded') : preciseTime(step.assistantDurationMs)) + '.</p><p>' + piUi('工具只有采集起止时才展示执行区间；没有把历史顺序或结果时刻当成工具起点。','Tool intervals require captured start and end times; result timestamps do not imply a start.') + '</p>');
  };
