const POLL_MS = 1500;
const USAGE_POLL_MS = 15000;
const $ = (id) => document.getElementById(id);

const state = {
  selectedConv: '', // '' follows the host-bound conversation, never latest mtime
  etag: '',
  snap: null,
  usage: null,
  usageMode: '',
  usageProject: '', usageDays: '7', heatPage: 0,
  heatSelection: null,
  tab: 'surface',
  ccInstance: null,
  mountedSession: null,
  frames: { trace: null, eval: null },
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
}

const speedSeconds = n => n == null ? '—' : n.toLocaleString('zh-CN', {maximumFractionDigits:3});

function embedUrl(kind, sessionId, bust = false) {
  const qs = new URLSearchParams();
  if (sessionId) qs.set('session', sessionId);
  if (bust) qs.set('t', String(Date.now()));
  return `/${kind}${qs.toString() ? '?' + qs : ''}`;
}

function syncEmbedFrames({ force = false } = {}) {
  const isEmbed = state.tab === 'trace' || state.tab === 'eval';
  $('refresh-embed').classList.toggle('hidden', !isEmbed);
  if (!isEmbed) return;
  const kind = state.tab;
  const sessionId = effectiveSessionId();
  const url = embedUrl(kind, sessionId, force);
  const frame = $('frame-' + kind);
  if (!force && state.frames[kind]?.sessionId === sessionId) return;
  const request = { sessionId };
  state.frames[kind] = request;
  if (window.sidecar?.fetch) {
    frame.removeAttribute('src');
    frame.srcdoc = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;font:13px/1.6 Geist,-apple-system,sans-serif;color:#52627a;background:transparent}</style></head><body>正在读取会话记录…</body></html>';
    window.sidecar.fetch(url, { method: 'GET' })
      .then(res => { if (!res.ok) throw new Error(`${url}: ${res.status}`); return res.text(); })
      .then(html => { if (state.frames[kind] === request) frame.srcdoc = html; })
      .catch(err => {
        if (state.frames[kind] !== request) return;
        frame.srcdoc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;font:13px/1.6 Geist,-apple-system,sans-serif;color:#b42318;background:transparent}</style></head><body>加载失败：${esc(err?.message || err)}</body></html>`;
      });
  } else {
    frame.removeAttribute('srcdoc');
    frame.src = url;
  }
}

function renderAll() {
  if (state.tab === 'trace' || state.tab === 'eval') syncEmbedFrames();
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
  const isEmbed = nextTab === 'trace' || nextTab === 'eval';
  state.tab = nextTab;
  document.querySelector('.header').classList.toggle('usage-active', isUsage);
  document.querySelector('.header').classList.toggle('embed-active', isEmbed);
  $('app').classList.toggle('is-embed-view', isEmbed);
  for (const btn of document.querySelectorAll('[data-tab]')) {
    const active = btn.dataset.tab === state.tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
  }
  for (const name of ['surface', 'trace', 'eval', 'usage']) {
    $('panel-' + name).classList.toggle('hidden', name !== state.tab);
  }
  state.ccInstance?.setActive(state.tab === 'surface');
  if (wasUsage !== isUsage) poll();
  renderAll();
}

let pollTimer, pollRequest, pollEpoch = 0;
function clearSnapshot(message, sessionChanged = false) {
  state.snap = null; state.etag = ''; state.mountedSession = null;
  if (sessionChanged) state.frames = { trace: null, eval: null };
  state.ccInstance?.destroy(); state.ccInstance = null;
  $('cc-host').textContent = message;
  for (const id of ['m-win','m-hit','m-cp','m-out','m-occupancy','m-tps','m-win-sub','m-hit-sub','m-cp-sub','m-out-sub','m-occupancy-sub','m-tps-sub']) $(id).textContent = '—';
  $('source-note').textContent = '';
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
    if (state.etag) qs.set('etag', state.etag);
    const res = await getJson('/api/context?' + qs, controller.signal);
    if (epoch !== pollEpoch) return;
    if (res.empty) {
      clearSnapshot('当前会话暂无请求记录，请选择要查看的会话。', Boolean(state.snap));
      $('conv-select').innerHTML = '<option value="">当前对话</option>' + (res.conversations || []).map(c => '<option value="' + esc(c.id) + '">' + esc(c.title || '未命名对话') + '</option>').join('');
      $('live-label').textContent = '暂无记录';
      if (chooseStartTab && !conv) switchTab('usage');
      renderAll();
    } else {
      if (!res.unchanged) {
        state.etag = res.etag; state.snap = res;
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
  if (e.target.closest('#refresh-embed')) {
    syncEmbedFrames({ force: true });
    return;
  }
  const pager = e.target.closest('[data-page]');
  if (pager && state.usage) { state.heatPage += Number(pager.dataset.page); renderModelMatrix(state.usage); return; }
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
    clearSnapshot('读取会话…', true);
    switchTab('trace');
    $('tab-trace').focus();
    return;
  }
});

$('conv-select').addEventListener('change', (e) => {
  chooseStartTab = false;
  state.selectedConv = e.target.value;
  ++pollEpoch; pollRequest?.abort(); clearTimeout(pollTimer);
  clearSnapshot('读取会话…', true);
  if (state.tab === 'trace' || state.tab === 'eval') syncEmbedFrames({ force: true });
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

poll();
