  let reviewDetailStack = [], reviewDetailOrigin = null;
  function reviewCloseDetail() {
    const overlay = $('review-detail-overlay');
    overlay?.remove(); reviewDetailStack = [];
    if (reviewDetailOrigin?.isConnected) reviewDetailOrigin.focus({ preventScroll: true });
    reviewDetailOrigin = null;
  }
  function reviewOpenDetail(detail, nested = false) {
    let overlay = $('review-detail-overlay');
    if (!overlay) {
      reviewDetailOrigin = document.activeElement;
      overlay = document.createElement('div'); overlay.id = 'review-detail-overlay'; overlay.className = 'review-detail-overlay';
      overlay.innerHTML = ui('<section class="review-detail-window" role="dialog" aria-modal="true" aria-labelledby="review-detail-title"><header><button id="review-detail-back" aria-label="返回上一层">‹</button><div><h2 id="review-detail-title"></h2><p id="review-detail-subtitle"></p></div><button id="review-detail-close" aria-label="关闭详情">×</button></header><div class="review-detail-body" id="review-detail-body"></div></section>');
      document.body.append(overlay);
      overlay.onclick = e => { if (e.target === overlay) reviewCloseDetail(); };
      $('review-detail-close').onclick = reviewCloseDetail;
      $('review-detail-back').onclick = () => { reviewDetailStack.pop(); reviewPaintDetail(); };
      overlay.onkeydown = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); reviewCloseDetail(); }
        if (e.key === 'Tab') {
          const items = [...overlay.querySelectorAll('button:not([disabled]), [tabindex="0"], a[href]')].filter(el => !el.hidden && el.getClientRects().length);
          const first = items[0], last = items.at(-1);
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      };
    }
    if (nested && reviewDetailStack.length) reviewDetailStack.at(-1).scroll = $('review-detail-body').scrollTop;
    reviewDetailStack = nested ? [...reviewDetailStack, detail] : [detail];
    reviewPaintDetail();
  }
  function reviewPaintDetail() {
    const detail = reviewDetailStack.at(-1);
    $('review-detail-title').textContent = detail.title;
    $('review-detail-subtitle').textContent = detail.subtitle || '';
    $('review-detail-back').hidden = reviewDetailStack.length < 2;
    $('review-detail-body').innerHTML = detail.html;
    detail.bind?.();
    $('review-detail-body').scrollTop = detail.scroll || 0;
    $('review-detail-close').focus({ preventScroll: true });
  }
  function reviewHasChange(fact) {
    return Boolean(fact?.preview || fact?.diffChanges?.length);
  }
  function reviewDiffRow(row) {
    if (row.kind === 'fold') return ui('<button class="review-diff-fold">展开 ') + row.count + ui(' 行未改动内容</button>');
    if (row.kind === 'hunk' || row.kind === 'meta') return '<div class="review-diff-marker"><code>' + esc(row.text) + '</code></div>';
    return '<div class="review-diff-row ' + row.kind + '"><span class="review-diff-line-number">' + (row.before ?? '') + '</span><span class="review-diff-line-number">' + (row.after ?? '') + '</span><span class="review-diff-sign">' + (row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : '') + '</span><code>' + esc(row.text || ' ') + '</code></div>';
  }
  function reviewOpenRecordedChange(fact, detail, nested, path) {
    const changes = fact.diffChanges, pageSize = 500;
    let index = Math.max(0, changes.findIndex(change => change.path === path));
    let raw = false, shown = pageSize;
    detail.html = '<div class="review-change-status" data-tone="' + esc(fact.tone) + '">' + esc(fact.outcome) + '</div>' +
      '<div class="review-patch-file">' + (changes.length > 1 ? ui('<select id="review-patch-files" aria-label="选择改动文件">') +
        changes.map((change, i) => '<option value="' + i + '">' + esc(change.path) + '</option>').join('') + '</select>' : '') +
        '<span id="review-patch-path"></span></div>' +
      '<div class="review-diff-toolbar"><span id="review-patch-count"></span><button id="review-patch-raw"></button></div>' +
      '<p class="review-diff-note" id="review-patch-note"></p>' +
      ui('<div class="review-diff-scroller review-patch-scroller" tabindex="0" aria-label="改动内容"><div id="review-patch-view"></div><button id="review-patch-more" class="review-diff-fold" hidden>显示更多行</button></div>');
    detail.bind = () => {
      const files = $('review-patch-files'), pane = $('review-patch-view'), toggle = $('review-patch-raw'), more = $('review-patch-more');
      const types = { add: ui('新增文件'), delete: ui('删除文件'), update: ui('修改文件') };
      let change, rows;
      const render = () => {
        const formatted = rows && !raw;
        toggle.hidden = !rows;
        toggle.textContent = raw ? ui('行级对比') : ui('原始补丁');
        more.hidden = !formatted || shown >= rows.length;
        pane.classList.toggle('review-diff-lines', !!formatted);
        pane.innerHTML = formatted
          ? ui('<div class="review-diff-column-key"><span>原</span><span>新</span><span></span><span>改动片段</span></div>') + rows.slice(0, shown).map(reviewDiffRow).join('')
          : change.diff?.text ? '<pre class="excerpt">' + esc(change.diff.text) + '</pre>' : ui('<p class="review-patch-empty">未记录补丁正文。</p>');
      };
      const select = () => {
        change = changes[index]; rows = recordedDiffRows(change);
        const destination = change.kind?.move_path;
        const name = destination ? ui('移动文件') : types[change.kind?.type];
        if (files) files.title = change.path;
        const pathLabel = [files ? '' : change.path, destination ? '→ ' + destination : ''].filter(Boolean).join(' ');
        $('review-patch-path').textContent = [name, pathLabel].filter(Boolean).join(' · ');
        const removed = rows?.filter(row => row.kind === 'remove').length;
        const added = rows?.filter(row => row.kind === 'add').length;
        $('review-patch-count').innerHTML = rows ? '<b class="removed">− ' + removed + ui(' 行</b><b class="added">+ ') + added + ui(' 行</b>') : '';
        $('review-patch-note').textContent = change.diff?.omitted
          ? ui('片段过长，当前为截取内容；行数统计仅针对展示部分。')
          : ui('按本次记录的补丁展示，未记录的行号留空。');
        render();
        pane.parentElement.scrollTo(0, 0);
      };
      if (files) {
        files.value = String(index);
        files.onchange = () => { index = Number(files.value); shown = pageSize; select(); };
      }
      toggle.onclick = () => { raw = !raw; render(); pane.parentElement.scrollTo(0, 0); };
      more.onclick = () => {
        pane.insertAdjacentHTML('beforeend', rows.slice(shown, shown + pageSize).map(reviewDiffRow).join(''));
        shown += pageSize;
        if (shown >= rows.length) { more.hidden = true; pane.parentElement.focus({ preventScroll: true }); }
      };
      select();
    };
    reviewOpenDetail(detail, nested);
  }
  function reviewOpenChange(t, step, fact, nested = false, path = null) {
    if (!reviewHasChange(fact)) return;
    const preview = fact.preview;
    const planned = fact.tone === 'bad' || fact.tone === 'unknown';
    const title = planned ? ui('原计划改动') : ui('改动对比');
    const position = ui('第 ') + t.number + ui(' 轮 / 第 ') + step.number + ui(' 步');
    if (!preview) return reviewOpenRecordedChange(fact, { title, subtitle: position }, nested, path);
    const subtitle = (fact.target || fact.title) + ' · ' + position;
    const rows = changedLines(preview.before, preview.after), removed = rows.filter(r => r.kind === 'remove').length, added = rows.filter(r => r.kind === 'add').length;
    const folded = compactDiff(rows), hasFolds = folded.some(row => row.kind === 'fold');
    const detail = {
      title, subtitle,
      html: '<div class="review-change-status" data-tone="' + fact.tone + '">' + esc(fact.outcome) + '</div>' +
        '<div class="review-diff-toolbar"><span><b class="removed">− ' + removed + ui(' 行</b><b class="added">+ ') + added + ui(' 行</b></span>') +
        (hasFolds ? ui('<button id="review-diff-toggle">显示全部片段</button>') : '<span class="review-diff-complete">' + (preview.partial ? ui('截取片段') : ui('完整替换片段')) + '</span>') + '</div>' +
        ui('<p class="review-diff-note">本次替换片段对比，非整文件；“原 / 新”是对应片段中的行号。</p>') +
        (preview.partial ? ui('<p class="review-change-status">片段过长，当前为截取内容；行数统计仅针对展示部分。</p>') : '') +
        ui('<div class="review-diff-scroller" tabindex="0" aria-label="改动内容"><div class="review-diff-column-key"><span>原</span><span>新</span><span></span><span>改动片段</span></div><div id="review-diff-lines" class="review-diff-lines"></div></div>'),
      bind: () => {
        const render = () => {
          const visible = detail.all ? rows : folded;
          if ($('review-diff-toggle')) $('review-diff-toggle').textContent = detail.all ? ui('只看改动附近') : ui('显示全部片段');
          $('review-diff-lines').innerHTML = visible.map(reviewDiffRow).join('');
          $('review-diff-lines').querySelectorAll('.review-diff-fold').forEach(el => el.onclick = () => { detail.all = true; render(); });
        };
        if ($('review-diff-toggle')) $('review-diff-toggle').onclick = () => { detail.all = !detail.all; render(); };
        render();
      },
    };
    reviewOpenDetail(detail, nested);
  }
  function reviewOpenStepDetail(t, step, insight, info) {
    const html = '<div class="review-detail-section"><h3>' + insight.input.label + '</h3><p>' + esc(insight.input.text) + '</p></div>' +
      insight.calls.map(fact => '<div class="review-detail-section"><h3>' + esc(fact.title) + '</h3><p data-tone="' + fact.tone + '">' + esc(fact.outcome) + '</p>' +
        (fact.detail ? '<p class="review-detail-muted">' + esc(fact.detail) + '</p>' : '') +
        (reviewHasChange(fact) ? '<button class="review-detail-link" data-detail-change="' + fact.seq + '">' + (fact.tone === 'bad' ? ui('查看原计划改动') : ui('查看改动对比')) + ' ↗</button>' : '') + '</div>').join('') +
      (insight.reply ? ui('<div class="review-detail-section"><h3>回复摘录</h3><p>') + esc(insight.reply) + '</p></div>' : '') +
      (insight.links.length ? ui('<div class="review-detail-section"><h3>后续记录</h3>') + insight.links.map(l => '<button class="review-detail-link" data-detail-step="' + l.step + '">' + esc(l.text) + ' ↗</button>').join('<br>') + ui('<p class="review-detail-muted">依据同一轮中工具与完整参数一致的失败、成功记录。</p></div>') : '') +
      (insight.following ? ui('<div class="review-detail-section"><h3>接下来</h3><button class="review-detail-link" data-detail-step="') + insight.following.step + ui('">第 ') + insight.following.step + ui(' 步 · ') + esc(insight.following.text) + ' ↗</button></div>' : '') +
      (info ? ui('<div class="review-detail-section"><h3>本步请求上下文</h3><p>已有 ≈') + reviewTokens(info.total) + ' tokens；' + (info.initial ? ui('首次载入 ') : ui('相比上次请求 ')) + reviewSigned(info.amount) + ui('。</p><p class="review-detail-muted">请求发出前的估算构成，不含本次回复。</p></div>') : '') +
      ui('<button class="review-detail-link" id="review-detail-record">查看调用与返回原文 ↗</button>');
    reviewOpenDetail({ title: ui('第 ') + step.number + ui(' 步 · 前后文与依据'), subtitle: ui('第 ') + t.number + ui(' 轮 · ') + reviewActionStepLabel(step), html,
      bind: () => {
        $('review-detail-body').querySelectorAll('[data-detail-change]').forEach(el => el.onclick = () => reviewOpenChange(t, step, insight.calls.find(f => f.seq === Number(el.dataset.detailChange)), true));
        $('review-detail-body').querySelectorAll('[data-detail-step]').forEach(el => el.onclick = () => reviewJumpToStep(t, Number(el.dataset.detailStep)));
        $('review-detail-record').onclick = () => { reviewCloseDetail(); showStep(t.steps.indexOf(step)); };
      } });
  }
