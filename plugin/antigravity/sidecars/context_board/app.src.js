const POLL_MS = 1500;
const USAGE_POLL_MS = 15000;
const $ = (id) => document.getElementById(id);

const SERIES_META = [
  { key: 'cacheReadTokens', label: '缓存读取', color: '#39a29b' },
  { key: 'inputTokens', label: '新增输入', color: '#5286bf' },
  { key: 'cacheWriteTokens', label: '缓存写入', color: '#bf8b32' },
];

const state = {
  selectedConv: '', // '' follows the host-bound conversation, never latest mtime
  etag: '',
  snap: null,
  usage: null,
  usageModel: '',
  tab: 'surface',
  filter: '',
  activeSources: new Set(SERIES_META.map((s) => s.key)),
  activeLayers: new Set(['total']),
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
  const options = [
    `<option value="">${state.selectedConv ? '跟随当前会话' : `当前会话 (${esc(snap.shortId)} · #${snap.cutSeq})`}</option>`,
    ...(conversations || []).map(
      (c) => `<option value="${esc(c.id)}" ${state.selectedConv === c.id ? 'selected' : ''}>${esc(c.shortId)}${c.id === hostConv ? ' (当前)' : ''}</option>`
    ),
  ];
  select.innerHTML = options.join('');

  const pill = $('live-pill');
  pill.classList.remove('is-error');
  $('live-label').textContent = `已同步 · #${snap.cutSeq}`;
  $('source-note').textContent = snap.source.note + (snap.currentContext.available ? ` 来源文本约 ${fmt(snap.currentContext.totals.total)} tokens。` : '');

  $('m-win').textContent = fmt(snap.currentWindow);
  $('m-win-sub').textContent = `#${snap.usageSeq ?? '?'} · 缓 ${fmt(snap.currentCached)} · 新 ${fmt(snap.currentUncached)}${snap.currentWrite ? ' · 写 ' + fmt(snap.currentWrite) : ''}`;

  $('m-hit').textContent = snap.cacheHitRate == null ? '—' : `${snap.cacheHitRate}%`;
  $('m-hit-sub').textContent = `读缓 ${fmt(snap.totalCache)}`;

  if (snap.checkpoint) {
    $('m-cp').textContent = `#${snap.checkpoint.step}`;
    $('m-cp-sub').textContent = `${fmt(snap.checkpoint.beforeWindow)} → ${fmt(snap.checkpoint.afterWindow)}`;
  } else {
    $('m-cp').textContent = '未压缩';
    $('m-cp-sub').textContent = `峰值 ${fmt(snap.peakWindow)}`;
  }

  $('m-out').textContent = fmt(snap.totalOut);
  $('m-out-sub').textContent = `${snap.turns} 轮 · ${snap.plannerSteps} 次请求`;
  $('step-count').textContent = snap.recentSteps?.length || 0;
}

function renderNativeContextChart(snap) {
  const rows = (snap.trendSeries || []).filter(r => r.windowTokens != null);
  const host = $('fig-context-canvas');
  if (!rows.length) {
    host.innerHTML = '<p class="chart-caption">当前范围暂无请求用量记录。</p>';
    return;
  }
  $('fig-context-scope').textContent = `${snap.plannerSteps} 次请求 · ${rows.length} 个采样点`;

  const W = Math.max(280, Math.round(host.clientWidth || 760));
  const leftPad = 56;
  const rightPad = 18;
  const plotW = W - leftPad - rightPad;

  const activeSeries = SERIES_META.filter((s) => state.activeSources.has(s.key));
  const seriesKeys = activeSeries.length ? activeSeries.map((s) => s.key) : SERIES_META.map((s) => s.key);
  const colorOf = (key) => SERIES_META.find((s) => s.key === key)?.color || '#2378dc';

  const totals = rows.map((r) => seriesKeys.reduce((acc, k) => acc + (Number(r[k]) || 0), 0));
  const max = Math.max(1, ...totals);
  const first = rows[0].seq;
  const last = Math.max(first + 1, rows.at(-1).seq);
  const px = (seq) => leftPad + ((seq - first) / Math.max(1, last - first)) * plotW;
  const py = (val) => 204 - (val / max) * 156;
  const rule = (y) => `<path class="plot-grid" d="M${leftPad} ${y.toFixed(1)}H${W - rightPad}"/>`;
  const tx = (x, y, v, cl = 'plot-axis', anchor = 'start') =>
    `<text class="${cl}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${esc(v)}</text>`;

  const controlsHtml = `<div class="report-context-controls">
    <div class="report-source-toggles">${SERIES_META.map(
      (s) =>
        `<button type="button" data-report-source="${s.key}" aria-pressed="${seriesKeys.includes(s.key)}" style="--source-color:${s.color}"><i></i>${esc(s.label)}</button>`
    ).join('')}</div>
    <div class="report-layer-toggles">${[
      ['total', '请求输入'],
      ['delta', '增减'],
    ]
      .map(
        ([k, label]) =>
          `<button type="button" data-report-layer="${k}" aria-pressed="${state.activeLayers.has(k)}">${label}</button>`
      )
      .join('')}</div>
  </div>`;

  let totalSvg = '';
  if (state.activeLayers.has('total')) {
    let b = '';
    for (let i = 0; i <= 3; i++) {
      const n = (max * i) / 3;
      b += rule(py(n)) + tx(leftPad - 8, py(n) + 4, fmt(n), 'plot-axis', 'end');
    }
    let lower = rows.map(() => 0);
    for (const key of seriesKeys) {
      const upper = rows.map((r, i) => lower[i] + (Number(r[key]) || 0));
      const upperLine = compactTrendPolyline(rows.map((r, i) => [px(r.seq), py(upper[i])])).join('L');
      const lowerLine = compactTrendPolyline(rows.map((r, i) => [px(r.seq), py(lower[i])]).reverse()).join('L');
      b += `<path d="M${upperLine}L${lowerLine}Z" fill="${colorOf(key)}" opacity="0.24"/>`;
      b += `<path d="M${upperLine}" fill="none" stroke="${colorOf(key)}" stroke-width="1.35"/>`;
      lower = upper;
    }
    const tickCount = Math.min(8, Math.max(4, Math.floor(plotW / 120)));
    for (let i = 0; i <= tickCount; i++) {
      const n = first + ((last - first) * i) / tickCount;
      b += tx(px(n), 228, `#${Math.round(n)}`, 'plot-axis', 'middle');
    }
    if (snap.checkpoint) {
      const cpRow = rows.find((r) => r.seq >= snap.checkpoint.step) || rows.at(-1);
      if (cpRow) {
        const idx = rows.indexOf(cpRow);
        const xx = px(cpRow.seq), yy = py(totals[idx]);
        b += `<circle class="context-pin" cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="3.8"/>`;
        b += tx(Math.min(W - 140, xx + 8), Math.max(20, yy - 10), `CHECKPOINT #${snap.checkpoint.step}`, 'context-annotation');
      }
    }
    const hitW = Math.max(12, plotW / Math.max(1, rows.length));
    rows.forEach((r, idx) => {
      b += `<g class="plot-mark" data-trend-idx="${idx}"><rect class="context-hit" x="${(px(r.seq) - hitW / 2).toFixed(1)}" y="32" width="${hitW.toFixed(1)}" height="178"/></g>`;
    });
    totalSvg = `<svg viewBox="0 0 ${W} 238" role="img" aria-label="实报请求输入">${b}</svg>`;
  }

  let deltaSvg = '';
  if (state.activeLayers.has('delta') && rows.length > 1) {
    const deltas = rows.map(r => r.deltaBySource ? seriesKeys.reduce((n, key) => n + r.deltaBySource[key], 0) : null);
    const limit = Math.max(1, ...deltas.map(v => Math.abs(v || 0)));
    const axis = (y, label) => tx(leftPad - 8, y + 3, label, 'plot-axis', 'end');
    let d = axis(18, '+' + fmt(limit)) + axis(70, '0') + axis(122, '−' + fmt(limit));
    d += '<path class="plot-grid" d="M' + leftPad + ' 70H' + (W - rightPad) + '"/>';
    const barW = Math.max(3, Math.min(14, plotW / rows.length * .62));
    deltas.forEach((delta, i) => {
      if (delta == null) return;
      const size = Math.abs(delta) / limit * 50;
      d += '<g class="plot-mark" data-trend-idx="' + i + '"><rect x="' + (px(rows[i].seq) - barW / 2).toFixed(1) + '" y="' + (delta >= 0 ? 70 - size : 70).toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + size.toFixed(1) + '" fill="' + (delta >= 0 ? '#5286bf' : '#bf8b32') + '"/></g>';
    });
    deltaSvg = '<div class="context-delta-label">与前一次请求的输入净变化 · 包含压缩带来的减少</div><svg viewBox="0 0 ' + W + ' 138" role="img" aria-label="相邻请求输入变化">' + d + '</svg>';
  }

  host.innerHTML = controlsHtml + totalSvg + deltaSvg;
}

function renderNativeComparison(snap) {
  const host = $('fig-comparison-canvas');
  const comp = snap.comparison;
  if (!comp || comp.before?.windowTokens == null || comp.after?.windowTokens == null) {
    host.innerHTML = '<p class="chart-caption">暂无足够步数生成前后对照。</p>';
    return;
  }
  const a = comp.before, b = comp.after;
  const labelA = snap.checkpoint ? `压缩后起点 (#${a.seq})` : `会话起点 (#${a.seq})`;
  const labelB = `当前最新 (#${b.seq})`;
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
      return `<button type="button" class="report-bar-row" data-jump-step="${r.s}" ${r.retained ? '' : 'disabled'} title="${r.retained ? '定位来源片段' : '该请求的来源片段未保留在最近请求中'}">
        <span class="report-bar-label"><small class="report-bar-rank">${String(idx + 1).padStart(2, '0')}</small>#${r.s} · ${esc(r.tl)}</span>
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
  const q = state.filter.trim().toLowerCase();
  const list = (snap.recentSteps || []).filter((r) => !q || (r.tl || '').toLowerCase().includes(q) || `#${r.s}`.includes(q));
  $('step-feed').innerHTML = list
    .map(
      (r) => `
    <button type="button" class="step-row" data-jump-step="${r.s}" ${r.retained ? '' : 'disabled'} title="${r.retained ? '定位来源片段' : '该请求的来源片段未保留在最近请求中'}">
      <span class="step-left"><span class="step-seq">#${r.s}</span><span class="step-tl">${esc(r.tl)}</span></span>
      <span class="step-right">${r.d == null ? '—' : (r.d >= 0 ? '+' : '−') + fmt(Math.abs(r.d))}<span class="step-win">${fmt(r.w)}</span></span>
    </button>`
    )
    .join('');
}

function renderAll() {
  if (!state.snap) return;
  if (state.tab === 'curve') { renderNativeContextChart(state.snap); renderNativeComparison(state.snap); renderNativeTopSteps(state.snap); }
  if (state.tab === 'steps') renderSteps(state.snap);
}

const USAGE_PARTS = [
  ['inputTokens', '新增输入', 'var(--u-input)'], ['cacheReadTokens', '缓存读取', 'var(--u-read)'],
  ['cacheWriteTokens', '缓存写入', 'var(--u-write)'], ['outputTokens', '模型输出', 'var(--u-output)'],
];
const exact = n => n == null ? '—' : n.toLocaleString('zh-CN');
const speed = n => n == null ? '—' : n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });

