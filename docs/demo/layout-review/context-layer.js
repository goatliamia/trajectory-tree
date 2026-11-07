  const reviewContextData = data.context || { requests: [], boundaries: [] };
  let reviewContextRequests = [...new Map([...(reviewContextData.historyRequests || []), ...(reviewContextData.requests || [])].map(row => [row.seq, row])).values()].sort((a, b) => a.seq - b.seq);
  function reviewIndexContextSteps(rows) {
    const byStep = new Map();
    rows.forEach((row, index) => { const key = row.turn + ':' + row.step; if (!byStep.has(key)) byStep.set(key, index); });
    return byStep;
  }
  let reviewContextStepIndex = reviewIndexContextSteps(reviewContextRequests);
  let reviewContextRows = contextByTurn(reviewContextRequests);
  let reviewContextMap = new Map(reviewContextRows.map(row => [row.turn, row]));
  let reviewContextScale = contextDisplayScale(reviewContextRows);
  let reviewContextSelected = reviewContextRows.at(-1)?.turn ?? null;
  overviewLayers.add('context');
  const reviewTokens = value => Math.abs(value) >= 1000 ? (value / 1000).toFixed(1) + 'k' : Math.round(value).toLocaleString();
  const reviewSigned = value => (value > 0 ? '+' : value < 0 ? '−' : '') + reviewTokens(Math.abs(value));
  function reviewDuration(ms) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return seconds + ui('秒');
    return Math.floor(seconds / 60) + ui('分') + (seconds % 60 ? seconds % 60 + ui('秒') : '');
  }
  function reviewTimeLayer(layout, visible, left, right, mainHeight, mapTime) {
    if (!overviewLayers.has('duration')) return '';
    let html = '', lastDivider = -Infinity;
    for (const l of layout) {
      if (!visible(l.x, l.end)) continue;
      const fullDivider = l.x - lastDivider >= 16;
      html += '<path d="M' + l.x + ' 96V' + (fullDivider ? mainHeight - 38 : 104) + '" class="review-turn-divider' + (fullDivider ? '' : ' short') + '"/>';
      if (fullDivider) lastDivider = l.x;
    }
    for (const group of durationGroups(layout)) {
      if (!visible(group.start, group.end)) continue;
      const first = group.rows[0].turn.number, last = group.rows.at(-1).turn.number;
      const start = Math.max(left, group.start), end = Math.min(right, group.end), cx = (start + end) / 2;
      const label = first === last ? ui`第 ${first} 轮` : ui`第 ${first}–${last} 轮` + ui(' · 展开');
      const ongoing = group.rows.some(l => l.turn.end === null);
      const duration = (first === last ? '' : ui('共 ')) + (ongoing ? '≥' : '') + reviewDuration(group.duration);
      // 宽度不够时退到短标签,再不够就只留时长;都放不下就整条不画,避免只剩一个空框。
      const span = end - start - 8;
      const shortLabel = first === last ? ui('第 ') + first + ui(' 轮') : first + '–' + last;
      const fitWidth = value => reviewMeasure(value) * 1.08 + 6;
      const full = span >= Math.max(fitWidth(label), fitWidth(duration));
      const single = !full && span >= fitWidth(shortLabel) ? shortLabel
        : !full && duration && span >= fitWidth(duration) ? duration : '';
      if (!full && !single) continue;
      let body = '<rect x="' + start + '" y="28" width="' + Math.max(1, end - start - 3) + '" height="38" rx="4" class="review-duration-band"/>';
      body += '<path d="M' + (start + 4) + ' 62v4H' + Math.max(start + 4, end - 7) + 'v-4" class="review-interval-guide"/>';
      body += full
        ? brText(cx, 42, label, 'review-turn-duration') + brText(cx, 57, duration, 'review-turn-duration review-duration-value')
        : brText(cx, 49, single, 'review-turn-duration' + (single === duration ? ' review-duration-value' : ''));
      html += brGroup('data-review-duration-range="' + first + ':' + last + '" class="review-duration-hit"', body,
        label + ' · ' + duration + ui('。点击查看每一轮耗时，没有按时长筛选。'));
    }
    const last = layout.at(-1);
    if (last && visible(last.end)) html += '<path d="M' + last.end + ' 96V' + (mainHeight - 38) + '" class="review-turn-divider"/>';
    return html;
  }
  function reviewContextMissing(number) {
    const first = Math.min(...(reviewContextData.requests || []).map(row => row.turn));
    return number < first && Number.isFinite(first) ? ui('本轮早于当前返回的历史范围；当前增量从第 ') + first + ui(' 轮开始') : ui('没有这轮的请求构成记录');
  }
  function reviewContextNote(row, number) {
    if (!row) return reviewContextMissing(number);
    if (row.isBaseline) return ui('首轮已有 ') + reviewTokens(row.total) + ui(' · 看开始时的构成');
    return ui('第 ') + row.turn + ui(' 轮 · ') + (row.net >= 0 ? ui('净增 ') : ui('净减 ')) + reviewTokens(Math.abs(row.net));
  }
  function reviewContextLayer(layout, base, left, right, visible) {
    if (!overviewLayers.has('context')) return '';
    if (!reviewContextRows.length) return '';
    const scale = reviewContextScale, zero = base;
    const top = zero - scale.pixels, bottom = zero + scale.pixels;
    let html = '<defs><pattern id="review-negative-hatch" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M-1 1L1 -1 M0 5L5 0 M4 6L6 4" stroke="var(--surface)" stroke-opacity=".5" stroke-width="1"/></pattern></defs>';
    for (const y of [top, bottom]) html += '<path d="M' + left + ' ' + y + 'H' + right + '" class="review-context-grid"/>';
    html += brText(left - 7, top + 3, '+' + reviewTokens(scale.limit), 'review-context-axis', 'end');
    html += brText(left - 7, zero + 3, '0', 'review-context-axis', 'end');
    html += brText(left - 7, bottom + 3, '−' + reviewTokens(scale.limit), 'review-context-axis', 'end');
    const overflowLabels = [];
    for (const l of layout) {
      if (!visible(l.x, l.end)) continue;
      const row = reviewContextMap.get(l.turn.number);
      const x = (l.x + l.end) / 2, width = Math.max(.8, Math.min(38, (l.end - l.x) * .65));
      const amounts = contextBarAmounts(row);
      const positive = contextDisplaySide(amounts.increase, scale), negative = contextDisplaySide(amounts.decrease, scale);
      const upper = Math.max(15, positive.height), lower = Math.max(15, negative.height);
      let body = '<rect class="br-hit" x="' + l.x + '" y="' + (zero - upper) + '" width="' + Math.max(1, l.end - l.x) + '" height="' + (upper + lower) + '"/>';
      if (!row) {
        body += '<path d="M' + (x - 2) + ' ' + (zero - 2) + 'l4 4m0 -4l-4 4" class="review-context-missing"/>';
      } else {
        let up = zero, down = zero;
        for (const c of CONTEXT_CATEGORIES) {
          const delta = amounts.values[c.key];
          if (delta === 0) continue;
          const height = Math.abs(delta) * (delta > 0 ? positive.factor : negative.factor), start = delta > 0 ? up - height : down;
          body += '<rect data-context-segment="' + c.key + '" x="' + (x - width / 2) + '" y="' + start + '" width="' + width + '" height="' + height + '" fill="' + c.color + '" opacity="' + (delta > 0 ? .46 : .4) + '"/>';
          if (delta < 0) body += '<rect x="' + (x - width / 2) + '" y="' + start + '" width="' + width + '" height="' + height + '" fill="url(#review-negative-hatch)" pointer-events="none"/>';
          if (delta > 0) up -= height; else down += height;
        }
        for (const sign of [1, -1]) {
          const side = sign > 0 ? positive : negative;
          if (!side.overflow) continue;
          const y = zero - sign * (scale.pixels - 4), capWidth = Math.max(14, width);
          body += '<rect x="' + (x - capWidth / 2) + '" y="' + (y - 4) + '" width="' + capWidth + '" height="8" rx="3" class="review-context-capped"/>';
          for (const dx of [-4, 0, 4]) body += '<circle cx="' + (x + dx) + '" cy="' + y + '" r=".9" class="review-context-capped-dot"/>';
          overflowLabels.push({ x, sign, turn: row.turn, baseline: row.isBaseline, value: sign > 0 ? amounts.increase : -amounts.decrease });
        }
      }
      const note = reviewContextNote(row, l.turn.number);
      html += brGroup('class="review-context-turn" data-context-turn="' + l.turn.number + '"', body, note + (row && !row.isBaseline ? ui('；增加 ') + reviewTokens(row.increase) + ui('，减少 ') + reviewTokens(row.decrease) : ui('；显示末次请求已有构成，作为后续轮次的比较基线')) + (positive.overflow || negative.overflow ? ui('；实际量超过本图 ') + reviewTokens(scale.limit) + ui(' 显示范围，柱高已收起，不表示模型上下文超限') : ''));
    }
    for (const sign of [1, -1]) {
      const occupied = [];
      for (const item of overflowLabels.filter(i => i.sign === sign).sort((a, b) => Number(b.baseline) - Number(a.baseline) || Math.abs(b.value) - Math.abs(a.value))) {
        const label = (item.baseline ? ui('首轮 ') + reviewTokens(item.value) : reviewSigned(item.value)) + ui(' · 收起'), width = reviewMeasure(label);
        const x = Math.max(left + width / 2, Math.min(right - width / 2, item.x));
        const y = sign > 0 ? top - 7 : bottom + 15;
        if (occupied.some(box => x - width / 2 < box.right + 10 && x + width / 2 > box.left - 10)) continue;
        if (reviewBranchesNow.some(p => x - width / 2 < p.right + 5 && x + width / 2 > p.left - 5 && y + 3 > base + p.top - 3 && y - 10 < base + p.bottom + 3)) continue;
        html += brGroup('class="review-context-overflow" data-context-turn="' + item.turn + '"',
          brText(x, y, label, 'review-context-overflow-label'), ui('第 ') + item.turn + ui(' 轮 · 实际 ') + reviewTokens(item.value) + ui(' tokens；柱高已收起，点开看完整构成'));
        occupied.push({ left: x - width / 2, right: x + width / 2 });
      }
    }
    return html;
  }
  function reviewCompactionLayer(mapTime, left, right, mainHeight) {
    if (!overviewLayers.has('context')) return '';
    const markers = (reviewContextData.boundaries || []).filter(e => e.kind === 'compaction')
      .map(e => ({ id: e.seq, at: reviewActiveTime(e.turn, e.time), x: mapTime(e.time), e }));
    let html = '';
    for (const group of aggregateInScreen(markers, 24)) {
      const x = group[0].x;
      if (x < left || x > right) continue;
      const events = group.map(item => item.e);
      const caption = events.length === 1 ? ui('压缩上下文 · 第 ') + events[0].turn + ui(' 轮') : events.length + ui(' 次压缩上下文');
      html += '<path d="M' + x + ' 96V' + (mainHeight - 38) + '" class="review-compaction-divider"/>';
      html += brGroup('class="review-compaction-marker" data-context-compaction="' + events.map(e => e.seq).join(',') + '"',
        '<rect x="' + (x - 12) + '" y="68" width="24" height="24" rx="5" class="review-compaction-hit"/>' +
        '<g transform="translate(' + (x - 8) + ' 71)" class="review-compact-fold"><path d="M2.5 5.5 6 8l-3.5 2.5"/><path d="M13.5 5.5 10 8l3.5 2.5"/></g>' +
        (events.length > 1 ? brText(x + 15, 83, String(events.length), 'review-compaction-count') : ''), caption);
    }
    return html;
  }
  function reviewOpenCompaction(seqs) {
    const events = reviewContextData.boundaries.filter(e => seqs.includes(e.seq));
    const event = events[0], row = reviewContextMap.get(event.turn);
    let html = ui('<p class="review-explain">系统把较早的一段对话整理成摘要，再带着摘要继续。靛蓝虚线标出摘要实际写入上下文的位置；原会话日志仍然保留。</p>');
    if (row) html += ui('<p class="review-context-change-note">第 ') + row.turn + ui(' 轮净变化 ') + reviewSigned(row.net) + ui(' tokens。这个数还包含本轮新增内容，不等于这次压缩单独减少的量。</p>');
    html += '<div class="review-list">' + events.map(e => '<button data-compaction-turn="' + e.turn + ui('">第 ') + e.turn + ui(' 轮 · 查看上下文来源变化<small>压缩记录 seq ') + e.seq + '</small></button>').join('') + '</div>';
    html += ui('<div class="drawer-actions"><button class="action-button primary" id="review-compaction-path">查看本轮行动路径 ↗</button></div>');
    openDrawer(events.length > 1 ? events.length + ui(' 次压缩上下文') : ui('压缩上下文'), ui('较早的对话 → 摘要'), html);
    document.querySelectorAll('[data-compaction-turn]').forEach(el => el.onclick = () => reviewOpenContext(Number(el.dataset.compactionTurn)));
    $('review-compaction-path').onclick = () => reviewEnterPath(event.turn);
  }
  // 抽屉的当前目标:上下文数据晚到时按它重开,不把步级视图退回轮级。
  let reviewContextDrawer = null;
  function reviewOpenContext(turnNumber, stepNumber) {
    const target = stepNumber == null ? null : session.turns.find(t => t.number === turnNumber);
    if (target && target.steps.some(step => step.number === stepNumber)) return reviewOpenStepContext(target, stepNumber);
    reviewContextDrawer = { turn: turnNumber, step: null };
    const row = reviewContextMap.get(turnNumber);
    if (!row) {
      openDrawer(ui('上下文增量尚未包含本轮'), ui('第 ') + turnNumber + ui(' 轮'), '<p class="review-explain">' + reviewContextMissing(turnNumber) + ui('。缺失不表示零。</p>'));
      $('drawer').dataset.contextTurn = turnNumber;
      geistContextCoverage(); return;
    }
    reviewContextSelected = turnNumber;
    const first = reviewContextRequests.find(r => r.turn === row.turn);
    const max = Math.max(1, ...CONTEXT_CATEGORIES.map(c => Math.abs(row.parts[c.key][row.isBaseline ? 'after' : 'delta'])));
    let html = '<div class="review-context-headline"><strong>' + (row.isBaseline ? reviewTokens(row.total) : reviewSigned(row.net)) + '</strong><span>' + (row.isBaseline ? ui('首轮末次请求 · 已有上下文') : ui('tokens · 净变化')) + '</span></div>';
    if (row.isBaseline) html += ui('<p class="review-context-change-note">首次请求已经带着约 ') + reviewTokens(CONTEXT_CATEGORIES.reduce((n, c) => n + (first[c.key] || 0), 0)) + ui(' tokens，并不是空白。下面同时列出首次请求与本轮末次请求的构成。</p>');
    if (!row.isBaseline && (row.increase || row.decrease)) html += '<div class="review-context-totals">' +
      (row.increase ? ui('<span>增加 <b>') + reviewSigned(row.increase) + '</b></span>' : '') +
      (row.decrease ? ui('<span>减少 <b>') + reviewSigned(-row.decrease) + '</b></span>' : '') + '</div>';
    html += '<div class="review-context-breakdown">';
    const changedCategories = CONTEXT_CATEGORIES.filter(c => row.isBaseline ? row.parts[c.key].after !== 0 : row.parts[c.key].delta !== 0);
    if (!changedCategories.length) html += ui('<p class="review-quiet">本轮各来源没有净变化。</p>');
    for (const c of changedCategories) {
      const p = row.parts[c.key], shareBase = p.delta >= 0 ? row.increase : row.decrease;
      const share = shareBase ? Math.abs(p.delta) / shareBase * 100 : 0;
      html += '<div class="review-context-category"><div><i style="background:' + c.color + '"></i><span>' + c.label + '</span><b>' + (row.isBaseline ? '≈' + reviewTokens(p.after) : reviewSigned(p.delta)) + '</b></div>';
      const amount = row.isBaseline ? p.after : Math.abs(p.delta);
      if (amount) html += '<div class="review-context-meter"><i style="width:' + amount / max * 100 + '%;background:' + c.color + ';opacity:' + (p.delta >= 0 ? .9 : .6) + '"></i></div>';
      html += '<small>' + (row.isBaseline ? ui('开始时 ≈') + reviewTokens(first[c.key] || 0) + ui(' → 末次请求 ≈') + reviewTokens(p.after) : '≈' + reviewTokens(p.before) + ' → ≈' + reviewTokens(p.after) + (p.delta ? ui(' · 占本轮') + (p.delta > 0 ? ui('增加 ') : ui('减少 ')) + share.toFixed(1) + '%' : ui(' · 未变'))) + '</small></div>';
    }
    html += '</div>';
    const boundaries = row.baselineSeq === null ? [] : (reviewContextData.boundaries || []).filter(e => e.seq > row.baselineSeq && e.seq <= row.seq);
    const prunes = boundaries.filter(e => e.kind === 'prune'), compactions = boundaries.filter(e => e.kind === 'compaction');
    if (compactions.length) html += '<p class="review-context-change-note">' + compactions.length + ui(' 次压缩：把较早的对话整理成摘要，黄色剪刀线标出实际发生的位置。</p>');
    if (prunes.length) {
      const names = [...new Set(prunes.flatMap(e => e.tools || []))];
      html += '<p class="review-context-change-note">' + prunes.length + ui(' 条过长的工具返回被裁短：保留开头和结尾，省去中间内容。') + (names.length ? ui('涉及 ') + names.map(esc).join('、') + '。' : '') + ui('按日志明确指定的被替换返回记录对应，计在裁短实际发生的这一轮；不挂在报错分叉上，也不会删除行动路径或原会话日志。</p>');
      html += ui('<details class="ov-proof"><summary>裁短了哪些工具返回</summary>') + prunes.flatMap(e => (e.replaced || []).map(r =>
        '<div class="source-row"><span>' + esc(r.tool || ui('工具')) + (r.turn ? ui(' · 原第 ') + r.turn + ui(' 轮 / 第 ') + r.step + ui(' 步') : '') + ui('</span>原返回 seq ') + r.seq + ui(' → 裁短记录 seq ') + e.seq + '</div>')).join('') + '</details>';
    }
    if (contextBarAmounts(row).increase > reviewContextScale.limit || row.decrease > reviewContextScale.limit) html += ui('<p class="review-quiet">图的柱高显示到 ') + reviewTokens(reviewContextScale.limit) + ui(' tokens，超过时用省略号收起柱高。这是显示范围，不是模型容量限制。这里显示完整数值。</p>');
    html += '<p class="review-quiet">' + (row.isBaseline ? ui('首轮显示已有量，作为下一轮的比较基线；不能把它称作相对上一轮的增量。') : ui('比较第 ') + row.baselineTurn + ui(' 轮与第 ') + row.turn + ui(' 轮的末次请求，反映每类内容的净变化。')) + ui('这些不是累计花费，也不包括末次请求之后才产生的回复。</p>');
    // 已经在行动路径里时,"查看本轮行动路径"是重复操作,只留定位与对话跳转。
    const inPath = view === 'path';
    html += '<div class="drawer-actions">' + (inPath ? '' : ui('<button class="action-button primary" id="review-context-path">查看本轮行动路径 ↗</button>')) + ui('<button class="action-button" id="review-context-focus">在全景中放大本轮</button></div>');
    openDrawer(ui('第 ') + turnNumber + ui(' 轮 · 上下文变化'), row.steps + ui(' 次请求 · 各来源均为估算'), html);
    if ($('review-context-path')) $('review-context-path').onclick = () => reviewEnterPath(turnNumber);
    $('review-context-focus').onclick = () => reviewFocusTurn(turnNumber);
  }
  // 步级视图:行动路径以步为单位,点哪根柱就答哪一步。轮级读数在页面顶部,这里不重复摊开。
  function reviewOpenStepContext(t, stepNumber) {
    const step = t.steps.find(row => row.number === stepNumber);
    if (!step) return;
    reviewContextDrawer = { turn: t.number, step: stepNumber };
    const title = ui('第 ') + t.number + ui(' 轮 · 第 ') + stepNumber + ui(' 步 · 上下文变化');
    const index = reviewContextStepIndex.get(t.number + ':' + stepNumber);
    const info = index === undefined ? null : reviewStepContext(t, step);
    if (!info) {
      let carry = null;
      for (const row of reviewContextRequests) {
        if (row.turn < t.number || (row.turn === t.number && row.step <= stepNumber)) carry = row;
        else break;
      }
      if (!carry) {
        openDrawer(title, ui('本步没有发起新的请求'),
          ui('<p class="review-quiet">这一步没有模型请求,也没有更早的请求可以沿用,因此没有可比较的上下文构成。缺失不表示零。</p>'));
        return;
      }
      const total = CONTEXT_CATEGORIES.reduce((sum, c) => sum + (carry[c.key] || 0), 0);
      const origin = carry.turn === t.number ? ui('第 ') + carry.step + ui(' 步') : ui('上一轮第 ') + carry.step + ui(' 步');
      let html = '<div class="review-context-headline"><strong>≈' + reviewTokens(total) + '</strong><span>' + ui('tokens · 沿用 ') + origin + ui(' 的请求') + '</span></div>';
      html += ui('<p class="review-explain">这一步没有重新请求模型,模型看到的内容与上一次请求相同;下面的构成取自那次请求,不是本步的新增。</p>');
      html += '<div class="review-context-breakdown">' + CONTEXT_CATEGORIES.filter(c => (carry[c.key] || 0) > 0).map(c =>
        '<div class="review-context-category"><div><i style="background:' + c.color + '"></i><span>' + c.label + '</span><b>≈' + reviewTokens(carry[c.key]) + '</b></div></div>').join('') + '</div>';
      html += '<div class="drawer-actions">' + ui('<button class="action-button" id="review-step-turn">查看本轮上下文 ↗</button>') + '</div>';
      openDrawer(title, ui('沿用最近一次请求'), html);
      if ($('review-step-turn')) $('review-step-turn').onclick = () => reviewOpenContext(t.number);
      return;
    }
    const increase = CONTEXT_CATEGORIES.reduce((n, c) => n + Math.max(0, info.parts[c.key]), 0);
    const decrease = CONTEXT_CATEGORIES.reduce((n, c) => n + Math.max(0, -info.parts[c.key]), 0);
    const max = Math.max(1, ...CONTEXT_CATEGORIES.map(c => Math.abs(info.parts[c.key])));
    const prior = index > 0 ? reviewContextRequests[index - 1] : null;
    const priorLabel = !prior ? '' : prior.turn === t.number ? ui('第 ') + prior.step + ui(' 步') : ui('上一轮第 ') + prior.step + ui(' 步');
    let html = info.initial
      ? '<div class="review-context-headline"><strong>≈' + reviewTokens(info.total) + '</strong><span>' + ui('tokens · 首次请求已有量') + '</span></div>'
      : '<div class="review-context-headline"><strong>' + reviewSigned(info.amount) + '</strong><span>' + ui('tokens · 本步净变化') + '</span></div>';
    if (!info.initial && (increase || decrease)) html += '<div class="review-context-totals">' +
      (increase ? ui('<span>增加 <b>') + reviewSigned(increase) + '</b></span>' : '') +
      (decrease ? ui('<span>减少 <b>') + reviewSigned(-decrease) + '</b></span>' : '') + '</div>';
    const changed = CONTEXT_CATEGORIES.filter(c => info.parts[c.key] !== 0);
    if (!changed.length) html += ui('<p class="review-quiet">这一步各来源没有净变化。</p>');
    else {
      html += '<div class="review-context-breakdown">';
      for (const c of changed) {
        const delta = info.parts[c.key], after = info.current[c.key] || 0, before = after - delta;
        const shareBase = delta >= 0 ? increase : decrease, share = shareBase ? Math.abs(delta) / shareBase * 100 : 0;
        html += '<div class="review-context-category"><div><i style="background:' + c.color + '"></i><span>' + c.label + '</span><b>' + (info.initial ? '≈' + reviewTokens(after) : reviewSigned(delta)) + '</b></div>';
        if (delta) html += '<div class="review-context-meter"><i style="width:' + Math.abs(delta) / max * 100 + '%;background:' + c.color + ';opacity:' + (delta >= 0 ? .9 : .6) + '"></i></div>';
        html += '<small>≈' + reviewTokens(before) + ' → ≈' + reviewTokens(after) + (share ? ui(' · 占本步') + (delta > 0 ? ui('增加 ') : ui('减少 ')) + share.toFixed(1) + '%' : ui(' · 未变')) + '</small></div>';
      }
      html += '</div>';
    }
    const turnRow = reviewContextMap.get(t.number);
    if (turnRow && !turnRow.isBaseline) html += ui('<p class="review-quiet">本轮合计（轮末相对上一轮末）') + reviewSigned(turnRow.net) + ui(' tokens。步级增量相加不等于轮级增量:没有重新请求的步不计入,跨轮边界也不按步切。</p>');
    html += '<div class="drawer-actions">' + ui('<button class="action-button" id="review-step-turn">查看本轮上下文 ↗</button>') + '</div>';
    openDrawer(title, prior ? ui('比较 ') + priorLabel + ui(' → 第 ') + stepNumber + ui(' 步') : ui('首次请求 · 已有上下文'), html);
    if ($('review-step-turn')) $('review-step-turn').onclick = () => reviewOpenContext(t.number);
  }
  function reviewContextBind() {
    let key = $('review-overlay-key');
    if (view === 'overview') {
      if (!key) {
        key = document.createElement('div'); key.id = 'review-overlay-key'; key.className = 'review-overlay-key';
        key.innerHTML = ui('<span class="review-overlay-caption" data-context-caption>上下文 <b>首轮已有量 · 之后↑增 ↓减</b></span>') + CONTEXT_CATEGORIES.map(c => '<button class="review-overlay-source" data-context-category="' + c.key + '"><i style="background:' + c.color + '"></i>' + c.label + '</button>').join('') +
          ui('<button id="review-context-readout" class="review-overlay-pick"></button><button id="review-context-scale-note" class="review-overlay-scale">柱高至 ±') + reviewTokens(reviewContextScale.limit) + ui(' · …收起更大量</button>');
        $('graph-caption').append(key);
      }
      key.setAttribute('aria-hidden', String(!overviewLayers.has('context')));
      $('review-context-readout').textContent = reviewContextNote(reviewContextMap.get(reviewContextSelected)) + ' ↗';
      $('review-context-readout').onclick = () => reviewOpenContext(reviewContextSelected);
      $('review-context-scale-note').onclick = reviewOpenScaleNote;
    } else key?.remove();
    $('graph').querySelectorAll('[data-context-turn]').forEach(el => {
      const number = Number(el.dataset.contextTurn), row = reviewContextMap.get(number);
      el.onmouseenter = () => {
        reviewContextSelected = number;
        if ($('review-context-readout')) $('review-context-readout').textContent = reviewContextNote(row);
        tlReadout(row && !row.isBaseline ? ui('第 ') + number + ui(' 轮：增加 ') + reviewTokens(row.increase) + ui('，减少 ') + reviewTokens(row.decrease) + ui('，净变化 ') + reviewSigned(row.net) + ui(' tokens。点击看来源。') : reviewContextNote(row));
      };
      el.onclick = e => { e.stopPropagation(); reviewOpenContext(number); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reviewOpenContext(number); } };
    });
    $('graph').querySelectorAll('[data-review-duration-range]').forEach(el => {
      const [first, last] = el.dataset.reviewDurationRange.split(':').map(Number);
      const open = () => reviewOpenDurations(first, last);
      el.onmouseenter = () => tlReadout(first === last ? ui('第 ') + first + ui(' 轮：点击定位本轮，或查看上下文与行动。') : ui('第 ') + first + '–' + last + ui(' 轮：点击展开每一轮的耗时，短轮次也在其中。'));
      el.onclick = e => { e.stopPropagation(); open(); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
    $('graph').querySelectorAll('[data-context-compaction]').forEach(el => {
      const seqs = el.dataset.contextCompaction.split(',').map(Number);
      el.onclick = e => { e.stopPropagation(); reviewOpenCompaction(seqs); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reviewOpenCompaction(seqs); } };
      el.onmouseenter = () => tlReadout(ui('折叠标记与靛蓝虚线：较早的对话在这里被整理成摘要。点击看详情。'));
    });
    $('canvas').querySelectorAll('[data-context-category]').forEach(el => {
      el.onclick = () => reviewOpenContextSources(el.dataset.contextCategory);
      el.onmouseenter = () => $('graph').querySelectorAll('[data-context-segment]').forEach(segment => { segment.style.opacity = segment.dataset.contextSegment === el.dataset.contextCategory ? '.8' : '.08'; });
      el.onmouseleave = () => $('graph').querySelectorAll('[data-context-segment]').forEach(segment => { segment.style.opacity = ''; });
    });
    $('graph-caption').querySelectorAll('.br-key-item').forEach(el => {
      const label = el.textContent.trim();
      el.dataset.tone = Object.entries({ '中断': 'stop', '压缩上下文': 'compact', '结果还不清楚': 'unknown', '等待已折叠': 'gap' }).find(([name]) => label.includes(name))?.[1] || '';
      if (el.dataset.tone === 'compact') {
        el.style.visibility = overviewLayers.has('context') ? '' : 'hidden';
        el.setAttribute('aria-hidden', String(!overviewLayers.has('context')));
      }
    });
    $('graph-caption').querySelector('[data-br-layer="context"]')?.setAttribute('title', ui('上下文来源变化，以及压缩与裁短记录；与停顿、再试独立'));
  }
