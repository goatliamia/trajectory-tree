  // 一步的读数与证据:标题一行、操作一段、依据收进一个折叠区,原文只在最深处。
  reviewRenderStepSummary = function(t, step) {
    const panel = $('step-panel');
    const identity = [session.id, t.number, step.number, overviewLayers.has('duration'), overviewLayers.has('context'), 'inspector'].join(':');
    if (panel.dataset.detailKey === identity) return;
    panel.dataset.detailKey = identity;
    const insight = stepInsight(t, step, session.overview.episodes, reviewContextData.callFacts);
    const index = t.steps.indexOf(step);
    panel.className = 'step-panel on geist-step'; panel.style.display = '';
    panel.setAttribute('aria-label', ui('所选步骤详情'));
    const turnIndex = session.turns.indexOf(t);
    const stepNeighbour = direction => {
      const within = t.steps[index + direction];
      if (within) return { turn: t, step: within, within: true };
      const row = session.turns[turnIndex + direction];
      if (!row || !row.steps.length) return null;
      return { turn: row, step: direction > 0 ? row.steps[0] : row.steps.at(-1), within: false };
    };
    const forward = stepNeighbour(1), backward = stepNeighbour(-1);
    const navTitle = (target, direction) => {
      if (!target) return direction > 0 ? ui('已是最后一步') : ui('已是第一步');
      if (!target.within) return direction > 0 ? ui('下一轮第 1 步') : ui('上一轮末步');
      return direction > 0 ? (insight.following ? ui('下一步 · ') + insight.following.text : ui('下一步')) : ui('上一步');
    };
    const callOf = fact => step.calls.find(call => call.seq === fact.seq) || null;
    // 展开沿用 Geist 的 Show code 行:16px chevron 收起时指右、打开后指下,文字只留标签。
    const chevron = '<span class="geist-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="m12.06 6.75-.53.53-2.82 2.82a1 1 0 0 1-1.42 0L4.47 7.28l-.53-.53L5 5.69l.53.53L8 8.69l2.47-2.47.53-.53z"/></svg></span>';
    // 跳转箭头用图标,不用 ↗ 字符:字符随字体变形,这是 Geist 图标的同一套几何。
    const arrow = '<svg class="geist-arrow" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5.5 10.5 10.5 5.5M6.5 5.5h4v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const disclosure = (label, body) => '<details class="geist-result"><summary>' + label + chevron + '</summary>' + body + '</details>';
    const excerpt = value => value && typeof value.text === 'string' && value.text.trim()
      ? { text: value.text.replace(/\r\n/g, '\n'), omitted: Number(value.omitted) || 0 } : null;
    // 原始记录的内容并进面板:调用参数、返回原文、错误类型和 seq 都在这一步里看全。
    const rawEntry = fact => {
      const call = callOf(fact);
      if (!call) return '';
      const args = excerpt(call.args), result = fact.preview ? null : excerpt(call.result);
      const error = call.error ? String(call.error.code || call.error.name || '') : '';
      if (!args && !result && !error) return '';
      const block = (label, value) => '<span class="geist-result-label">' + label + '</span><pre class="geist-result-text">' + esc(value.text) + '</pre>' +
        (value.omitted ? '<span class="geist-result-note">' + ui('节选 · 另有 ') + value.omitted + ui(' 个字符未载入') + '</span>' : '');
      return disclosure(ui('调用参数与原文'),
        (error ? '<span class="geist-result-label">' + ui('错误类型') + '</span><pre class="geist-result-text">' + esc(error) + '</pre>' : '') +
        (args ? block(ui('调用参数'), args) : '') + (result ? block(ui('返回原文'), result) : ''));
    };
    const callMeta = fact => {
      const call = callOf(fact), bits = [];
      if (call && call.seq != null) bits.push('seq ' + call.seq + (call.resultSeq != null ? ' → ' + call.resultSeq : ''));
      if (call && call.start != null && call.end != null) bits.push(dur(call.end - call.start));
      return bits.join(' · ');
    };
    const operation = fact => {
      const meta = [fact.detail, callMeta(fact)].filter(Boolean).join(' · ');
      const raw = rawEntry(fact);
      const diff = fact.preview ? '<button class="geist-text-action" data-insight-change="' + fact.seq + '">' + (fact.tone === 'bad' || fact.tone === 'unknown' ? ui('查看原计划') : ui('打开改动对比')) + arrow + '</button>' : '';
      return '<article class="geist-operation" data-tone="' + fact.tone + '">' +
        '<h3>' + esc(fact.title) + '</h3>' +
        '<p>' + esc(fact.outcome) + (diff ? ' ' + diff : '') + '</p>' +
        (meta ? '<span class="geist-operation-size">' + esc(meta) + '</span>' : '') +
        (raw ? '<div class="geist-operation-actions">' + raw + '</div>' : '') +
        '</article>';
    };
    // 展开原文时不改变面板外框高度:锁住当前高度,内容在面板内滚动,图区不会被挤压。
    panel.style.height = '';
    panel.innerHTML = '<header class="geist-step-meta"><span><b>' + ui`第 ${step.number} 步` + '</b>' +
      (overviewLayers.has('duration') ? '<span>' + preciseTime(recordDuration(step)) + '</span>' : '') +
      (insight.calls.length > 1 ? '<span>' + insight.calls.length + ui(' 项操作</span>') : '') + '</span>' +
      ui('<nav class="geist-step-navigation" aria-label="逐步浏览"><button data-inspector-nav="-1" aria-label="上一步" title="') + esc(navTitle(backward, -1)) + '"' + (backward ? '' : ' disabled') + ui('>←</button><button data-inspector-nav="1" aria-label="下一步" title="') + esc(navTitle(forward, 1)) + '"' + (forward ? '' : ' disabled') + '>→</button></nav></header>' +
      '<p class="geist-step-context"><span>' + esc(insight.input.label) + '</span><span class="geist-step-context-text" title="' + esc(insight.input.text) + '">' + esc(insight.input.text) + '</span></p>' +
      '<div class="geist-operations">' +
        insight.calls.map(operation).join('') +
        (insight.reply ? '<p class="geist-step-reply">' + esc(insight.reply) + '</p>' : '') +
        (step.reply && step.reply.text && step.reply.text.length > (insight.reply || '').length
          ? disclosure(ui('回复原文'), '<pre class="geist-result-text">' + esc(step.reply.text) + '</pre>') : '') +
        (!insight.calls.length && !insight.reply ? ui('<p class="review-quiet">没有记录到本步的文字回复或工具操作。</p>') : '') +
      '</div>' +
      (insight.links.length ? '<p class="geist-step-next"><span>' + ui('后续记录') + '</span>' + insight.links.map(l => '<button class="geist-text-action" data-insight-step="' + l.step + '">' + esc(l.text) + arrow + '</button>').join('') + '</p>' : '') +
      (insight.following ? '<p class="geist-step-next"><span>' + ui('接下来') + '</span><button class="geist-text-action" data-insight-step="' + insight.following.step + '">' + ui('第 ') + insight.following.step + ui(' 步 · ') + esc(insight.following.text) + arrow + '</button></p>' : '');
    panel.querySelectorAll('[data-insight-change]').forEach(el => el.onclick = () => reviewOpenChange(t, step, insight.calls.find(f => f.seq === Number(el.dataset.insightChange))));
    panel.querySelectorAll('[data-insight-step]').forEach(el => el.onclick = () => reviewJumpToStep(t, Number(el.dataset.insightStep)));
    // 展开前把面板高度钉住:内容在里面滚,画布和图区保持原样。
    const panelDetails = () => [...panel.querySelectorAll('details.geist-result')];
    panelDetails().forEach(details => {
      details.querySelector('summary').addEventListener('click', () => {
        if (details.open) return;
        panel.style.height = panel.getBoundingClientRect().height + 'px';
      });
      details.addEventListener('toggle', () => {
        if (!details.open && !panelDetails().some(row => row.open)) panel.style.height = '';
      });
    });
    panel.querySelectorAll('[data-inspector-nav]').forEach(el => el.onclick = () => {
      const direction = Number(el.dataset.inspectorNav), target = stepNeighbour(direction);
      if (!target) return;
      if (target.within) reviewJumpToStep(t, target.step.number);
      else reviewEnterPath(target.turn.number, target.step.number);
      requestAnimationFrame(() => {
        $('step-panel')?.querySelector('[data-inspector-nav="' + direction + '"]:not(:disabled)')?.focus({ preventScroll: true });
      });
    });
  };
