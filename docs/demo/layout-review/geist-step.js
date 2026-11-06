  // A single inspector: action and observed result first, evidence on demand.
  reviewRenderStepSummary = function(t, step) {
    const panel = $('step-panel');
    const identity = [session.id, t.number, step.number, overviewLayers.has('duration'), overviewLayers.has('context'), 'inspector'].join(':');
    if (panel.dataset.detailKey === identity) return;
    panel.dataset.detailKey = identity;
    const info = reviewStepContext(t, step), insight = stepInsight(t, step, session.overview.episodes, reviewContextData.callFacts);
    const index = t.steps.indexOf(step);
    panel.className = 'step-panel on geist-step'; panel.style.display = '';
    panel.setAttribute('aria-label', ui('所选步骤详情'));
    const render = fact => {
      const lines = value => value ? String(value).split(/\r?\n/).length : 0;
      const size = fact.preview && !fact.preview.partial
        ? (fact.preview.before ? ui('替换片段 ') + lines(fact.preview.before) + ' → ' + lines(fact.preview.after) + ui(' 行') : ui('写入内容 ') + lines(fact.preview.after) + ui(' 行')) : '';
      return '<article class="geist-operation" data-tone="' + fact.tone + '"><div class="geist-operation-copy"><h3>' + esc(fact.title) + '</h3>' +
        '<p>' + esc(fact.outcome) + '</p>' + (size ? '<span class="geist-operation-size">' + (fact.tone === 'bad' || fact.tone === 'unknown' ? ui('原计划 · ') : '') + size + '</span>' : '') + '</div>' +
        (fact.preview ? '<button class="geist-diff-action" data-insight-change="' + fact.seq + '">' + (fact.tone === 'bad' || fact.tone === 'unknown' ? ui('查看原计划') : ui('查看差异')) + ' <span aria-hidden="true">↗</span></button>' : '') + '</article>';
    };
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
    panel.innerHTML = '<header class="geist-step-meta"><span><b>' + ui`第 ${step.number} 步` + '</b>' +
      (overviewLayers.has('duration') ? '<span>' + preciseTime(recordDuration(step)) + '</span>' : '') +
      (insight.calls.length > 1 ? '<span>' + insight.calls.length + ui(' 项操作</span>') : '') + '</span>' +
      ui('<nav class="geist-step-navigation" aria-label="逐步浏览"><button data-inspector-nav="-1" aria-label="上一步" title="') + esc(navTitle(backward, -1)) + '"' + (backward ? '' : ' disabled') + ui('>←</button><button data-inspector-nav="1" aria-label="下一步" title="') + esc(navTitle(forward, 1)) + '"' + (forward ? '' : ' disabled') + '>→</button></nav></header>' +
      '<div class="geist-operations">' + (insight.calls.length ? insight.calls.map(render).join('') :
        ui('<article class="geist-operation"><div class="geist-operation-copy"><h3>回复</h3><p>') + esc(insight.reply || ui('没有记录到本步的文字回复。')) + '</p></div></article>') + '</div>' +
      (insight.links.length ? '<div class="geist-step-recovery">' + insight.links.map(link => '<button class="geist-text-action recovery" data-insight-step="' + link.step + '">' + esc(link.text) + ' ↗</button>').join('') + '</div>' : '') +
      ui('<footer class="geist-step-evidence"><button class="geist-text-action quiet" id="review-panel-details">输入与依据 ↗</button><button class="geist-text-action quiet" id="panel-record">原始记录 ↗</button></footer>');
    $('panel-record').onclick = () => showStep(index);
    $('review-panel-details').onclick = () => reviewOpenStepDetail(t, step, insight, info);
    panel.querySelectorAll('[data-insight-change]').forEach(el => el.onclick = () => reviewOpenChange(t, step, insight.calls.find(f => f.seq === Number(el.dataset.insightChange))));
    panel.querySelectorAll('[data-insight-step]').forEach(el => el.onclick = () => reviewJumpToStep(t, Number(el.dataset.insightStep)));
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
