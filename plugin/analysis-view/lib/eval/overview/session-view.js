// A source-linked Web host may still serve the previous page assembler.
if (typeof globalThis.ui !== 'function') {
  globalThis.ui = (text, ...values) => Array.isArray(text)
    ? text.map((part, index) => part + (index < values.length ? values[index] : '')).join('') : text;
}

const windowOccupancyBands = [
  [20, '<20%'], [40, '20–40%'], [60, '40–60%'], [70, '60–70%'],
  [85, '70–85%'], [100, '85–100%'], [Infinity, '≥100%'],
];
const windowRatio = (used, window) => Number.isFinite(used) && window > 0 ? 100 * used / window : null;

function readStepOccupancy({ points, stepEnds }) {
  let sampleIndex = -1;
  return stepEnds.map(([seq, turn, step]) => {
    while (sampleIndex + 1 < points.length && points[sampleIndex + 1][0] <= seq) sampleIndex++;
    const [, used, window] = points[sampleIndex] ?? [];
    return { seq, turn, step, used, window, ratio: windowRatio(used, window) };
  });
}

function readOccupancyActions({ actions, names }, getTurn) {
  return actions.map(row => {
    const [launch, request, turnNo, step, name, status, used, window, result, category, model, elapsed] = row;
    const turn = getTurn(turnNo);
    return { launch, request, turn, step, tool: names[name], status, used, window, result, category, model, elapsed,
      ratio: windowRatio(used, window), error: status === 1 ? turn.errors.find(error => error.failed === result) : null };
  });
}

