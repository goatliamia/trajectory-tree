(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const data = JSON.parse($('eval-data').textContent);
  const locale = globalThis.__trajectoryLocale ?? 'zh-CN';
  const t = (zh, en) => locale === 'en' ? en : zh;
  const turnLabel = turn => t(`第 ${turn} 轮`, `Turn ${turn}`);
  const turns = new Map(data.turns.map(row => [row.number, row]));
  const scopeSelect = $('scope');
  const errorCells = new Map();
  let selectedError = null;
  let usageTurn = null;
  const usagePair = [];
  let usageSlot = 0;
  const defaultSort = globalThis.__trajectoryEvalToolSort;
  const state = { turn: null, sort: ['calls', 'errors'].includes(defaultSort) ? defaultSort : 'time', allTools: false, tool: null };
  const standardOrder = ['tool-comparison', 'tool-errors', 'turn-usage', 'eval-findings'];
  const views = {
    classic: { title: t('运行评估', 'Session evaluation'), sections: standardOrder },
    overview: { title: t('轮次总览', 'Turn overview'), sections: ['turn-usage', 'tool-comparison', 'tool-errors', 'eval-findings'] },
    monitor: { title: t('工具监控', 'Tool monitor'), sections: standardOrder },
    evidence: { title: t('证据工作台', 'Evidence workspace'), sections: ['tool-errors', 'turn-usage', 'tool-comparison', 'eval-findings'] },
  };
  const toolLimit = 5;
  const number = new Intl.NumberFormat(locale);
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const fmt = value => Number.isFinite(value) ? number.format(value) : '—';
  const pct = value => Number.isFinite(value) ? decimal.format(value * 100) + '%' : '—';
  const ratio = (value, total) => total ? `${fmt(value)} / ${fmt(total)}` : '—';
  const html = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const record = seq => `<code class="record-tag">#${seq}</code>`;
  const unknownTool = t('未记工具名', 'Unnamed tool');
  const toolName = name => html(name || unknownTool);
  const scopeLabel = () => state.turn == null ? t('整段会话', 'Full session') : turnLabel(state.turn);
  const scopeMetrics = () => turns.get(state.turn)?.metrics ?? data.whole;
  const selectedTool = metrics => metrics.tools.find(tool => tool.name === state.tool);
  const findingSource = () => {
    const source = window.__trajectoryDiagnosisOptions?.source?.() ?? {};
    return {...source,host:data.host,session:source.session ?? data.codeExecution?.session,cut:data.cut};
  };
  const findingsBoard = globalThis.__mountEvalFindings?.($('eval-findings'), {
    getEntries:()=> {
      const source = findingSource();
      return (data.findingCalls??[]).filter(row=>state.turn==null||row.turn===state.turn).map(row=>({...row,source}));
    },
    onDiagnose:(selection,button,view)=>window.__diagnosisDemoAsk?.(selection,button,view),
  });

  function clockDuration(ms) {
    if (!Number.isFinite(ms) || ms < 60_000) return shortDuration(ms);
    const seconds = Math.round(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const pad = value => String(value).padStart(2, '0');
    return hours ? `${hours}h ${pad(minutes)}m ${pad(seconds % 60)}s` : `${minutes}m ${pad(seconds % 60)}s`;
  }

  function shortDuration(ms) {
    if (!Number.isFinite(ms)) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${decimal.format(ms / 1000)}s`;
  }

  const errorNames = {
    FS_NOT_OBSERVED: t('修改前未读取文件', 'File not read before editing'),
    FS_STALE_VERSION: t('文件版本已变化', 'File version changed'),
    FS_EDIT_NOT_FOUND: t('找不到待替换文本', 'Replacement target not found'),
    FS_NOT_FOUND: t('文件未找到', 'File not found'), FS_NOT_TEXT: t('文件不是文本', 'File is not text'),
    SESSION_QUERY_PERSISTENCE_FAILED: t('历史记录读取失败', 'Could not read session history'),
    TOOL_TIMEOUT: t('工具调用超时', 'Tool call timed out'), CODE_RUN_FAILED: t('代码执行失败', 'Code execution failed'),
    SEARCH_FAILED: t('搜索失败', 'Search failed'), WEB_UNSUPPORTED_CONTENT_TYPE: t('网页内容类型不支持', 'Unsupported web content type'),
    WEB_PROVIDER_ERROR: t('网页服务报错', 'Web provider error'), WEB_REDIRECT_BLOCKED: t('网页重定向受阻', 'Web redirect blocked'),
    ABORTED: t('执行中止', 'Aborted'), ABORTED_BEFORE_DISPATCH: t('调度前取消', 'Cancelled before dispatch'),
    TOOL_OUTCOME_UNKNOWN: t('宿主报告结果未知', 'Host reports an unknown outcome'), TOOL_ERROR: t('无细分错误码', 'Unspecified error code'),
  };
  const errorName = code => {
    const label = data.failureLabels && Object.hasOwn(data.failureLabels, code) ? data.failureLabels[code] : null;
    return html(label ? t(...label) : /^EXIT_-?\d+$/.test(code) ? t('命令退出', 'Command exit')
      : Object.hasOwn(errorNames, code) ? errorNames[code] : code);
  };
  const errorCategories = new Map([
    [t('文件修改保护', 'File edit protection'), ['FS_NOT_OBSERVED', 'FS_STALE_VERSION']],
    [t('文件与编辑目标', 'Files and edit targets'), ['FS_NOT_FOUND', 'FS_NOT_TEXT', 'FS_EDIT_NOT_FOUND']],
    [t('服务与访问', 'Services and access'), ['SESSION_QUERY_PERSISTENCE_FAILED', 'SEARCH_FAILED', 'WEB_UNSUPPORTED_CONTENT_TYPE',
      'WEB_PROVIDER_ERROR', 'WEB_REDIRECT_BLOCKED']],
    [t('调用超时', 'Timeouts'), ['TOOL_TIMEOUT']],
    [t('中止与取消', 'Aborts and cancellations'), ['ABORTED', 'ABORTED_BEFORE_DISPATCH']],
    [t('结果待确认', 'Unconfirmed outcomes'), ['TOOL_OUTCOME_UNKNOWN']],
    [t('代码执行失败', 'Code execution failed'), ['CODE_RUN_FAILED']],
  ].flatMap(([category, codes]) => codes.map(code => [code, category])));

  function groupErrors(conditions) {
    const groups = new Map();
    for (const condition of conditions) {
      const category = data.failureCategories?.[condition.category];
      const label = category ? t(...category) : errorCategories.get(condition.code) ?? t('其他工具报错', 'Other tool errors');
      if (!groups.has(label)) groups.set(label, { label, calls: 0, matched: 0, conditions: [] });
      const group = groups.get(label);
      group.calls += condition.calls;
      group.matched += condition.matched;
      group.conditions.push(condition);
    }
    return [...groups.values()].sort((a, b) => b.calls - a.calls);
  }

  function facts(entries) {
    return `<dl class="facts">${entries.map(([label, value]) =>
      `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
  }

  function renderSummary({ timing }) {
    const measured = ratio(timing.turns.measured, timing.turns.total);
    const coverage = t(`${measured} 轮有起止记录`, `${measured} turns have recorded timing`);
    $('summary').innerHTML = `<div class="readout">
      <p class="readout-label">${t('各轮耗时合计', 'Total turn duration')}</p>
      <strong>${clockDuration(timing.turns.ms)}</strong><small>${coverage}</small>
    </div>`;
  }

  function renderOutcomes(outcomes) {
    const parts = [
      { label: t('非报错返回', 'Non-error result'), count: outcomes.returned, mark: 'returned' },
      { label: t('报错', 'Error'), count: outcomes.errors, mark: 'error' },
      { label: t('无结果记录', 'Result unrecorded'), count: outcomes.unknown, mark: 'unknown' },
    ];
    $('outcome-chart').innerHTML = `<div class="outcome-head">
      <span class="outcome-total"><span class="outcome-total-label">${t('调用结果', 'Tool outcomes')}</span> <strong class="mono">${fmt(outcomes.calls)}</strong><small>${t(' 次', ' calls')}</small></span>
      <span class="outcome-coverage">${t('结果覆盖', 'Result coverage')} <code>${pct(outcomes.outcomeCoverage)}</code></span>
    </div>
    <div class="bar-track" aria-hidden="true"><div class="result-bar">
      ${parts.map(part => `<i class="segment-${part.mark}" style="width:${outcomes.calls ? part.count / outcomes.calls * 100 : 0}%"></i>`).join('')}
    </div></div>
    <div class="legend outcome-legend">${parts.map(part =>
      `<span><i class="swatch swatch-${part.mark}" aria-hidden="true"></i>${part.label} <code>${fmt(part.count)}</code></span>`).join('')}</div>`;
  }

  function latencyView(stats, samples, includeTool) {
    const reported = stats.reportedCalls ? `<p class="tail-note">${t(
      `另有 ${fmt(stats.reportedCalls)} 次调用记录了单次耗时，合计 ${clockDuration(stats.reportedMs)}。`,
      `${fmt(stats.reportedCalls)} other calls report a duration, totaling ${clockDuration(stats.reportedMs)}.`,
    )}</p>` : '';
    if (!stats.pairedCalls) return `<p class="empty">${t('此范围暂无有起止记录的调用。', 'No calls in this scope have a recorded start and result.')}</p>` + reported;
    const bins = data.durationBins;
    const max = Math.max(1, ...stats.counts);
    const target = Math.max(1, max / 4);
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const step = [1, 2, 2.5, 5, 10].map(value => Math.ceil(value * magnitude)).find(value => value >= target);
    const ceiling = Math.ceil(max / step) * step;
    const ticks = Array.from({ length: ceiling / step + 1 }, (_, index) => index * step);
    const binsLabel = bins.map((bin, index) => t(`${bin.label} ${bin.unit} 有 ${fmt(stats.counts[index])} 次`,
      `${bin.label} ${bin.unit}: ${fmt(stats.counts[index])} calls`)).join(t('，', ', '));
    const longCalls = stats.counts.at(-1);
    const coverage = ratio(stats.pairedCalls, stats.calls);
    return `<div class="evidence-head"><h4>${t('耗时分布', 'Duration distribution')}</h4><small>${t(`${coverage} 次有起止`, `${coverage} calls timed`)}</small></div>
    <div class="latency-facts">
      <div><span>${t('中位数', 'Median')}</span><strong class="mono">${shortDuration(stats.p50Ms)}</strong></div>
      <div><span title="${t('至少 20 个配对样本才显示 P95', 'P95 requires at least 20 timed calls')}">P95</span><strong class="mono">${stats.pairedCalls >= 20 ? shortDuration(stats.p95Ms) : '—'}</strong></div>
    </div>
    <div class="histogram" role="img" aria-label="${t('各时长档的调用次数。', 'Call counts by duration. ')}${html(binsLabel)}">
      <div class="histogram-axis mono" aria-hidden="true">
        ${ticks.map(tick => `<span style="bottom:${tick / ceiling * 100}%">${fmt(tick)}</span>`).join('')}
      </div>
      <div class="histogram-area">
        <div class="histogram-grid" aria-hidden="true">${ticks.map(tick =>
          `<i style="bottom:${tick / ceiling * 100}%"></i>`).join('')}</div>
        <div class="histogram-columns">
          ${bins.map((bin, index) => {
            const count = stats.counts[index];
            return `<div class="histogram-bin" style="--height:${count / ceiling * 100}%">
              <div class="histogram-plot"><span class="histogram-count mono">${fmt(count)}</span><i class="histogram-bar"></i></div>
              <div class="histogram-label mono">${html(bin.label)}<span>${bin.unit}</span></div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
    ${longCalls ? `<p class="tail-note"><i aria-hidden="true"></i><span>${t(
      `耗时 ≥ ${shortDuration(data.longCallMs)} 的 <strong>${fmt(longCalls)} 次</strong>调用，占已测耗时 <strong>${pct(stats.longMs / stats.cumulativeMs)}</strong>`,
      `<strong>${fmt(longCalls)}</strong> calls lasted at least ${shortDuration(data.longCallMs)}, accounting for <strong>${pct(stats.longMs / stats.cumulativeMs)}</strong> of measured time`,
    )}</span></p>` : ''}
    ${samples.length ? `<section class="slowest">
      <div class="evidence-head"><h4>${t('最慢的调用', 'Slowest calls')}</h4><small>${t('发起 → 结果', 'Start → result')}</small></div>
      <ol>${samples.map(sample => `<li>
        <span>${turnLabel(fmt(sample.turn))} ${includeTool ? `· <code>${toolName(sample.tool)}</code> ` : ''}
          ${record(sample.call)} <span aria-hidden="true">→</span> ${record(sample.result)}</span>
        <strong class="mono" title="${fmt(sample.ms)} ms">${clockDuration(sample.ms)}</strong>
      </li>`).join('')}</ol>
    </section>` : ''}${reported}`;
  }

  function renderComparison(metrics) {
    const { tools, timing } = metrics;
    const maxMs = Math.max(0, ...tools.map(tool => tool.timing.cumulativeMs ?? 0)) || 1;
    const maxErrors = Math.max(1, ...tools.map(tool => tool.errors));
    const order = {
      calls: tool => tool.calls,
      errors: tool => tool.errors,
      time: tool => tool.timing.cumulativeMs ?? -1,
    }[state.sort];
    const ranked = tools.map((tool, index) => ({ tool, index })).sort((a, b) =>
      order(b.tool) - order(a.tool) || b.tool.calls - a.tool.calls || a.tool.name.localeCompare(b.tool.name));
    const visible = state.allTools ? ranked : ranked.slice(0, toolLimit);
    const active = ranked.find(({ tool }) => tool.name === state.tool);
    if (active && !visible.includes(active)) visible.push(active);
    const lead = tools.find(tool => tool.timing.cumulativeMs === maxMs);
    if (lead && timing.calls.cumulativeMs > 0) {
      const share = `<strong>${pct(maxMs / timing.calls.cumulativeMs)}</strong>`;
      $('tool-caption').innerHTML = `<code>${toolName(lead.name)}</code> ${t(`占已测工具累计耗时的 ${share}`, `accounts for ${share} of measured tool duration`)}`;
    } else $('tool-caption').textContent = `${scopeLabel()} · ${t(`${fmt(tools.length)} 种工具`, `${fmt(tools.length)} tools`)}`;
    const list = $('tool-rows');
    list.classList.toggle('is-expanded', state.allTools);
    list.innerHTML = visible.map(({ tool, index }) => {
      const ms = tool.timing.cumulativeMs;
      const timeLabel = clockDuration(ms);
      const label = t(`${toolName(tool.name)}，${fmt(tool.calls)} 次调用，累计耗时 ${timeLabel}，${fmt(tool.errors)} 次报错`,
        `${toolName(tool.name)}, ${fmt(tool.calls)} calls, ${timeLabel} cumulative duration, ${fmt(tool.errors)} errors`);
      return `<button type="button" class="compare-row" data-tool="${index}" aria-controls="tool-inspector"
        aria-pressed="${tool.name === state.tool}" aria-label="${label}">
        <span class="compare-name"><code>${toolName(tool.name)}</code><small>${t(`${fmt(tool.calls)} 次调用`, `${fmt(tool.calls)} calls`)}</small></span>
        <span class="compare-value compare-time">
          <span class="bar-track" aria-hidden="true"><i style="width:${(ms ?? 0) / maxMs * 100}%"></i></span>
          <span class="mono"${ms == null ? '' : ` title="${fmt(ms)} ms"`}>${timeLabel}</span>
        </span>
        <span class="compare-value compare-errors">
          <span class="bar-track" aria-hidden="true"><i style="width:${tool.errors / maxErrors * 100}%"></i></span>
          <span class="mono${tool.errors ? ' danger' : ' quiet-number'}">${fmt(tool.errors)}</span>
        </span>
      </button>`;
    }).join('') || `<p class="empty">${t('此范围内暂无工具调用。', 'No tool calls in this scope.')}</p>`;
    list.scrollTop = 0;
    const coverage = ratio(timing.calls.pairedCalls, timing.calls.calls);
    $('tool-footnote').textContent = timing.calls.calls ? t(`${coverage} 次调用有起止 · 条长按各列最大值缩放`,
      `${coverage} calls timed · bars scale to each column's maximum`) : '';
    const more = $('tool-more');
    more.hidden = ranked.length <= visible.length && !state.allTools;
    more.setAttribute('aria-expanded', String(state.allTools));
    more.textContent = state.allTools ? t('收起工具', 'Show fewer tools')
      : t(`查看全部 ${fmt(ranked.length)} 种工具`, `Show all ${fmt(ranked.length)} tools`);
    for (const button of $('tool-sort').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.sort === state.sort));
    }
  }

  function samplePairs(examples) {
    const matched = examples.find(row => row.returned != null);
    const unmatched = examples.find(row => row.returned == null);
    return [matched, unmatched].filter(Boolean).map(sample => {
      const returned = sample.returned != null;
      return `<div class="error-pair">
        <div class="pair-marker" aria-hidden="true"></div>
        <div>${t(`第 ${sample.turn} 轮报错调用`, `Failed call in turn ${sample.turn}`)} ${record(sample.failed)}${window.__diagnosisDemoAsk
          ? ` <button type="button" class="text-action" data-diagnosis-failure="${sample.failed}"${sample.powerShell ? ' data-powershell' : ''}>${t('问这次', 'Ask about this call')}</button>` : ''}
          ${sample.attribution ? `<p class="error-attribution">${html(window.__trajectoryFailureText(sample.attribution))}
            ${sample.result != null && sample.result !== sample.failed ? record(sample.result) : ''}</p>` : ''}</div>
        ${sample.read != null ? `<div class="pair-marker read" aria-hidden="true"></div>
          <div>${t('读取目标文件', 'Target file read')} ${record(sample.read)}</div>` : ''}
        <div class="pair-marker ${returned ? 'returned' : 'unknown'}" aria-hidden="true"></div>
        <div>${returned ? t('后续同参调用未报错 ', 'Later non-error return with the same arguments ') + record(sample.returned)
          : t('本轮未见同参非报错返回', 'No non-error return with the same arguments was recorded in this turn')}</div>
      </div>`;
    }).join('');
  }

  function slowestCalls(tools, limit) {
    return tools.flatMap(tool => tool.slowest.map(sample => ({ ...sample, tool: tool.name })))
      .sort((a, b) => b.ms - a.ms || b.call - a.call).slice(0, limit);
  }

  function diagnosisAction(host, label, selection, view) {
    if (!window.__diagnosisDemoAsk) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-action eval-diagnosis-action';
    button.textContent = label;
    button.onclick = () => window.__diagnosisDemoAsk(selection, button, view);
    host.append(button);
  }

  function renderInspector(metrics) {
    const tool = selectedTool(metrics);
    const stats = tool?.timing ?? metrics.timing.calls;
    $('selected-tool-title').textContent = tool ? tool.name || unknownTool : t('全部工具', 'All tools');
    $('selected-tool-title').classList.toggle('mono', Boolean(tool));
    $('show-all-latency').hidden = !tool;
    $('tool-error-link').hidden = !tool?.errorConditions.length;
    const samples = tool?.slowest ?? slowestCalls(metrics.tools, 3);
    $('tool-evidence').innerHTML = latencyView(stats, samples, !tool);
    const questionLabel = data.host === 'dsh' && tool?.name ? t('问这项工具', 'Ask about this tool') : t('问工具耗时', 'Ask about tool timing');
    diagnosisAction($('tool-evidence'), questionLabel, { kind: 'tool', turn: state.turn, name: tool?.name,
      timing: stats, slowest: samples });
  }

  function selectErrorCell(key) {
    const cell = errorCells.get(key);
    if (!cell) return;
    selectedError = cell;
    for (const button of $('error-matrix').querySelectorAll('[data-cell]')) {
      button.setAttribute('aria-pressed', String(button.dataset.cell === key));
    }
    const { tool, group } = cell;
    $('error-example').innerHTML = `<p class="evidence-label">${t('报错样本', 'Error samples')}</p>
      <h3><code>${toolName(tool)}</code><span aria-hidden="true"> × </span>${group.label}</h3>
      <p><strong class="mono">${ratio(group.matched, group.calls)}</strong> ${t('次报错后有同轮同参非报错返回', 'errors were followed by a non-error return with the same arguments in the same turn')}</p>
      <div class="error-conditions" role="group" aria-label="${t('按错误码查看样本', 'View samples by error code')}">
        ${group.conditions.map((condition, index) => `<button type="button" class="error-condition"
          data-condition="${index}" aria-pressed="${index === 0}">
          <span>${errorName(condition.code)}</span>
          <span class="condition-count">${t(`${fmt(condition.calls)} 次`, `${fmt(condition.calls)} calls`)}</span>
          <code>${html(condition.code)}</code>
        </button>`).join('')}
      </div>
      <div id="error-samples" aria-live="polite">${samplePairs(group.conditions[0].examples)}</div>`;
    diagnosisAction($('error-example'), t('问这组报错', 'Ask about these errors'), { kind: 'group', turn: state.turn, tool, group });
  }

  function renderErrors({ tools, outcomes, attributionCoverage }) {
    const errorTools = tools.filter(tool => tool.errorConditions?.length)
      .sort((a, b) => b.errors - a.errors || a.name.localeCompare(b.name));
    const columns = groupErrors(errorTools.flatMap(tool => tool.errorConditions));
    const top = columns[0];
    if (outcomes.errors && attributionCoverage) $('error-caption').textContent = globalThis.__trajectoryFailureCoverageText(attributionCoverage);
    else if (top) $('error-caption').innerHTML = `<strong>${ratio(top.calls, outcomes.errors)}</strong> ${t(
      `次工具报错集中在「<strong>${top.label}</strong>」`, `tool errors fall under <strong>${top.label}</strong>`,
    )}`;
    else $('error-caption').textContent = outcomes.errors
      ? t(`${fmt(outcomes.errors)} 次工具报错，暂无可分类的记录。`, `${fmt(outcomes.errors)} tool errors lack classification records.`)
      : t(`${scopeLabel()}未记录工具报错。`, `No tool errors recorded in this scope.`);
    $('matrix-note').hidden = !top;
    $('error-example').hidden = !top;
    $('error-layout').classList.toggle('has-selection', Boolean(top));
    selectedError = null;
    errorCells.clear();
    if (!top) {
      $('error-matrix').innerHTML = '';
      $('error-example').innerHTML = '';
      return;
    }

    let peak = 0;
    let firstCell;
    const rows = errorTools.map((tool, row) => {
      const groups = new Map(groupErrors(tool.errorConditions).map(group => [group.label, group]));
      const keys = columns.map((column, col) => {
        const group = groups.get(column.label);
        if (!group) return null;
        const key = `${row}-${col}`;
        errorCells.set(key, { tool: tool.name, group });
        if (group.calls > peak) {
          peak = group.calls;
          firstCell = key;
        }
        return key;
      });
      return { tool: tool.name, keys };
    });
    $('error-matrix').innerHTML = `<div class="matrix-scroll" tabindex="0" role="region" aria-label="${t('工具与报错类型热图，可横向滚动', 'Tool and error type heatmap, scrollable horizontally')}">
      <table class="error-matrix">
        <caption class="sr-only">${t('各报错类型下每种工具的报错次数', 'Error counts by tool and type')}</caption>
        <thead><tr><th scope="col">${t('工具 / 类型', 'Tool / type')}</th>${columns.map(column => `<th scope="col">
          ${column.label}<small class="mono">${t(`${fmt(column.calls)} 次`, `${fmt(column.calls)} errors`)}</small>
        </th>`).join('')}</tr></thead>
        <tbody>${rows.map(row => `<tr><th scope="row"><code>${toolName(row.tool).replaceAll('_', '_<wbr>')}</code></th>${row.keys.map(key => {
          if (key === null) return `<td class="matrix-zero" aria-label="${t('0 次', '0 errors')}">–</td>`;
          const { tool, group } = errorCells.get(key);
          return `<td><button type="button" class="heat-cell mono" data-cell="${key}" aria-controls="error-example"
            aria-label="${t(`${toolName(tool)}，${group.label}，${fmt(group.calls)} 次报错`, `${toolName(tool)}, ${group.label}, ${fmt(group.calls)} errors`)}"
            style="--heat:${14 + group.calls / peak * 34}%">${fmt(group.calls)}</button></td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
    selectErrorCell(firstCell);
  }

  function hasUsagePoint({ usage, timing }) {
    return usage.requests > 0 && usage.outputRecords === usage.requests &&
      Number.isFinite(usage.output) && Number.isFinite(timing.turns.ms);
  }

  function usageScale(max, knee, candidates) {
    const limit = Math.max(1, max) * 1.12;
    const unit = Math.min(knee, limit / 8);
    const span = Math.log1p(limit / unit);
    const place = value => Math.log1p(value / unit) / span * 100;
    const ticks = [0];
    for (const tick of candidates) {
      if (tick > limit) break;
      if (place(tick) - place(ticks.at(-1)) >= 13) ticks.push(tick);
    }
    return { place, ticks };
  }

  function renderUsagePlot() {
    const samples = data.turns.filter(row => hasUsagePoint(row.metrics)).map(({ number, metrics }) => ({
      number, output: metrics.usage.output, elapsed: metrics.timing.turns.ms, errors: metrics.outcomes.errors,
    }));
    const comparable = ratio(samples.length, data.turns.length);
    $('usage-coverage').textContent = t(`整段会话 · ${comparable} 轮可比`, `Full session · ${comparable} comparable turns`);
    if (!samples.length) {
      const recorded = data.turns.filter(row => Number.isFinite(row.metrics.usage.output));
      $('usage-title').textContent = recorded.length ? t('每轮输出 token', 'Output tokens per turn') : t('轮次用量与耗时', 'Turn usage and duration');
      $('usage-caption').textContent = recorded.length ? t('按轮展示已记录的输出用量。', 'Recorded output by turn.')
        : t('按轮比较模型输出量和耗时。', 'Compare model output and elapsed time by turn.');
      if (!recorded.length) {
        $('usage-chart').innerHTML = `<p class="empty">${t('此范围暂无可用于对照的输出和耗时记录。', 'No comparable output and timing records in this scope.')}</p>`;
        return null;
      }
      const scale = Math.max(1, ...recorded.map(row => row.metrics.usage.output));
      $('usage-chart').innerHTML = `<div class="usage-output-list">${recorded.map(({ number, metrics }) =>
        `<button type="button" class="usage-output-row" data-usage-turn="${number}"><span>${turnLabel(fmt(number))}</span><i aria-hidden="true" style="--portion:${metrics.usage.output / scale * 100}%"></i><code>${fmt(metrics.usage.output)} ${t('token', 'tokens')}</code></button>`).join('')}</div>`;
      const coverage = ratio(recorded.length, data.turns.length);
      $('usage-coverage').textContent = t(`${coverage} 轮有输出记录`, `${coverage} turns have recorded output`);
      return recorded.at(-1).number;
    }

    const withErrors = samples.filter(row => row.errors > 0);
    const totalOutput = samples.reduce((total, row) => total + row.output, 0);
    const errorOutput = withErrors.reduce((total, row) => total + row.output, 0);
    const share = `<strong title="${fmt(errorOutput)} / ${fmt(totalOutput)} ${t('token', 'tokens')}">${pct(errorOutput / totalOutput)}</strong>`;
    $('usage-caption').innerHTML = withErrors.length && totalOutput > 0
      ? `<strong>${ratio(withErrors.length, samples.length)}</strong> ${t(`轮记录了工具报错，合计占可比轮次输出的 ${share}`,
        `turns had tool errors and account for ${share} of comparable output`)}`
      : t('每个点对应一轮的模型输出量和耗时。', 'Each point shows model output and elapsed time for one turn.');

    const ordered = [...samples].sort((a, b) => a.output - b.output || b.number - a.number);
    const middle = (ordered.length - 1) / 2;
    const median = (ordered[Math.floor(middle)].output + ordered[Math.ceil(middle)].output) / 2;
    const slowestBelowMedian = samples.filter(row => row.output <= median)
      .reduce((slowest, row) => !slowest || row.elapsed > slowest.elapsed ? row : slowest, null);
    const distance = row => Math.abs(row.output - slowestBelowMedian.output);
    const closest = samples.filter(row => row !== slowestBelowMedian)
      .reduce((nearest, row) => !nearest || distance(row) < distance(nearest) ? row : nearest, null);
    if (closest) usagePair.push(slowestBelowMedian.number, closest.number);
    const x = usageScale(ordered.at(-1).output, 1_000,
      [1, 3, 10, 30, 100, 300, 1_000, 3_000, 10_000, 30_000, 100_000, 300_000, 1_000_000, 3_000_000, 10_000_000]);
    const y = usageScale(Math.max(...samples.map(row => row.elapsed)), 10_000,
      [1, 3, 10, 30, 100, 300, 1_000, 3_000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000, 10_800_000]);
    const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
    const elapsedTick = ms => ms >= 3_600_000 ? `${ms / 3_600_000}h` : ms >= 60_000 ? `${ms / 60_000}m` : shortDuration(ms);
    const medianX = x.place(median);
    const peerLink = closest ? `<svg id="usage-peer-link" class="usage-peer-link" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" hidden>
      <line vector-effect="non-scaling-stroke" />
    </svg>` : '';

    $('usage-chart').innerHTML = `<div class="usage-chart-head">
      <span>${t('单轮耗时', 'Turn duration')}</span>
      <div class="legend usage-legend">
        <span><i class="usage-mark" aria-hidden="true"></i>${t('未记录工具报错', 'No recorded tool errors')}</span>
        <span><i class="usage-mark usage-mark-error" aria-hidden="true"></i>${t('有工具报错', 'Tool errors recorded')}</span>
      </div>
    </div>
    <div class="usage-plot">
      <div class="usage-y-axis mono" aria-hidden="true">${y.ticks.map(tick =>
        `<span style="bottom:${y.place(tick)}%">${tick === 0 ? '0' : elapsedTick(tick)}</span>`).join('')}</div>
      <div class="usage-plane" role="group" aria-label="${t(`每个散点代表一轮。输出中位数 ${fmt(median)} token。用方向键浏览轮次。`,
        `Each point is one turn. Median output: ${fmt(median)} tokens. Use arrow keys to browse turns.`)}" aria-describedby="usage-chart-note">
        ${x.ticks.slice(1).map(tick => `<i class="usage-grid-x" style="left:${x.place(tick)}%" aria-hidden="true"></i>`).join('')}
        ${y.ticks.slice(1).map(tick => `<i class="usage-grid-y" style="bottom:${y.place(tick)}%" aria-hidden="true"></i>`).join('')}
        <i class="usage-median" style="left:${medianX}%" data-edge="${medianX > 60}" aria-hidden="true">
          <span class="usage-median-label">${t('中位数', 'Median')} <code>${fmt(median)}</code></span>
        </i>
        ${peerLink}
        ${samples.map(row => {
          const label = t(`第 ${fmt(row.number)} 轮，输出 ${fmt(row.output)} token，耗时 ${clockDuration(row.elapsed)}，${fmt(row.errors)} 次工具报错`,
            `Turn ${fmt(row.number)}, ${fmt(row.output)} output tokens, ${clockDuration(row.elapsed)} elapsed, ${fmt(row.errors)} tool errors`);
          const horizontal = x.place(row.output);
          return `<button type="button" class="usage-point" data-usage-turn="${row.number}" data-errors="${row.errors > 0}"
            data-edge="${horizontal > 82}" style="left:${horizontal}%;bottom:${y.place(row.elapsed)}%" tabindex="-1"
            aria-pressed="false" aria-controls="usage-evidence" aria-label="${label}" title="${label}">
            <span aria-hidden="true">${turnLabel(fmt(row.number))}</span></button>`;
        }).join('')}
      </div>
      <div class="usage-x-axis mono" aria-hidden="true">${x.ticks.map(tick =>
        `<span style="left:${x.place(tick)}%" data-edge="${x.place(tick) > 95}">${compact.format(tick)}</span>`).join('')}</div>
      <p class="usage-x-label">${t('单轮输出 token', 'Output tokens per turn')}</p>
    </div>
    <p id="usage-chart-note" class="usage-chart-note">${closest ? `<span id="usage-peer-note" class="usage-peer-note" hidden>${t('连线标出两轮对照', 'The line connects the two compared turns')}</span>` : ''}
      <span><span class="usage-median-note">${t('虚线标记输出中位数', 'Dashed line marks median output')} <code>${fmt(median)}</code> · </span>${t('两轴对数压缩', 'Both axes use a logarithmic scale')}</span></p>`;

    const examples = $('usage-examples');
    examples.hidden = !closest;
    if (closest) {
      examples.innerHTML = `<p><span class="usage-pair-label">${t('两轮对照', 'Turn comparison')}</span>
        <span id="usage-pair-delta" aria-live="polite"></span></p>` +
        usagePair.map(() => `<button type="button" data-usage-turn="" aria-pressed="false" aria-controls="usage-evidence">
          <span class="usage-example-turn"></span><code><span class="usage-example-output"></span><span class="usage-example-divider"> · </span><span class="usage-example-time"></span></code>
        </button>`).join('') +
        `<p>${t('点轮次卡选中一侧，再点散点更换。', 'Select a turn card, then click a point to replace it.')}</p>`;
    }
    return slowestBelowMedian.number;
  }

  function updateUsagePair(points, comparing) {
    if (usagePair.length !== 2) return;
    const metrics = usagePair.map(turn => turns.get(turn).metrics);
    const outputGap = Math.abs(metrics[0].usage.output - metrics[1].usage.output);
    const elapsedGap = Math.abs(metrics[0].timing.turns.ms - metrics[1].timing.turns.ms);
    $('usage-pair-delta').innerHTML = `${t('输出相差', 'Output difference')} <strong>${fmt(outputGap)} ${t('token', 'tokens')}</strong> · ${t('耗时相差', 'Duration difference')} <strong>${clockDuration(elapsedGap)}</strong>`;
    const cards = $('usage-examples').querySelectorAll('button');
    usagePair.forEach((turn, index) => {
      const card = cards[index];
      const point = points.find(button => Number(button.dataset.usageTurn) === turn);
      card.dataset.usageTurn = turn;
      card.querySelector('.usage-example-turn').textContent = turnLabel(fmt(turn));
      card.querySelector('.usage-example-output').textContent = fmt(metrics[index].usage.output) + t(' token', ' tokens');
      card.querySelector('.usage-example-time').textContent = clockDuration(metrics[index].timing.turns.ms);
      if (point) {
        const endpoint = index + 1;
        const line = $('usage-peer-link').firstElementChild;
        line.setAttribute('x' + endpoint, parseFloat(point.style.left));
        line.setAttribute('y' + endpoint, 100 - parseFloat(point.style.bottom));
      }
    });
    $('usage-peer-link').toggleAttribute('hidden', !comparing);
    $('usage-peer-note').toggleAttribute('hidden', !comparing);
  }

  function selectUsageTurn(turn) {
    usageTurn = turn;
    const row = turns.get(turn);
    const points = [...$('usage-chart').querySelectorAll('.usage-point')];
    const selectedPoint = points.find(button => Number(button.dataset.usageTurn) === turn);
    const focusPoint = selectedPoint ?? points[0];
    const comparing = Boolean(selectedPoint && usagePair.length === 2);
    if (comparing) {
      const slot = usagePair.indexOf(turn);
      if (slot >= 0) usageSlot = slot;
      else usagePair[usageSlot] = turn;
    }
    updateUsagePair(points, comparing);
    for (const button of $('turn-usage').querySelectorAll('[data-usage-turn]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.usageTurn) === turn));
    }
    for (const point of points) {
      point.tabIndex = point === focusPoint ? 0 : -1;
      point.classList.toggle('is-peer', comparing && Number(point.dataset.usageTurn) === usagePair[1 - usageSlot]);
    }
    $('usage-inspector').classList.toggle('has-active-pair', comparing);
    $('usage-inspector').hidden = !row;
    $('usage-layout').classList.toggle('has-selection', Boolean(row));
    if (!row) return;

    const { usage, timing, outcomes, tools } = row.metrics;
    const [slowest] = slowestCalls(tools, 1);
    const partial = usage.outputRecords < usage.requests;
    let responseCoverage = t('暂无模型响应记录', 'No model responses recorded');
    if (usage.requests) {
      const coverage = ratio(usage.outputRecords, usage.requests);
      responseCoverage = data.host === 'dsh' ? t(`${coverage} 条模型响应有输出记录`, `${coverage} model responses report output`)
        : t(`${fmt(usage.outputRecords)} 条已记录响应计量`, `${fmt(usage.outputRecords)} responses with recorded usage`);
    }
    $('usage-evidence').innerHTML = `<h3>${turnLabel(fmt(turn))}</h3>
      <dl class="usage-facts">
        <div><dt>${partial ? t('已记录输出 token', 'Recorded output tokens') : t('输出 token', 'Output tokens')}</dt><dd class="mono">${fmt(usage.output)}</dd></div>
        <div><dt>${t('轮次耗时', 'Turn duration')}</dt><dd class="mono">${clockDuration(timing.turns.ms)}</dd></div>
      </dl>
      <p class="usage-turn-context">${responseCoverage} · ${t(`${fmt(outcomes.calls)} 次工具调用 · ${fmt(outcomes.errors)} 次报错`,
        `${fmt(outcomes.calls)} tool calls · ${fmt(outcomes.errors)} errors`)}</p>
      ${hasUsagePoint(row.metrics) ? '' : `<p class="usage-coverage-note">${t('散点图采用输出记录齐全且有轮次起止的样本。',
        'The scatter plot uses turns with recorded timing and complete output counts.')}</p>`}
      ${slowest ? `<div class="usage-slow-call">
        <h4>${t('该轮已测最慢调用', 'Slowest measured call in this turn')}</h4>
        <p><code>${toolName(slowest.tool)}</code><strong class="mono" title="${fmt(slowest.ms)} ms">${clockDuration(slowest.ms)}</strong></p>
        <p class="usage-call-records"><span>${t('发起', 'Start')} ${record(slowest.call)}</span> <span class="usage-call-arrow" aria-hidden="true">→</span> <span>${t('结果', 'Result')} ${record(slowest.result)}</span></p>
      </div>` : ''}`;
    $('usage-open-turn').hidden = !outcomes.calls;
    diagnosisAction($('usage-evidence'), t('问这轮', 'Ask about this turn'), { kind: 'rounds', turns: [turn] }, 'latency');
    if (comparing) diagnosisAction($('usage-evidence'), t('对照这两轮', 'Compare these turns'),
      { kind: 'rounds', turns: [...usagePair] }, 'latency');
  }

  function renderSupporting({ context, files, task, outcomes, checks, timing }) {
    $('files').innerHTML = facts([
      [t('关联文件', 'Related files'), fmt(files.count)], [t('写入前有读取', 'Read before writing'), ratio(files.before, files.paired)],
      [t('写入后有读回', 'Read after writing'), ratio(files.after, files.paired)],
      [t('工作区观测', 'Workspace observations'), fmt(task.changes)], [t('交付登记', 'Recorded deliveries'), fmt(task.deliveries)],
      [t('登记文件次数', 'Delivered file entries'), fmt(task.files)],
    ]) + `<div class="task-records">${task.evidence.slice(-4).map(row =>
      `<span>${row.type === 'deliverables/presented' ? t('交付', 'Delivery') : t('工作区', 'Workspace')} ${record(row.seq)}</span>`).join('')}</div>`;

    const { steps, model, toolSteps, calls } = timing;
    $('time-basis').innerHTML = facts([
      [t('各步耗时合计', 'Total step duration'), `${clockDuration(steps.ms)}<small>${ratio(steps.measured, steps.total)} ${t('步有起止记录', 'steps timed')}</small>`],
      [t('模型处理', 'Model processing'), clockDuration(model?.total.value) + (model?.total.samples
        ? `<small>DSH ${ratio(model.total.samples, model.steps)} ${t('步 · 首字', 'steps · first token')} ${clockDuration(model.firstToken.value)} · ${t('解码', 'decoding')} ${clockDuration(model.decode.value)}</small>` : '')],
      [t('步内工具覆盖', 'Tool coverage within steps'), `${clockDuration(toolSteps.coveredMs)}<small>${ratio(toolSteps.measured, toolSteps.total)} ${t('步可计算', 'steps measurable')}</small>`],
      [t('工具累计耗时', 'Cumulative tool duration'), `${clockDuration(calls.cumulativeMs)}<small>${ratio(calls.pairedCalls, calls.calls)} ${t('次有起止记录', 'calls timed')}</small>`],
    ]);

    $('more-metrics').innerHTML = facts([
      [t('工具结果覆盖率', 'Tool result coverage'), pct(outcomes.outcomeCoverage)],
      [t('同轮同参候选组', 'Same-turn repeat groups'), fmt(checks.repeatGroups)], [t('候选组内调用', 'Calls in repeat groups'), fmt(checks.repeatCalls)],
      [t('可核对参数定义的直接调用', 'Direct calls with checkable argument schemas'), ratio(checks.schema?.checkable, checks.directCalls)],
      [t('参数定义未匹配', 'Argument schema mismatches'), fmt(checks.schema?.nonconforming)],
      [t('参数 JSON 无效', 'Invalid argument JSON'), fmt(checks.json?.invalid)], [t('Skill 正文加载', 'Skill body loads'), fmt(context.skillLoads)],
      [t('有记录的子会话', 'Recorded child sessions'), fmt(context.children)],
    ]);
  }

  function updateToolSelection(tool) {
    state.tool = tool?.name ?? null;
    const metrics = scopeMetrics();
    for (const row of $('tool-rows').querySelectorAll('[data-tool]')) {
      row.setAttribute('aria-pressed', String(metrics.tools[Number(row.dataset.tool)]?.name === state.tool));
    }
    renderInspector(metrics);
  }

  function selectTurn(turn, initial = false) {
    state.turn = turn;
    state.allTools = false;
    scopeSelect.value = turn ?? '';
    const metrics = scopeMetrics();
    if (initial || (state.tool !== null && !selectedTool(metrics))) state.tool = metrics.tools[0]?.name ?? null;
    renderSummary(metrics);
    renderOutcomes(metrics.outcomes);
    renderComparison(metrics);
    renderInspector(metrics);
    renderErrors(metrics);
    selectUsageTurn(turn ?? usageTurn ?? defaultUsageTurn);
    renderSupporting(metrics);
    findingsBoard?.refresh();
  }

  function selectView() {
    const option = $('view-switch').selectedOptions[0];
    const name = option.dataset.layout ?? option.value;
    const view = views[name];
    if (option.dataset.layout) document.body.dataset.theme = option.value;
    else delete document.body.dataset.theme;
    const white = option.value === 'white';
    $('view-title').textContent = white ? data.title : view.title;
    $('workspace-context').textContent = white ? view.title : data.title;
    const examples = $('usage-examples');
    if (white) $('usage-evidence').before(examples);
    else $('usage-inspector').append(examples);
    if (document.body.dataset.view === name) return false;

    document.body.dataset.view = name;
    $('section-nav').hidden = name !== 'evidence';
    for (const section of view.sections) $('eval-basis').before($(section));
    return true;
  }

  const defaultUsageTurn = renderUsagePlot();
  const roundRange = data.turns.length === 1 ? turnLabel(data.turns[0].number)
    : data.turns.length ? t(`第 ${data.turns[0].number}–${data.turns.at(-1).number} 轮`, `Turns ${data.turns[0].number}–${data.turns.at(-1).number}`)
    : t('暂无轮次', 'No turns');
  $('snapshot-range').textContent = data.totalTurns > data.turns.length
    ? t(`展开 ${roundRange} · 共 ${fmt(data.totalTurns)} 轮`, `${roundRange} shown · ${fmt(data.totalTurns)} total turns`) : roundRange;
  $('source-label').textContent = globalThis.__trajectoryUi?.(data.sourceLabel) ?? data.sourceLabel;
  $('source-cut').textContent = '#' + data.cut;
  scopeSelect.innerHTML = `<option value="">${t('整段会话', 'Full session')}</option>` +
    data.turns.map(row => `<option value="${row.number}">${turnLabel(row.number)}</option>`).join('');
  $('view-switch').addEventListener('change', () => {
    if (selectView()) window.scrollTo({ top: 0 });
  });
  scopeSelect.addEventListener('change', () => selectTurn(scopeSelect.value ? Number(scopeSelect.value) : null));
  $('tool-sort').addEventListener('click', event => {
    const button = event.target.closest('button[data-sort]');
    if (!button) return;
    state.sort = button.dataset.sort;
    renderComparison(scopeMetrics());
  });
  $('tool-more').addEventListener('click', () => {
    state.allTools = !state.allTools;
    renderComparison(scopeMetrics());
  });
  $('tool-rows').addEventListener('click', event => {
    const button = event.target.closest('button[data-tool]');
    if (!button) return;
    updateToolSelection(scopeMetrics().tools[Number(button.dataset.tool)]);
    const inspector = $('tool-inspector');
    if (inspector.getBoundingClientRect().top >= $('tool-rows').getBoundingClientRect().bottom) {
      inspector.scrollIntoView({ block: 'start' });
      $('selected-tool-title').focus({ preventScroll: true });
    }
  });
  $('show-all-latency').addEventListener('click', () => {
    updateToolSelection(null);
    $('selected-tool-title').focus({ preventScroll: true });
  });
  $('tool-error-link').addEventListener('click', () => {
    const entry = [...errorCells].filter(([, cell]) => cell.tool === state.tool)
      .sort((a, b) => b[1].group.calls - a[1].group.calls)[0];
    if (!entry) return;
    selectErrorCell(entry[0]);
    $('error-example').scrollIntoView({ block: 'nearest' });
    $('error-example').focus({ preventScroll: true });
  });
  $('error-matrix').addEventListener('click', event => {
    const button = event.target.closest('button[data-cell]');
    if (button && button.getAttribute('aria-pressed') !== 'true') selectErrorCell(button.dataset.cell);
  });
  $('error-example').addEventListener('click', event => {
    const sample = event.target.closest('[data-diagnosis-failure]');
    if (sample) {
      window.__diagnosisDemoAsk?.({ kind: 'failure', seq: Number(sample.dataset.diagnosisFailure), powerShell: sample.hasAttribute('data-powershell') }, sample);
      return;
    }
    const button = event.target.closest('button[data-condition]');
    if (!button || button.getAttribute('aria-pressed') === 'true') return;
    for (const choice of $('error-example').querySelectorAll('.error-condition')) {
      choice.setAttribute('aria-pressed', String(choice === button));
    }
    const condition = selectedError.group.conditions[Number(button.dataset.condition)];
    $('error-samples').innerHTML = samplePairs(condition.examples);
  });
  $('turn-usage').addEventListener('click', event => {
    const button = event.target.closest('button[data-usage-turn]');
    if (button) selectUsageTurn(Number(button.dataset.usageTurn));
  });
  $('usage-chart').addEventListener('keydown', event => {
    const point = event.target.closest('.usage-point');
    if (!point) return;
    const points = [...$('usage-chart').querySelectorAll('.usage-point')];
    let index = points.indexOf(point);
    switch (event.key) {
      case 'ArrowLeft': case 'ArrowUp': index = Math.max(0, index - 1); break;
      case 'ArrowRight': case 'ArrowDown': index = Math.min(points.length - 1, index + 1); break;
      case 'Home': index = 0; break;
      case 'End': index = points.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const next = points[index];
    selectUsageTurn(Number(next.dataset.usageTurn));
    next.focus();
  });
  $('usage-open-turn').addEventListener('click', () => {
    if (usageTurn == null) return;
    selectTurn(usageTurn);
    const title = $('tools-title');
    title.scrollIntoView({ block: 'start' });
    title.focus({ preventScroll: true });
  });

  selectView();
  selectTurn(null, true);
})();
