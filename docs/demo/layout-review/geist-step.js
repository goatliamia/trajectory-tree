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
    const arrow = '<svg class="geist-arrow" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5.5 10.5 10.5 5.5M6.5 5.5h4v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const disclosure = geistRecordDisclosure;
    const operation = fact => {
      const call = step.calls.find(c => c.seq === fact.seq);
      if (!call) return '';
      const diff = reviewHasChange(fact) ? '<button class="geist-text-action" data-insight-change="' + fact.seq + '">' + (fact.tone === 'bad' || fact.tone === 'unknown' ? ui('查看原计划') : ui('打开改动对比')) + arrow + '</button>' : '';
      return geistToolRecord(call, { fact, turn: t, step, actions: diff });
    };
    // 展开原文时不改变面板外框高度:锁住当前高度,内容在面板内滚动,图区不会被挤压。
    panel.style.height = '';
    panel.scrollTop = 0;
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
    // 展开时给原文稳定的阅读高度,内容在面板内滚动,不跟随长输出无限增高。
    const panelDetails = () => [...panel.querySelectorAll('details.geist-tool-record, details.geist-result')];
    panelDetails().forEach(details => {
      details.querySelector('summary').addEventListener('click', () => {
        if (details.open) return;
        panel.style.height = Math.max(panel.getBoundingClientRect().height, Math.min(window.innerHeight * .44, 360)) + 'px';
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
