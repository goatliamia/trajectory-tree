  // Visual adaptation only: semantic categories and recorded values remain unchanged.
  for (const category of CONTEXT_CATEGORIES) category.color = 'var(--chart-' + category.key + ')';
  let geistMeasureFont = '';
  const geistMeasureWidths = new Map();
  function geistSyncMeasureFont() {
    const font = '12px ' + getComputedStyle(document.body).getPropertyValue('--sans');
    if (font !== geistMeasureFont) {
      geistMeasureFont = font;
      geistMeasureWidths.clear();
      reviewFileLayoutCache = null;
    }
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
        const label = document.createElement('span'); label.className = 'geist-section-label'; label.textContent = ui('观察');
        row.append(label, switches); caption.prepend(row);
      }
      legend = document.createElement('div'); legend.id = 'geist-legend'; legend.className = 'geist-legend';
      caption.append(legend);
      const toggle = document.createElement('button'); toggle.id = 'geist-legend-toggle'; toggle.className = 'geist-text-action quiet';
      toggle.innerHTML = '<span class="geist-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="m12.06 6.75-.53.53-2.82 2.82a1 1 0 0 1-1.42 0L4.47 7.28l-.53-.53L5 5.69l.53.53L8 8.69l2.47-2.47.53-.53z"/></svg></span>' + ui('符号说明'); toggle.setAttribute('aria-controls', legend.id);
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
  let geistFitPass = false;
  renderOverview = function(...args) {
    geistSyncMeasureFont();
    const value = geistOverviewBase(...args);
    geistArrangeCaption(); geistGoalChip();
    // Fit again if arranging the caption changed the available box. The SVG
    // itself can legitimately be taller when the goal or branch lanes overflow.
    const box = $('graph-scroll') ? $('graph-scroll').clientHeight : 0;
    if (!geistFitPass && box > 120 && Math.abs((geistOverviewFrame?.height || 0) - Math.max(240, box)) > 14) {
      geistFitPass = true;
      try { geistOverviewBase(...args); geistArrangeCaption(); geistGoalChip(); } finally { geistFitPass = false; }
    }
    return value;
  };
  // 目标入口放在观察行:caption 每次重排都会重建子节点,所以放在重排之后补。
  function geistGoalChip() {
    const goal = (typeof data !== 'undefined' && data.context && data.context.goal) || null;
    if (!goal) return;
    const caption = $('graph-caption');
    const layers = caption && caption.querySelector('.br-layers');
    if (layers && !layers.querySelector('[data-br-layer="goal"]')) {
      layers.insertAdjacentHTML('beforeend', '<label class="br-layer"><input type="checkbox" data-br-layer="goal"' + (overviewLayers.has('goal') ? ' checked' : '') + ui('>目标</label>'));
      layers.querySelector('[data-br-layer="goal"]').onchange = event => {
        event.target.checked ? overviewLayers.add('goal') : overviewLayers.delete('goal');
        renderOverview();
      };
    }
  }
  const geistActionBase = renderActionPath;
  renderActionPath = function(...args) { geistSyncMeasureFont(); const value = geistActionBase(...args); geistArrangeCaption(); return value; };
  // Re-measure labels once the self-hosted font is ready; preserve the viewport.
  document.fonts.ready.then(() => {
    geistMeasureWidths.clear();
    reviewFileLayoutCache = null;
    const vp = $('graph-scroll'), left = vp.scrollLeft, top = vp.scrollTop;
    if (view === 'path') renderActionPath(); else renderOverview({ plotOnly: true });
    vp.scrollLeft = left; vp.scrollTop = top;
  });
