  function reviewActionStepLabel(step) {
    const kinds = [...new Set(step.calls.map(callKind))];
    const titles = [...new Set(step.calls.map(c => reviewContextData.callFacts?.[c.seq]?.title).filter(Boolean))];
    if (kinds.length === 1 && kinds[0] === 'other' && titles.length === 1) return titles[0] + (step.calls.length > 1 ? ' ×' + step.calls.length : '');
    return kinds.length > 1 ? kinds.slice(0, 2).map(kindLabel).join('、') + (kinds.length > 2 ? ui('等') : '') : stepLabel(step);
  }
  function reviewToolStepLabel(step, x, y) {
    if (!step.calls.length) return brText(x, y, shorten(reviewActionStepLabel(step), 16), 'br-label');
    const counts = new Map();
    for (const call of step.calls) counts.set(call.name, (counts.get(call.name) || 0) + 1);
    const names = [...counts].slice(0, 2), max = names.length > 1 ? 7 : 16;
    return '<text x="' + x + '" y="' + y + '" text-anchor="middle" class="br-label review-tool-label">' + names.map(([name,n],i) =>
      (i ? '<tspan class="review-tool-separator"> / </tspan>' : '') + '<tspan style="fill:' + globalThis.__trajectoryToolColor(name) + '">' + esc(shorten(name??'?',max)) + (n>1?' ×'+n:'') + '</tspan>').join('') + (counts.size>2?'<tspan>…</tspan>':'') + '</text>';
  }
  function reviewCallMeasure(call,step,turnNumber){
    if(call.measure)return call.measure;
    const stats=typeof geistStatsByStep==='undefined'?null:geistStatsByStep.get(turnNumber+':'+step.number);
    const record=stats?.calls?.find(r=>r.name===call.name&&(r.seq===call.seq||r.callId===call.id));
    if(!record)return null;
    return /^(edit|write|apply_patch)$/.test(call.name)?{kind:'change',added:record.added,removed:record.removed,basis:call.name==='write'?'write-input':'replacement-input',state:record.error?'attempted':record.endedAt==null?'pending':'returned'}:
      call.name==='read'?{kind:'read',lines:record.lines}:{kind:'output',chars:record.chars};
  }
  function renderActionPath() {
    // Counts are projected once from original events; no diff work during paint.
    const t = turn(), steps = t.steps, count = steps.length, viewport = $('graph-scroll');
    const canvas = $('canvas'); canvas.classList.add('review-action-mode');
    if (!count) { $('graph').innerHTML = ''; return; }
    selectedStep = Math.max(0, Math.min(selectedStep, count - 1));
    const selected = steps[selectedStep], showContext = overviewLayers.has('context'), showTime = overviewLayers.has('duration');
    const contextObstacles = [];
    const geometry = typeof geistActionGeometry === 'function' ? geistActionGeometry(t) : { height: 360, base: 208 };
    const actorReserve = typeof geistActionActorReserve === 'function' ? geistActionActorReserve(t) : 0;
    const mainHeight = geometry.height, height = mainHeight + actorReserve, rawBase = geometry.base;
    const viewportWidth = Math.max(300, viewport.clientWidth), viewportLeft = viewport.scrollLeft, gutter = 54;
    // 文件行画在基线下方 78px,再留标签高度;基线太靠下时这一行会被画布裁掉,
    // 所以按"文件行 + 底部刻度"反推一个安全基线,而不是固定 height-96。
    const fileRow = overviewLayers.has('files') ? 46 : 0;
    let base = Math.min(rawBase, mainHeight - 20 - fileRow - 78);
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
    // 顶部是步标题与材料行所在的安全区;柱子不能长进去,否则会盖住上方视图,
    // 而这里滚轮是缩放、没有额外的纵向滚动可以躲。
    const topSafe = 110;
    const contextGeometry = actionContextGeometry(sideUp, sideDown, scale.limit, topSafe, base);
    const upSide = contextGeometry.up, downSide = contextGeometry.down;
    if (showContext && sideUp + sideDown > 0) base = contextGeometry.base;
    const gridTop = base - upSide.pixels, gridBottom = base + downSide.pixels;
    let html = ui('<title>第 ') + t.number + ui(' 轮 · 逐步行动</title><desc>每个图标是一段模型处理及随后发起的工具操作，步内可能经历请求重试。上下文与主线共用零点，向上增加、向下减少。步骤间距表示顺序，不表示耗时。</desc>'), axisLabels = '';
    html += '<defs><pattern id="review-action-negative" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 5L5 0" stroke="var(--surface)" stroke-opacity=".6"/></pattern></defs>';
    if (showContext) {
      if (sideUp) { html += '<path d="M' + gutter + ' ' + gridTop + 'H' + (width - gutter) + '" class="review-context-grid"/>'; axisLabels += brText(gutter - 7, gridTop + 3, reviewSigned(upSide.limit), 'review-context-axis', 'end'); }
      if (sideDown) { html += '<path d="M' + gutter + ' ' + gridBottom + 'H' + (width - gutter) + '" class="review-context-grid"/>'; axisLabels += brText(gutter - 7, gridBottom + 3, reviewSigned(-downSide.limit), 'review-context-axis', 'end'); }
    }
    html += '<path d="M' + (x(0) - 36) + ' ' + base + 'H' + (x(count - 1) + 36) + '" class="br-trunk"/>';
    steps.forEach((step, index) => {
      const pos = x(index), active = index === selectedStep, left = start + index * gap + 6, right = left + gap - 12;
      const info = reviewStepContext(t, step);
      let part = '<rect x="' + left + '" y="28" width="' + (right - left) + '" height="' + (height - 60) + '" class="br-hit"/>';
      // 步号与耗时并成一行,顶部少一行给图。
      part += brText(pos, 48, ui`第 ${step.number} 步` + (showTime ? ' · ' + preciseTime(recordDuration(step)) : ''), 'review-turn-duration');
      // 耗时条:用官方每步的构成画占比,取代原来的等宽区间引导线。
      if (showTime && recordDuration(step) != null) {
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
        const ttft = stats && Number.isFinite(stats.ttft) ? Math.max(0, Math.min(model, stats.ttft)) : 0;
        for (const [cls, value] of [['review-time-wait', ttft], ['review-time-model', model-ttft], ['review-time-tool', tool], ['review-time-rest', rest]]) {
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
        if (plus) contextObstacles.push({ left: pos - 22, right: pos + 22, top: -sides.up.height - 5, bottom: 0, routeStem: true });
        if (minus) contextObstacles.push({ left: pos - 22, right: pos + 22, top: 0, bottom: sides.down.height + 5, routeStem: true });
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
          const batch = info.current?.contextSteps;
          const batchLabel = batch?.length > 1 ? ' · ' + batch[0] + '–' + batch.at(-1) + (globalThis.__trajectoryLocale === 'en' ? ' combined' : ' 步合并') : '';
          part += brText(pos, labelY, (info.initial ? ui('初始 ') : '') + reviewSigned(amount * sign) + (side.overflow ? ui(' · 收起') : '') + batchLabel, 'review-context-overflow-label');
          if (side.overflow) {
            part += '<rect x="' + (pos - 20) + '" y="' + (edge - 4 * sign - 4) + '" width="40" height="8" rx="3" class="review-context-capped"/>';
            for (const dx of [-4, 0, 4]) part += '<circle cx="' + (pos + dx) + '" cy="' + (edge - 4 * sign) + '" r=".9" class="review-context-capped-dot"/>';
          }
        }
      } else if (showContext) part += brText(pos, base - 30, ui('上下文未记录'), 'br-note');
      if (active) part += '<circle cx="' + pos + '" cy="' + base + '" r="18" class="review-action-halo"/>';
      part += '<circle cx="' + pos + '" cy="' + base + '" r="13" class="review-action-node"/>';
      // One shared corner slot for control, error and retry states. The selected
      // node keeps its normal focus halo; no additional status rings are drawn.
      const controls = summarizeControls(step.calls);
      part += reviewToolMarker(step.calls, pos + TRACE_MARKER_DOCK.x, base + TRACE_MARKER_DOCK.y, { retries: (step.retries || []).length });
    // 目标图标留在节点中心，与右上的状态角标分开；读取目标不画。
    const goalMark = ((((typeof data !== 'undefined' && data && data.context) ? data.context : {}).goal || {}).markers || []).find(m => m.operation && m.operation !== 'read' && m.time >= step.start && m.time <= (step.end || Infinity));
    if (goalMark) {
      // DSH 的 goal-outline 图标(16×16):两段开口圆弧 + 一支射向靶心的箭头。
      const goalClass = 'review-goal-icon ' + goalMark.operation;
      part += '<g class="' + goalClass + '" transform="translate(' + pos + ' ' + base + ui(') scale(1.125)"><title>目标') + (goalMark.operation === 'create' ? ui('创建') : goalMark.operation === 'complete' ? ui('完成') : ui('中止')) + '</title>' + traceSymbolGlyph('goal') + '</g>';
    }
      const icon = stepIcon(step);
      const toolNames = [...new Set(step.calls.map(call => call.name))];
      part += '<g transform="translate(' + pos + ' ' + base + ')" class="review-action-icon"' + (toolNames.length === 1 ? ' style="stroke:' + globalThis.__trajectoryToolColor(toolNames[0]) + '"' : '') + '>' + icon + '</g>';
      part += reviewToolStepLabel(step, pos, base + 34);

      html += brGroup('class="action-step review-action-step' + (active ? ' is-selected' : '') + '" data-step="' + index + '" aria-pressed="' + active + '"', part,
        ui('第 ') + step.number + ui(' 步 · ') + reviewActionStepLabel(step) + ' · ' + preciseTime(recordDuration(step)) + (info ? ui('；上下文净变化 ') + reviewSigned(info.amount) : '') + (controls ? ' · ' + controlSummaryTitle(controls, globalThis.__trajectoryLocale) : ''));
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
    reviewActionFileFrame = { t, x, base, fileBase: gridBottom + actorReserve, actorBand: Math.max(92, gridBottom - base + 42), gutter, height, viewportWidth, viewportLeft, contextObstacles };
    html += '<g id="review-files-layer">' + reviewActionFiles(t, x, gridBottom + actorReserve, viewport.scrollLeft + gutter, viewport.scrollLeft + viewportWidth - gutter) + '</g>';
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
    $('graph-caption').innerHTML = '<div class="br-key"></div>' +
      ui('<div class="review-action-guidance">点图标看这一步 · 双击看原始记录 · 缩小返回总览</div>') +
      '<div class="review-overlay-key" aria-hidden="' + !overviewLayers.has('context') + ui('"><span class="review-overlay-caption" data-context-caption>上下文 <b>↑增 ↓减</b></span>') +
      CONTEXT_CATEGORIES.map(c => '<button class="review-overlay-source" data-action-source="' + c.key + '"><i style="background:' + c.color + '"></i>' + c.label + '</button>').join('') + '</div>';
    $('graph-caption').querySelectorAll('[data-action-source]').forEach(el => el.onclick = () => reviewOpenContextSources(el.dataset.actionSource));
  }