function mountSessionEval({ data, $, num, esc, time, dayFormat, option, metric, empty, fraction, dot,
  chart, getActions, openActions, openWork }) {
  const { frame, xGrid, yGrid, line, circle, showPlot, plotEmpty } = chart;
  const colors = { curve: '#2671e0', error: '#b84e34', guard: '#b6781e', compression: '#0b8976' };
  const guard = data.categories.indexOf(ui('文件修改保护'));
  const occupancy = value => Number.isFinite(value) ? value.toFixed(2).replace(/\.?0+$/, '') + '%' : '—';
  const roundStep = action => action.turn.no + ':' + action.step;
  const labelSession = session => {
    const first = dayFormat.format(session.turns[0].at), last = dayFormat.format(session.turns.at(-1).at);
    return (first === last ? first : first + '–' + last) + ' · ' + num(session.turns.length)
      + ui(' 轮 · ') + session.id.slice(8, 16);
  };
  let current = Math.max(0, data.sessions.findIndex(session => session.occupancy.points.length));
  let session, actions, compactions, view;
  let stepReads, selectedStep, showStep;

  const stepLabel = ({ seq, turn, step }) => ui`第 ${turn} 轮 · 第 ${step} 步 · #${seq}`;

  function pinStep(index, announce = false) {
    selectedStep = index;
    $('pressure-prev').disabled = index === 0;
    $('pressure-next').disabled = index === stepReads.length - 1;
    showStep(index);
    if (announce) {
      const reading = stepReads[index];
      $('pressure-step-status').textContent = stepLabel(reading) + ' · '
        + (reading.ratio == null ? ui('暂无占用读数') : ui('窗口占用 ') + occupancy(reading.ratio));
    }
  }

  function select(index = current) {
    current = index;
    if (session === data.sessions[index]) return draw();
    session = data.sessions[index];
    $('session-project').value = String(session.project);
    $('session-select').innerHTML = data.sessions.map((item, i) => item.project === session.project
      ? option(i, labelSession(item)) : '').join('');
    $('session-select').value = String(index);
    $('session-scope').textContent = num(session.turns.length) + ui(' 轮 · 截至 #') + session.cut;
    $('session-native').innerHTML = ui`<a href="/analysis-view/trace?staged=1&amp;session=${encodeURIComponent(session.id)}"
      target="_blank" rel="noopener">执行路径 ↗</a>`;
    stepReads = readStepOccupancy(session.occupancy);
    selectedStep = stepReads.findLastIndex(reading => reading.ratio != null);
    $('pressure-inspector').hidden = selectedStep < 0;
    $('pressure-step-status').textContent = '';
    actions = getActions(index);
    compactions = session.work.compactions.flatMap(item => item.actions.map(action =>
      ({ ...action, group: item.seq, atSeq: action.end?.seq ?? action.seq })));
    $('session-tool').innerHTML = option('all', ui('全部工具')) + [...new Set(actions.map(row => row.tool))]
      .sort((a, b) => a.localeCompare(b)).map((name, index) => option(index, name)).join('');
    $('session-error').innerHTML = option('all', ui('全部类型')) + data.categories.map((name, i) =>
      actions.some(row => row.category === i) ? option(i, name) : '').join('');
    render();
  }

  function derive() {
    const tool = $('session-tool').selectedOptions[0]?.textContent;
    const category = $('session-error').value;
    const own = $('session-tool').value === 'all' ? actions : actions.filter(row => row.tool === tool);
    const isError = row => row.status === 1 && (category === 'all' || row.category === Number(category));
    const errors = own.filter(isError), known = own.filter(row => row.status !== 2);
    const paired = known.filter(row => row.ratio != null);
    const groups = new Map();
    for (const row of errors) {
      const key = roundStep(row) + ':' + row.category;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const batches = [...groups.values()].map(rows => rows.sort((a, b) => a.result - b.result))
      .sort((a, b) => b.length - a.length || b[0].result - a[0].result);
    const bins = windowOccupancyBands.map(([end, label], i) => {
      const start = windowOccupancyBands[i - 1]?.[0] ?? 0;
      const rows = paired.filter(row => row.ratio >= start && row.ratio < end), failures = rows.filter(isError);
      return { label, rows, failures, steps: new Set(rows.map(roundStep)).size,
        failedSteps: new Set(failures.map(roundStep)).size };
    }).filter(bin => bin.rows.length);
    return { errors, known, paired, batches, bins };
  }

  function render() {
    view = derive();
    const samples = session.occupancy.points.filter(point => point[2] > 0);
    const windows = [...new Set(samples.map(point => point[2]))];
    const amounts = samples.map(([, used, window]) => windowRatio(used, window));
    const max = amounts.reduce((high, value) => Math.max(high, value), 0);
    const min = amounts.reduce((low, value) => Math.min(low, value), Infinity);
    $('session-overview').innerHTML = metric(ui('上下文窗口'), windows.length === 1 ? num(windows[0]) : windows.length ? num(windows.length) + ui(' 种') : '—',
      windows.length === 1 ? ui('token · 当前会话路由') : windows.length ? ui('按当时模型路由计量') : ui('当前会话缺窗口样本'))
      + metric(ui('会话占用范围'), samples.length ? occupancy(min) + '–' + occupancy(max) : '—', ui('DSH 状态栏回放'))
      + metric(ui('调用有占用记录'), num(view.paired.length), num(view.known.length) + ui(' 次调用有结果'));
    const selectedError = $('session-error');
    $('pressure-legend').innerHTML = dot(ui('窗口占用率'), colors.curve, 'line')
      + (view.errors.some(row => row.category === guard) ? dot(ui('文件修改保护'), colors.guard) : '')
      + (view.errors.some(row => row.category !== guard) ? dot(selectedError.value === 'all' ? ui('其他工具报错')
        : selectedError.selectedOptions[0]?.textContent, colors.error) : '')
      + (compactions.length ? dot(ui('压缩'), colors.compression, 'dashed') : '');
    const note = num(view.errors.length) + ui(' 次所选报错 · ') + num(view.batches.length) + ui(' 组步骤记录');
    $('band-note').textContent = note + (view.errors.some(row => row.ratio == null) ? ui(' · 部分报错缺调用前占用') : '');
    renderBands();
    renderHandoff();
    draw();
  }

  function renderBands() {
    const peak = Math.max(.05, ...view.bins.map(bin => bin.failures.length / bin.rows.length));
    $('pressure-bands').innerHTML = view.bins.length
      ? ui('<div class="band-header"><span>窗口占用</span><span>报错占比</span><span>报错 / 调用</span><span>报错步骤</span></div>')
        + view.bins.map((bin, i) => {
          const share = bin.failures.length / bin.rows.length;
          return `<button class="band-row" type="button" data-pressure-band="${i}">
            <span class="band-name">${esc(bin.label)}</span>
            <span class="band-visual"><span class="band-track" aria-hidden="true"><i style="width:${100 * share / peak}%"></i></span>
              <span class="band-percent">${fraction(bin.failures.length, bin.rows.length)}</span></span>
            <span class="band-value">${num(bin.failures.length)} / ${num(bin.rows.length)}</span>
            <span class="band-value">${num(bin.failedSteps)} / ${num(bin.steps)}</span></button>`;
        }).join('')
      : empty(ui('当前范围没有可对齐的调用结果和窗口占用。'));
    $('pressure-more').hidden = !view.errors.length;
    const batches = view.batches.slice(0, 3).map((batch, i) => {
      const row = batch[0];
      return ui`<button class="row-link" type="button" data-pressure-batch="${i}"><span>
        <strong>${esc(data.categories[row.category] ?? ui('工具报错'))}</strong>
        <small>第 ${row.turn.no} 轮 · ${num(batch.length)} 次 · #${row.result}</small></span>
        <span class="row-value">${occupancy(row.ratio)}</span></button>`;
    });
    if (compactions.length) {
      const item = compactions.at(-1);
      batches.push(ui`<button class="row-link" type="button" data-pressure-compression="${item.group}"><span>
        <strong>最近一次压缩</strong><small>${num(compactions.length)} 次记录 · #${item.atSeq}</small></span>
        <span class="row-value">↗</span></button>`);
    }
    $('pressure-samples').innerHTML = batches.join('') || empty(ui('当前范围没有报错或压缩记录。'));
  }

  function renderHandoff() {
    const children = session.work.children;
    $('session-handoff').hidden = !children.length;
    if (!children.length) return;
    const reported = children.filter(item => item.report);
    $('session-handoff-note').textContent = ui`${num(children.length)} 次委派，${num(reported.length)} 次有回传。${num(reported.filter(item => item.parentReplies > 0).length)} 次回传前，主线仍有模型回复。`;
    $('session-handoff-more').hidden = children.length <= 6;
    $('session-handoff-rows').innerHTML = [...children].reverse().slice(0, 6).map(item => ui`<button class="row-link" type="button" data-pressure-child="${item.seq}">
      <span><strong>子任务 #${item.seq}${item.turn == null ? '' : ui(' · 第 ') + item.turn + ui(' 轮')}</strong>
        <small>${item.report ? ui('回传 #') + item.report.seq + ui(' · 间隔内主线 ') + num(item.parentReplies) + ui(' 次模型回复') : ui('截至快照未见匹配的结算回传')}</small></span>
      <span class="row-value">${item.report ? time(item.elapsed) : ui('待回传记录')}</span></button>`).join('');
  }

  function draw() {
    const host = $('pressure-plot'), points = session.occupancy.points;
    if (!points.some(point => point[2] > 0)) return plotEmpty(host, ui('此会话没有可回放的窗口占用'));
    const f = frame(host);
    if (f.width < 100) return;
    const start = session.turns[0].seq, end = Math.max(start + 1, session.cut);
    const max = Math.max(100, Math.ceil(points.reduce((m, [, used, window]) => Math.max(m, windowRatio(used, window) ?? 0), 0) / 20) * 20);
    const x = seq => f.left + (f.right - f.left) * Math.max(0, Math.min(1, (seq - start) / (end - start)));
    const y = value => f.bottom - (f.bottom - f.top) * value / max;
    const step = Math.ceil(max / 120) * 20;
    const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
    const turnTicks = new Map();
    const n = Math.min(f.width < 460 ? 4 : 7, session.turns.length);
    let priorTick = -Infinity;
    for (let i = 0; i < n; i++) {
      const target = start + i * (end - start) / Math.max(1, n - 1);
      const turn = session.turns.reduce((best, item) => Math.abs(item.seq - target) < Math.abs(best.seq - target) ? item : best);
      if (x(turn.seq) - priorTick < 52) continue;
      turnTicks.set(turn.seq, turn.no + ui(' 轮'));
      priorTick = x(turn.seq);
    }
    const segments = [];
    let segment = null, capacity = null;
    for (const point of points) {
      const value = windowRatio(point[1], point[2]);
      if (value == null) { segment = null; continue; }
      if (!segment || capacity !== point[2]) {
        segment = [];
        segments.push(segment);
        capacity = point[2];
      }
      segment.push([x(point[0]), y(value)]);
    }
    const track = segments.map(segment => {
      const path = segment.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
      if (segment.length === 1) {
        const [x, y] = segment[0];
        return `<circle cx="${x}" cy="${y}" r="2" fill="${colors.curve}"/>`;
      }
      return `<path class="pressure-area" d="${path} L${segment.at(-1)[0]} ${f.bottom} L${segment[0][0]} ${f.bottom} Z"/>
        <path class="pressure-path" d="${path}"/>`;
    }).join('');
    const compressionMarks = compactions.map(item => {
      const point = points.findLast(point => point[0] <= item.atSeq);
      return { item, x: x(item.atSeq), y: point?.[2] > 0 ? y(windowRatio(point[1], point[2])) : f.top + 7 };
    });
    const failed = view.batches.map(batch => ({ batch, row: batch.find(row => row.ratio != null) }))
      .filter(mark => mark.row).map(mark => ({ ...mark, x: x(mark.row.result), y: y(mark.row.ratio) }));
    const markings = compressionMarks.map(mark => line(mark.x, f.top, mark.x, f.bottom, 'compression-line')
      + `<rect class="data-dot pressure-compression" x="${mark.x - 3.5}" y="${mark.y - 3.5}" width="7" height="7" rx="1.5" fill="${colors.compression}"/>`).join('')
      + failed.map(mark => circle(mark, mark.row.category === guard ? colors.guard : colors.error, mark.batch.length > 1 ? 5.4 : 3.7, .88)).join('');
    const axes = xGrid(f, [...turnTicks.keys()], x, seq => turnTicks.get(seq), false) + yGrid(f, ticks, y, pct => pct + '%');
    const guideMarkup = selectedStep < 0 ? '' : `<g class="pressure-step-cursor" hidden><line y1="${f.top}" y2="${f.bottom}"/><circle r="4"/></g>`;
    function stepAt(point) {
      if (point.x < f.left || point.x > f.right || point.y < f.top || point.y > f.bottom) return null;
      const seq = start + (point.x - f.left) / (f.right - f.left) * (end - start);
      let lo = 0, hi = stepReads.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (stepReads[mid].seq < seq) lo = mid + 1;
        else hi = mid;
      }
      const before = stepReads[lo - 1], after = stepReads[lo];
      return !after || (before && seq - before.seq <= after.seq - seq) ? lo - 1 : lo;
    }
    const svg = showPlot(host, f, ui('上下文窗口占用率时间线，标注工具报错和压缩。'), track + axes + guideMarkup + markings,
      [...compressionMarks, ...failed], (mark, overlap) => mark.item
        ? [ui('压缩 #') + mark.item.atSeq, ui('点击核对压缩前后请求')]
        : [data.categories[mark.row.category] ?? ui('工具报错'),
          ui('第 ') + mark.row.turn.no + ui(' 轮 · ') + occupancy(mark.row.ratio) + ' · ' + num(mark.batch.length) + ui(' 次')
            + (overlap.filter(item => item.batch).length > 1 ? ui(' · 附近还有报错') : '')],
      (mark, overlap) => {
        if (mark.item) return openWork('compactions', current, mark.item.group);
        const rows = [...new Set(overlap.filter(item => item.batch).flatMap(item => item.batch))];
        openActions(ui('窗口占用下的报错'), ui('调用开始前的窗口占用 · ') + num(rows.length) + ui(' 次报错'), rows);
      }, guideMarkup ? {
        preview: point => showStep(stepAt(point) ?? selectedStep),
        reset: () => showStep(selectedStep),
        select: point => {
          const index = stepAt(point);
          if (index != null) pinStep(index, true);
        },
      } : null);
    if (!guideMarkup) return;

    const guide = svg.querySelector('.pressure-step-cursor');
    const readingDot = guide.lastElementChild;
    let visibleStep;
    showStep = index => {
      if (index === visibleStep) return;
      visibleStep = index;
      const reading = stepReads[index];
      $('pressure-step-label').textContent = stepLabel(reading);
      $('pressure-step-percent').textContent = occupancy(reading.ratio);
      $('pressure-step-tokens').textContent = reading.ratio == null ? ui('暂无占用读数')
        : `${num(reading.used)} / ${num(reading.window)} token`;
      guide.setAttribute('transform', `translate(${x(reading.seq)} 0)`);
      readingDot.toggleAttribute('hidden', reading.ratio == null);
      if (reading.ratio != null) readingDot.setAttribute('cy', y(reading.ratio));
    };
    guide.removeAttribute('hidden');
    pinStep(selectedStep);
  }

  $('session-project').innerHTML = data.projects.map((project, i) => option(i, project.name)).join('');
  $('session-project').addEventListener('change', event => select(data.sessions.findIndex(session => session.project === Number(event.target.value))));
  $('session-select').addEventListener('change', event => select(Number(event.target.value)));
  $('pressure-prev').addEventListener('click', () => pinStep(selectedStep - 1, true));
  $('pressure-next').addEventListener('click', () => pinStep(selectedStep + 1, true));
  for (const name of ['session-tool', 'session-error']) $(name).addEventListener('change', render);
  $('session-page').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const { pressureBand, pressureBatch, pressureCompression, pressureChild } = button.dataset;
    if (pressureBand != null) {
      const band = view.bins[Number(pressureBand)];
      openActions(band.label + ui(' 的调用'), num(band.failures.length) + ui(' 次报错 / ') + num(band.rows.length) + ui(' 次有结果调用'),
        band.failures.length ? band.failures : band.rows);
    } else if (pressureBatch != null) {
      const batch = view.batches[Number(pressureBatch)];
      openActions(data.categories[batch[0].category] ?? ui('工具报错'), num(batch.length) + ui(' 次报错 · 第 ') + batch[0].turn.no + ui(' 轮'), batch);
    } else if (pressureCompression != null) openWork('compactions', current, Number(pressureCompression));
    else if (pressureChild != null) openWork('children', current, Number(pressureChild));
    else if (button.id === 'pressure-more') openActions(ui('会话报错记录'), num(view.errors.length) + ui(' 次所选报错'), view.errors);
    else if (button.id === 'session-handoff-more') openWork('children', current);
  });
  return { select, draw };
}
