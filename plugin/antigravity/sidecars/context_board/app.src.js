const POLL_MS = 1500;
const USAGE_POLL_MS = 15000;
const $ = (id) => document.getElementById(id);

const SERIES_META = [
  { key: 'cacheReadTokens', label: '缓存读取', color: 'var(--u-read)' },
  { key: 'inputTokens', label: '新增输入', color: 'var(--u-input)' },
  { key: 'cacheWriteTokens', label: '缓存写入', color: 'var(--u-write)' },
];

const state = {
  selectedConv: '', // '' follows the host-bound conversation, never latest mtime
  etag: '',
  snap: null,
  usage: null,
  usageMode: '',
  usageProject: '', usageDays: '7', heatPage: 0,
  heatSelection: null,
  tab: 'surface',
  filter: '',
  chartTurn: null,
  inlineTurn: null,
  stepTurn: null,
  activeSources: new Set(SERIES_META.map((s) => s.key)),
  trendMetric: 'total',
  ccInstance: null,
  mountedSession: null,
};

const fmt = (n) => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
};
const pct = (n, total) => (total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '—');
const turnName = turn => turn > 0 ? `第 ${turn} 轮` : '未分轮';
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Exact same GET helper as Antigravity's built-in swarm_board/app.js (never overwrites window.fetch!)
async function getJson(path, signal) {
  const f = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
  const res = await f(path, { method: 'GET', signal });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// The shared panel reads the same resolved snapshot as the header and charts.
window.__ttLoadCurrentContext = async sessionId => {
  if (state.snap?.conversationId !== sessionId) return { available: false };
  return state.snap.currentContext;
};
window.__ttLoadContextBody = async (sessionId, version, itemId) => {
  const qs = new URLSearchParams({ session: sessionId, version, item: itemId });
  return (await getJson('/api/current-context/body?' + qs)).text;
};

function syncScheme() {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, #f7f7f8)';
  document.documentElement.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const nums = (c.match(/[\d.]+/g) || []).map(Number);
  if (nums.length < 3) return;
  const scale = c.startsWith('color(') ? 1 : 255;
  const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const theme = lum < 0.5 ? 'dark' : 'light';
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
}
syncScheme();
new MutationObserver(syncScheme).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

function effectiveSessionId() {
  return state.snap?.conversationId || state.selectedConv || window.sidecar?.conversationId || '';
}

function ensureNativeTreemapMounted() {
  const session = effectiveSessionId();
  if (!state.snap || !session) return;
  if (state.ccInstance && state.mountedSession === session) {
    state.ccInstance.setActive(state.tab === 'surface');
    return;
  }
  state.ccInstance?.destroy();
  state.mountedSession = session;
  state.ccInstance = mountCurrentContext($('cc-host'), {
    sessionId: session,
    active: state.tab === 'surface',
    base: '/api/current-context',
  });
}

function renderHeader(snap, conversations) {
  const select = $('conv-select');
  const hostConv = window.sidecar?.conversationId || '';
  const currentTitle = conversations?.find(c => c.id === snap.conversationId)?.title || '当前对话';
  const options = [
    `<option value="">${state.selectedConv ? '跟随当前对话' : esc(currentTitle) + '（当前）'}</option>`,
    ...(conversations || []).filter(c => c.id !== (hostConv || (!state.selectedConv && snap.conversationId)) || c.id === state.selectedConv).map(
      (c) => `<option value="${esc(c.id)}" ${state.selectedConv === c.id ? 'selected' : ''}>${esc(c.title || '未命名对话')}</option>`
    ),
  ];
  select.innerHTML = options.join('');

  const pill = $('live-pill');
  pill.classList.remove('is-error');
  $('live-label').textContent = `已同步 · #${snap.cutSeq}`;
  $('source-note').textContent = snap.currentContext.available ? `最近请求 #${snap.usageSeq ?? '—'} · 可见来源文本约 ${fmt(snap.currentContext.totals.total)} Token` : snap.source.note;
  $('source-note').title = snap.source.note;

  $('m-win').textContent = fmt(snap.currentWindow);
  $('m-win-sub').textContent = `${turnName(snap.currentTurn)} · #${snap.usageSeq ?? '?'}`;
  $('m-win').title = `缓存读取 ${exact(snap.currentCached)} · 新增输入 ${exact(snap.currentUncached)} · 缓存写入 ${exact(snap.currentWrite)}`;
  const occ = snap.occupancy;
  const basis = occ?.basis === 'host-estimate' ? '宿主估算' : '实报输入';
  $('m-occupancy').textContent = occ?.percent == null ? '—' : occ.percent.toFixed(1) + '%';
  $('m-occupancy-sub').textContent = occ ? `${basis} ${fmt(occ.used)} / ${fmt(occ.capacity)}` : '未记录窗口上限';
  $('window-metric').title = occ ? `${basis} ${exact(occ.used)} / 同次请求窗口上限 ${exact(occ.capacity)} Token` : '宿主未记录本次请求的窗口上限';
  $('m-tps').textContent = speed(snap.currentTps);
  const route = snap.currentRoute;
  $('m-tps-sub').textContent = [route?.mode, route?.role, snap.timedRequests ? `会话均速 ${speed(snap.averageTps)}` : '暂无计时'].filter(Boolean).join(' · ');
  $('speed-metric').title = `${snap.currentResponseModel || route?.label || ''} · ${exact(snap.currentOutput)} 输出 Token / ${speedSeconds(snap.currentStreamSeconds)} 流式生成秒。会话均速按 ${snap.timedRequests} 次请求的流式生成时长加权。`;

  $('m-hit').textContent = snap.cacheHitRate == null ? '—' : `${snap.cacheHitRate}%`;
  $('m-hit-sub').textContent = `读缓 ${fmt(snap.totalCache)}`;

  if (snap.checkpoint) {
    $('m-cp').textContent = snap.checkpoint.turn ? turnName(snap.checkpoint.turn) : `#${snap.checkpoint.step}`;
    $('m-cp-sub').textContent = `#${snap.checkpoint.step} · ${fmt(snap.checkpoint.beforeWindow)} → ${fmt(snap.checkpoint.afterWindow)}`;
  } else {
    $('m-cp').textContent = '未压缩';
    $('m-cp-sub').textContent = `峰值 ${fmt(snap.peakWindow)}`;
  }

  $('m-out').textContent = fmt(snap.totalOut);
  $('m-out-sub').textContent = `${snap.turns} 轮 · ${snap.plannerSteps} 次请求`;
  $('step-count').textContent = snap.turns || '';
}

function renderTurnReadout(row) {
  const host = $('fig-context-readout');
  if (!row) { host.replaceChildren(); return; }
  const change = row.deltaTokens == null ? '—' : (row.deltaTokens > 0 ? '+' : '') + fmt(row.deltaTokens);
  host.innerHTML = `<strong>${turnName(row.turn)}</strong>
    <span>轮末输入 <b>${fmt(row.windowTokens)}</b></span><span>轮内峰值 <b>${fmt(row.peak)}</b></span>
    <span>较上轮 <b>${change}</b></span>${row.checkpoints ? `<span class="checkpoint-note">压缩 ${row.checkpoints} 次</span>` : ''}
    <button type="button" data-toggle-inline="${row.turn}" aria-expanded="${state.inlineTurn === row.turn}">${state.inlineTurn === row.turn ? '收起本轮' : '展开 ' + row.requests + ' 次请求'}</button>`;
}

const speedSeconds = n => n == null ? '—' : n.toLocaleString('zh-CN', {maximumFractionDigits:3});

function renderInlineTurn(snap) {
  const panel = $('inline-turn');
  const row = snap.turnSeries.find(r => r.turn === state.inlineTurn);
  if (!row) { panel.replaceChildren(); return; }
  const cuts = row.cuts.map(c => `<span class="cut-caption">压缩 #${c.seq}　${fmt(c.before)} → ${fmt(c.after)} Token</span>`).join('');
  const rows = snap.turnDetail?.turn === row.turn ? snap.turnDetail.rows : null;
  panel.innerHTML = cuts + (rows ? rows.length ? `<div class="inline-scroll" tabindex="0" aria-label="本轮请求"><table><thead><tr><th>请求</th><th>工具与动作</th><th>输入</th><th>输出</th><th>tok/s</th></tr></thead><tbody>${rows.map(r =>
    `<tr><td>#${r.seq ?? r.index}</td><td>${esc(r.label)}</td><td>${fmt(r.windowTokens)}</td><td>${fmt(r.outputTokens)}</td><td>${speed(r.tps)}</td></tr>`).join('')}</tbody></table></div>` : '本轮没有请求记录。' : '读取本轮请求…');
}

function openInline(turn) {
  state.inlineTurn = turn;
  selectChartTurn(turn);
  renderTurnReadout(state.snap.turnSeries.find(r => r.turn === turn));
  renderInlineTurn(state.snap);
  if (state.snap.turnDetail?.turn !== turn) poll();
}

function selectChartTurn(turn) {
  if (state.chartTurn === turn) return;
  const row = state.snap?.turnSeries.find(r => r.turn === turn);
  if (!row) return;
  state.chartTurn = turn;
  for (const mark of $('fig-context-canvas').querySelectorAll('[data-chart-turn]')) {
    const active = Number(mark.dataset.chartTurn) === turn;
    mark.classList.toggle('is-current', active);
    mark.setAttribute('tabindex', active ? '0' : '-1');
  }
  renderTurnReadout(row);
}

function renderNativeContextChart(snap) {
  const rows = snap.turnSeries, host = $('fig-context-canvas');
  const known = rows.filter(r => r.turn > 0).length;
  $('fig-context-scope').textContent = `${known} 轮 · ${snap.plannerSteps} 次请求`;
  if (!rows.length) {
    host.innerHTML = '<p class="chart-caption">暂无已记录的轮次或请求。</p>';
    renderTurnReadout(null);
    return;
  }
  const selected = rows.find(r => r.turn === state.chartTurn) || rows.at(-1);
  const series = SERIES_META.filter(s => state.activeSources.has(s.key));
  const delta = state.trendMetric === 'delta', showPeak = !delta && series.length === SERIES_META.length;
  const valueOf = row => {
    const source = delta ? row.deltaBySource : row;
    if (row.windowTokens == null || !source) return null;
    return series.reduce((n, s) => n + source[s.key], 0);
  };
  const left = 49, right = 12, top = 20, bottom = 166;
  curveWidth = host.clientWidth;
  const width = Math.max(240, host.clientWidth, left + right + rows.length * 24);
  const slot = (width - left - right) / rows.length, bar = Math.min(48, slot * .57);
  const zero = delta ? (top + bottom) / 2 : bottom;
  const max = rows.reduce((n, r) => Math.max(n, Math.abs(valueOf(r) ?? 0), showPeak ? (r.peak ?? 0) : 0), 1);
  const scale = (zero - top) / max, y = value => zero - value * scale;
  const ticks = delta ? [max, 0, -max] : [max, max / 2, 0];
  const tickEvery = Math.max(1, Math.ceil(58 / slot));
  const chart = ticks.map(value => `<path class="plot-grid" d="M${left} ${y(value)}H${width - right}"/>
    <text class="plot-axis" x="${left - 7}" y="${y(value) + 3}" text-anchor="end">${fmt(value)}</text>`).join('');
  const bars = rows.map((row, i) => {
    const x = left + (i + .5) * slot, value = valueOf(row);
    let shapes = `<rect class="turn-hit" x="${x - slot / 2 + 1}" y="${top - 8}" width="${slot - 2}" height="${bottom - top + 16}" rx="3"/>`;
    if (value == null) {
      shapes += `<text class="plot-axis" text-anchor="middle" x="${x}" y="${zero - 4}">—</text>`;
    } else if (delta) {
      shapes += `<rect x="${x - bar / 2}" y="${Math.min(zero, y(value))}" width="${bar}" height="${Math.abs(value) * scale}" fill="${value < 0 ? 'var(--tt-warning)' : 'var(--tt-metric)'}"/>`;
    } else {
      let sum = 0;
      for (const s of series) {
        sum += row[s.key];
        shapes += `<rect x="${x - bar / 2}" y="${y(sum)}" width="${bar}" height="${row[s.key] * scale}" fill="${s.color}"/>`;
      }
    }
    if (showPeak && row.peak != null) shapes += `<path class="turn-peak" d="M${x - bar / 2} ${y(row.peak)}h${bar}"/>`;
    if (row.checkpoints) shapes += `<g class="cut-marker"><title>${row.checkpoints} 次上下文压缩</title>
      <path class="cut-line" d="M${x} ${top - 2}V${bottom}"/><g transform="translate(${x},${top - 8})">
      <rect x="-8" y="-7" width="16" height="14" rx="3"/><path d="m-5.5-2.5 3.5 2.5-3.5 2.5m11-5L2 0l3.5 2.5"/></g></g>`;
    if (i === rows.length - 1 || (i % tickEvery === 0 && (rows.length - 1 - i) * slot >= 48)) {
      shapes += `<text class="plot-axis" text-anchor="middle" x="${x}" y="${bottom + 28}">${turnName(row.turn)}</text>`;
    }
    const active = row === selected;
    return `<g role="button" tabindex="${active ? 0 : -1}" data-chart-turn="${row.turn}" class="plot-mark${active ? ' is-current' : ''}"
      aria-label="${turnName(row.turn)}，${row.requests} 次请求，轮末输入 ${exact(row.windowTokens)}，查看本轮请求">${shapes}</g>`;
  }).join('');
  const sources = SERIES_META.map(s => `<button type="button" data-report-source="${s.key}" aria-pressed="${state.activeSources.has(s.key)}" style="--source-color:${s.color}"><i></i>${s.label}</button>`).join('');
  const metrics = [['total','轮末输入'],['delta','轮间增减']].map(([key, label]) =>
    `<button type="button" data-report-layer="${key}" aria-pressed="${state.trendMetric === key}">${label}</button>`).join('');
  const scrollLeft = host.querySelector('.turn-plot')?.scrollLeft || 0;
  const focusedTurn = host.contains(document.activeElement) ? document.activeElement.dataset.chartTurn : null;
  const cpKey = rows.some(r => r.checkpoints) ? '<span class="cp-key">压缩</span>' : '';
  host.innerHTML = `<div class="report-context-controls"><div class="report-source-toggles">${sources}${showPeak ? '<span class="peak-key">轮内峰值</span>' : ''}${cpKey}</div>
    <div class="report-layer-toggles">${metrics}</div></div>
    <div class="turn-plot"><svg role="group" aria-label="${delta ? '相邻轮末输入的净变化' : '每轮末次请求的实报输入与轮内峰值'}" viewBox="0 0 ${width} 204" style="width:${width}px">${chart}${bars}</svg></div>`;
  host.querySelector('.turn-plot').scrollLeft = scrollLeft;
  if (focusedTurn != null) host.querySelector(`[data-chart-turn="${Number(focusedTurn)}"]`)?.focus({ preventScroll: true });
  renderTurnReadout(selected);
}

function renderNativeComparison(snap) {
  const host = $('fig-comparison-canvas');
  const comp = snap.comparison;
  if (!comp || comp.before?.windowTokens == null || comp.after?.windowTokens == null) {
    host.innerHTML = '<p class="chart-caption">暂无足够步数生成前后对照。</p>';
    return;
  }
  const a = comp.before, b = comp.after;
  const labelA = `${snap.checkpoint ? '压缩后' : '起点'} · ${turnName(a.turn)} · #${a.seq ?? a.index}`;
  const labelB = `最近 · ${turnName(b.turn)} · #${b.seq ?? b.index}`;
  $('fig-comparison-scope').textContent = `${labelA} → ${labelB}`;

  const totalA = SERIES_META.reduce((s, m) => s + (Number(a[m.key]) || 0), 0);
  const totalB = SERIES_META.reduce((s, m) => s + (Number(b[m.key]) || 0), 0);
  const netDelta = totalB - totalA;
  const maxCell = Math.max(1, ...SERIES_META.flatMap((m) => [Number(a[m.key]) || 0, Number(b[m.key]) || 0]));

  const summaryHtml = `<div class="comparison-summary">
    <div><span>${esc(labelA)}</span><strong>${fmt(totalA)}</strong><small>tokens</small></div>
    <span class="comparison-arrow">→</span>
    <div><span>${esc(labelB)}</span><strong>${fmt(totalB)}</strong><small>tokens</small></div>
    <div class="comparison-delta-card">
      <span>合计净变化</span>
      <strong>${netDelta >= 0 ? '+' : '−'}${fmt(Math.abs(netDelta))}</strong>
      <small>tokens · ${totalA > 0 ? (netDelta >= 0 ? '增长 ' : '减少 ') + pct(Math.abs(netDelta), totalA) : '—'}</small>
    </div>
  </div>`;

  const rowsHtml = SERIES_META.map((m) => {
    const va = Number(a[m.key]) || 0;
    const vb = Number(b[m.key]) || 0;
    const d = vb - va;
    const amount = (d > 0 ? '+' : d < 0 ? '−' : '') + fmt(Math.abs(d));
    const rel = va === 0 ? (d > 0 ? '从零新增' : '未变化') : d === 0 ? '未变化' : (d > 0 ? '增加 ' : '减少 ') + pct(Math.abs(d), va);
    return `<tr>
      <th scope="row"><i class="composition-swatch" style="background:${m.color}"></i>${esc(m.label)}</th>
      <td><span class="comparison-measure" style="--measure-width:${((va / maxCell) * 100).toFixed(1)}%"><span>${fmt(va)}</span><i></i></span></td>
      <td><span class="comparison-measure" style="--measure-width:${((vb / maxCell) * 100).toFixed(1)}%"><span>${fmt(vb)}</span><i></i></span></td>
      <td><span class="comparison-change"><b>${esc(amount)}</b><small>${esc(rel)}</small></span></td>
    </tr>`;
  }).join('');

  host.innerHTML = `${summaryHtml}<div class="comparison-scroll"><table class="comparison-table">
    <thead><tr><th>实报输入 · tokens</th><th>${esc(labelA)}</th><th>${esc(labelB)}</th><th>净变化</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;
}

function renderNativeTopSteps(snap) {
  const host = $('fig-top-steps-canvas');
  const rows = (snap.topSteps || []).slice(0, 8);
  if (!rows.length) {
    host.innerHTML = '<p class="chart-caption">暂无单步增长记录。</p>';
    return;
  }
  const maxD = Math.max(1, ...rows.map((r) => r.d));
  const barsHtml = rows
    .map((r, idx) => {
      const catColor = 'var(--tt-metric)';
      const widthPct = Math.max(1, (r.d / maxD) * 100).toFixed(1);
      return `<button type="button" class="report-bar-row" data-open-turn="${r.t}" title="展开该轮请求">
        <span class="report-bar-label"><small class="report-bar-rank">${idx + 1}</small>${turnName(r.t)} · #${r.s ?? '—'} · ${esc(r.tl)}</span>
        <span class="report-bar-track"><i style="left:0%;width:${widthPct}%;background:${catColor}"></i></span>
        <b>+${fmt(r.d)}</b>
        <small>${fmt(r.w)}</small>
      </button>`;
    })
    .join('');

  host.innerHTML = `<div class="report-bars has-detail">
    <div class="report-bar-unit"><span>步骤与动作</span><span>请求输入净增 · 请求总输入</span></div>
    ${barsHtml}
  </div>`;
}

function renderSteps(snap) {
  const select = $('step-turn'), turn = state.stepTurn;
  if (select.dataset.version !== snap.version) {
    select.innerHTML = `<option value="">全部轮次</option>` + snap.turnSeries.map(r =>
      `<option value="${r.turn}">${turnName(r.turn)} · ${r.requests} 次请求</option>`).join('');
    select.dataset.version = snap.version;
  }
  select.value = turn == null ? '' : String(turn);
  renderToolEval(snap,turn);
  if (turn != null && snap.turnDetail?.turn !== turn) {
    $('step-feed').textContent = '正在读取本轮请求…';
    return;
  }
  const rows = turn == null ? snap.recentSteps : snap.turnDetail.rows.map(r =>
    ({ s: r.seq, index: r.index, t: r.turn, w: r.windowTokens, d: r.deltaTokens, tl: r.label, retained: r.retained, tps: r.tps, mode: r.mode })).reverse();
  const q = state.filter.trim().toLowerCase();
  const list = rows.filter(r => !q || [r.tl, r.mode, '#' + (r.s ?? r.index)].join(' ').toLowerCase().includes(q));
  let previous;
  $('step-feed').innerHTML = list.map(r => {
    const heading = previous === r.t ? '' : `<h3 class="step-heading">${turnName(r.t)}<small>净变化 / 输入</small></h3>`;
    previous = r.t;
    return heading + `<button type="button" class="step-row" data-jump-step="${r.s}" ${r.retained ? '' : 'disabled'} title="${esc(r.mode || '')} · ${speed(r.tps)} tok/s · ${r.retained ? '定位来源片段' : '来源片段未保留'}">
      <span class="step-left"><span class="step-seq">#${r.s ?? r.index ?? '—'}</span><span class="step-tl">${esc(r.tl)}</span></span>
      <span class="step-right">${r.d == null ? '—' : (r.d >= 0 ? '+' : '−') + fmt(Math.abs(r.d))}<span class="step-win">${fmt(r.w)}</span></span>
    </button>`;
  }).join('') || '<p class="chart-caption">当前范围没有匹配的请求。</p>';
}

function renderToolEval(snap, turn) {
  const evaluation = snap.toolEval, tools = (turn == null ? evaluation.all : evaluation.byTurn[turn]) || [];
  const sum = key => tools.reduce((n,t) => n + t[key], 0);
  const native = evaluation.source === 'steps', count = sum('calls'), errors = sum('error'), timed = sum('timed');
  $('eval-source').textContent = native ? '宿主工具执行记录 · 耗时按单次执行累加' : '来自对话中的工具调用声明 · 执行结果与耗时未记录';
  $('eval-summary').innerHTML = [['工具调用', count + ' 次'], ['工具种类', tools.length], ['记录报错', native ? errors + ' 次' : '—'], ['累计执行', timed ? speed(sum('seconds')) + ' 秒' : '—']]
    .map(([label,value]) => `<div><small>${label}</small><strong>${value}</strong></div>`).join('');
  const families = {read:'读取',write:'写入',command:'命令',search:'搜索',coordination:'协作',web:'网络',process:'进程',other:'其他'};
  const sorted = [...tools].sort((a,b) => b.calls-a.calls || a.name.localeCompare(b.name));
  $('tool-evaluation').innerHTML = count ? `<div class="eval-table-scroll"><table class="eval-tools"><thead><tr><th>工具</th><th>调用分布</th><th>宿主结果</th><th>平均执行</th></tr></thead><tbody>${sorted.map(t => {
    const results = [[t.done,'完成'],[t.error,'报错'],[t.stopped,'中止'],[t.unknown,'未确认']].filter(([n]) => n)
      .map(([n,label]) => label + ' ' + n).join(' · ');
    return `<tr><th><strong>${esc(t.name)}</strong><small>${families[t.family] || '其他'}</small></th><td><div class="eval-volume"><i style="width:${t.calls/sorted[0].calls*100}%"></i></div>${t.calls} 次</td><td${t.error ? ' class="has-errors"' : ''}>${results}${t.errors.length ? '<small>' + t.errors.map(n => '#' + n).join(' · ') + '</small>' : ''}</td><td title="${t.timed} 次有计时">${t.timed ? speedSeconds(t.seconds/t.timed) + ' 秒' : '—'}</td></tr>`;
  }).join('')}</tbody></table></div>` : '<p class="chart-caption">当前范围没有工具调用记录。</p>';
  $('request-evidence').querySelector('summary').textContent = turn == null ? `最近 ${snap.recentSteps.length} 次请求` : '本轮请求明细';
}

function openTurn(turn) {
  state.stepTurn = turn;
  state.filter = '';
  $('step-filter').value = '';
  if (state.tab === 'steps') { renderSteps(state.snap); poll(); }
  else { switchTab('steps'); $('step-turn').focus(); }
}

function renderAll() {
  if (!state.snap) return;
  if (state.tab === 'curve') { renderNativeContextChart(state.snap); renderInlineTurn(state.snap); renderNativeComparison(state.snap); renderNativeTopSteps(state.snap); }
  if (state.tab === 'steps') renderSteps(state.snap);
}

const USAGE_PARTS = [
  ['inputTokens', '新增输入', 'var(--u-input)'], ['cacheReadTokens', '缓存读取', 'var(--u-read)'],
  ['cacheWriteTokens', '缓存写入', 'var(--u-write)'], ['outputTokens', '模型输出', 'var(--u-output)'],
];
const exact = n => n == null ? '—' : n.toLocaleString('zh-CN');
const speed = n => n == null ? '—' : n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });

function modelShare(tokens, total) {
  if (tokens == null || !(total > 0)) return '—';
  const percent = tokens / total * 100;
  return percent > 0 && percent < .1 ? '<0.1%' : speed(percent) + '%';
}

function selectHeatCell(chat, family, modeName = '') {
  const cell = modeName ? family.modes.find(m => m.name === modeName) : family;
  if (!cell) return;
  state.heatSelection = { id:chat.id, model:family.name, mode:modeName };
  for (const btn of $('usage-conversations').querySelectorAll('[data-heat-model]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.heatChat === chat.id &&
      btn.dataset.heatModel === family.name && btn.dataset.heatMode === modeName));
  }
  const modes = modeName ? [cell] : family.modes;
  const breakdown = modes.map(m => {
    const label = [m.name,...m.roles].join(' · ');
    const response = m.responseModels.length ? m.responseModels.join(' / ') : '响应模型未记录';
    return `<li><span>${esc(label)}</span><b>${esc(modelShare(m.totalTokens, family.totalTokens))}</b>
      <small>${esc(response)}</small></li>`;
  }).join('');
  $('heat-detail').innerHTML = `<div class="matrix-selection"><strong>${esc(chat.title || '未命名对话')} · ${esc(family.name)}${modeName ? ' · ' + esc(modeName) : ''}</strong>
    <span>${exact(cell.requests)} 次请求</span><span>${exact(cell.totalTokens)} Token</span><span>${speed(cell.tps)} tok/s</span></div>
    <div class="model-breakdown"><span>模型内占比</span><ul>${breakdown}</ul></div>`;
}

function renderModelMatrix(data) {
  const catalogue = new Map();
  for (const chat of data.conversations) {
    for (const family of chat.modelUsage) {
      if (!catalogue.has(family.name)) catalogue.set(family.name, {modes:new Set(), tokens:0});
      const item = catalogue.get(family.name);
      item.tokens += family.totalTokens ?? 0;
      for (const m of family.modes) item.modes.add(m.name);
    }
  }
  const groups = [...catalogue].map(([name, item]) => ({name, tokens:item.tokens,
    modes:data.models.filter(mode => item.modes.has(mode))})).sort((a,b) =>
      Number(a.name === '未记录模型') - Number(b.name === '未记录模型') || b.tokens-a.tokens || a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
  const canSplit = groups.some(g => g.modes.length > 1);
  $('matrix-split-label').hidden = !canSplit;
  const split = canSplit && $('matrix-split').checked;
  const columns = groups.flatMap(g => (split ? g.modes : ['']).map(mode => ({family:g.name,mode})));
  const pages = Math.max(1,Math.ceil(data.conversations.length / 10));
  state.heatPage = Math.min(state.heatPage,pages-1);
  const visible = data.conversations.slice(state.heatPage*10,state.heatPage*10+10);
  $('heat-pages').innerHTML = pages > 1 ? `<button data-page="-1" ${state.heatPage ? '' : 'disabled'}>上一页</button><span>${state.heatPage+1} / ${pages}</span><button data-page="1" ${state.heatPage+1 < pages ? '' : 'disabled'}>下一页</button>` : '';
  const rowSpan = split ? ' rowspan="2"' : '';
  $('usage-columns').innerHTML = `<tr><th scope="col"${rowSpan}>对话</th>` + groups.map(g =>
    `<th class="model-head" ${split ? 'scope="colgroup" colspan="' + g.modes.length + '"' : 'scope="col"'}>${esc(g.name)}</th>`).join('') +
    `<th class="matrix-total" scope="col"${rowSpan}>${data.model ? '所选 Token' : '累计 Token'}</th></tr>` +
    (split ? '<tr class="matrix-modes">' + columns.map(c => `<th scope="col">${esc(c.mode)}</th>`).join('') + '</tr>' : '');
  $('usage-conversations').innerHTML = visible.map(chat => {
    const name = chat.title || '未命名对话';
    const families = new Map(chat.modelUsage.map(f => [f.name, f]));
    const heat = columns.map(({family,mode}) => {
      const model = families.get(family);
      const cell = mode ? model?.modes.find(m => m.name === mode) : model;
      if (!cell) return '<td class="matrix-empty" aria-label="无独立请求">—</td>';
      const share = chat.allModeTokens > 0 ? cell.totalTokens / chat.allModeTokens : 0;
      const percent = esc(modelShare(cell.totalTokens, chat.allModeTokens));
      const level = !share ? 0 : share <= .1 ? 1 : share <= .3 ? 2 : share <= .65 ? 3 : 4;
      const label = esc([family,mode].filter(Boolean).join(' · '));
      return `<td class="matrix-value"><button type="button" class="heat-cell" data-level="${level}" data-heat-chat="${esc(chat.id)}"
        data-heat-model="${esc(family)}" data-heat-mode="${esc(mode)}" aria-controls="heat-detail" aria-pressed="false"
        aria-label="${esc(name)}，${label}，${exact(cell.requests)} 次请求，${exact(cell.totalTokens)} Token，占比 ${percent}"
        title="${label} · ${exact(cell.totalTokens)} Token · ${exact(cell.requests)} 次请求"><span class="mobile-mode">${label}</span>${percent}</button></td>`;
    }).join('');
    return `<tr><th scope="row" class="chat-heading"><button type="button" data-usage-chat="${esc(chat.id)}" title="打开对话 · ${esc(name)}">${esc(name)} <i aria-hidden="true">↗</i></button>
      <small>${exact(chat.requests)} 次请求 · ${speed(chat.tps)} tok/s${chat.children ? ' · 含子会话' : ''}</small></th>${heat}
      <td class="matrix-total"><span class="mobile-token-label">Token </span>${exact(chat.totalTokens)}</td></tr>`;
  }).join('');
  const previous = state.heatSelection;
  const chat = visible.find(c => c.id === previous?.id && c.modelUsage.length) || visible.find(c => c.modelUsage.length);
  if (!chat) { state.heatSelection = null; $('heat-detail').replaceChildren(); return; }
  const largest = rows => rows.reduce((a,b) => (a.totalTokens ?? -1) >= (b.totalTokens ?? -1) ? a : b);
  const family = chat.modelUsage.find(f => f.name === previous?.model) || largest(chat.modelUsage);
  const mode = split ? family.modes.find(m => m.name === previous?.mode) || largest(family.modes) : null;
  selectHeatCell(chat, family, mode?.name);
}

function renderUsage(data) {
  const t = data.totals, chats = data.conversations;
  const select = $('usage-model');
  const project = $('usage-project');
  project.innerHTML = '<option value="">全部项目</option>' + data.projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  project.value = state.usageProject;
  select.innerHTML = '<option value="">全部模式</option>' + data.models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  select.value = data.model;
  state.usageMode = data.model;
  $('usage-scope').textContent = `${$('usage-days').selectedOptions[0].text} · ${exact(chats.length)} 个主对话 · ${exact(t.requests)} 次请求`;
  $('usage-content').classList.toggle('hidden', !chats.length);
  $('u-total').textContent = exact(t.totalTokens);
  $('u-total-note').textContent = t.completeRequests === t.requests && t.requests ? '含缓存读取与写入' : `${exact(t.completeRequests)} / ${exact(t.requests)} 次请求有完整用量`;
  $('u-tps').textContent = speed(t.tps);
  $('u-tps-note').textContent = t.timedRequests ? `${exact(t.timedRequests)} 次有流式计时` : '暂无流式计时样本';
  $('u-first').textContent = t.firstTokenSeconds == null ? '—' : t.firstTokenSeconds.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  $('u-first-note').textContent = t.firstRequests ? `${exact(t.firstRequests)} 次有首 Token 计时` : '暂无首 Token 计时样本';

  const ring = $('usage-ring'), stops = [];
  let start = 0, largest = null;
  $('usage-legend').innerHTML = USAGE_PARTS.map(([key, label, color]) => {
    const value = t[key], share = value == null ? '—' : pct(value, t.totalTokens);
    if (value > 0) {
      const end = start + value / t.totalTokens * 100;
      stops.push(`${color} ${start}% ${end}%`);
      start = end;
      if (!largest || value > largest.value) largest = { label, value, share };
    }
    return `<li><i style="background:${color}"></i><span>${label}</span><b>${exact(value)}</b><small>${share}</small></li>`;
  }).join('');
  ring.style.background = stops.length ? `conic-gradient(${stops.join(',')})` : 'var(--sw-fill)';
  ring.setAttribute('aria-label', 'Token 构成，' + USAGE_PARTS.map(([key, label]) => label + ' ' + exact(t[key])).join('，'));
  $('u-largest-label').textContent = largest?.label || '占比';
  $('u-largest-share').textContent = largest?.share || '—';

  const routes = data.speeds.filter(r => r.timedRequests);
  const max = Math.max(1,...routes.map(r => r.tps));
  $('usage-speeds').innerHTML = routes.map((r,i) => `<tr title="${esc([...r.raw,...r.responseModels].join(' · '))}">
    <td>${routes[i-1]?.mode !== r.mode ? esc(r.mode) : `<span class="sr-mode">${esc(r.mode)}</span>`}</td><th scope="row">${esc(r.label)}</th>
    <td><div class="rate"><span aria-hidden="true"><i style="width:${r.tps / max * 100}%"></i></span><b>${speed(r.tps)}</b></div></td>
    <td>${exact(r.timedRequests)}</td></tr>`).join('') || '<tr><td colspan="4">当前范围暂无流式计时。</td></tr>';
  renderModelMatrix(data);
  const notes = ['输出速度按有计时请求的输出 Token 总和除以流式生成总秒数计算。'];
  if (data.undatedRequests) notes.push(`${data.undatedRequests} 次请求缺少日期，可在「全部时间」查看。`);
  if (data.sharedRequests) notes.push(`已合并 ${exact(data.sharedRequests)} 条具有相同响应 ID 的重复记录。`);
  if (data.transcriptChats) notes.push(`本机有 ${exact(data.transcriptChats)} 个对话使用 transcript，用量以已记录分项为准。`);
  if (data.unavailableChats) notes.push(`有 ${exact(data.unavailableChats)} 个对话暂不可读。`);
  if (data.staleChats) notes.push(`有 ${exact(data.staleChats)} 个对话暂用上次统计。`);
  $('usage-footnote').textContent = notes.join(' ');
}

function usageStatus(message, label, error = false) {
  $('usage-live').classList.toggle('is-error', error);
  $('usage-live-label').textContent = label;
  $('usage-message').textContent = message;
  $('usage-message').classList.toggle('hidden', !message);
}

let chooseStartTab = true;
function switchTab(nextTab) {
  chooseStartTab = false;
  const wasUsage = state.tab === 'usage', isUsage = nextTab === 'usage';
  state.tab = nextTab;
  document.querySelector('.header').classList.toggle('usage-active', isUsage);
  for (const btn of document.querySelectorAll('[data-tab]')) {
    const active = btn.dataset.tab === state.tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
  }
  for (const name of ['surface', 'curve', 'steps', 'usage']) {
    $('panel-' + name).classList.toggle('hidden', name !== state.tab);
  }
  state.ccInstance?.setActive(state.tab === 'surface');
  if (wasUsage !== isUsage || (nextTab === 'steps' && state.stepTurn != null && state.snap?.turnDetail?.turn !== state.stepTurn)) poll();
  renderAll();
}

let curveResizeTimer = 0, curveWidth = 0;
new ResizeObserver(([entry]) => {
  if (state.tab !== 'curve' || !state.snap) return;
  if (curveWidth === entry.contentRect.width) return;
  curveWidth = entry.contentRect.width;
  clearTimeout(curveResizeTimer);
  curveResizeTimer = setTimeout(() => { if (state.tab === 'curve' && state.snap) renderNativeContextChart(state.snap); }, 60);
}).observe($('fig-context-canvas'));

let pollTimer, pollRequest, pollEpoch = 0;
function clearSnapshot(message) {
  state.snap = null; state.etag = ''; state.mountedSession = null;
  state.chartTurn = null; state.inlineTurn = null; state.stepTurn = null; state.filter = '';
  $('step-filter').value = ''; delete $('step-turn').dataset.version;
  state.ccInstance?.destroy(); state.ccInstance = null;
  $('cc-host').textContent = message;
  for (const id of ['m-win','m-hit','m-cp','m-out','m-occupancy','m-tps','m-win-sub','m-hit-sub','m-cp-sub','m-out-sub','m-occupancy-sub','m-tps-sub']) $(id).textContent = '—';
  for (const id of ['fig-context-canvas','fig-context-readout','inline-turn','fig-comparison-canvas','fig-top-steps-canvas','step-feed','eval-summary','eval-source','tool-evaluation']) $(id).replaceChildren();
  $('source-note').textContent = ''; $('step-count').textContent = '';
  for (const id of ['source-note','m-win','window-metric','speed-metric']) $(id).removeAttribute('title');
}
async function poll() {
  clearTimeout(pollTimer);
  if (document.visibilityState === 'hidden') return;
  pollRequest?.abort();
  const controller = new AbortController(), epoch = ++pollEpoch;
  pollRequest = controller;
  const isUsage = state.tab === 'usage';
  const timeout = setTimeout(() => controller.abort(), isUsage ? 60000 : 12000);
  try {
    if (isUsage) {
      const qs = new URLSearchParams({group:'mode',project:state.usageProject,days:state.usageDays, mode: state.usageMode, etag: state.usage?.etag || '' });
      const result = await getJson('/api/usage?' + qs, controller.signal);
      if (epoch !== pollEpoch) return;
      if (!result.unchanged) { state.usage = result; renderUsage(result); }
      usageStatus(state.usage.conversations.length ? '' : '当前筛选范围没有请求记录。可调整项目、模式或时间。', '已同步');
      return;
    }
    const conv = state.selectedConv || window.sidecar?.conversationId || '';
    const qs = new URLSearchParams({ conversationId: conv, list:'all' });
    if (state.tab === 'steps' && state.stepTurn != null) qs.set('turn', state.stepTurn);
    if (state.tab === 'curve' && state.inlineTurn != null) qs.set('turn', state.inlineTurn);
    if (state.etag) qs.set('etag', state.etag);
    const res = await getJson('/api/context?' + qs, controller.signal);
    if (epoch !== pollEpoch) return;
    if (res.empty) {
      clearSnapshot('当前会话暂无请求记录，请选择要查看的会话。');
      $('conv-select').innerHTML = '<option value="">当前对话</option>' + (res.conversations || []).map(c => '<option value="' + esc(c.id) + '">' + esc(c.title || '未命名对话') + '</option>').join('');
      $('live-label').textContent = '暂无记录';
      if (chooseStartTab && !conv) switchTab('usage');
    } else {
      if (!res.unchanged) {
        state.etag = res.etag; state.snap = res;
        if (state.stepTurn != null && !res.turnSeries.some(row => row.turn === state.stepTurn)) state.stepTurn = null;
      }
      if (state.snap) {
        renderHeader(state.snap, res.conversations);
        if (!res.unchanged) { renderAll(); ensureNativeTreemapMounted(); state.ccInstance?.refresh(0); }
      }
    }
    chooseStartTab = false;
  } catch (error) {
    if (epoch !== pollEpoch) return;
    if (isUsage) {
      usageStatus(state.usage ? '更新失败，显示上次统计。' : '暂时无法读取用量，正在重试。', '读取失败', true);
      return;
    }
    $('live-pill').classList.add('is-error');
    $('live-label').textContent = state.snap ? '同步失败 · 保留上次读数' : '读取失败 · 正在重试';
    if (!state.snap) $('cc-host').textContent = '暂时无法读取请求记录。';
  } finally {
    clearTimeout(timeout);
    if (epoch === pollEpoch && document.visibilityState !== 'hidden') pollTimer = setTimeout(poll, isUsage ? USAGE_POLL_MS : POLL_MS);
  }
}
document.addEventListener('visibilitychange', () => {
  clearTimeout(pollTimer); ++pollEpoch; pollRequest?.abort();
  if (document.visibilityState !== 'hidden') poll();
});

document.querySelector('.tabs').addEventListener('keydown', e => {
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const current = tabs.indexOf(e.target);
  if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const index = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
    : (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  switchTab(tabs[index].dataset.tab); tabs[index].focus();
});

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    switchTab(tabBtn.dataset.tab);
    return;
  }
  const pager = e.target.closest('[data-page]');
  if (pager && state.usage) { state.heatPage += Number(pager.dataset.page); renderModelMatrix(state.usage); return; }
  const toggle = e.target.closest('[data-toggle-inline]');
  if (toggle && state.inlineTurn === Number(toggle.dataset.toggleInline)) {
    state.inlineTurn = null; renderNativeContextChart(state.snap); renderInlineTurn(state.snap); return;
  }
  const chartMark = e.target.closest('[data-chart-turn], [data-open-turn], [data-toggle-inline]');
  if (chartMark && state.snap) {
    openInline(Number(chartMark.dataset.chartTurn ?? chartMark.dataset.openTurn ?? chartMark.dataset.toggleInline));
    return;
  }
  const heat = e.target.closest('[data-heat-model]');
  if (heat && state.usage) {
    const chat = state.usage.conversations.find(c => c.id === heat.dataset.heatChat);
    const family = chat?.modelUsage.find(m => m.name === heat.dataset.heatModel);
    if (family) selectHeatCell(chat, family, heat.dataset.heatMode);
    return;
  }
  const usageChat = e.target.closest('[data-usage-chat]');
  if (usageChat) {
    state.selectedConv = usageChat.dataset.usageChat;
    clearSnapshot('读取会话…');
    switchTab('surface');
    $('tab-surface').focus();
    return;
  }

  const srcBtn = e.target.closest('[data-report-source]');
  if (srcBtn && state.snap) {
    const key = srcBtn.dataset.reportSource;
    if (state.activeSources.has(key) && state.activeSources.size > 1) {
      state.activeSources.delete(key);
    } else {
      state.activeSources.add(key);
    }
    renderNativeContextChart(state.snap);
    $('fig-context-canvas').querySelector(`[data-report-source="${key}"]`).focus({ preventScroll: true });
    return;
  }

  const layerBtn = e.target.closest('[data-report-layer]');
  if (layerBtn && state.snap) {
    const key = layerBtn.dataset.reportLayer;
    state.trendMetric = key;
    renderNativeContextChart(state.snap);
    $('fig-context-canvas').querySelector(`[data-report-layer="${key}"]`).focus({ preventScroll: true });
    return;
  }

  const jumpBtn = e.target.closest('[data-jump-step]');
  if (jumpBtn) {
    const stepSeq = jumpBtn.dataset.jumpStep;
    switchTab('surface');
    const searchInput = document.querySelector('#cc-host .cc-search input');
    if (searchInput) {
      searchInput.value = `#${stepSeq} ·`;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  }
});

for (const event of ['pointerover', 'focusin']) $('fig-context-canvas').addEventListener(event, e => {
  const mark = e.target.closest('[data-chart-turn]');
  if (mark && state.inlineTurn == null) selectChartTurn(Number(mark.dataset.chartTurn));
});
$('fig-context-canvas').addEventListener('keydown', e => {
  const mark = e.target.closest('[data-chart-turn]');
  if (!mark) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInline(Number(mark.dataset.chartTurn)); return; }
  const marks = [...$('fig-context-canvas').querySelectorAll('[data-chart-turn]')], i = marks.indexOf(mark);
  const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: marks.length - 1 }[e.key];
  if (next == null) return;
  e.preventDefault(); const target = marks[Math.max(0, Math.min(marks.length - 1, next))];
  target.focus(); if (state.inlineTurn != null) openInline(Number(target.dataset.chartTurn));
});

$('conv-select').addEventListener('change', (e) => {
  chooseStartTab = false;
  state.selectedConv = e.target.value;
  ++pollEpoch; pollRequest?.abort(); clearTimeout(pollTimer);
  clearSnapshot('读取会话…');
  poll();
});

$('matrix-split').addEventListener('change', () => {
  if (state.usage) renderModelMatrix(state.usage);
});

for (const id of ['usage-model','usage-project','usage-days']) $(id).addEventListener('change', () => {
  state.usageMode = id === 'usage-model' ? $('usage-model').value : '';
  state.usageProject = $('usage-project').value;
  state.usageDays = $('usage-days').value;
  state.heatPage = 0;
  state.usage = null;
  $('usage-content').classList.add('hidden');
  $('usage-scope').textContent = $('usage-days').selectedOptions[0].text;
  usageStatus('正在汇总所选范围…', '读取中');
  poll();
});

$('step-turn').addEventListener('change', e => openTurn(e.target.value === '' ? null : Number(e.target.value)));

$('step-filter').addEventListener('input', (e) => {
  state.filter = e.target.value;
  if (state.snap) renderSteps(state.snap);
});

poll();
