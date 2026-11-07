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
    const rawResult = fact => {
      const call = callOf(fact), text = call && call.result && typeof call.result.text === 'string' ? call.result.text : '';
      if (!text.trim() || fact.preview) return null;
      const lines = text.replace(/\r\n/g, '\n').split('\n');
      return { shown: lines.slice(0, 10).join('\n'), clipped: Boolean(call.result.omitted) || lines.length > 10 };
    };
    const operation = fact => {
      const raw = rawResult(fact);
      return '<article class="geist-operation" data-tone="' + fact.tone + '">' +
        '<h3>' + esc(fact.title) + '</h3>' +
        '<p>' + esc(fact.outcome) + '</p>' +
        (fact.detail ? '<span class="geist-operation-size">' + esc(fact.detail) + '</span>' : '') +
        (raw ? '<details class="geist-result"><summary>' + esc(raw.clipped ? ui('返回原文 · 前 10 行') : ui('返回原文')) + '</summary><pre class="geist-result-text">' + esc(raw.shown) + '</pre></details>' : '') +
        (fact.preview ? '<button class="geist-text-action" data-insight-change="' + fact.seq + '">' + (fact.tone === 'bad' || fact.tone === 'unknown' ? ui('查看原计划') : ui('打开改动对比')) + ' ↗</button>' : '') +
        '</article>';
    };
    panel.innerHTML = '<header class="geist-step-meta"><span><b>' + ui`第 ${step.number} 步` + '</b>' +
      (overviewLayers.has('duration') ? '<span>' + preciseTime(recordDuration(step)) + '</span>' : '') +
      (insight.calls.length > 1 ? '<span>' + insight.calls.length + ui(' 项操作</span>') : '') + '</span>' +
      ui('<nav class="geist-step-navigation" aria-label="逐步浏览"><button data-inspector-nav="-1" aria-label="上一步" title="') + esc(navTitle(backward, -1)) + '"' + (backward ? '' : ' disabled') + ui('>←</button><button data-inspector-nav="1" aria-label="下一步" title="') + esc(navTitle(forward, 1)) + '"' + (forward ? '' : ' disabled') + '>→</button></nav></header>' +
      '<p class="geist-step-context"><span>' + esc(insight.input.label) + '</span><span class="geist-step-context-text" title="' + esc(insight.input.text) + '">' + esc(insight.input.text) + '</span></p>' +
      '<div class="geist-operations">' +
        insight.calls.map(operation).join('') +
        (insight.reply ? '<p class="geist-step-reply">' + esc(insight.reply) + '</p>' : '') +
        (!insight.calls.length && !insight.reply ? ui('<p class="review-quiet">没有记录到本步的文字回复或工具操作。</p>') : '') +
      '</div>' +
      (insight.links.length ? '<p class="geist-step-next"><span>' + ui('后续记录') + '</span>' + insight.links.map(l => '<button class="geist-text-action" data-insight-step="' + l.step + '">' + esc(l.text) + ' ↗</button>').join('') + '</p>' : '') +
      (insight.following ? '<p class="geist-step-next"><span>' + ui('接下来') + '</span><button class="geist-text-action" data-insight-step="' + insight.following.step + '">' + ui('第 ') + insight.following.step + ui(' 步 · ') + esc(insight.following.text) + ' ↗</button></p>' : '') +
      '<p class="geist-step-record"><button class="geist-text-action quiet" id="geist-step-record">' + ui('查看原始记录 ↗') + '</button></p>';
    panel.querySelectorAll('[data-insight-change]').forEach(el => el.onclick = () => reviewOpenChange(t, step, insight.calls.find(f => f.seq === Number(el.dataset.insightChange))));
    panel.querySelectorAll('[data-insight-step]').forEach(el => el.onclick = () => reviewJumpToStep(t, Number(el.dataset.insightStep)));
    const record = $('geist-step-record');
    if (record) record.onclick = () => showStep(index);
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
