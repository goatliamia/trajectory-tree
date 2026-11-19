(() => {
  'use strict';
  const locale = globalThis.__trajectoryLocale ?? 'zh-CN';
  const t = (zh, en) => locale === 'en' ? en : zh;
  const numFmt = new Intl.NumberFormat(locale);
  const decFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const cnyFmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtInt = v => Number.isFinite(v) ? numFmt.format(Math.round(v)) : '—';
  const fmtK = v => {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 1e6) return decFmt.format(v / 1e6) + 'M';
    if (Math.abs(v) >= 1e3) return decFmt.format(v / 1e3) + 'k';
    return numFmt.format(Math.round(v));
  };
  const fmtPct = v => Number.isFinite(v) ? decFmt.format(v * 100) + '%' : '—';
  const fmtCny = v => Number.isFinite(v) ? '¥' + cnyFmt.format(v) : null;
  const fmtGap = sec => {
    if (!Number.isFinite(sec)) return '—';
    if (sec < 60) return `${Math.round(sec)}s`;
    if (sec < 3600) return `${decFmt.format(sec / 60)}m`;
    return `${decFmt.format(sec / 3600)}h`;
  };

  const CAUSE_META = {
    'compaction/prune': { label: t('工具结果裁短', 'Tool result prune'), short: 'prune', cls: 'prune' },
    'compaction/summary': { label: t('摘要压缩', 'Compaction summary'), short: 'summary', cls: 'summary' },
    'session/reload': { label: t('会话重载 / 重启', 'Session reload'), short: 'reload', cls: 'reload' },
    'header/system': { label: t('请求头、系统段或模型信号', 'Header, system or model signal'), short: 'header', cls: 'header' },
    'idle-ttl': { label: t('长间隔回落', 'Long-gap drop'), short: 'gap', cls: 'ttl' },
    'unexplained': { label: t('未关联事件的回落', 'Drop without an observed boundary'), short: 'other', cls: 'unexplained' },
  };
  const causeMeta = cause => CAUSE_META[cause] ?? { label: String(cause || '—'), short: String(cause || '?'), cls: 'ttl' };

  function downsampleRequests(requests, maxBars = 180) {
    if (requests.length <= maxBars) {
      return requests.map(r => ({ kind: 'single', req: r, startIndex: r.index, endIndex: r.index }));
    }
    const important = new Set();
    for (let i = 0; i < requests.length; i++) {
      const r = requests[i];
      if (r.drop || r.hadCompactionBefore || r.hadPruneBefore || r.hadReloadBefore) {
        important.add(i);
        if (i > 0) important.add(i - 1);
      }
    }
    const stride = Math.max(2, Math.ceil((requests.length - important.size) / Math.max(20, maxBars - important.size)));
    const out = [];
    let i = 0;
    while (i < requests.length) {
      if (important.has(i)) {
        out.push({ kind: 'single', req: requests[i], startIndex: i, endIndex: i });
        i++;
        continue;
      }
      const start = i;
      let sumHit = 0, sumMiss = 0, count = 0;
      let peakReq = requests[i];
      while (i < requests.length && !important.has(i) && count < stride) {
        const r = requests[i];
        sumHit += r.cacheReadTokens;
        sumMiss += (r.uncachedInputTokens ?? r.inputTokens);
        if (r.totalInputTokens > peakReq.totalInputTokens) peakReq = r;
        count++;
        i++;
      }
      out.push({
        kind: 'bucket',
        count,
        startIndex: start,
        endIndex: i - 1,
        req: {
          ...peakReq,
          cacheReadTokens: sumHit / count,
          inputTokens: sumMiss / count,
          uncachedInputTokens: sumMiss / count,
          totalInputTokens: (sumHit + sumMiss) / count,
          turnStart: requests[start].turn,
          turnEnd: requests[i - 1].turn,
        },
      });
    }
    return out;
  }

  globalThis.__mountCacheCompaction = function mountCacheCompaction(root, cc, { host, onOpenTurn } = {}) {
    const s = cc?.summary;
    if (!root || !(s?.requestsWithUsage || s?.compactions || s?.prunePasses)) {
      if (root) root.hidden = true;
      return { setTurn() {} };
    }
    root.hidden = false;

    const anchors = [];
    for (const c of (cc.compactions || [])) {
      anchors.push({
        id: `comp:${c.seq}`,
        kind: 'compaction',
        cause: 'compaction/summary',
        seq: c.seq,
        reqSeq: c.nextRequestSeq ?? c.seq,
        turn: c.turn,
        compaction: c,
        drop: c.nextRequestDrop,
      });
    }
    for (const p of (cc.prunePasses || [])) {
      if (p.followedBySummary) continue;
      anchors.push({
        id: `prune:${p.seq}`,
        kind: 'prune',
        cause: 'compaction/prune',
        seq: p.seq,
        reqSeq: p.nextRequestSeq ?? p.seq,
        turn: p.turn,
        prune: p,
        drop: p.nextRequestDrop,
      });
    }
    for (const d of (cc.drops || [])) {
      if (d.cause === 'compaction/summary' || d.cause === 'compaction/prune') {
        if (anchors.some(a => a.reqSeq === d.seq && a.cause === d.cause)) continue;
      }
      anchors.push({
        id: `drop:${d.seq}`,
        kind: 'drop',
        cause: d.cause,
        seq: d.seq,
        reqSeq: d.seq,
        turn: d.turn,
        drop: d,
      });
    }
    anchors.sort((a, b) => a.seq - b.seq);

    const state = {
      activeTurn: null,
      causeFilter: 'all',
      selectedId: anchors.find(a => a.cause === 'compaction/prune' && a.drop)?.id
        ?? anchors.find(a => a.kind === 'compaction')?.id
        ?? anchors[0]?.id
        ?? (cc.requests.length ? `req:${cc.requests[cc.requests.length - 1].seq}` : null),
    };

    const reqBySeq = new Map((cc.requests || []).map(r => [r.seq, r]));
    const buckets = downsampleRequests(cc.requests || []);
    const maxTokens = buckets.reduce((max, bucket) => Math.max(max, bucket.req.totalInputTokens), 1000);

    function renderKpis() {
      const extraCostText = fmtCny(s.totalExtraCostCny);
      const pruneRatio = s.standalonePruneSavedTokens > 0 && s.standalonePruneLostCacheTokens > 0
        ? decFmt.format(s.standalonePruneLostCacheTokens / s.standalonePruneSavedTokens) + '×'
        : null;
      const compPureText = s.compactionPostReadCalls > 0
        ? `${fmtInt(s.compactionPureReReads)} / ${fmtInt(s.compactionPostReadCalls)} (${fmtPct(s.compactionPureReReadRatio)})`
        : s.compactions > 0 ? t('压缩后无读取', 'No reads after compaction') : '—';
      return `<div class="cache-strip">
        <div class="cache-kpi">
          <div class="cache-kpi-label"><span>${t('累计缓存命中', 'Cumulative cache hit')}</span></div>
          <div class="cache-kpi-value">${fmtPct(s.overallCacheHitRatio)}</div>
          <div class="cache-kpi-sub">${t('命中', 'Hit')} <code>${fmtK(s.totalCacheReadTokens)}</code> · ${t('未命中', 'Uncached')} <code>${fmtK(s.totalUncachedInputTokens)}</code> · ${fmtInt(s.requestsWithUsage)} ${t('次请求', 'reqs')}</div>
        </div>
        <div class="cache-kpi">
          <div class="cache-kpi-label"><span>${t('前缀缓存回落', 'Prefix cache drops')}</span></div>
          <div class="cache-kpi-value">${fmtInt(s.cacheDrops)} <span style="font-size:12px;font-weight:500;color:var(--muted)">${t('次', '')}</span></div>
          <div class="cache-kpi-sub">${t('减少命中', 'Lost')} <code>${fmtK(s.totalLostCacheTokens)}</code>${extraCostText ? ` · ${t('估算额外花费', 'Est. extra')} <code>${extraCostText}</code>` : ''}${s.ratioDilutions ? ` · ${t('排除', 'Excl.')} ${s.ratioDilutions} ${t('次比率稀释', 'dilutions')}` : ''}</div>
        </div>
        ${host === 'antigravity' ? '' : `<div class="cache-kpi">
          <div class="cache-kpi-label"><span>${t('工具结果裁短', 'Tool result pruning')}</span></div>
          <div class="cache-kpi-value">${fmtInt(s.prunePasses)} <span style="font-size:12px;font-weight:500;color:var(--muted)">${t('次', 'passes')} (${fmtInt(s.rawPruneEvents)} ${t('条', 'ops')})</span></div>
          <div class="cache-kpi-sub">${s.standalonePrunePasses > 0
            ? `${t('独立裁短省下', 'Saved')} <code>${fmtK(s.standalonePruneSavedTokens)}</code> · ${t('缓存回落', 'cache drop')} <code>${fmtK(s.standalonePruneLostCacheTokens)}</code>${pruneRatio ? ` (<code>${pruneRatio}</code>)` : ''}`
            : s.prunePasses ? t('均伴随摘要压缩发生', 'All preceded summary compaction') : t('暂无裁短记录', 'No prune events recorded')}</div>
        </div>`}
        <div class="cache-kpi">
          <div class="cache-kpi-label"><span>${t('压缩与裁短后重读', 'Post-compaction re-reads')}</span></div>
          <div class="cache-kpi-value">${s.compactions > 0 ? fmtInt(s.compactions) + ' ' + t('次压缩', 'compacts') : (s.prunedReadFiles > 0 ? `${s.prunedPureReReadFiles}/${s.prunedReadFiles}` : '0')}</div>
          <div class="cache-kpi-sub">${t('15步未改动重读', '15-call unmodified')}: <code>${compPureText}</code>${s.compactionModifiedReReads ? ` · ${t('改后重读', 'post-edit')} <code>${s.compactionModifiedReReads}</code>` : ''}${s.prunedReadFiles ? ` · ${t('被裁文件重读', 'pruned re-read')} <code>${s.prunedReReadFiles}/${s.prunedReadFiles}</code>` : ''}</div>
        </div>
      </div>`;
    }

    function renderCauseFilterBar() {
      const order = ['compaction/prune', 'compaction/summary', 'session/reload', 'header/system', 'idle-ttl', 'unexplained'];
      const pills = order.filter(c => (s.dropsByCause?.[c] || 0) > 0 || (c === 'compaction/summary' && s.compactions > 0) || (c === 'compaction/prune' && s.standalonePrunePasses > 0));
      if (!pills.length) return '';
      return `<div class="cache-cause-bar" role="group" aria-label="${t('按事件归因筛选', 'Filter by cause')}">
        <span>${t('回落与切点归因', 'Attribution')}:</span>
        <button type="button" class="cache-pill" data-cause-filter="all" aria-pressed="${state.causeFilter === 'all'}">${t('全部', 'All')} <code>${anchors.length}</code></button>
        ${pills.map(c => {
          const m = causeMeta(c);
          const count = anchors.filter(a => a.cause === c).length;
          return `<button type="button" class="cache-pill" data-cause-filter="${esc(c)}" aria-pressed="${state.causeFilter === c}"><i class="cache-dot cache-dot-${m.cls}"></i>${esc(m.label)} <code>${count}</code></button>`;
        }).join('')}
      </div>`;
    }

    function renderSvg() {
      if (!buckets.length) return `<p class="empty">${t('暂无可比的请求用量记录。', 'No comparable request usage was recorded.')}</p>`;
      const W = 720, H = 190, padL = 44, padR = 14, padT = 32, padB = 34;
      const plotW = W - padL - padR;
      const plotH = H - padT - padB;
      const n = buckets.length;
      const stepX = plotW / Math.max(1, n);
      const barW = Math.max(1.5, Math.min(14, stepX * 0.78));
      const yScale = v => padT + plotH - (Math.max(0, v) / maxTokens) * plotH;

      const ticks = [0, 0.5, 1].map(f => ({ val: maxTokens * f, y: padT + plotH * (1 - f) }));
      const selectedAnchor = anchors.find(a => a.id === state.selectedId);
      const selectedReqSeq = selectedAnchor?.reqSeq ?? (state.selectedId?.startsWith('req:') ? Number(state.selectedId.slice(4)) : null);

      const seqToX = new Map();
      let lastLabelX = [-999, -999];
      const barsSvg = buckets.map((b, idx) => {
        const xCenter = padL + (idx + 0.5) * stepX;
        const x = xCenter - barW / 2;
        const r = b.req;
        seqToX.set(r.seq, xCenter);
        const hit = r.cacheReadTokens || 0;
        const miss = r.uncachedInputTokens ?? r.inputTokens ?? 0;
        const yHit = yScale(hit);
        const hHit = Math.max(0, padT + plotH - yHit);
        const yTop = yScale(hit + miss);
        const hMiss = Math.max(0, yHit - yTop);
        const isDrop = Boolean(b.kind === 'single' && r.drop);
        const dropCause = r.drop?.cause;
        const isSelected = b.kind === 'single' && r.seq === selectedReqSeq;
        const dimmed = state.activeTurn != null && (b.kind === 'single' ? r.turn !== state.activeTurn : (r.turnEnd < state.activeTurn || r.turnStart > state.activeTurn));
        const anchorForBar = b.kind === 'single' ? anchors.find(a => a.reqSeq === r.seq) : null;
        const clickId = anchorForBar ? anchorForBar.id : `req:${r.seq}`;
        const causeCls = dropCause ? causeMeta(dropCause).cls : '';
        let dropLine = '';
        if (isDrop) {
          const row = (xCenter - lastLabelX[0]) >= 46 ? 0 : 1;
          const showText = (xCenter - lastLabelX[row]) >= 40;
          if (showText) lastLabelX[row] = xCenter;
          const labelY = row === 0 ? padT - 9 : padT - 20;
          const lineTop = row === 0 ? padT - 6 : padT - 17;
          dropLine = `<line class="cache-drop-line cache-drop-line-${causeCls}" x1="${xCenter.toFixed(1)}" y1="${lineTop}" x2="${xCenter.toFixed(1)}" y2="${padT + plotH}" />`
            + (showText ? `<text class="cache-axis-label" x="${xCenter.toFixed(1)}" y="${labelY}" text-anchor="middle" style="fill:var(--${causeCls === 'unexplained' ? 'red' : causeCls === 'prune' ? 'amber' : 'accent'})">${esc(causeMeta(dropCause).short)}</text>` : '');
        }
        return `<g class="cache-bar-group${isSelected ? ' is-selected' : ''}${dimmed ? ' is-turn-dim' : ''}" data-select-id="${esc(clickId)}">
          <title>${esc(`${t('第', 'T')}${r.turn ?? '?'}${t('轮', '')} · #${r.seq} · ${t('命中', 'hit')} ${fmtK(hit)} / ${t('未命中', 'miss')} ${fmtK(miss)}${isDrop ? ' · ' + causeMeta(dropCause).label : ''}`)}</title>
          <rect class="cache-bar-bg" x="${(xCenter - stepX / 2).toFixed(1)}" y="${padT}" width="${stepX.toFixed(1)}" height="${plotH}" fill="transparent" />
          ${hHit > 0.3 ? `<rect class="cache-bar-hit" x="${x.toFixed(1)}" y="${yHit.toFixed(1)}" width="${barW.toFixed(1)}" height="${hHit.toFixed(1)}" />` : ''}
          ${hMiss > 0.3 ? `<rect class="cache-bar-miss${isDrop ? (dropCause === 'unexplained' ? ' is-drop-unexplained' : ' is-drop') : ''}" x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${hMiss.toFixed(1)}" />` : ''}
          ${dropLine}
        </g>`;
      }).join('');

      const trackY = padT + plotH + 16;
      const trackDots = anchors.map(a => {
        const x = seqToX.get(a.reqSeq);
        if (x == null) return '';
        const m = causeMeta(a.cause);
        const colorVar = m.cls === 'prune' ? 'var(--amber)' : m.cls === 'summary' ? 'var(--accent)' : m.cls === 'unexplained' ? 'var(--red)' : 'var(--teal)';
        const isSel = a.id === state.selectedId;
        return a.kind === 'compaction'
          ? `<polygon class="cache-marker-btn" data-select-id="${esc(a.id)}" points="${x.toFixed(1)},${trackY - 5} ${(x + 4.5).toFixed(1)},${trackY} ${x.toFixed(1)},${trackY + 5} ${(x - 4.5).toFixed(1)},${trackY}" fill="${colorVar}" stroke="${isSel ? 'var(--ink)' : 'none'}" stroke-width="1.5"><title>${esc(`${t('摘要压缩', 'Compaction')} #${a.seq} · ${a.compaction.postWindow?.pureReReads ?? 0} ${t('次未改动重读', 'unmodified re-reads')}`)}</title></polygon>`
          : `<circle class="cache-marker-btn" data-select-id="${esc(a.id)}" cx="${x.toFixed(1)}" cy="${trackY}" r="${isSel ? 4.2 : 3}" fill="${colorVar}" stroke="${isSel ? 'var(--ink)' : 'none'}" stroke-width="1.5"><title>${esc(`${m.label} #${a.seq}`)}</title></circle>`;
      }).join('');

      return `<div class="cache-chart-meta">
        <div class="legend">
          <span><i class="swatch" style="background:var(--pale-blue)"></i>${t('缓存命中 (cacheRead)', 'Cache hit')}</span>
          <span><i class="swatch" style="background:var(--blue)"></i>${t('常规新增输入', 'Uncached input')}</span>
          <span><i class="swatch" style="background:var(--amber)"></i>${t('缓存回落未命中', 'Cache-drop miss')}</span>
          <span><i class="swatch" style="background:var(--accent)"></i>${t('◆ 摘要压缩', '◆ Summary')}</span>
        </div>
        <span class="mono">${buckets.length < cc.requests.length ? t(`${cc.requests.length} 次请求（平稳段已聚合，保留全部回落）`, `${cc.requests.length} reqs (steady plateaus bucketed)`) : t(`${cc.requests.length} 次请求`, `${cc.requests.length} requests`)}</span>
      </div>
      <div class="cache-svg-wrap">
        <svg class="cache-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('逐请求缓存命中与未命中分布图', 'Per-request cache hit and miss distribution')}">
          ${ticks.map(tk => `<line class="cache-grid-line" x1="${padL}" y1="${tk.y.toFixed(1)}" x2="${W - padR}" y2="${tk.y.toFixed(1)}" />
            <text class="cache-axis-label" x="${padL - 6}" y="${(tk.y + 3).toFixed(1)}" text-anchor="end">${esc(fmtK(tk.val))}</text>`).join('')}
          ${barsSvg}
          <line class="cache-grid-line" x1="${padL}" y1="${trackY}" x2="${W - padR}" y2="${trackY}" />
          <text class="cache-axis-label" x="${padL - 6}" y="${trackY + 3}" text-anchor="end">${t('切点', 'cuts')}</text>
          ${trackDots}
        </svg>
      </div>`;
    }

    function renderAnchorList() {
      const visible = anchors.filter(a => {
        if (state.causeFilter !== 'all' && a.cause !== state.causeFilter) return false;
        if (state.activeTurn != null && a.turn != null && a.turn !== state.activeTurn) return false;
        return true;
      });
      if (!visible.length) {
        return `<div class="cache-events-head"><span>${t('缓存回落与压缩切点', 'Cache drops & compaction cuts')}</span><span>0</span></div>
          <p class="empty">${t('当前筛选范围暂无缓存回落或压缩切点。点击上方任意请求柱查看明细。', 'No cache drops or compaction cuts in this filter. Click any request bar above.')}</p>`;
      }
      return `<div class="cache-events-head">
        <span>${t('缓存回落与压缩切点（点选查看详情）', 'Cache drops & compaction cuts')}</span>
        <span class="mono">${visible.length}</span>
      </div>
      <div class="cache-events-list">${visible.map(a => {
        const m = causeMeta(a.cause);
        const sel = a.id === state.selectedId;
        let title = m.label;
        let meta = `${t('第', 'T')}${a.turn ?? '?'}${t('轮', '')} · #${a.seq}`;
        let delta = '';
        let deltaCls = '';
        if (a.kind === 'compaction') {
          const c = a.compaction;
          const pure = c.postWindow?.pureReReads ?? 0;
          const reads = c.postWindow?.readCalls ?? 0;
          title = `${t('摘要压缩', 'Summary compaction')}${c.precededByPrune ? ' · ' + t('前有裁短', 'after prune') : ''}`;
          meta += ` · ${t('压掉', 'shadowed')} ${fmtK(c.shadowedTokenCount)} · ${t('15步未改动重读', 'unmodified re-read')} ${pure}/${reads}`;
          delta = c.nextRequestDrop ? `-${fmtK(c.nextRequestDrop.lostCacheTokens)}` : fmtPct(c.summaryUsage?.cacheHitRatio);
          deltaCls = pure > 0 ? 'is-warn' : '';
        } else if (a.kind === 'prune') {
          const p = a.prune;
          title = `${t('独立工具裁短', 'Standalone prune')} (${p.prunedCount} ${t('条', 'ops')})`;
          meta += ` · ${t('省下', 'saved')} ${fmtK(p.shadowedTokenCount)}`;
          if (p.nextRequestDrop) {
            delta = `${t('缓存回落', 'drop')} ${fmtK(p.nextRequestDrop.lostCacheTokens)}`;
            deltaCls = 'is-warn';
          } else {
            delta = t('缓存未回落', 'intact');
          }
        } else if (a.drop) {
          const d = a.drop;
          meta += d.gapSec != null ? ` · ${t('间隔', 'gap')} ${fmtGap(d.gapSec)}` : '';
          delta = `-${fmtK(d.lostCacheTokens)}`;
          deltaCls = a.cause === 'unexplained' ? 'is-bad' : 'is-warn';
        }
        return `<button type="button" class="cache-event-row" data-select-id="${esc(a.id)}" aria-pressed="${sel}">
          <i class="cache-dot cache-dot-${m.cls}"></i>
          <span style="min-width:0">
            <div class="cache-event-title">${esc(title)}</div>
            <div class="cache-event-meta mono">${esc(meta)}</div>
          </span>
          <span class="cache-event-delta ${deltaCls}">${esc(delta)}</span>
        </button>`;
      }).join('')}</div>`;
    }

    function renderInspector() {
      const anchor = anchors.find(a => a.id === state.selectedId);
      const reqSeq = anchor?.reqSeq ?? (state.selectedId?.startsWith('req:') ? Number(state.selectedId.slice(4)) : null);
      const req = reqSeq != null ? reqBySeq.get(reqSeq) : null;
      if (!anchor && !req) {
        return `<p class="empty">${t('点击左侧请求柱或切点查看缓存与压缩明细。', 'Select a request bar or cut marker to inspect.')}</p>`;
      }

      const turn = anchor?.turn ?? req?.turn;
      const openTurnBtn = turn != null && typeof onOpenTurn === 'function'
        ? `<button type="button" class="text-action" data-open-cache-turn="${turn}">${t(`聚焦第 ${turn} 轮`, `Focus turn ${turn}`)}</button>`
        : '';

      if (anchor?.kind === 'prune') {
        const p = anchor.prune;
        const d = p.nextRequestDrop;
        const saved = p.shadowedTokenCount || 0;
        const lost = d?.lostCacheTokens || 0;
        const maxBar = Math.max(1, saved, lost);
        const ratioText = saved > 0 && lost > 0 ? `${decFmt.format(lost / saved)}×` : null;
        const extraCny = fmtCny(d?.extraCostCny);
        const filesHtml = p.prunedReadFiles.length
          ? `<h4>${t('被裁短的读取文件', 'Pruned read files')} (${p.prunedReadFiles.length})</h4>
            <ul class="cache-file-list">${p.prunedReadFiles.map(f => {
              const tag = f.reReadCount === 0
                ? `<span class="cache-tag cache-tag-none">${t('后续未重读', 'not re-read')}</span>`
                : f.modifiedBeforeReRead
                  ? `<span class="cache-tag cache-tag-mod">${t('改后重读', 'post-edit')} #${f.firstReReadSeq}</span>`
                  : `<span class="cache-tag cache-tag-pure">${t('未改动重读', 'unmodified')} #${f.firstReReadSeq}</span>`;
              return `<li class="cache-file-item"><span class="cache-file-name" title="${esc(f.path)}">${esc(f.basename)} <span style="color:var(--muted)">#${f.originalSeq}</span></span>${tag}</li>`;
            }).join('')}</ul>`
          : `<p class="cache-kpi-sub" style="margin-top:8px">${t('本次裁短的对象为非 read 工具返回（如命令/搜索输出）。', 'Pruned results were non-read tool outputs (e.g. shell/search).')}</p>`;

        return `<div class="cache-inspector-head">
          <h3><i class="cache-dot cache-dot-prune" style="margin-right:6px"></i>${t('独立工具裁短', 'Standalone Tool Prune')}</h3>
          ${openTurnBtn}
        </div>
        <div class="cache-compare-box">
          <div class="cache-compare-title"><span>${t('裁短省下 vs 次步缓存回落', 'Pruned vs Next cache drop')}</span><strong class="mono">${ratioText ? t(`回落 / 省下 ${ratioText}`, `${ratioText} drop/saved`) : t('缓存未回落', 'Cache intact')}</strong></div>
          <div class="cache-compare-row">
            <span>${t('裁短省下', 'Pruned')}</span>
            <div class="cache-compare-track"><div class="cache-compare-fill cache-compare-fill-saved" style="width:${(saved / maxBar * 100).toFixed(1)}%"></div></div>
            <span class="mono">${fmtK(saved)}</span>
          </div>
          <div class="cache-compare-row">
            <span>${t('缓存回落', 'Cache drop')}</span>
            <div class="cache-compare-track"><div class="cache-compare-fill cache-compare-fill-lost" style="width:${(lost / maxBar * 100).toFixed(1)}%"></div></div>
            <span class="mono">${fmtK(lost)}</span>
          </div>
        </div>
        <dl class="facts">
          <div><dt>${t('切点序号', 'Prune seq')}</dt><dd class="mono">#${p.seq}${p.endSeq !== p.seq ? '–#' + p.endSeq : ''} (${p.prunedCount} ${t('条', 'ops')})</dd></div>
          ${d ? `<div><dt>${t('次步缓存变化', 'Next req cache')}</dt><dd class="mono">${fmtK(d.prevCacheRead)} → ${fmtK(d.currCacheRead)} (${fmtPct(d.prevHitRatio)} → ${fmtPct(d.currHitRatio)})</dd></div>
          <div><dt>${t('请求间隔', 'Gap')}</dt><dd class="mono">${fmtGap(d.gapSec)}</dd></div>
          ${extraCny ? `<div><dt>${t('估算额外花费', 'Est. extra cost')}</dt><dd class="mono">${extraCny}</dd></div>` : ''}` : ''}
        </dl>
        ${filesHtml}`;
      }

      if (anchor?.kind === 'compaction') {
        const c = anchor.compaction;
        const su = c.summaryUsage;
        const pw = c.postWindow || {};
        const hitPct = su?.cacheHitRatio;
        const hitBar = hitPct != null ? Math.round(hitPct * 100) : 0;
        const reReadHtml = (pw.reReadItems || []).length
          ? `<h4>${t(`压缩后 ${pw.windowLimit} 步内重读文件`, `Re-reads within ${pw.windowLimit} calls`)} (${pw.reReadItems.length})</h4>
            <ul class="cache-file-list">${pw.reReadItems.map(item => `<li class="cache-file-item">
              <span class="cache-file-name" title="${esc(item.path)}">${esc(item.basename)} <span style="color:var(--muted)">#${item.priorReadSeq}→#${item.postReadSeq}</span></span>
              <span class="cache-tag ${item.modifiedInBetween ? 'cache-tag-mod' : 'cache-tag-pure'}">${item.modifiedInBetween ? t('改后重读', 'post-edit') : t('未改动重读', 'unmodified')}</span>
            </li>`).join('')}</ul>`
          : `<p class="cache-kpi-sub" style="margin-top:8px">${t(`压缩后 ${pw.toolCallsObserved ?? 0} 次工具调用内未重读旧文件。`, `No previously read files were re-read within ${pw.toolCallsObserved ?? 0} calls.`)}</p>`;

        return `<div class="cache-inspector-head">
          <h3><i class="cache-dot cache-dot-summary" style="margin-right:6px"></i>${t('摘要压缩切点', 'Compaction Summary')} #${c.seq}</h3>
          ${openTurnBtn}
        </div>
        ${su ? `<div class="cache-compare-box">
          <div class="cache-compare-title"><span>${t('总结调用自身缓存命中率', 'Summarizer own cache hit')}${c.precededByPrune ? ' · ' + t('前有裁短', 'preceded by prune') : ''}</span><strong class="mono">${fmtPct(hitPct)}</strong></div>
          <div class="cache-compare-row">
            <span>${t('缓存命中', 'Cache hit')}</span>
            <div class="cache-compare-track"><div class="cache-compare-fill cache-compare-fill-hit" style="width:${hitBar}%"></div></div>
            <span class="mono">${fmtK(su.cacheReadTokens)}</span>
          </div>
          <div class="cache-compare-row">
            <span>${t('未命中输入', 'Uncached')}</span>
            <div class="cache-compare-track"><div class="cache-compare-fill cache-compare-fill-miss" style="width:${100 - hitBar}%"></div></div>
            <span class="mono">${fmtK(su.uncachedInputTokens ?? su.inputTokens)}</span>
          </div>
        </div>` : ''}
        <dl class="facts">
          <div><dt>${t('上下文缩减', 'Context shrink')}</dt><dd class="mono">${fmtK(c.shadowedTokenCount)} → ${c.summaryEstimatedTokens == null ? '—' : '~' + fmtK(c.summaryEstimatedTokens)}</dd></div>
          ${anchor.drop ? `<div><dt>${t('后续请求的缓存读取量', 'Cache reads on the next request')}</dt><dd class="mono">${fmtK(anchor.drop.prevCacheRead)} → ${fmtK(anchor.drop.currCacheRead)}</dd></div>` : ''}
          <div><dt>${t('15步读取构成', '15-call reads')}</dt><dd class="mono">${t('未改动重读', 'unmod')} ${pw.pureReReads ?? 0} · ${t('改后重读', 'mod')} ${pw.modifiedReReads ?? 0} / ${pw.readCalls ?? 0}</dd></div>
          <div><dt>${t('15步改写报错', '15-call edit errs')}</dt><dd class="mono">${pw.editErrors ?? 0} / ${pw.editCalls ?? 0}</dd></div>
        </dl>
        ${reReadHtml}`;
      }

      const d = anchor?.drop ?? req?.drop;
      if (d) {
        const m = causeMeta(d.cause);
        const extraCny = fmtCny(d.extraCostCny);
        return `<div class="cache-inspector-head">
          <h3><i class="cache-dot cache-dot-${m.cls}" style="margin-right:6px"></i>${esc(m.label)}</h3>
          ${openTurnBtn}
        </div>
        <dl class="facts">
          <div><dt>${t('请求定位', 'Request')}</dt><dd class="mono">${t('第', 'Turn ')}${d.turn ?? '?'}${t('轮', '')} · #${d.prevSeq} → #${d.seq}</dd></div>
          <div><dt>${t('缓存回落', 'Cache drop')}</dt><dd class="mono">${fmtK(d.prevCacheRead)} → ${fmtK(d.currCacheRead)} (-${fmtK(d.lostCacheTokens)})</dd></div>
          <div><dt>${t('命中率变化', 'Hit ratio')}</dt><dd class="mono">${fmtPct(d.prevHitRatio)} → ${fmtPct(d.currHitRatio)}</dd></div>
          <div><dt>${t('间隔时长', 'Gap')}</dt><dd class="mono">${fmtGap(d.gapSec)}</dd></div>
          ${extraCny ? `<div><dt>${t('估算额外花费', 'Est. extra cost')}</dt><dd class="mono">${extraCny}</dd></div>` : ''}
        </dl>
        <p class="cache-kpi-sub" style="margin-top:8px">${d.cause === 'unexplained'
          ? t('相邻请求之间未记录可关联的本地事件。', 'No related local event was recorded between these requests.')
          : d.cause === 'idle-ttl'
            ? t('相邻请求间隔较长（≥5 分钟）且本地无压缩或切换事件；隐式缓存的留存时间由服务端动态管理（非固定 TTL），此处仅作候选归因提示。', 'Long gap (≥5 min) with no local compaction or switch; implicit cache retention is managed dynamically by the provider (not a fixed TTL), so this is a candidate attribution.')
            : t('此标签来自相邻请求之间记录的事件或模型变化。', 'This label reflects an event or model change recorded between adjacent requests.')}</p>`;
      }

      return `<div class="cache-inspector-head">
        <h3>${t('模型请求', 'Model request')} #${req.seq}</h3>
        ${openTurnBtn}
      </div>
      <dl class="facts">
        <div><dt>${t('轮次 / 步骤', 'Turn / Step')}</dt><dd class="mono">${t('第', 'T')}${req.turn ?? '?'}${t('轮', '')} · S${req.step ?? '?'}</dd></div>
        <div><dt>${t('模型', 'Model')}</dt><dd class="mono">${esc([req.provider, req.model].filter(Boolean).join(' / ') || '—')}</dd></div>
        <div><dt>${t('缓存命中', 'Cache hit')}</dt><dd class="mono">${fmtK(req.cacheReadTokens)} (${fmtPct(req.cacheHitRatio)})</dd></div>
        <div><dt>${t('未命中输入', 'Uncached input')}</dt><dd class="mono">${fmtK(req.uncachedInputTokens ?? req.inputTokens)}</dd></div>
        <div><dt>${t('输出', 'Output')}</dt><dd class="mono">${fmtK(req.outputTokens)}</dd></div>
      </dl>`;
    }

    function render() {
      root.innerHTML = `<header class="section-head comparison-head">
        <div>
          <h2 id="cache-compaction-title">${t('缓存与压缩', 'Cache & compaction')}</h2>
          <p>${t('对比相邻请求的缓存读取量，查看回落、压缩切点和压缩后的文件重读。', 'Compare cache reads across adjacent requests and inspect drops, compaction cuts and file re-reads.')}</p>
        </div>
      </header>
      ${renderKpis()}
      ${renderCauseFilterBar()}
      <div class="cache-layout">
        <div class="cache-canvas">
          ${renderSvg()}
          ${renderAnchorList()}
        </div>
        <aside class="cache-inspector" aria-live="polite">
          ${renderInspector()}
        </aside>
      </div>`;
    }

    root.addEventListener('click', event => {
      const filterBtn = event.target.closest('button[data-cause-filter]');
      if (filterBtn) {
        state.causeFilter = filterBtn.dataset.causeFilter;
        render();
        return;
      }
      const openTurn = event.target.closest('button[data-open-cache-turn]');
      if (openTurn) {
        onOpenTurn?.(Number(openTurn.dataset.openCacheTurn));
        return;
      }
      const selEl = event.target.closest('[data-select-id]');
      if (selEl) {
        state.selectedId = selEl.dataset.selectId;
        render();
      }
    });

    render();
    return {
      setTurn(turn) {
        state.activeTurn = turn;
        render();
      },
    };
  };
})();
