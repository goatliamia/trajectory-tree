import { createZoomTreemap, zoomMapOverlay } from './zoom-treemap.js';
import { CONTEXT_CATEGORIES, currentContextScene } from './model.js';
import {ui} from './ui-locale.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const format = value => value >= 1000 ? (value / 1000).toFixed(value >= 100000 ? 0 : 1) + 'k' : Math.round(value).toLocaleString();
function stylesheet(name) {
  const href = new URL(name, import.meta.url).href;
  if ([...document.querySelectorAll('link[rel=stylesheet]')].some(link => link.href === href)) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; document.head.append(link);
}

export function mountCurrentContext(host, { sessionId, active = false, base = '/analysis-view/current-context' } = {}) {
  stylesheet('./panel.css'); stylesheet('./zoom-treemap.css');
  host.classList.add('current-context-panel');
  host.innerHTML = `<header class="cc-head"><div class="cc-heading"><h2>当前上下文</h2><div class="cc-total">—<small>tokens</small></div></div><div class="cc-summary"><span class="cc-count">当前保留 · 估算</span><span class="cc-status" role="status">等待打开</span></div><nav class="cc-legend" aria-label="轨迹图内容分类">${CONTEXT_CATEGORIES.map(row => `<button type="button" data-category="${row.key}" aria-pressed="false" style="--category:${row.color}"><i></i>${escape(ui(row.key === 'assistant' ? '模型输出' : row.label))}</button>`).join('')}</nav></header>
    <div class="cc-map-wrap"><div class="cc-map zoom-treemap" role="group" aria-label="当前上下文构成，按内容分类分区"></div><div class="cc-empty">正在读取当前保留内容…</div></div>
    <div class="cc-controls"><button type="button" data-action="fit">全图</button><button type="button" data-action="refresh">刷新</button><span class="cc-help">滚轮缩放 · 拖动 · 双击进入 / 返回</span></div>
    <label class="cc-search"><input type="search" placeholder="查找内容或来源" aria-label="查找当前上下文"></label>
    <section class="cc-detail" aria-label="选中内容"><div class="cc-detail-heading"><h3>查看当前上下文构成</h3><button class="cc-open" type="button" hidden>查看正文 ↗</button></div><div class="cc-meta">沿用轨迹图的七类划分</div><p>面积表示估算 tokens。缩放查看片段，单击阅读；压缩后保留的摘要和内容也在图中。</p></section>
    <section class="cc-body" aria-label="上下文正文" hidden><header><button type="button" data-action="back">← 返回图</button><h3></h3></header><pre tabindex="0"></pre><footer><span></span><button type="button" data-action="more" hidden> 继续显示</button></footer></section>`;
  const find = selector => host.querySelector(selector), map = find('.cc-map'), empty = find('.cc-empty'), status = find('.cc-status');
  const detail = find('.cc-detail'), bodyPane = find('.cc-body'), search = find('input');
  const events = new AbortController();
  let requestedActive = active, visible = false, destroyed = false, timer = 0, resizeTimer = 0, request, bodyRequest, api, data, selected, viewState;
  let paintedSize = '';
  let category = null, bodyText = '', bodyShown = 0, paintFrames = 0;
  const bodyCache = new Map();
  function note(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
  function select(item) {
    selected = item;
    const label = ui(CONTEXT_CATEGORIES.find(row => row.key === item.category)?.label ?? '');
    detail.querySelector('h3').textContent = item.name;
    const share = data?.totals.total > 0 ? ' · ' + ((item.tokens ?? item.weight) / data.totals.total * 100).toFixed(1) + '%' : '';
    detail.querySelector('.cc-meta').textContent = `${label} · ${format(item.tokens ?? item.weight)} tokens${share}${item.seq != null ? ' · #' + item.seq : ''}`;
    detail.querySelector('p').textContent = item.aggregate ? '当前保留 ' + item.itemCount + ' 段' + label + '，双击或滚轮放大查看。' : item.preview || '此片段包含结构化内容。';
    const button = detail.querySelector('.cc-open'); button.hidden = Boolean(item.aggregate); button.disabled = data?.bodyAvailable === false;
  }
  function applySearch() {
    const query = search.value.trim().toLowerCase();
    const ids = (data?.items ?? []).filter(item => (!category || category === item.category) && (!query || (item.name + ' ' + item.preview + ' ' + item.category).toLowerCase().includes(query))).map(item => item.id);
    api?.search(query || category || '', ids);
  }
  function clearSearch() {
    category = null; search.value = '';
    host.querySelectorAll('[data-category]').forEach(node => node.setAttribute('aria-pressed', 'false'));
  }
  function paint() {
    if (!visible || !data?.items.length) return;
    viewState = api?.getState() ?? viewState; api?.destroy();
    paintedSize = Math.round(map.clientWidth) + ':' + Math.round(map.clientHeight);
    map.innerHTML = '<canvas class="zoom-map-canvas" tabindex="0" aria-label="当前上下文，滚轮缩放，拖动平移，双击进入或返回"></canvas>' + zoomMapOverlay();
    api = createZoomTreemap(map, { model: currentContextScene(data.items, map.clientWidth, map.clientHeight), selected: selected?.id,
      viewState, getBody: item => item.preview || '', onSelect: select, onOpen: item => { if (!item.aggregate) openBody(item); },
      onFrame() { host.dataset.drawFrames = String(++paintFrames); } });
    host.dataset.items = String(data.items.length); host.dataset.version = data.version;
    applySearch();
  }
  async function load() {
    if (!visible || destroyed) return;
    request?.abort(); const controller = new AbortController(); request = controller;
    note(data ? '更新中…' : '读取中…');
    try {
      const response = await fetch(base + '?session=' + encodeURIComponent(sessionId), { signal: controller.signal, cache: 'no-store' });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || 'HTTP ' + response.status);
      if (controller.signal.aborted || destroyed) return;
      if (!next.available) {
        data = null; api?.destroy(); api = null; map.replaceChildren(); empty.hidden = false; empty.textContent = '当前记录尚不能还原保留上下文。';
        find('.cc-total').innerHTML = '—<small>tokens</small>'; find('.cc-count').textContent = '当前保留 · 估算'; note('暂不可用'); return;
      }
      if (next.version !== data?.version) {
        const wasZoomed = api && api.getState().camera.k > 1.05, selectedId = selected?.id;
        data = next; bodyCache.clear(); bodyRequest?.abort(); bodyPane.hidden = true; bodyText = '';
        const current = data.items.find(item => item.id === selectedId); selected = current;
        paint();
        if (current) { select(current); if (wasZoomed) api?.focusLeaf(current.id); }
        else { selected = null; detail.querySelector('h3').textContent = '选择一个内容片段'; detail.querySelector('.cc-meta').textContent = '当前保留 · 按内容分类分区'; detail.querySelector('p').textContent = '单击阅读内容，双击进入或返回，滚轮连续缩放。'; detail.querySelector('.cc-open').hidden = true; }
      }
      empty.hidden = data.items.length > 0; empty.textContent = '当前还没有保留内容。';
      find('.cc-total').innerHTML = format(data.totals.total) + '<small>tokens</small>';
      const categories = new Set(data.items.map(item => item.category));
      find('.cc-count').textContent = data.items.length + ' 段 · ' + categories.size + ' 类 · 估算';
      note(data.contextWindow ? (data.totals.total / data.contextWindow * 100).toFixed(1) + '% 窗口' : '已同步');
    } catch (error) {
      if (!controller.signal.aborted && !destroyed) {
        note('读取失败 · 可刷新', true);
        if (!data) { empty.hidden = false; empty.textContent = '无法读取当前上下文：' + error.message; }
      }
    }
  }
  function refresh(delay = 400) { clearTimeout(timer); if (visible && !destroyed) timer = setTimeout(load, delay); }
  function showBody() {
    bodyShown = Math.min(bodyText.length, bodyShown + 65536);
    bodyPane.querySelector('pre').textContent = bodyText.slice(0, bodyShown);
    bodyPane.querySelector('footer span').textContent = `${bodyShown.toLocaleString()} / ${bodyText.length.toLocaleString()} 字符`;
    bodyPane.querySelector('[data-action=more]').hidden = bodyShown >= bodyText.length;
  }
  async function openBody(item) {
    if (!visible || !data || data.bodyAvailable === false) return;
    select(item); bodyRequest?.abort(); const controller = new AbortController(); bodyRequest = controller;
    const version = data.version;
    bodyPane.hidden = false; bodyPane.querySelector('h3').textContent = item.name;
    bodyPane.querySelector('pre').textContent = '读取正文…'; bodyPane.querySelector('footer span').textContent = ''; bodyPane.querySelector('[data-action=more]').hidden = true;
    try {
      let text = bodyCache.get(item.id);
      if (text === undefined) {
        const url = new URL(base + '/body', location.href); url.search = new URLSearchParams({ session: sessionId, version, item: item.id });
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(response.status === 409 ? '内容快照已更新，请返回并刷新后重试。' : result.error || '读取失败');
        text = result.text;
        if (text.length <= 65536) { bodyCache.set(item.id, text); while (bodyCache.size > 4) bodyCache.delete(bodyCache.keys().next().value); }
      }
      if (controller.signal.aborted || destroyed || data?.version !== version) return;
      bodyText = text; bodyShown = 0; showBody(); bodyPane.querySelector('[data-action=back]').focus({ preventScroll: true });
    } catch (error) { if (!controller.signal.aborted && !destroyed) bodyPane.querySelector('pre').textContent = error.message; }
  }
  function closeBody() { bodyRequest?.abort(); bodyPane.hidden = true; bodyText = ''; bodyPane.querySelector('pre').textContent = ''; map.querySelector('canvas')?.focus({ preventScroll: true }); }
  const listen = (target, name, callback) => target.addEventListener(name, callback, { signal: events.signal });
  const resizeObserver = new ResizeObserver(() => {
    const size = Math.round(map.clientWidth) + ':' + Math.round(map.clientHeight);
    clearTimeout(resizeTimer);
    if (!visible || size === paintedSize) return;
    resizeTimer = setTimeout(() => {
      const currentSize = Math.round(map.clientWidth) + ':' + Math.round(map.clientHeight);
      if (!visible || destroyed || currentSize === paintedSize) return;
      const focused = api?.getState().camera.k > 1.05 ? selected?.id : null;
      paint(); if (focused) api?.focusLeaf(focused);
    }, 100);
  });
  resizeObserver.observe(map);
  listen(map, 'pointerdown', clearSearch);
  map.addEventListener('wheel', clearSearch, { passive: true, signal: events.signal });
  // A sidebar can reflow between the two gestures. Its return destination is
  // always the whole retained surface, independent of the old column width.
  map.addEventListener('dblclick', event => {
    if (!api?.getState().focusPath.length) return;
    event.preventDefault(); event.stopPropagation(); api.fitAll();
  }, { capture: true, signal: events.signal });
  listen(host, 'click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'fit') { clearSearch(); api?.fitAll(); }
    if (action === 'refresh') refresh(0);
    if (action === 'back') closeBody();
    if (action === 'more') showBody();
    const button = event.target.closest('[data-category]');
    if (button) {
      category = category === button.dataset.category ? null : button.dataset.category;
      host.querySelectorAll('[data-category]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.category === category))); applySearch();
    }
    if (event.target.closest('.cc-open') && selected) openBody(selected);
  });
  listen(search, 'input', applySearch);
  listen(search, 'keydown', event => {
    if (event.key !== 'Enter') return;
    const query = search.value.trim().toLowerCase(), item = data?.items.find(item => (!category || category === item.category) && (item.name + ' ' + item.preview).toLowerCase().includes(query));
    if (item) { select(item); api?.select(item.id); api?.focusLeaf(item.id); applySearch(); }
  });
  listen(host, 'keydown', event => { if (event.key === 'Escape' && !bodyPane.hidden) { event.stopPropagation(); closeBody(); } });
  function visibility() {
    const next = requestedActive && document.visibilityState !== 'hidden';
    if (next === visible || destroyed) return;
    visible = next; host.dataset.active = String(visible);
    if (visible) { paint(); refresh(0); }
    else { clearTimeout(timer); clearTimeout(resizeTimer); request?.abort(); bodyRequest?.abort(); viewState = api?.getState() ?? viewState; api?.destroy(); api = null; bodyCache.clear(); bodyText = ''; bodyPane.querySelector('pre').textContent = ''; bodyPane.hidden = true; }
  }
  listen(document, 'visibilitychange', visibility); visibility();
  return {
    refresh,
    setActive(value) { requestedActive = Boolean(value); visibility(); },
    destroy() { requestedActive = false; visibility(); destroyed = true; clearTimeout(timer); clearTimeout(resizeTimer); resizeObserver.disconnect(); request?.abort(); bodyRequest?.abort(); api?.destroy(); events.abort(); bodyCache.clear(); data = null; host.replaceChildren(); host.classList.remove('current-context-panel'); },
  };
}
