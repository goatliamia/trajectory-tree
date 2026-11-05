  // Visual adaptation only: semantic categories and recorded values remain unchanged.
  for (const category of CONTEXT_CATEGORIES) category.color = 'var(--chart-' + category.key + ')';
  let geistMeasureFont = '';
  const geistMeasureWidths = new Map();
  function geistSyncMeasureFont() {
    const font = '12px ' + getComputedStyle(document.body).getPropertyValue('--sans');
    if (font !== geistMeasureFont) { geistMeasureFont = font; geistMeasureWidths.clear(); }
  }
  reviewMeasure = function(text) {
    if (!geistMeasureFont) geistSyncMeasureFont();
    const key = String(text);
    if (geistMeasureWidths.has(key)) return geistMeasureWidths.get(key);
    tlContext.font = geistMeasureFont;
    const width = tlContext.measureText(key).width;
    if (geistMeasureWidths.size > 4096) geistMeasureWidths.clear();
    geistMeasureWidths.set(key, width);
    return width;
  };
  let geistLegendOpen = false;
  // 开合状态只有一个来源:图例的 hidden 与按钮的 aria-expanded 都从这里同步。
  function geistSyncLegend() {
    const legend = $('geist-legend'), toggle = $('geist-legend-toggle');
    if (!legend) return;
    legend.hidden = !geistLegendOpen;
    if (toggle) toggle.setAttribute('aria-expanded', String(geistLegendOpen));
  }
  function geistArrangeCaption() {
    geistRenderContextOverview();
    geistBindLayout();
    const caption = $('graph-caption');
    if (!caption) return;
    let legend = $('geist-legend');
    if (!legend) {
      const switches = caption.querySelector('.br-layers');
      if (switches) {
        const row = document.createElement('div'); row.className = 'geist-observe-row';
        const label = document.createElement('span'); label.className = 'geist-section-label'; label.textContent = '观察';
        row.append(label, switches); caption.prepend(row);
      }
      legend = document.createElement('div'); legend.id = 'geist-legend'; legend.className = 'geist-legend';
      caption.append(legend);
      const toggle = document.createElement('button'); toggle.id = 'geist-legend-toggle'; toggle.className = 'geist-text-action quiet';
      toggle.textContent = '符号说明'; toggle.setAttribute('aria-controls', legend.id);
      toggle.onclick = () => { geistLegendOpen = !geistLegendOpen; geistSyncLegend(); };
      caption.querySelector('.geist-observe-row')?.append(toggle);
      // Controls belong to the canvas; the inspector follows without another card.
      if (caption.nextElementSibling !== $('step-panel')) $('step-panel').before(caption);
      geistPlaceFileStatus();
    }
    // 每次重绘都会重建图例元素;不重新收进来,它们就留在外面,点"收起"收掉的只是一个空盒子。
    for (const element of [...caption.children]) {
      if (element === legend) continue;
      if (element.matches('.br-key,.review-overlay-key')) legend.append(element);
    }
    caption.querySelector('.br-key')?.classList.add('geist-symbols');
    geistSyncLegend();
  }
  const geistOverviewBase = renderOverview;
  renderOverview = function(...args) { geistSyncMeasureFont(); const value = geistOverviewBase(...args); geistArrangeCaption(); geistGoalChip(); return value; };
  // 目标入口放在观察行:caption 每次重排都会重建子节点,所以放在重排之后补。
  function geistGoalChip() {
    const goal = (typeof data !== 'undefined' && data.context && data.context.goal) || null;
    if (!goal) return;
    const caption = $('graph-caption');
    if (!caption || caption.querySelector('#br-goal')) return;
    const label = '目标 ' + (goal.phase || 'active') + (goal.roundsStarted != null && goal.maxGoalRounds != null ? ' · ' + goal.roundsStarted + '/' + goal.maxGoalRounds : '');
    caption.insertAdjacentHTML('afterbegin', '<button class="geist-text-action quiet" id="br-goal">' + label + ' ↗</button>');
    // 不做点击:SVG 里 z 序不可靠。改成悬停在带子所在的横带内弹出信息。
    let tip = document.getElementById('goal-tip');
    if (!tip) {
      tip = document.createElement('div'); tip.id = 'goal-tip';
      tip.style.cssText = 'position:fixed;z-index:80;max-width:360px;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:12px/1.5 var(--sans);box-shadow:0 8px 28px #0003;display:none;pointer-events:none';
      document.body.appendChild(tip);
    }
    tip.textContent = (goal.objective || '目标未记录') + ' · ' + (goal.phase || '') + (goal.roundsStarted != null ? ' · ' + goal.roundsStarted + '/' + (goal.maxGoalRounds ?? '?') : '');
    const scroll = $('graph-scroll');
    if (scroll && !scroll.dataset.goalTip) {
      scroll.dataset.goalTip = '1';
      scroll.addEventListener('mousemove', event => {
        const band = document.querySelector('[data-goal-band]');
        const tipEl = document.getElementById('goal-tip');
        if (!band || !tipEl) return;
        const r = band.getBoundingClientRect();
        const inside = event.clientY >= r.top - 6 && event.clientY <= r.bottom + 6;
        tipEl.style.display = inside ? 'block' : 'none';
        if (inside) { tipEl.style.left = Math.min(window.innerWidth - 380, event.clientX + 14) + 'px'; tipEl.style.top = Math.max(8, event.clientY - 8) + 'px'; }
      });
      scroll.addEventListener('mouseleave', () => { const tipEl = document.getElementById('goal-tip'); if (tipEl) tipEl.style.display = 'none'; });
    }
    $('br-goal').onclick = () => {
      const rows = [['目标', goal.objective || '未记录'], ['阶段', goal.phase || '未记录'],
        ['轮次', goal.roundsStarted != null ? goal.roundsStarted + ' / ' + (goal.maxGoalRounds ?? '?') : '未记录'],
        ['变更', (goal.markers || []).map(m => (m.operation || '') + '@' + m.seq).join(' · ') || '未记录']];
      openDrawer('会话目标', label, '<dl class="geist-timing-facts">' + rows.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + String(v).replace(/</g, '&lt;') + '</dd></div>').join('') + '</dl>');
    };
  }
  const geistActionBase = renderActionPath;
  renderActionPath = function(...args) { geistSyncMeasureFont(); const value = geistActionBase(...args); geistArrangeCaption(); return value; };
  // Re-measure labels once the self-hosted font is ready; preserve the viewport.
  document.fonts.ready.then(() => {
    geistMeasureWidths.clear();
    const vp = $('graph-scroll'), left = vp.scrollLeft, top = vp.scrollTop;
    if (view === 'path') renderActionPath(); else renderOverview({ plotOnly: true });
    vp.scrollLeft = left; vp.scrollTop = top;
  });
