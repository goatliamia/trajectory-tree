  function reviewActionStepLabel(step) {
    const kinds = [...new Set(step.calls.map(callKind))];
    const titles = [...new Set(step.calls.map(c => reviewContextData.callFacts?.[c.seq]?.title).filter(Boolean))];
    if (kinds.length === 1 && kinds[0] === 'other' && titles.length === 1) return titles[0] + (step.calls.length > 1 ? ' ×' + step.calls.length : '');
    return kinds.length > 1 ? kinds.slice(0, 2).map(kindLabel).join('、') + (kinds.length > 2 ? ui('等') : '') : stepLabel(step);
  }
  function renderActionPath() {
    const t = turn(), steps = t.steps, count = steps.length, viewport = $('graph-scroll');
    const canvas = $('canvas'); canvas.classList.add('review-action-mode');
    if (!count) { $('graph').innerHTML = ''; return; }
    selectedStep = Math.max(0, Math.min(selectedStep, count - 1));
    const selected = steps[selectedStep], showContext = overviewLayers.has('context'), showTime = overviewLayers.has('duration');
    const geometry = typeof geistActionGeometry === 'function' ? geistActionGeometry(t) : { height: 360, base: 208 };
    const viewportWidth = Math.max(300, viewport.clientWidth), viewportLeft = viewport.scrollLeft, gutter = 54, { height, base: rawBase } = geometry;
    // 文件行画在基线下方 78px,再留标签高度;基线太靠下时这一行会被画布裁掉,
    // 所以按"文件行 + 底部刻度"反推一个安全基线,而不是固定 height-96。
    const fileRow = overviewLayers.has('files') ? 46 : 0;
    const base = Math.min(rawBase, height - 20 - fileRow - 78);
    const gap = Math.max(128, Math.min(176, (viewportWidth - gutter * 2) / count));
    const width = Math.max(viewportWidth, gutter * 2 + gap * count);
    const start = (width - gap * count) / 2, x = index => start + (index + .5) * gap;
    const scale = { ...reviewActionScale(t), pixels: 100 };
    // 上下按本轮实际的增减极值分配:数据在真实页面里是齐的(rows 598 / index 598)。
    let sideUp = 0, sideDown = 0;
    if (showContext) for (const step of steps) {
      const info = reviewStepContext(t, step); if (!info) continue;
      let plus = 0, minus = 0;
      for (const c of CONTEXT_CATEGORIES) { const value = info.parts[c.key] || 0; if (value > 0) plus += value; else minus -= value; }
      sideUp = Math.max(sideUp, plus); sideDown = Math.max(sideDown, minus);
    }
    const band = scale.pixels * 2;
    // 顶部是步标题与材料行所在的安全区;柱子不能长进去,否则会盖住上方视图,
    // 而这里滚轮是缩放、没有额外的纵向滚动可以躲。
    const topSafe = 150;
    const wantedUp = sideUp + sideDown > 0 ? Math.max(28, band * sideUp / (sideUp + sideDown)) : scale.pixels;
    const upPixels = Math.max(28, Math.min(wantedUp, base - topSafe));
    const downPixels = band - upPixels;
    const upSide = { limit: Math.max(1, sideUp), pixels: upPixels }, downSide = { limit: Math.max(1, sideDown), pixels: downPixels };
    const gridTop = base - upPixels, gridBottom = base + downPixels;
    let html = ui('<title>第 ') + t.number + ui(' 轮 · 逐步行动</title><desc>每个图标是一段模型处理及随后发起的工具操作，步内可能经历请求重试。上下文与主线共用零点，向上增加、向下减少。步骤间距表示顺序，不表示耗时。</desc>'), axisLabels = '';
    html += '<defs><pattern id="review-action-negative" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 5L5 0" stroke="var(--surface)" stroke-opacity=".6"/></pattern></defs>';
    if (showContext) {
      html += '<path d="M' + gutter + ' ' + gridTop + 'H' + (width - gutter) + '" class="review-context-grid"/>';
      html += '<path d="M' + gutter + ' ' + gridBottom + 'H' + (width - gutter) + '" class="review-context-grid"/>';
      axisLabels += brText(gutter - 7, gridTop + 3, reviewSigned(upSide.limit), 'review-context-axis', 'end');
      axisLabels += brText(gutter - 7, gridBottom + 3, reviewSigned(-downSide.limit), 'review-context-axis', 'end');
    }
    html += '<path d="M' + (x(0) - 36) + ' ' + base + 'H' + (x(count - 1) + 36) + '" class="br-trunk"/>';
    steps.forEach((step, index) => {
      const pos = x(index), active = index === selectedStep, left = start + index * gap + 6, right = left + gap - 12;
      const info = reviewStepContext(t, step);
      let part = '<rect x="' + left + '" y="28" width="' + (right - left) + '" height="' + (height - 60) + '" class="br-hit"/>';
      // 步号与耗时并成一行,顶部少一行给图。
      part += brText(pos, 48, ui`第 ${step.number} 步` + (showTime ? ' · ' + preciseTime(recordDuration(step)) : ''), 'review-turn-duration');
      // 耗时条:用官方每步的构成画占比,取代原来的等宽区间引导线。
      {
        const stats = typeof geistStatsByStep !== 'undefined' ? geistStatsByStep.get(t.number + ':' + step.number) : null;
        const total = Math.max(1, step.end - step.start);
        const toolRaw = stats && Number.isFinite(stats.toolWall) ? stats.toolWall
          : (step.calls || []).reduce((sum, c) => sum + (Number.isFinite(c.start) && Number.isFinite(c.end) ? c.end - c.start : 0), 0);
        const tool = Math.max(0, Math.min(total, toolRaw));
        const model = stats && Number.isFinite(stats.ttft) && Number.isFinite(stats.decode)
          ? Math.max(0, Math.min(total - tool, stats.ttft + stats.decode)) : Math.max(0, total - tool);
        const rest = Math.max(0, total - tool - model);
        const width = Math.max(1, right - left);
        let bx = left;
        for (const [cls, value] of [['review-time-tool', tool], ['review-time-model', model], ['review-time-rest', rest]]) {
          if (value <= 0) continue;
          const w = Math.max(0.6, value / total * width);
          part += '<rect x="' + bx + '" y="56" width="' + w + '" height="4" rx="1" class="' + cls + '"/>';
          bx += w;
        }
      }
      if (showContext && info) {
        const values = CONTEXT_CATEGORIES.map(c => ({ ...c, value: info.parts[c.key] }));
        const plus = values.reduce((n, c) => n + Math.max(0, c.value), 0), minus = values.reduce((n, c) => n + Math.max(0, -c.value), 0);
        const sides = { up: contextDisplaySide(plus, upSide), down: contextDisplaySide(minus, downSide) };
        let up = base, down = base;
        for (const c of values) {
          if (!c.value) continue;
          const side = c.value > 0 ? sides.up : sides.down, h = Math.abs(c.value) * side.factor;
          const y = c.value > 0 ? up - h : down;
          part += '<rect data-context-segment="' + c.key + '" x="' + (pos - 20) + '" y="' + y + '" width="40" height="' + h + '" fill="' + c.color + '" opacity="' + (active ? '.65' : '.46') + '"/>';
          if (c.value < 0) part += '<rect x="' + (pos - 20) + '" y="' + y + '" width="40" height="' + h + '" fill="url(#review-action-negative)" pointer-events="none"/>';
          if (c.value > 0) up -= h; else down += h;
        }
        for (const [amount, side, sign] of [[plus, sides.up, 1], [minus, sides.down, -1]]) {
          if (!amount) continue;
          const edge = base - sign * side.height;
          const labelY = sign > 0 ? Math.min(base - 27, edge - 9) : Math.max(base + 78, edge + 15);
          part += brText(pos, labelY, (info.initial ? ui('初始 ') : '') + reviewSigned(amount * sign) + (side.overflow ? ui(' · 收起') : ''), 'review-context-overflow-label');
          if (side.overflow) {
            part += '<rect x="' + (pos - 20) + '" y="' + (edge - 4 * sign - 4) + '" width="40" height="8" rx="3" class="review-context-capped"/>';
            for (const dx of [-4, 0, 4]) part += '<circle cx="' + (pos + dx) + '" cy="' + (edge - 4 * sign) + '" r=".9" class="review-context-capped-dot"/>';
          }
        }
      } else if (showContext) part += brText(pos, base - 30, ui('上下文未记录'), 'br-note');
      if (active) part += '<circle cx="' + pos + '" cy="' + base + '" r="18" class="review-action-halo"/>';
      part += '<circle cx="' + pos + '" cy="' + base + '" r="13" class="review-action-node"/>';
      // 步状态:环表示最严重的结局,徽标给数量。超时/拦截只看得到在支线里,
      // 原子化之后要在这里补回来,否则评测信息在路径视图里消失。
      const codes = step.calls.map(c => c.error?.code).filter(Boolean);
      const timeouts = codes.filter(code => /TIMEOUT/i.test(code)).length;
      const blocked = codes.filter(code => /^FS_|OBSERVED/i.test(code)).length;
      const errors = step.calls.filter(c => c.status === 'error').length;
      const retries = (step.retries || []).length;
      const worst = errors ? 'error' : timeouts ? 'timeout' : blocked ? 'blocked' : '';
      if (worst) part += '<circle cx="' + pos + '" cy="' + base + '" r="15.5" class="review-action-ring ' + worst + '"/>';
    // 目标事件画成状态环外侧的一圈:创建/完成/阻塞各有颜色,读取不画。
    const goalMark = ((((typeof data !== 'undefined' && data && data.context) ? data.context : {}).goal || {}).markers || []).find(m => m.operation && m.operation !== 'read' && m.time >= step.start && m.time <= (step.end || Infinity));
    if (goalMark) {
      // DSH 的 goal-outline 图标(16×16):两段开口圆弧 + 一支射向靶心的箭头。
      const goalClass = 'review-goal-icon ' + goalMark.operation;
      const gx = pos - 9, gy2 = base - 9;
      part += '<g class="' + goalClass + '" transform="translate(' + gx + ' ' + gy2 + ui(') scale(1.125)"><title>目标') + (goalMark.operation === 'create' ? ui('创建') : goalMark.operation === 'complete' ? ui('完成') : ui('中止')) + '</title>'
        + '<path d="M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5"/>'
        + '<path d="M11.5 8C11.5001 8.69227 11.2948 9.36901 10.9102 9.94463C10.5257 10.5202 9.97901 10.9689 9.33944 11.2338C8.69986 11.4987 7.99609 11.5681 7.31712 11.433C6.63816 11.2979 6.01449 10.9645 5.52501 10.475C5.03548 9.98552 4.70209 9.36185 4.56702 8.68289C4.43195 8.00392 4.50127 7.30015 4.76619 6.66057C5.03112 6.021 5.47976 5.47436 6.05538 5.08978C6.631 4.70519 7.30774 4.49995 8.00001 4.5"/>'
        + '<path d="M8.00024 7.99976L11.2 4.80005"/>'
        + '<path d="M12.4719 5.62245C12.4246 5.66972 12.3569 5.69025 12.2913 5.67715L10.7814 5.37555C10.7022 5.35972 10.6402 5.29781 10.6244 5.2186L10.3228 3.70866C10.3097 3.6431 10.3302 3.57533 10.3775 3.52806L12.1826 1.723C12.2863 1.61929 12.4627 1.65879 12.5122 1.79684L12.9271 2.95225C12.9472 3.00847 12.9915 3.05272 13.0477 3.07291L14.2031 3.48774C14.3412 3.5373 14.3807 3.71368 14.277 3.81739L12.4719 5.62245Z"/></g>';
    }
      const badges = [];
      if (errors) badges.push(['error', '×', ui('报错 ') + errors + ui(' 次')]);
      if (timeouts) badges.push(['timeout', '◷', ui('超时 ') + timeouts + ui(' 次')]);
      if (blocked) badges.push(['blocked', '⊣', ui('拦截 ') + blocked + ui(' 次')]);
      if (retries) badges.push(['retry', '↻', ui('重试 ') + retries + ui(' 次')]);
      badges.slice(0, 2).forEach(([kind, glyph, label], i) => {
        const bx = pos + 17 + i * 17, by = base - 17;
        part += '<g class="review-action-badge ' + kind + '" transform="translate(' + bx + ' ' + by + ')"><title>' + label + '</title>' +
          '<circle r="7.5"/><text text-anchor="middle" y="3.2">' + glyph + '</text></g>';
      });
      const icon = step.calls.length && step.calls.every(c => /^查询/.test(reviewContextData.callFacts?.[c.seq]?.title || '')) ? STEP_ICON.query : stepIcon(step);
      part += '<g transform="translate(' + pos + ' ' + base + ')" class="review-action-icon">' + icon + '</g>';
      part += brText(pos, base + 34, shorten(reviewActionStepLabel(step), 16), 'br-label');
      html += brGroup('class="action-step review-action-step' + (active ? ' is-selected' : '') + '" data-step="' + index + '" aria-pressed="' + active + '"', part,
        ui('第 ') + step.number + ui(' 步 · ') + reviewActionStepLabel(step) + ' · ' + preciseTime(recordDuration(step)) + (info ? ui('；上下文净变化 ') + reviewSigned(info.amount) : ''));
    });
    const fullTitle = ui('第 ') + t.number + ui(' 轮 · ') + String(t.prompts?.[0]?.text || t.title || '').replace(/\s+/g, ' ');
    const titleWidth = Math.max(60, viewportWidth - gutter * 2 - 210);
    let title = fullTitle;
    if (reviewMeasure(title) > titleWidth) {
      let low = 0, high = title.length;
      while (low < high) { const mid = Math.ceil((low + high) / 2); if (reviewMeasure(title.slice(0, mid) + '…') <= titleWidth) low = mid; else high = mid - 1; }
      title = title.slice(0, low) + '…';
    }
    const failures = steps.filter(s => s.calls.some(c => c.status === 'error')).length;
    // 本轮若是目标事件的落点,在钉住标题右侧标出,与底部目标入口共用同一份数据。
    const goal = (typeof data !== 'undefined' && data.context && data.context.goal) || null;
    const goalHere = goal && (goal.markers || []).find(m => m.time >= t.start && m.time <= (t.end ?? Infinity));
    const goalText = goalHere ? ui(' · 目标 ') + (goalHere.operation || '') + (goal.roundsStarted != null ? ' ' + goal.roundsStarted + '/' + (goal.maxGoalRounds ?? '?') : '') : '';
    html += '<g class="review-action-pinned" transform="translate(' + viewport.scrollLeft + ',0)">' + axisLabels +
      brText(gutter, 18, title, 'br-note', 'start') +
      brText(viewportWidth - gutter, 18, count + ui(' 步') + (showTime ? ' · ' + reviewDuration(endOf(t) - t.start) : '') + (failures ? ' · ' + failures + ui(' 步受阻') : '') + goalText, 'br-note', 'end') +
      brText(gutter, height - 12, showContext ? ui('每步上下文变化 · 显示至 ±') + reviewTokens(scale.limit) : ui('步骤从左到右排列'), 'br-axis', 'start') +
      brText(viewportWidth - gutter, height - 12, ui('间距表示顺序 · 耗时见上方'), 'br-axis', 'end') + '</g>';
    reviewActionFileFrame = { t, x, base, gutter, height, viewportWidth, viewportLeft };
    html += '<g id="review-files-layer">' + reviewActionFiles(t, x, base, viewport.scrollLeft + gutter, viewport.scrollLeft + viewportWidth - gutter) + '</g>';
    const graph = $('graph');
    graph.setAttribute('viewBox', '0 0 ' + width + ' ' + height); graph.setAttribute('height', height);
    graph.style.width = width + 'px'; graph.innerHTML = html;
    // 步骤分组整体是选中;柱段单独接管:点它看这一轮的上下文变化明细。
    graph.querySelectorAll('[data-step] [data-context-segment]').forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        const group = el.closest('[data-step]');
        // data-step 存的是步的下标,不是步号。
        const index = group ? Number(group.dataset.step) : NaN;
        const step = Number.isInteger(index) && t.steps[index] ? t.steps[index].number : undefined;
        reviewOpenContext(t.number, step);
      };
    });
    graph.querySelectorAll('[data-step]').forEach(el => {
      el.onclick = () => selectStep(Number(el.dataset.step));
      el.ondblclick = () => showStep(Number(el.dataset.step));
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStep(Number(el.dataset.step)); graph.querySelector('[data-step="' + selectedStep + '"]')?.focus({ preventScroll: true }); } };
    });
    reviewRenderStepSummary(t, selected);
    reviewRenderActionCaption();
    reviewBindActionControls();
    reviewFilesBind();
    if (!viewport.dataset.reviewPinnedBound) {
      viewport.dataset.reviewPinnedBound = 'true';
      viewport.addEventListener('scroll', () => {
        if (view === 'path') {
          graph.querySelector('.review-action-pinned')?.setAttribute('transform', 'translate(' + viewport.scrollLeft + ',0)');
          reviewRefreshActionFiles();
        }
      });
    }
  }
  // Selection changes the active mark and inspector, not the already materialized
  // turn geometry. Data/layer/viewport changes still go through the full renderer.
  selectStep = function(index) {
    const t = turn(), next = Math.max(0, Math.min(t.steps.length - 1, index));
    if (!t.steps.length || !Number.isInteger(next)) return;
    const graph = $('graph'), frame = reviewActionFileFrame, node = graph.querySelector('[data-step="' + next + '"]');
    if (view !== 'path' || zoom || frame?.t !== t || !node) { selectedStep = next; renderActionPath(); return; }
    const previous = graph.querySelector('[data-step="' + selectedStep + '"]');
    if (next !== selectedStep) {
      if (previous) {
        previous.classList.remove('is-selected'); previous.setAttribute('aria-pressed', 'false');
        previous.querySelector('.review-action-halo')?.remove();
        previous.querySelectorAll('[data-context-segment]').forEach(el => el.setAttribute('opacity', '.46'));
      }
      selectedStep = next;
      node.classList.add('is-selected'); node.setAttribute('aria-pressed', 'true');
      const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      for (const [key, value] of Object.entries({ cx: frame.x(next), cy: frame.base, r: 18, class: 'review-action-halo' })) halo.setAttribute(key, value);
      node.insertBefore(halo, node.querySelector('.review-action-node'));
      node.querySelectorAll('[data-context-segment]').forEach(el => el.setAttribute('opacity', '.65'));
    }
    reviewRenderStepSummary(t, t.steps[next]);
    if (typeof geistUpdateStepTiming === 'function') geistUpdateStepTiming(t);
    reviewApplyFileFocus();
    if (typeof geistBindSkillMaterials === 'function') geistBindSkillMaterials();
  };
  function reviewRenderStepSummary(t, step) {
    const panel = $('step-panel'), info = reviewStepContext(t, step);
    const identity = [session.id, t.number, step.number, overviewLayers.has('duration'), overviewLayers.has('context')].join(':');
    if (panel.dataset.detailKey === identity) return;
    panel.dataset.detailKey = identity;
    const insight = stepInsight(t, step, session.overview.episodes, reviewContextData.callFacts);
    panel.className = 'step-panel on review-step-summary'; panel.style.display = '';
    const calls = step.calls || [];
    const single = insight.calls.length === 1;
    const title = single ? insight.calls[0].title : reviewActionStepLabel(step);
    const renderCall = fact => '<article class="review-operation">' +
      (single ? '' : '<h4>' + esc(fact.title) + '</h4>') +
      '<div class="review-operation-result"><p data-tone="' + fact.tone + '">' + esc(fact.outcome) + '</p>' +
      (fact.preview ? '<button class="review-operation-change" data-insight-change="' + fact.seq + '">' + (fact.tone === 'bad' || fact.tone === 'unknown' ? ui('查看原计划') : ui('对比改动')) + ' ↗</button>' : '') + '</div></article>';
    const onward = insight.links[0] || (insight.following ? { step: insight.following.step, text: ui('第 ') + insight.following.step + ui(' 步 · ') + insight.following.text } : null);
    panel.innerHTML = ui('<div class="review-step-heading"><div><p>第 ') + step.number + ui(' 步') +
      (overviewLayers.has('duration') ? ' · ' + preciseTime(recordDuration(step)) : '') + (calls.length ? ' · ' + calls.length + ui(' 项操作') : '') +
      '</p><h3>' + esc(title) + ui('</h3></div><button class="review-panel-quiet" id="panel-record">原始记录 ↗</button><button class="review-panel-quiet" id="panel-expand">展开全文</button></div>') +
      '<div class="review-operations">' + insight.calls.slice(0, 2).map(renderCall).join('') +
      (!calls.length && insight.reply ? '<p class="review-reply-summary">' + esc(insight.reply) + '</p>' : '') +
      (!calls.length && !insight.reply ? ui('<p class="review-reply-summary">没有记录到本步的文字回复或工具操作。</p>') : '') + '</div>' +
      '<div class="review-step-footer"><div>' + (onward ? '<span>' + (insight.links.length ? ui('后续确认') : ui('接下来')) + '</span><button data-insight-step="' + onward.step + '" class="' + (insight.links.length ? 'review-insight-proof' : '') + '">' + esc(onward.text) + ' ↗</button>' : ui('<span>本轮执行记录到这里</span>')) +
      '</div><button class="review-panel-quiet" id="review-panel-details">' + (insight.calls.length > 2 ? ui('全部 ') + insight.calls.length + ui(' 项操作与依据') : ui('前后文与依据')) + ' ↗</button></div>';
    $('panel-record').onclick = () => showStep(selectedStep);
    const expand = $('panel-expand');
    if (expand) expand.onclick = () => { const open = panel.classList.toggle('is-open'); expand.textContent = open ? ui('收起') : ui('展开全文'); };
    $('review-panel-details').onclick = () => reviewOpenStepDetail(t, step, insight, info);
    panel.querySelectorAll('[data-insight-change]').forEach(el => el.onclick = () => reviewOpenChange(t, step, insight.calls.find(f => f.seq === Number(el.dataset.insightChange))));
    panel.querySelectorAll('[data-insight-step]').forEach(el => el.onclick = () => reviewJumpToStep(t, Number(el.dataset.insightStep)));
  }
  function reviewJumpToStep(t, number) {
    const index = t.steps.findIndex(s => s.number === number);
    if (index < 0) return;
    if ($('review-detail-overlay')) reviewCloseDetail();
    selectStep(index); $('graph').querySelector('[data-step="' + index + '"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function reviewRenderActionCaption() {
    $('graph-caption').innerHTML = ui('<div class="br-key"><span class="br-key-item"><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" class="review-action-node"/></svg>操作步骤</span>') +
      '<span class="br-key-item"><svg viewBox="0 0 12 12">' + brCap(6, 6) + ui('</svg>报错</span>') +
      ui('<span class="br-key-item"><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.2" fill="none" stroke="#c0503f" stroke-width="1.6"/></svg>步状态环（红报错 / 橙超时 / 灰拦截）</span>') +
      ui('<span class="br-key-item"><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="#fff" stroke="#6a7f9a"/><text x="6" y="8.6" text-anchor="middle" font-size="7" fill="#4d6076">↻</text></svg>徽标数量</span>') +
      ui('<span class="br-key-item"><svg viewBox="0 0 12 12"><rect x="2" y="2.5" width="8" height="7" rx="1.5" class="br-glyph"/></svg>文件对象</span>') +
      ui('<span class="br-key-item"><svg viewBox="0 0 14 10"><path d="M1 9 C5 9 4 3 8 3 H13" class="br-glyph"/></svg>子代理支线</span>') +
      '</div>' +
      ui('<div class="review-action-guidance">点图标看这一步 · 双击看原始记录 · 缩小返回总览</div>') +
      '<div class="review-overlay-key" aria-hidden="' + !overviewLayers.has('context') + ui('"><span class="review-overlay-caption" data-context-caption>上下文 <b>↑增 ↓减</b></span>') +
      CONTEXT_CATEGORIES.map(c => '<button class="review-overlay-source" data-action-source="' + c.key + '"><i style="background:' + c.color + '"></i>' + c.label + '</button>').join('') + '</div>';
    $('graph-caption').querySelectorAll('[data-action-source]').forEach(el => el.onclick = () => reviewOpenContextSources(el.dataset.actionSource));
  }