function renderUsage(data) {
  const t = data.totals, chats = data.conversations;
  const select = $('usage-model');
  select.innerHTML = '<option value="">全部模型</option>' + data.models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  select.value = data.model;
  state.usageModel = data.model;
  $('usage-scope').textContent = `本机全部历史 · ${exact(chats.length)} 个对话 · ${exact(t.requests)} 次请求`;
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

  const max = data.byModel[0]?.tps || 1;
  $('usage-speeds').innerHTML = data.byModel.map(m => `<li>
    <div><span>${esc(m.name)}</span><b>${speed(m.tps)}</b></div>
    <div class="usage-speed-detail"><span class="usage-track"><i style="width:${(m.tps ?? 0) / max * 100}%"></i></span><small>${exact(m.timedRequests)} 次测速</small></div>
    </li>`).join('') || '<li class="usage-empty">暂无模型记录</li>';
  $('usage-conversations').innerHTML = chats.map(c => {
    const name = c.title || '对话 ' + c.id.slice(0, 8);
    return `<tr><th scope="row"><button type="button" data-usage-chat="${esc(c.id)}" title="查看对话 · ${esc(name)}"><span>${esc(name)}</span><i aria-hidden="true">↗</i></button></th><td>${exact(c.requests)}</td><td title="${exact(c.totalTokens)} Token">${exact(c.totalTokens)}</td><td>${speed(c.tps)}</td></tr>`;
  }).join('');
  const notes = ['输出速度按有计时请求的输出 Token 总和除以流式生成总秒数计算。'];
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
  if (wasUsage !== isUsage) poll();
  renderAll();
}

let curveResizeTimer = 0;
new ResizeObserver(() => {
  if (state.tab !== 'curve' || !state.snap) return;
  clearTimeout(curveResizeTimer);
  curveResizeTimer = setTimeout(() => renderNativeContextChart(state.snap), 60);
}).observe($('fig-context-canvas'));

let pollTimer, pollRequest, pollEpoch = 0;
function clearSnapshot(message) {
  state.snap = null; state.etag = ''; state.mountedSession = null;
  state.ccInstance?.destroy(); state.ccInstance = null;
  $('cc-host').textContent = message;
  for (const id of ['m-win','m-hit','m-cp','m-out','m-win-sub','m-hit-sub','m-cp-sub','m-out-sub']) $(id).textContent = '—';
  for (const id of ['fig-context-canvas','fig-comparison-canvas','fig-top-steps-canvas','step-feed']) $(id).replaceChildren();
  $('source-note').textContent = ''; $('step-count').textContent = '';
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
      const qs = new URLSearchParams({ model: state.usageModel, etag: state.usage?.etag || '' });
      const result = await getJson('/api/usage?' + qs, controller.signal);
      if (epoch !== pollEpoch) return;
      if (!result.unchanged) { state.usage = result; renderUsage(result); }
      usageStatus(state.usage.conversations.length ? '' : '本机暂无 Antigravity 对话记录。', '已同步');
      return;
    }
    const conv = state.selectedConv || window.sidecar?.conversationId || '';
    const qs = new URLSearchParams({ conversationId: conv });
    if (state.etag) qs.set('etag', state.etag);
    const res = await getJson('/api/context?' + qs, controller.signal);
    if (epoch !== pollEpoch) return;
    if (res.empty) {
      clearSnapshot('当前会话暂无请求记录，请选择要查看的会话。');
      $('conv-select').innerHTML = '<option value="">当前会话</option>' + (res.conversations || []).map(c => '<option value="' + esc(c.id) + '">' + esc(c.shortId) + '</option>').join('');
      $('live-label').textContent = '暂无记录';
      if (chooseStartTab && !conv) switchTab('usage');
    } else {
      if (!res.unchanged) { state.etag = res.etag; state.snap = res; }
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
    return;
  }

  const layerBtn = e.target.closest('[data-report-layer]');
  if (layerBtn && state.snap) {
    const key = layerBtn.dataset.reportLayer;
    if (state.activeLayers.has(key) && state.activeLayers.size > 1) {
      state.activeLayers.delete(key);
    } else {
      state.activeLayers.add(key);
    }
    renderNativeContextChart(state.snap);
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

$('fig-context-canvas').addEventListener('mousemove', (e) => {
  const mark = e.target.closest('[data-trend-idx]');
  if (!mark || !state.snap?.trendSeries) return;
  const row = state.snap.trendSeries.filter(r => r.windowTokens != null)[Number(mark.dataset.trendIdx)];
  if (!row) return;
  const readout = $('fig-context-readout');
  readout.dataset.state = 'active';
  readout.innerHTML = `<strong>#${row.seq}</strong> (第 ${row.turn} 轮 · ${esc(row.at)}) · 实报输入 <strong>${fmt(row.windowTokens)}</strong> (读缓 ${fmt(row.cacheReadTokens)} + 新增输入 ${fmt(row.inputTokens)} + 缓存写入 ${fmt(row.cacheWriteTokens)} · 输出 ${fmt(row.outputTokens)}) · ${esc(row.label)}`;
});

$('conv-select').addEventListener('change', (e) => {
  chooseStartTab = false;
  state.selectedConv = e.target.value;
  ++pollEpoch; pollRequest?.abort(); clearTimeout(pollTimer);
  clearSnapshot('读取会话…');
  poll();
});

$('usage-model').addEventListener('change', (e) => {
  state.usageModel = e.target.value;
  state.usage = null;
  $('usage-content').classList.add('hidden');
  $('usage-scope').textContent = '本机 · 全部历史';
  usageStatus('正在汇总所选模型…', '读取中');
  poll();
});

$('step-filter').addEventListener('input', (e) => {
  state.filter = e.target.value;
  if (state.snap) renderSteps(state.snap);
});

poll();
