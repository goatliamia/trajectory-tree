(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const reload = () => location.reload();
  $('overview-refresh').addEventListener('click', reload);
  $('overview-retry').addEventListener('click', reload);
  async function loadOverview() {
    const response = await fetch('/analysis-view/overview-data', { cache: 'no-store' });
    if (!response.ok || !response.body) throw new Error('overview response');
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '', data, complete = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const row = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          if (row.type === 'start') data = { ...row, sessions: [] };
          if (row.type === 'session') {
            if (row.session) data.sessions.push(row.session);
            $('overview-progress').textContent = ui`正在读取会话 · ${row.done} / ${data.total}`;
          }
          if (row.type === 'complete') {
            Object.assign(data, { models: row.models, categories: row.categories, unread: row.unread });
            complete = true;
          }
        }
      }
    } finally { await reader.cancel().catch(() => {}); }
    if (!data || !complete) throw new Error('incomplete overview');
    data.sessions.sort((a, b) => b.turns.at(-1).at - a.turns.at(-1).at);
    return data;
  }
  let data;
  try { data = $('overview-data') ? JSON.parse($('overview-data').textContent) : await loadOverview(); }
  catch {
    $('overview-progress').textContent = ui('暂时无法读取会话总览。');
    $('overview-retry').hidden = false;
    return;
  }
  const portable = Boolean(data.host && data.host !== 'dsh');
  const hasUsage = data.sessions.some(session => session.turns.some(turn => turn.requests.length));
  const hasRequestWindows = data.sessions.some(session => session.turns.some(turn => turn.requests.some(request => request.window && request.input != null)));
  data.categories = data.categories.map(label => ui(label));
  const rows = data.sessions.flatMap((session, sessionIndex) =>
    session.turns.map(turn => ({ ...turn, session: sessionIndex, project: session.project })))
    .sort((a, b) => a.at - b.at)
    .map((turn, index) => ({ ...turn, id: index }));
  const roundsBySession = data.sessions.map(() => new Map());
  for (const turn of rows) roundsBySession[turn.session].set(turn.no, turn);
  const actionsBySession = data.sessions.map((session, index) =>
    readOccupancyActions(session.occupancy, turn => roundsBySession[index].get(turn)));
  const hasToolModels = actionsBySession.some(actions => actions.some(action => action.model));
  const actionsByTurn = rows.map(() => []);
  for (const actions of actionsBySession) for (const action of actions) actionsByTurn[action.turn.id].push(action);
  const workItems = data.sessions.flatMap((session, sessionIndex) => Object.entries(session.work)
    .flatMap(([kind, items]) => items.map(item => ({ ...item, kind, session: sessionIndex,
      project: session.project, round: roundsBySession[sessionIndex].get(item.turn) ?? null }))))
    .map((item, id) => ({ ...item, id }));
  const counts = new Map();
  for (const turn of rows) for (const request of turn.requests) {
    if (request.model) counts.set(request.model, (counts.get(request.model) ?? 0) + 1);
  }
  const routeOrder = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
  const colors = ['#1860e2', '#2e864d', '#b86b13', '#bd5040', '#087f83', '#963c20', '#196d98', '#998314'];
  const colorByRoute = new Map(routeOrder.map((route, index) => [route, colors[index % colors.length]]));
  const unknownTone = '#446b91';
  const tone = route => colorByRoute.get(route) ?? unknownTone;
  const toneStyle = route => `--series:${tone(route)}`;
  const ink = { wait: '#296ee3', median: '#1156d2', tail: '#068170', paired: '#087d69', unpaired: '#ae690f' };
  const outcomes = {
    completed: [ui('正常结束'), '#2874de'], aborted: [ui('中止'), '#bd791c'], interrupted: [ui('中断'), '#16897b'],
    error: [ui('以错误结束'), '#bf5142'], open: [ui('未记录结束'), '#6689b0'], other: [ui('其他结束状态'), '#486d87'],
  };
  const goalStates = {
    complete: [ui('已标记完成'), '#16897b'], active: [ui('进行中'), '#2874de'], paused: [ui('暂停'), '#bd791c'],
    blocked: [ui('受阻'), '#bf5142'], cleared: [ui('已清除'), '#6689b0'], other: [ui('其他状态'), '#486d87'],
  };
  const state = { project: 'all', period: portable ? 'all' : '30', model: 'all', scenario: 'lookup', toolMode: 'all', feedback: 'all', input: '20000', expanded: false,
    windowMode: portable && !hasUsage ? 'tool' : 'model', windowDimension: portable ? 'input' : 'occupancy', windowRoute: '', windowTool: '', windowError: '' };
  const scenarioInputs = { lookup: '20000', feedback: 'all', change: 'all', direct: '20000' };
  const toolModeNames = { native: ui('普通调用'), ptc: 'PTC', mixed: ui('混合') };
  const scenarioDescriptions = {
    lookup: ui('从包含文件查找或读取的请求出发，看动作怎么组合，以及之后有没有修改同一个文件。'),
    feedback: ui('从相同类型的工具反馈出发，看下一次模型回复采取了什么动作。'),
    change: ui('从有明确文件目标的修改出发，看前序读取、同文件读回和后续显式检查。'),
    direct: ui('在无工具调用的轮次里，对照第一段正文出现的时间、正文长度和用量。'),
  };
  const feedbackLabels = {
    read: [ui('补读同一目标'), '#198370'], same: [ui('同参再试'), '#c38020'], changed: [ui('改参再试'), '#2f70d6'],
    other: [ui('换用其他工具'), '#5c9edf'], reply: [ui('后续回复无工具'), '#8ebdc9'], ended: [ui('本轮无后续请求'), '#9bb7d6'],
  };
  const actionBuckets = [[ui('1 个'), '#b9d5fa'], [ui('2 个'), '#6fa7ed'], [ui('3–4 个'), '#347bda'], [ui('5 个以上'), '#1455ba']];
  const day = 86_400_000, shanghai = 8 * 3_600_000;
  const startDay = time => Math.floor((time + shanghai) / day) * day - shanghai;
  const firstDay = startDay(workItems.reduce((min, row) => Math.min(min, row.round?.at ?? row.at), rows[0]?.at ?? data.latest));
  const lastDay = startDay(data.latest);
  const until = lastDay + day;
  const format = new Intl.NumberFormat('en-US');
  const dayFormat = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' });
  const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Shanghai', hour12: false });
  const num = n => n == null ? '—' : format.format(n);
  const small = n => n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(n < 10e6 ? 2 : 1) + 'M'
    : n >= 1000 ? (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k' : num(n);
  const fixed = (n, precision) => Number(n.toFixed(precision)).toString();
  const time = (ms, precision = 1) => {
    if (!Number.isFinite(ms)) return '—';
    if (ms < 1000) return num(Math.round(ms)) + 'ms';
    if (ms < 60_000) return fixed(ms / 1000, precision) + 's';
    const seconds = Math.round(ms / 1000);
    return seconds >= 3600 ? Math.floor(seconds / 3600) + 'h ' + Math.floor(seconds / 60) % 60 + 'm'
      : Math.floor(seconds / 60) + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
  };
  const tickTime = ms => ms === 0 ? '0' : ms >= 3_600_000 ? fixed(ms / 3_600_000, 1) + 'h'
    : ms >= 60_000 ? fixed(ms / 60_000, 1) + 'm' : ms >= 1000 ? fixed(ms / 1000, 1) + 's' : ms + 'ms';
  const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const q = (values, p) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
  };
  const outputTotal = values => values.length ? values.reduce((a, b) => a + b, 0) : null;
  const shortSession = turn => data.sessions[turn.session].id.replace(/^session-/, '').slice(0, 8);
  const workspace = turn => data.projects[turn.project].name || ui('未记录项目');
  const outcomeOf = turn => turn.endSeq == null ? 'open' : Object.hasOwn(outcomes, turn.reason) ? turn.reason : 'other';
  const fraction = (n, d) => d > 0 && n != null ? fixed(100 * n / d, 1) + '%' : '—';
  const modelName = id => id ? data.models[id].name : ui('未记录路由');
  const modelRoute = id => [modelName(id), data.models[id].provider].filter(Boolean).join(' · ');
  const legendName = id => data.models.filter(model => model.name === modelName(id)).length > 1 ? modelRoute(id) : modelName(id);
  const plural = (n, unit) => num(n) + ' ' + unit;
  const seq = n => n == null ? '—' : '<code class="seq">#' + n + '</code>';
  const empty = label => `<p class="empty-text">${esc(label)}</p>`;
  const dot = (label, color, variant = '') =>
    `<span><i class="${variant}" style="--series:${color}" aria-hidden="true"></i>${esc(label)}</span>`;
  const option = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;

  $('snapshot').textContent = ui('截至 ') + dayFormat.format(data.latest)
    + (data.unread ? ' · ' + num(data.unread) + ui(' 段未读取') : '') + (data.more ? ui(' · 最近记录') : '')
    + (data.sessions.some(session => session.synthetic) ? ui(' · 含模拟记录') : '');
  $('project').innerHTML = option('all', ui('全部项目')) + data.projects.map((project, i) => option(i, project.name || ui('未记录项目'))).join('');
  $('period').value = state.period;
  $('model').innerHTML = option('all', ui('全部模型')) + routeOrder.map(id => option(id, modelRoute(id))).join('')
    + (rows.some(turn => !turn.model) ? option(0, modelName(0)) : '');
  $('tool-mode').innerHTML = option('all', ui('全部')) + Object.entries(toolModeNames)
    .filter(([mode]) => rows.some(turn => turn.requests.some(request => request.toolMode === mode)))
    .map(([mode, label]) => option(mode, label)).join('');
  $('feedback-type').innerHTML = option('all', ui('全部类型')) + data.categories.map((name, id) => option(id, name)).join('');
  $('window-route').innerHTML = option('', ui('全部模型')) + routeOrder.map(id => option(id, modelRoute(id))).join('');
  $('window-tool').innerHTML = option('', ui('全部工具')) + [...new Set(actionsBySession.flatMap(actions => actions.map(action => action.tool)))]
    .sort((a, b) => a.localeCompare(b)).map(name => option(name, name)).join('');
  $('window-error').innerHTML = option('', ui('全部类型')) + data.categories.map((name, id) => option(id, name)).join('');
  $('wait-legend').innerHTML = dot(ui('单轮'), ink.wait) + dot(ui('日 P50'), ink.median, 'line') + dot(ui('日 P90'), ink.tail, 'dashed');
  $('error-legend').innerHTML = dot(ui('有同参返回样本'), ink.paired) + dot(ui('无同参返回样本'), ink.unpaired, 'hollow');

  let view;
  const inputEnds = { 0: 20_000, 20000: 80_000, 80000: 160_000, 160000: Infinity };
  const outputBins = [
    [128, '<128'], [256, '128–255'], [512, '256–511'], [1000, '512–999'],
    [2000, '1–2k'], [4000, '2–4k'], [Infinity, '≥4k'],
  ];
  const feedbackOf = request => (request.behavior?.feedback ?? []).filter(row =>
    state.feedback === 'all' || row.category === Number(state.feedback));
  function isInCohort({ turn, request }) {
    if (state.model !== 'all' && request.model !== Number(state.model)) return false;
    if (!request.model) return false;
    if (state.scenario === 'direct') {
      if (turn.calls || request.type !== 'direct' || (turn.bodySeq != null && request.seq !== turn.bodySeq)) return false;
    } else {
      if (request.type !== 'tools' || (state.toolMode !== 'all' && request.toolMode !== state.toolMode)) return false;
      if (state.scenario === 'feedback' ? !feedbackOf(request).length : !request.behavior?.[state.scenario]) return false;
    }
    if (state.input === 'all') return true;
    return Number.isFinite(request.input) && request.input >= Number(state.input) && request.input < inputEnds[state.input];
  }

  let windowView;
  function deriveWindow(turns, modelMode) {
    const inputMode = modelMode && state.windowDimension === 'input';
    const toolGroups = portable && !modelMode;
    const bands = inputMode ? [[20_000, '<20k'], [80_000, '20–80k'], [160_000, '80–160k'], [Infinity, '≥160k']] : windowOccupancyBands;
    const bins = bands.map(([upper, label]) => ({ upper, label, items: [] }));
    const candidates = modelMode ? turns.flatMap(turn => turn.requests.map(request => ({ turn, request, model: request.model,
      ratio: windowRatio(request.input, request.window?.[0]), dimension: state.windowDimension,
      measurement: inputMode ? request.input : windowRatio(request.input, request.window?.[0]) })))
      : turns.flatMap(turn => actionsByTurn[turn.id]).filter(action => action.status !== 2
        && (!state.windowTool || state.windowTool === action.tool));
    const route = toolGroups && !hasToolModels ? '' : state.windowRoute;
    const scoped = candidates.filter(item => !route || item.model === Number(route));
    if (toolGroups) {
      const groups = new Map();
      for (const item of scoped) {
        if (!groups.has(item.tool)) groups.set(item.tool, { label: item.tool, items: [] });
        groups.get(item.tool).items.push(item);
      }
      return { bins: [...groups.values()].sort((a, b) => b.items.length - a.items.length), total: scoped.length,
        measured: scoped.length, sessions: new Set(scoped.map(item => item.turn.session)).size };
    }
    const sessions = new Set();
    let measured = 0;
    for (const item of scoped) {
      const value = modelMode ? item.measurement : item.ratio;
      if (!Number.isFinite(value)) continue;
      bins.find(bin => value < bin.upper).items.push(item);
      sessions.add(item.turn.session);
      measured++;
    }
    return { bins, total: scoped.length, measured, sessions: sessions.size };
  }

  function derive() {
    const since = state.period === 'all' ? firstDay : until - Number(state.period) * day;
    const turns = rows.filter(turn => turn.at >= since
      && (state.project === 'all' || turn.project === Number(state.project))
      && (state.model === 'all' || turn.model === Number(state.model)));
    const waits = turns.filter(turn => Number.isFinite(turn.wait)).sort((a, b) => b.wait - a.wait || b.at - a.at);
    const tools = turns.filter(turn => turn.calls > 0);
    const errors = turns.flatMap(turn => turn.errors.map(error => ({ error, turn })));
    const requests = turns.flatMap(turn => turn.requests.map(request => ({ turn, request })));
    const cohort = requests.filter(isInCohort);
    const grouped = new Map();
    for (const pair of cohort) {
      const { model, effort, toolMode } = pair.request;
      const key = JSON.stringify([model, effort, toolMode]);
      if (!grouped.has(key)) grouped.set(key, { model, effort, toolMode, requests: [] });
      grouped.get(key).requests.push(pair);
    }
    const cohorts = [...grouped.values()].sort((a, b) => b.requests.length - a.requests.length);
    const bins = outputBins.map(([limit, label]) => ({ limit, label, requests: [] }));
    for (const pair of cohort) {
      if (Number.isFinite(pair.request.output)) bins.find(bin => pair.request.output < bin.limit).requests.push(pair);
    }
    const groupedErrors = new Map();
    for (const item of errors) {
      const id = item.error.category;
      if (!groupedErrors.has(id)) groupedErrors.set(id, { id, items: [], turns: new Set(), paired: 0 });
      const group = groupedErrors.get(id);
      group.items.push(item);
      group.turns.add(item.turn.id);
      group.paired += Number(item.error.returned != null);
    }
    const categories = [...groupedErrors.values()].map(group => ({
      ...group, recovery: q(group.items.map(({ error }) => error.recovery), .5),
    })).sort((a, b) => b.turns.size - a.turns.size || b.items.length - a.items.length);
    return { since, turns, waits, tools, errors, cohort, cohorts, bins, categories,
      work: deriveWork(turns, since) };
  }

  function deriveWork(turns, since) {
    const work = { goals: [], deliveries: [], children: [], compactions: [] };
    const visibleTurns = new Set(turns.map(turn => turn.id));
    for (const item of workItems) {
      const inScope = item.round ? visibleTurns.has(item.round.id)
        : state.model === 'all' && (state.project === 'all' || item.project === Number(state.project))
          && item.at >= since && item.at < until;
      if (inScope) work[item.kind].push(item);
    }
    work.deliveries.sort((a, b) => b.at - a.at);
    const sessions = new Set([...turns.map(turn => turn.session),
      ...Object.values(work).flatMap(items => items.map(item => item.session))]);
    const phases = Object.fromEntries(Object.keys(outcomes).map(phase => [phase, []]));
    for (const turn of turns) phases[outcomeOf(turn)].push(turn);
    const byEnd = Object.entries(phases).map(([phase, own]) => {
      const spans = own.map(turn => turn.end).filter(Number.isFinite);
      return { phase, turns: own, measured: spans.length, elapsed: outputTotal(spans) };
    }).filter(group => group.turns.length);
    return { ...work, sessions, byEnd, elapsed: outputTotal(byEnd.map(group => group.elapsed).filter(Number.isFinite)),
      measured: byEnd.reduce((total, group) => total + group.measured, 0) };
  }

  const metric = (label, value, note, unit = '') => `<div class="metric"><div class="metric-label">${label}</div>
    <div class="metric-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div><div class="metric-note">${note}</div></div>`;
  function renderOverview() {
    const { turns, waits, since, work } = view;
    const waitTimes = waits.map(turn => turn.wait);
    const sessions = work.sessions.size;
    const projects = new Set([...work.sessions].map(id => data.sessions[id].project)).size;
    const deliverySessions = new Set(work.deliveries.map(item => item.session)).size;
    const files = work.deliveries.reduce((sum, item) => sum + item.files, 0);
    const marked = work.goals.filter(goal => goal.phase === 'complete').length;
    const stoppedGroups = work.byEnd.filter(group => ['aborted', 'interrupted', 'error'].includes(group.phase));
    const stopped = stoppedGroups.reduce((sum, group) => sum + group.turns.length, 0);
    const stopTime = stopped ? outputTotal(stoppedGroups.map(group => group.elapsed).filter(Number.isFinite)) : 0;
    const stoppedNote = turns.length
      ? fraction(stopped, turns.length) + ui(' 的轮次') + (work.elapsed > 0 && stopTime != null ? ' · ' + fraction(stopTime, work.elapsed) + ui(' 的已记录用时') : '')
      : ui('当前范围没有轮次');
    $('scope').textContent = ui`${dayFormat.format(since)} – ${dayFormat.format(data.latest)} · ${projects} 个项目 · ${sessions} 段会话`;
    if (portable) {
      const requests = turns.flatMap(turn => turn.requests);
      const tools = turns.flatMap(turn => actionsByTurn[turn.id]).filter(action => action.status !== 2);
      $('overview').innerHTML = metric(ui('轮次'), num(turns.length), ui`${num(sessions)} 段会话`)
        + metric(ui('模型用量记录'), num(requests.length), ui`${num(requests.filter(row => row.input != null).length)} 次有输入量`)
        + metric(ui('工具调用有结果'), num(tools.length), ui`${num(view.errors.length)} 次工具报错`)
        + metric(ui('轮次用时 P50'), time(q(turns.map(turn => turn.end), .5)), ui`${num(work.measured)} 轮有计时`);
      return;
    }
    $('overview').innerHTML =
      metric(ui('有交付登记的会话'), sessions ? num(deliverySessions) + ' / ' + num(sessions) : '—',
        ui`${num(work.deliveries.length)} 次登记 · ${num(files)} 个产物条目`)
      + metric(ui('本期新建目标'), num(work.goals.length), ui`${num(marked)} 个已标记完成`, ui('个'))
      + metric(ui('中止、中断或错误'), num(stopped), stoppedNote, ui('轮'))
      + metric(ui('首段正文 P50'), time(q(waitTimes, .5)), ui`P90 ${time(q(waitTimes, .9))} · ${num(waits.length)} 轮有计时`);
  }

  function renderWork() {
    const { work, turns } = view;
    $('outcome-count').textContent = ui`${num(turns.length)} 轮 · ${num(work.measured)} 轮有起止`;
    const band = (label, sum, getValue) => sum > 0 ? `<div class="outcome-band"><span>${label}</span>
      <div role="img" aria-label="${work.byEnd.map(group => outcomes[group.phase][0] + ' ' + fraction(getValue(group), sum)).join('，')}">
      ${work.byEnd.filter(group => getValue(group) > 0).map(group =>
        `<i style="width:${100 * getValue(group) / sum}%;--series:${outcomes[group.phase][1]}" title="${outcomes[group.phase][0]} · ${fraction(getValue(group), sum)}"></i>`).join('')}</div></div>` : '';
    $('outcome-chart').innerHTML = band(ui('轮次占比'), turns.length, group => group.turns.length)
      + band(ui('用时占比'), work.elapsed, group => group.elapsed);
    $('outcome-rows').innerHTML = work.byEnd.length
      ? ui('<div class="outcome-columns"><span>结束状态</span><span>轮次</span><span>累计经过</span><span>用时占比</span></div>')
        + work.byEnd.map(group => {
          const [label, color] = outcomes[group.phase];
          return `<button class="row-link" type="button" data-end="${group.phase}">
            <strong class="category-name"><i class="mark-dot" style="--series:${color}" aria-hidden="true"></i><span>${label}</span></strong>
            <span class="row-value">${num(group.turns.length)}</span><span class="row-value">${time(group.elapsed)}</span>
            <span class="row-value">${fraction(group.elapsed, work.elapsed)}</span></button>`;
        }).join('')
      : empty(ui('这个范围没有轮次。'));
    $('goal-count').textContent = num(work.goals.length) + ui(' 个新建目标');
    $('goal-progress').innerHTML = Object.entries(goalStates).map(([phase, [label, color]]) => {
      const count = work.goals.filter(item => item.phase === phase).length;
      return count ? `<button class="goal-state" type="button" data-goal="${phase}">
        <i class="mark-dot" style="--series:${color}" aria-hidden="true"></i>${label}<b>${num(count)}</b></button>` : '';
    }).join('') || empty(ui('这个范围没有新建目标。'));
    $('deliveries-more').hidden = work.deliveries.length === 0;
    $('delivery-rows').innerHTML = work.deliveries.slice(0, 3).map(item => workLink(item)).join('')
      || empty(ui('这个范围没有交付登记。'));
  }

  const turnTitle = turn => ui`<strong class="round-title"><span title="${esc(workspace(turn))}">${esc(workspace(turn))}</span><span>第 ${turn.no} 轮</span></strong>`;
  function turnLink(turn, value, description) {
    return `<button class="row-link" type="button" data-turn="${turn.id}">
      <span>${turnTitle(turn)}<small>${esc(description)}</small></span>
      <span class="row-value">${esc(value)}</span></button>`;
  }

  function renderLists() {
    $('outliers').innerHTML = view.waits.slice(0, 4).map(turn =>
      turnLink(turn, time(turn.wait), `${modelName(turn.model)} · ${dayFormat.format(turn.at)}`)).join('')
      || empty(ui('这个范围没有正文计时记录。'));
    $('wait-list').hidden = view.waits.length === 0;
    const affected = view.tools.filter(turn => turn.errors.length).length;
    const counts = globalThis.__trajectoryFailureCounts(view.errors.map(({ error }) => error.attribution));
    const coverage = globalThis.__trajectoryFailureCoverageText(counts);
    const detail = ui`${num(view.errors.length)} 次报错，涉及 ${num(affected)} / ${num(view.tools.length)} 个工具轮。纵轴是同参返回的中位间隔。`;
    $('error-description').textContent = [coverage, detail].filter(Boolean).join(' · ');
    $('error-rows').innerHTML = view.categories.map(group => {
      const color = group.recovery == null ? ink.unpaired : ink.paired;
      return ui`<button class="row-link" type="button" data-error="${group.id}">
        <strong class="category-name"><i class="mark-dot ${group.recovery == null ? 'hollow' : ''}" style="--series:${color}"></i><span>${esc(data.categories[group.id])}</span></strong>
        <small>${num(group.turns.size)} 轮${group.recovery != null ? ' · P50 ' + time(group.recovery) : ''}</small>
        <span class="row-value">${num(group.paired)} / ${num(group.items.length)}</span></button>`;
    }).join('') || empty(ui('这个范围没有记录到工具报错。'));
  }

  const sum = values => values.reduce((total, value) => total + value, 0);
  const countRatio = (count, total) => total
    ? `<strong class="number">${fraction(count, total)}</strong><small>${num(count)} / ${num(total)}</small>` : '<span class="number">—</span>';
  const caseScore = ({ request, turn }) => {
    const b = request.behavior;
    if (state.scenario === 'lookup') return (b.lookup.linked ? 100 : 0) + b.actions;
    if (state.scenario === 'feedback') return Math.max(...feedbackOf(request).map(item =>
      (item.returned != null ? 100 : 0) + (item.kind === 'read' ? 20 : 0) + item.errors));
    if (state.scenario === 'change') return (b.change.check != null ? 100 : 0) + 10 * b.change.after + b.change.before;
    return turn.wait ?? 0;
  };
  const profileStrip = (parts, total) => `<span class="strip" aria-hidden="true">${parts
    .filter(part => part[0]).map(([count, label, color]) => `<i title="${esc(label)} · ${num(count)}" style="width:${100 * count / total}%;--series:${color}"></i>`).join('')}</span>`;
  const behaviorCell = (label, contents) => `<span><small class="cell-label">${label}</small>${contents}</span>`;
  let examples = [];
  function renderBehavior() {
    const scenario = state.scenario;
    $('model-description').textContent = scenarioDescriptions[scenario];
    $('tool-mode-control').hidden = scenario === 'direct';
    $('feedback-control').hidden = scenario !== 'feedback';
    const columns = {
      lookup: [ui('单次动作数'), ui('实际并行'), ui('同文件后续修改')],
      feedback: [ui('下一次模型回复'), ui('补读同一目标'), ui('同参后续返回')],
      change: [ui('同文件前读'), ui('同文件读回'), ui('随后有检查')],
      direct: [ui('首段正文 P50'), ui('正文字符 P50'), ui('输出 token P50')],
    }[scenario];
    const groups = state.expanded ? view.cohorts : view.cohorts.slice(0, 5);
    function values(pairs) {
      if (scenario === 'lookup') {
        const samples = pairs.map(({ request }) => request.behavior), counts = samples.map(row => row.actions);
        const countsBySize = [counts.filter(n => n === 1).length, counts.filter(n => n === 2).length,
          counts.filter(n => n >= 3 && n <= 4).length, counts.filter(n => n >= 5).length];
        const linked = samples.filter(row => row.lookup.linked);
        return [
          profileStrip(actionBuckets.map(([label, color], index) => [countsBySize[index], label, color]), counts.length)
            + ui`<small>中位 ${num(q(counts, .5))} · P90 ${num(q(counts, .9))}</small>`,
          countRatio(samples.filter(row => row.overlap).length, samples.filter(row => row.overlap != null).length),
          countRatio(linked.length, samples.filter(row => row.lookup.files > 0).length),
        ];
      }
      if (scenario === 'feedback') {
        const feedback = pairs.flatMap(({ request }) => feedbackOf(request));
        const parts = Object.entries(feedbackLabels).map(([key, [label, color]]) =>
          [feedback.filter(row => row.kind === key).length, label, color]).filter(row => row[0]);
        const leading = [...parts].sort((a, b) => b[0] - a[0])[0];
        return [
          profileStrip(parts, feedback.length) + `<small>${esc(leading?.[1] ?? '')} · ${num(leading?.[0] ?? 0)} / ${num(feedback.length)}</small>`,
          countRatio(feedback.filter(row => row.kind === 'read').length, feedback.length),
          countRatio(feedback.filter(row => row.returned != null).length, feedback.length),
        ];
      }
      if (scenario === 'change') {
        const changes = pairs.map(({ request }) => request.behavior.change);
        const files = sum(changes.map(row => row.files));
        return [
          countRatio(sum(changes.map(row => row.before)), files),
          countRatio(sum(changes.map(row => row.after)), files),
          countRatio(changes.filter(row => row.check != null).length, changes.length),
        ];
      }
      return [
        `<strong class="number">${time(q(pairs.map(({ turn }) => turn.wait), .5))}</strong>`,
        `<strong class="number">${num(q(pairs.map(({ turn }) => turn.chars), .5))}</strong>`,
        `<strong class="number">${num(q(pairs.map(({ request }) => request.output), .5))}</strong>`,
      ];
    }
    $('behavior').innerHTML = groups.length ? ui`<div class="behavior-columns"><span>模型与样本</span>${columns.map(name => `<span>${name}</span>`).join('')}</div>`
      + groups.map((group, index) => ui`<button class="behavior-line" type="button" data-cohort="${index}">
        <span><strong class="behavior-name">${esc(modelName(group.model))}</strong>
          <small>${esc(data.models[group.model].provider)} · ${esc(group.effort ?? ui('档位未记录'))}${group.toolMode ? ' · ' + toolModeNames[group.toolMode] : ''}</small>
          <small>${num(group.requests.length)} 次请求 · ${new Set(group.requests.map(({ turn }) => turn.session)).size} 段会话</small></span>
        ${values(group.requests).map((value, col) => behaviorCell(columns[col], value)).join('')}</button>`).join('')
      + (view.cohorts.length > 5 ? `<button class="text-button behavior-more" type="button" data-action="models">
        ${state.expanded ? ui('收起') : ui('展开 ') + num(view.cohorts.length) + ui(' 组')}</button>` : '')
      : empty(ui('当前项目、输入范围和场景下没有可对照的请求。'));
    const activeFeedback = new Set(view.cohort.flatMap(({ request }) => feedbackOf(request).map(row => row.kind)));
    const legend = scenario === 'lookup' ? actionBuckets
      : scenario === 'feedback' ? Object.entries(feedbackLabels).filter(([key]) => activeFeedback.has(key)).map(([, value]) => value) : [];
    $('behavior-legend').innerHTML = view.cohort.length ? legend.map(([label, color]) => dot(label, color)).join('') : '';
    const routes = new Set();
    examples = [];
    for (const group of view.cohorts) {
      if (routes.has(group.model)) continue;
      routes.add(group.model);
      examples.push([...group.requests].sort((a, b) => caseScore(b) - caseScore(a) || b.turn.at - a.turn.at)[0]);
      if (examples.length === 3) break;
    }
    $('behavior-examples').innerHTML = examples.map(({ turn, request }, index) => {
      const value = scenario === 'lookup' ? num(request.behavior.actions) + ui(' 个动作')
        : scenario === 'feedback' ? feedbackLabels[feedbackOf(request)[0].kind][0]
        : scenario === 'change' ? request.behavior.change.check != null ? ui('有显式检查')
          : num(request.behavior.change.files) + ui(' 个文件') : time(turn.wait);
      return ui`<button class="row-link" type="button" data-case="${index}">
        <span><strong>${esc(legendName(request.model))}</strong><small>${esc(workspace(turn))} · 第 ${turn.no} 轮 · #${request.seq}</small></span>
        <span class="row-value">${esc(value)}</span></button>`;
    }).join('') || empty(ui('这里会显示对应的实录样本。'));
  }

  function renderCohort() {
    const { cohort, cohorts, bins } = view;
    const measured = bins.reduce((sum, bin) => sum + bin.requests.length, 0);
    $('token-count').textContent = num(measured) + ui(' 次请求');
    const peak = Math.max(0, ...bins.map(bin => bin.requests.length));
    $('histogram').innerHTML = peak ? '<div class="hist-bars">' + bins.map((bin, index) => {
      const parts = new Map();
      for (const { request } of bin.requests) parts.set(request.model, (parts.get(request.model) ?? 0) + 1);
      const ordered = [...parts].sort((a, b) => routeOrder.indexOf(a[0]) - routeOrder.indexOf(b[0]));
      const count = bin.requests.length;
      const title = ordered.map(([id, size]) => modelRoute(id) + ' · ' + num(size)).join('\n');
      return ui`<button class="hist-bar" type="button" data-bin="${index}" ${count ? '' : 'disabled'}
        aria-label="${esc(bin.label)} token，${num(count)} 次请求" title="${esc(title)}">
        <span><b>${num(count)}</b><span class="column">${ordered.map(([route, size]) =>
          `<span style="${toneStyle(route)};height:${size / peak * 102}px"></span>`).join('')}</span></span>
        <em>${esc(bin.label)}</em></button>`;
    }).join('') + '</div>' : empty(ui('这个输入区间暂无输出用量记录。'));
    const output = cohort.map(({ request }) => request.output).filter(Number.isFinite);
    $('token-note').textContent = output.length ? ui('所选场景累计输出 ') + small(outputTotal(output)) + ' token。' : '';
    const routes = new Set(cohort.map(({ request }) => request.model));
    $('model-legend').innerHTML = routeOrder.filter(id => routes.has(id)).map(id => dot(legendName(id), tone(id))).join('');
    const shown = state.expanded ? cohorts : cohorts.slice(0, 5);
    const countText = ui`${num(cohort.length)} 次请求 · ${new Set(cohort.map(({ turn }) => turn.session)).size} 段会话`;
    $('cohort').innerHTML = ui`<div class="cohort-head"><h3>模型请求对照</h3><p>${countText} · 首 token 从模型步骤开始计时</p></div>`
      + (shown.length ? ui`<div class="table-wrap"><table>
      <thead><tr><th scope="col">模型与运行配置</th><th scope="col">请求 / 会话</th>
        <th scope="col">首 token P50</th><th scope="col">输出 token P50</th></tr></thead>
      <tbody>${shown.map((group, index) => `<tr><td><button class="model-cell" type="button" data-cohort="${index}">
        <i class="mark-dot" style="${toneStyle(group.model)}" aria-hidden="true"></i><span>
        <strong>${esc(modelName(group.model))}</strong><small>${esc(data.models[group.model].provider)} · ${esc(group.effort ?? ui('档位未记录'))}${group.toolMode ? ' · ' + toolModeNames[group.toolMode] : ''}</small></span></button></td>
        <td>${num(group.requests.length)} / ${new Set(group.requests.map(({ turn }) => turn.session)).size}</td>
        <td>${time(q(group.requests.map(({ request }) => request.ttft), .5), 2)}</td>
        <td>${num(q(group.requests.map(({ request }) => request.output), .5))}</td></tr>`).join('')}</tbody></table></div>`
        : empty(ui('这个范围和输入区间暂无可比较的请求。')));
  }

  function renderPortableModels() {
    const groups = new Map();
    for (const turn of view.turns) for (const request of turn.requests) {
      if (!groups.has(request.model)) groups.set(request.model, []);
      groups.get(request.model).push(request);
    }
    $('model-description').textContent = ui('按记录中的模型路由汇总请求用量和工具使用。');
    const names = [ui('模型'), ui('输入 token P50'), ui('输出 token P50'), ui('工具请求占比')];
    $('portable-models').innerHTML = groups.size ? `<table class="window-matrix" aria-labelledby="model-title"><thead><tr>
      ${names.map(name => `<th scope="col">${name}</th>`).join('')}</tr></thead><tbody>
      ${[...groups].sort((a, b) => b[1].length - a[1].length).map(([model, requests]) => {
        const knownTools = requests.filter(row => row.type != null);
        return `<tr><th scope="row"><strong>${esc(modelName(model))}</strong><small>${esc(data.models[model].provider)} · ${num(requests.length)}</small></th>
          <td>${num(q(requests.map(row => row.input), .5))}</td><td>${num(q(requests.map(row => row.output), .5))}</td>
          <td>${countRatio(knownTools.filter(row => row.type === 'tools').length, knownTools.length)}</td></tr>`;
      }).join('')}</tbody></table>` : empty(ui('当前范围暂无模型用量记录。'));
  }

  const isWindowError = action => action.status === 1 && (!state.windowError || action.category === Number(state.windowError));
  function windowQuantile(items, read, percentile, format) {
    const samples = items.map(read).filter(Number.isFinite);
    const value = q(samples, percentile);
    return { value, text: format(value), note: samples.length < items.length ? plural(samples.length, ui('个样本')) : '' };
  }
  function windowShare(numerator, denominator) {
    const value = denominator > 0 ? 100 * numerator / denominator : null;
    return { value, text: value == null ? '—' : occupancyText(value),
      note: denominator > 0 ? num(numerator) + ' / ' + num(denominator) : '' };
  }
  function renderWindow() {
    const modelMode = state.windowMode === 'model';
    const inputMode = modelMode && state.windowDimension === 'input';
    const toolGroups = portable && !modelMode;
    windowView = deriveWindow(view.turns, modelMode);
    const { bins, total, sessions, measured } = windowView;
    $('window-title').textContent = toolGroups ? ui('按工具对照') : inputMode ? ui('不同输入量下的表现') : ui('不同窗口占用下的表现');
    $('window-scope').textContent = toolGroups ? ui`${num(total)} 次有结果调用 · ${num(sessions)} 段会话`
      : ui`${num(measured)} / ${num(total)} 次可分档 · ${num(sessions)} 段会话`;
    $('window-description').textContent = toolGroups ? ui('按工具对照有结果的调用及后续同参返回。')
      : inputMode ? ui('按供应方报告的输入 token 分档。')
      : portable ? ui('用同一请求的已记录输入和窗口上限分档。')
      : modelMode ? ui('按请求的实际输入量和窗口上限分档。首 token 从模型步骤开始计时。')
        : ui('按工具发起前的窗口占用分档。可对照同一模型、同一工具在不同区间的表现。');
    $('window-tool-filters').hidden = modelMode;
    $('window-route-control').hidden = toolGroups && !hasToolModels;
    $('window-dimension-control').hidden = !portable || !modelMode || !hasRequestWindows;
    $('window-chart-note').hidden = !measured;
    $('window-chart-note').textContent = toolGroups ? ui('条长按各列的最大值缩放。点击工具查看实录。')
      : ui('条长按各列的最大值缩放。点击区间查看实录。');
    const output = level => items => windowQuantile(items, item => item.request.output, level, num);
    const toolShare = items => {
      const known = items.filter(item => item.request.type != null);
      return windowShare(known.filter(item => item.request.type === 'tools').length, known.length);
    };
    const any = predicate => bins.some(bin => bin.items.some(predicate));
    const columns = modelMode ? [
      ...(!portable ? [[ui('首 token'), ui('P90 等待'), '#286fd1', items => windowQuantile(items, item => item.request.ttft, .9, time)]]
        : any(item => Number.isFinite(item.request.responseMs))
          ? [[ui('模型响应耗时'), 'P90', '#286fd1', items => windowQuantile(items, item => item.request.responseMs, .9, time)]]
          : [[ui('输出 token'), 'P90', '#286fd1', output(.9)]]),
      [ui('输出 token'), 'P50', '#087d69', output(.5)],
      ...(!portable || any(item => item.request.type != null) ? [[ui('工具请求'), ui('占请求比例'), '#286fd1', toolShare]] : []),
    ] : [
      [ui('工具报错率'), ui('报错 / 调用'), '#b34c36', (items, errors) => windowShare(errors.length, items.length)],
      ...(!portable || any(item => Number.isFinite(item.elapsed))
        ? [[ui('调用耗时'), 'P90', '#286fd1', items => windowQuantile(items, item => item.elapsed, .9, time)]] : []),
      [ui('同参返回率'), ui('返回 / 报错'), '#087d69', (_items, errors) => windowShare(errors.filter(item => item.error?.returned != null).length, errors.length)],
    ];
    const tableRows = bins.map((bin, index) => {
      const { items, label } = bin;
      if (!items.length) return null;
      const failures = modelMode ? [] : items.filter(isWindowError);
      const values = columns.map(([, , , measure]) => measure(items, failures));
      return { index, label, count: items.length, values };
    }).filter(Boolean);
    const max = columns.map((_, col) => Math.max(0, ...tableRows.map(row => row.values[col].value ?? 0)));
    $('window-matrix').innerHTML = measured ? ui`<table class="window-matrix" aria-label="按窗口占用区间对照">
      <thead><tr><th scope="col">${toolGroups ? ui('工具') : inputMode ? ui('输入 token') : ui('窗口占用')}<small>${modelMode ? ui('请求样本') : ui('有结果调用')}</small></th>
        ${columns.map(([label, detail]) => `<th scope="col">${label}<small>${detail}</small></th>`).join('')}</tr></thead>
      <tbody>${tableRows.map(row => ui`<tr><th scope="row">
        <button type="button" class="window-band" data-window-band="${row.index}" title="查看实录">
          <strong>${esc(row.label)}</strong><small>${num(row.count)} 次</small></button></th>
        ${row.values.map((metric, col) => `<td><strong>${metric.text}</strong>
          <span class="window-track" aria-hidden="true"><i style="--series:${columns[col][2]};width:${max[col] ? 100 * (metric.value ?? 0) / max[col] : 0}%"></i></span>
          ${metric.note ? `<small>${metric.note}</small>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : empty(ui('所选范围内暂无可对照的记录。'));
  }
  const durationTicks = [0, 100, 300, 1000, 3000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000,
    1_800_000, 3_600_000, 7_200_000, 21_600_000, 43_200_000, 86_400_000];
  function logScale(max, low, high, constant, min = 0) {
    const start = Math.log1p(min / constant), end = Math.log1p(max / constant);
    return value => low + (high - low) * (Math.log1p(value / constant) - start) / (end - start);
  }
  const linearScale = (max, low, high) => value => low + (high - low) * value / max;
  const scaleTicks = (candidates, max, project, gap) => {
    const kept = [];
    for (const value of candidates) {
      if (value > max) break;
      if (!kept.length || Math.abs(project(value) - project(kept.at(-1))) >= gap) kept.push(value);
    }
    return kept;
  };
  const prettyTicks = (max, target = 5) => {
    const unit = Math.max(1, max / target);
    const power = 10 ** Math.floor(Math.log10(unit));
    const step = ([1, 2, 5, 10].find(n => n * power >= unit) ?? 10) * power;
    return Array.from({ length: Math.max(2, Math.ceil(max / step) + 1) }, (_, index) => index * step);
  };
  const maxOf = (items, access, floor = 1) => items.reduce((max, item) => Math.max(max, access(item)), floor);
  const n = value => value.toFixed(2);
  const line = (x1, y1, x2, y2, type = 'grid') =>
    `<line class="${type}" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>`;
  const axis = (x, y, label, anchor = 'middle') =>
    `<text class="axis" x="${n(x)}" y="${n(y)}" text-anchor="${anchor}">${esc(label)}</text>`;
  const circle = (mark, color, radius = 3, opacity = 1, hollow = false) =>
    `<circle class="data-dot" cx="${n(mark.x)}" cy="${n(mark.y)}" r="${radius}" opacity="${opacity}"
      fill="${hollow ? 'white' : color}" ${hollow ? 'stroke="' + color + '" stroke-width="1.5"' : ''}/>`;
  function frame(host) {
    const width = host.clientWidth, height = host.clientHeight;
    return { width, height, left: width < 350 ? 42 : 49, right: width - 10, top: 10, bottom: height - 28 };
  }
  function yGrid(f, ticks, position, label) {
    return ticks.map((tick, i) => {
      const y = position(tick);
      return line(f.left, y, f.right, y, i === 0 ? 'baseline' : 'grid') + axis(f.left - 8, y + 4, label(tick), 'end');
    }).join('');
  }
  function xGrid(f, ticks, position, label, grid = true) {
    return ticks.map((tick, i) => {
      const x = position(tick);
      const anchor = x - f.left < 9 ? 'start' : f.right - x < 12 ? 'end' : 'middle';
      return (grid ? line(x, f.top, x, f.bottom, i === 0 ? 'baseline' : 'grid') : '')
        + axis(x, f.height - 7, label(tick), anchor);
    }).join('');
  }

  function showPlot(host, f, description, picture, marks, summary, select, inspect) {
    host.innerHTML = `<svg viewBox="0 0 ${f.width} ${f.height}" role="img" aria-label="${esc(description)}">
      <g aria-hidden="true">${picture}<circle class="focus-ring" r="7" hidden/></g></svg><div class="tooltip" hidden></div>`;
    const svg = host.firstElementChild, tip = host.lastElementChild, ring = svg.querySelector('.focus-ring');
    const clear = () => {
      tip.hidden = true;
      ring.setAttribute('hidden', '');
      svg.classList.remove('active');
    };
    const position = event => {
      const bounds = svg.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    let released;
    if (inspect) {
      // Adjacent steps can be less than a pixel apart. Click rounds its coordinates.
      svg.onpointerup = event => { released = position(event); };
    }
    const pick = ({ x, y }, pointerType) => {
      const range = pointerType === 'touch' ? 19 : 10;
      let closest = null, distance = range ** 2;
      for (const mark of marks) {
        const candidate = (mark.x - x) ** 2 + (mark.y - y) ** 2;
        if (candidate > distance) continue;
        closest = mark;
        distance = candidate;
      }
      if (!closest) return null;
      const overlap = marks.filter(mark => Math.abs(mark.x - closest.x) <= 5.5 && Math.abs(mark.y - closest.y) <= 5.5);
      return { closest, overlap };
    };
    svg.onpointermove = event => {
      const point = position(event), hit = pick(point, event.pointerType);
      if (!hit) {
        clear();
        inspect?.preview(point);
        return;
      }
      inspect?.reset();
      const { closest, overlap } = hit;
      const [label, detail] = summary(closest, overlap);
      tip.innerHTML = `<strong>${esc(label)}</strong><span>${esc(detail)}</span>`;
      tip.hidden = false;
      tip.style.left = Math.max(0, Math.min(f.width - tip.offsetWidth, closest.x + 12)) + 'px';
      tip.style.top = Math.max(0, Math.min(f.height - tip.offsetHeight, closest.y - tip.offsetHeight - 7)) + 'px';
      ring.setAttribute('cx', n(closest.x));
      ring.setAttribute('cy', n(closest.y));
      ring.removeAttribute('hidden');
      svg.classList.add('active');
    };
    svg.onpointerleave = () => {
      clear();
      released = null;
      inspect?.reset();
    };
    svg.onclick = event => {
      const point = (event.detail && released) || position(event);
      const hit = pick(point, event.pointerType);
      released = null;
      if (hit) {
        clear();
        select(hit.closest, hit.overlap);
      } else inspect?.select(point);
    };
    return svg;
  }

  const plotEmpty = (host, text) => { host.innerHTML = `<div class="plot-empty">${esc(text)}</div>`; };
  const drawPath = (points, color, dash = '') => `<path d="${points.map((point, i) => (i ? 'L' : 'M') + n(point.x) + ' ' + n(point.y)).join(' ')}"
    fill="none" stroke="${color}" stroke-width="1.7" ${dash ? 'stroke-dasharray="' + dash + '"' : ''}/>`;
  function waitChart() {
    const host = $('wait-plot');
    if (!view.waits.length) return plotEmpty(host, ui('暂无首段正文计时样本'));
    const f = frame(host);
    const max = maxOf(view.waits, turn => turn.wait, 5000) * 1.07;
    const y = logScale(max, f.bottom, f.top, 300);
    const x = timeAt => f.left + (timeAt - view.since) / (until - view.since) * (f.right - f.left);
    const days = Math.round((until - view.since) / day);
    const tickCount = Math.min(f.width < 470 ? 4 : 6, days);
    const dates = Array.from({ length: tickCount }, (_, i) =>
      view.since + Math.round(i * (days - 1) / Math.max(1, tickCount - 1)) * day);
    const axisMarkup = xGrid(f, dates, x, stamp => dayFormat.format(stamp))
      + yGrid(f, scaleTicks(durationTicks, max, y, 28), y, tickTime);
    const marks = view.waits.map(turn => ({ x: x(turn.at), y: y(turn.wait), turn }));
    const daily = new Map();
    for (const { turn } of marks) {
      const start = startDay(turn.at);
      if (!daily.has(start)) daily.set(start, []);
      daily.get(start).push(turn.wait);
    }
    const series = [...daily.entries()].filter(([, values]) => values.length >= 5).sort(([a], [b]) => a - b)
      .map(([date, values]) => ({ date, x: x(date + day / 2), median: y(q(values, .5)), tail: y(q(values, .9)) }));
    const segments = [];
    for (const point of series) {
      const last = segments.at(-1);
      if (last && last.at(-1).date + day === point.date) last.push(point);
      else segments.push([point]);
    }
    const band = segments.filter(group => group.length > 1).map(group => {
      const coords = (points, key) => points.map(point => n(point.x) + ',' + n(point[key])).join(' ');
      return `<polygon fill="#f1f7ff" points="${coords(group, 'median')} ${coords([...group].reverse(), 'tail')}"/>`;
    }).join('');
    const lines = segments.map(group => {
      const points = key => group.map(point => ({ x: point.x, y: point[key] }));
      return drawPath(points('median'), ink.median) + drawPath(points('tail'), ink.tail, '4 4')
        + points('median').map(mark => circle(mark, ink.median, 2.4)).join('')
        + points('tail').map(mark => circle(mark, ink.tail, 2.4)).join('');
    }).join('');
    const p90 = q(view.waits.map(turn => turn.wait), .9);
    const dots = [...marks].reverse().map(mark => circle(mark, ink.wait, mark.turn.wait >= p90 ? 3.6 : 2.65,
      mark.turn.wait >= p90 ? .79 : .38)).join('');
    showPlot(host, f, ui('首段正文等待时间散点图。可用旁边的轮次列表查看全部样本。'), band + axisMarkup + dots + lines, marks,
      (mark, overlap) => overlap.length > 1
        ? [num(overlap.length) + ui(' 轮在此重叠'), ui('点击查看每轮计时')]
        : [workspace(mark.turn) + ui(' · 第 ') + mark.turn.no + ui(' 轮'), ui('首段正文 ') + time(mark.turn.wait)],
      (mark, overlap) => openMarks(mark, overlap, ui('等待样本')));
  }

  function errorChart() {
    const host = $('error-plot');
    if (!view.categories.length) return plotEmpty(host, ui('暂无工具报错样本'));
    const f = frame(host);
    const hasUnpaired = view.categories.some(group => group.recovery == null);
    const pairedBottom = f.bottom - (hasUnpaired ? 26 : 0);
    const maxY = maxOf(view.categories, group => group.recovery ?? 0, 1000) * 1.12;
    const y = logScale(maxY, pairedBottom, f.top, 150);
    const ticks = prettyTicks(maxOf(view.categories, group => group.turns.size), f.width < 430 ? 4 : 6);
    const x = linearScale(ticks.at(-1), f.left, f.right);
    const lane = f.bottom - 4;
    const pairedSamples = view.categories.some(group => group.recovery != null);
    const marks = view.categories.map(group => ({
      x: x(group.turns.size), y: group.recovery == null ? lane : y(group.recovery), group,
    }));
    const background = hasUnpaired
      ? `<rect x="${f.left}" y="${lane - 8}" width="${f.right - f.left}" height="16" fill="#fff8ee"/>` + axis(f.left - 8, lane + 4, '—', 'end') : '';
    const axes = xGrid(f, ticks, x, num)
      + (pairedSamples ? yGrid(f, scaleTicks(durationTicks, maxY, y, 24), y, tickTime) : '');
    const dots = marks.map(mark => circle(mark, mark.group.recovery == null ? ink.unpaired : ink.paired, 6, .92, mark.group.recovery == null)).join('');
    showPlot(host, f, ui('报错分类散点图。横轴是受影响的轮次，纵轴是同参返回的中位间隔。'),
      background + axes + dots, marks, ({ group }, overlap) => overlap.length > 1
        ? [num(overlap.length) + ui(' 类报错重叠'), ui('点击查看报错记录')]
        : [data.categories[group.id], num(group.turns.size) + ui(' 轮 · ') + (group.recovery == null ? ui('无同参返回样本') : 'P50 ' + time(group.recovery))],
      ({ group }, overlap) => {
        if (overlap.length <= 1) return openCategory(group);
        const items = overlap.flatMap(mark => mark.group.items).sort((a, b) => b.turn.at - a.turn.at);
        const description = overlap.map(mark => data.categories[mark.group.id]).join(' · ');
        openList(ui('所选报错样本'), description, 'errors', items);
      });
  }

  function renderPlots() {
    if (!portable) waitChart();
    errorChart();
  }

  const dialog = $('drawer'), drawerBody = $('drawer-body');
  const pageSize = 14;
  let list = null;
  const workNames = { goals: ui('目标进展'), deliveries: ui('交付登记'), children: ui('子任务回传'), compactions: ui('压缩前后的请求') };
  const workUnits = { goals: ui('个目标'), deliveries: ui('次交付'), children: ui('个子任务'), compactions: ui('个压缩区间') };
  const goalActions = { create: ui('登记目标'), edit: ui('更新目标'), complete: ui('标记完成'), clear: ui('清除目标'),
    pause: ui('暂停'), resume: ui('恢复'), block: ui('标记受阻') };
  const nextLabels = { same: ui('同工具同参'), changed: ui('同工具改参'), other: ui('换用其他工具') };
  const detailMetric = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const record = (label, line, extra = '') => `<div class="record"><strong>${label}</strong><p>${line}</p>${extra ? `<p>${extra}</p>` : ''}</div>`;
  function showDrawer(content, hasBack, heading) {
    $('drawer-back').hidden = !hasBack;
    $('drawer-top-label').hidden = hasBack;
    $('drawer-top-label').textContent = heading;
    drawerBody.innerHTML = content;
    drawerBody.scrollTop = 0;
    if (!dialog.open) dialog.showModal();
    else $('drawer-close').focus({ preventScroll: true });
  }

  function requestRecord(request) {
    const model = esc([modelRoute(request.model), request.effort, toolModeNames[request.toolMode]].filter(Boolean).join(' · '));
    const label = request.step == null ? model : ui`步骤 ${request.step} · ${model}`;
    const value = ui`输入 ${num(request.input)} · 输出 ${num(request.output)} token`
      + (portable ? '' : ui` · 首 token ${time(request.ttft, 2)}`);
    const anchor = request.line == null ? ui`模型回复 ${seq(request.seq)}` : ui`原生记录第 ${request.line} 行`;
    return record(label, value, anchor + (request.header != null ? ui(' · 请求头 ') + seq(request.header) : ''));
  }
  function behaviorRecords(request, scenario) {
    const b = request.behavior;
    if (!b || !scenario || scenario === 'direct') return '';
    if (scenario === 'lookup' && b.lookup) {
      const related = b.lookup.linked;
      return ui('<h3>文件取证</h3>') + record(ui('动作与取证'),
        num(b.actions) + ui(' 个动作 · ') + (b.overlap == null ? ui('并行情况未记录') : b.overlap ? ui('有实际重叠') : ui('顺序执行')),
        ui('文件记录 ') + num(b.lookup.files) + ui(' 个 · ') + b.lookup.refs.map(seq).join(' '))
        + (related ? record(ui('同一文件随后有修改'), ui('取证 ') + seq(related[0]) + ui(' → 修改返回 ') + seq(related[1]),
          related[2] ? ui('间隔 ') + related[2] + ui(' 个模型步骤') : ui('同一模型步骤内')) : '');
    }
    if (scenario === 'feedback') {
      return ui('<h3>反馈后的下一次回复</h3>') + feedbackOf(request).map(item => record(
        esc(data.categories[item.category]) + ' · ' + num(item.errors) + ui(' 次'),
        ui('报错 ') + seq(item.first) + ' · ' + feedbackLabels[item.kind][0] + (item.next != null ? ' ' + seq(item.next) : ''),
        [item.action != null ? ui('动作 ') + seq(item.action) : '', item.returned != null ? ui('同参返回 ') + seq(item.returned) : '']
          .filter(Boolean).join(' · '))).join('');
    }
    if (scenario === 'change' && b.change) return ui('<h3>修改与检查</h3>')
      + record(ui('同文件前读与读回'),
        ui`${num(b.change.files)} 个修改目标 · 前读 ${num(b.change.before)} 个 · 读回 ${num(b.change.after)} 个`, b.change.refs.map(seq).join(' '))
      + (b.change.check != null ? record(ui('同轮随后有显式检查'), ui('命令返回 ') + seq(b.change.check)) : '');
    return '';
  }
  const occupancyText = value => Number.isFinite(value) ? fixed(value, 2) + '%' : ui('未记录');
  function pressureAt(session, end) {
    const point = session.occupancy.points.findLast(row => row[0] <= end);
    return point?.[2] > 0 ? 100 * point[1] / point[2] : null;
  }
  function errorRecord(error) {
    const next = error.next ? ui`随后调用 ${esc(error.next.name)} ${seq(error.next.seq)} · ${nextLabels[error.next.kind]}` : '';
    const returned = error.returned == null ? ui('本轮未见同参非报错返回')
      : ui('同参返回 ') + seq(error.returned) + (error.recovery != null ? ui(' · 间隔 ') + time(error.recovery) : '');
    const attribution = globalThis.__trajectoryFailureText?.(error.attribution);
    return record(esc(data.categories[error.category]) + ' · ' + esc(error.tool),
      ui('报错 ') + seq(error.failed) + (error.code ? ' · ' + esc(error.code) : '') + ' · ' + returned,
      [attribution && esc(attribution), next].filter(Boolean).join(' · '));
  }
  function nativeLinks(session) {
    if (portable) return `<p class="drawer-sub">${ui`会话快照截至 ${seq(session.cut)}`}</p>`;
    const target = encodeURIComponent(session.id);
    return ui`<div class="native-links">
      <button type="button" class="session-jump" data-session-jump="${data.sessions.indexOf(session)}">本页查看窗口占用 ↗</button>
      <a href="/analysis-view/eval?format=page&amp;session=${target}" target="_blank" rel="noopener">打开会话 Eval ↗</a>
      <a href="/analysis-view/trace?staged=1&amp;session=${target}" target="_blank" rel="noopener">打开执行路径 ↗</a>
    </div><p class="drawer-sub">会话快照截至 ${seq(session.cut)}</p>`;
  }
  function evidenceDraft(session, question, anchors, fact = '') {
    if (portable) return '';
    const seqs = [...new Set(anchors.filter(Number.isSafeInteger))].slice(0, 5);
    if (!seqs.length) return '';
    const [anchor, ...related] = seqs;
    const query = 'trajectory_read(' + JSON.stringify({ session: session.id, cut: session.cut, seq: anchor, format: 'linked' }) + ')';
    const draft = [ui('使用 trace-analysis skill 核对这组记录。') + question, fact,
      ui('从这条取证查询开始，引用记录序号说明实际结果和仍需核验的部分。'), query,
      related.length ? ui('还需核对时，沿用返回的 snapshot，用 format=linked 查 ') + related.map(seq => '#' + seq).join('、') + '。' : '',
    ].filter(Boolean).join('\n');
    return ui`<details class="draft"><summary>取证草稿</summary><textarea aria-label="取证草稿" readonly>${esc(draft)}</textarea>
      <button type="button" class="text-button" data-action="copy-draft">复制草稿</button><span aria-live="polite"></span></details>`;
  }

  function openTurn(turn, selected = {}) {
    const session = data.sessions[turn.session];
    const errors = selected.error ? [selected.error] : turn.errors;
    const defaultRequest = turn.requests[0];
    const action = selected.occupancy;
    const requestWindow = Number.isFinite(selected.ratio) ? selected.request?.window : null;
    const output = turn.requests.map(request => request.output).filter(Number.isFinite);
    const phase = outcomeOf(turn);
    const roundState = outcomes[phase][0];
    const stopDraft = ['aborted', 'interrupted', 'error'].includes(phase) ? evidenceDraft(session,
      ui('核对这轮原本要完成的工作、最后取得的结果以及结束前的关键动作。'),
      [turn.endSeq, turn.prompt, turn.requests.at(-1)?.seq],
      ui`所选第 ${turn.no} 轮 · ${roundState}`) : '';
    const pressureDraft = action?.error ? evidenceDraft(session,
      ui('核对这次报错的直接条件和后续动作。结合报错前的窗口占用，检查是否还有相同条件的对照。'),
      [action.result, action.request, action.error.returned], ui('调用发起前窗口占用 ') + occupancyText(action.ratio) + '。') : '';
    const b = selected.request?.behavior;
    const anchors = selected.scenario === 'lookup' ? [...(b?.lookup?.linked?.slice(0, 2) ?? []), ...(b?.lookup?.refs ?? [])]
      : selected.scenario === 'change' ? [b?.change?.check, ...(b?.change?.refs ?? [])]
      : selected.scenario === 'feedback' && b ? feedbackOf(selected.request).flatMap(item => [item.first, item.next, item.returned]) : [];
    const modelDraft = anchors.some(Number.isSafeInteger) ? evidenceDraft(session,
      ui('对照这次模型请求、它取得的证据和后续动作，核对实际推进到了哪一步。'),
      [selected.request.seq, ...anchors]) : '';
    const content = ui`<div class="eyebrow">${esc(workspace(turn))} · 会话 ${shortSession(turn)}</div>
      <h2 id="drawer-title">第 ${turn.no} 轮</h2>
      <p class="drawer-sub">${esc(dateFormat.format(turn.at))} · ${esc(modelRoute(turn.model))}${turn.mixed ? ui(' · 轮内切换路由') : ''}${turn.toolMode ? ' · ' + toolModeNames[turn.toolMode] : ''}</p>
      <dl class="detail-numbers">
        ${portable ? '' : detailMetric(ui('首段正文'), time(turn.wait))}
        ${detailMetric(ui('本轮经过'), time(turn.end))}
        ${portable ? detailMetric(ui('工具调用'), num(turn.calls))
          : detailMetric(turn.calls ? ui('模型—工具往返') : ui('正文字符'), turn.calls ? num(turn.loops) + ui(' 次') : num(turn.chars))}
        ${detailMetric(ui('输出 token'), num(outputTotal(output)))}
      </dl>
      <h3>轮次记录</h3>
      ${record(ui('轮次起止'), ui('开始 ') + seq(turn.seq) + (turn.endSeq == null ? '' : ui(' → 结束 ') + seq(turn.endSeq)) + ' · ' + roundState,
        turn.prompt == null ? '' : ui('用户消息 ') + seq(turn.prompt))}
      ${turn.bodySeq == null ? '' : record(ui('首段正文'), ui('模型回复 ') + seq(turn.bodySeq) + ' · ' + time(turn.wait))}
      ${turn.ptc && turn.ptc.seq !== turn.toolSeq ? record(ui('首个 PTC 程序'),
        'run_code ' + seq(turn.ptc.seq) + ' · ' + time(turn.ptc.wait),
        ui`${num(turn.ptc.programs)} 个程序 · ${num(turn.ptc.calls)} 次子调用 · 外层累计 ${time(turn.ptc.elapsed)}（${turn.ptc.measured} / ${turn.ptc.programs} 有计时）`) : ''}
      ${turn.toolSeq == null ? '' : record(ui('首个工具动作'), esc(turn.tool) + ' ' + seq(turn.toolSeq) + ' · ' + time(turn.firstTool))}
      ${action ? (portable ? `<h3>${ui('工具调用记录')}</h3>` : ui('<h3>调用前的窗口占用</h3>')) + record(esc(action.tool) + ' · ' +
        (portable ? action.status === 1 ? ui('报错') : ui('正常返回') : occupancyText(action.ratio)),
        portable ? time(action.elapsed) : action.window > 0 ? num(action.used) + ' / ' + num(action.window) + ' token' : ui('占用记录缺失'),
        ui('发起 ') + seq(action.launch) + ui(' · 返回 ') + seq(action.result) + (action.elapsed == null ? '' : ui(' · 耗时 ') + time(action.elapsed))
          + (action.request != null ? ui(' · 模型回复 ') + seq(action.request) : '')) : ''}
      ${requestWindow ? ui('<h3>请求开始时的窗口占用</h3>') + record(occupancyText(selected.ratio),
        num(selected.request.input) + ' / ' + num(requestWindow[0]) + ' token',
        portable ? ui`窗口容量见原生记录第 ${requestWindow[1]} 行`
          : ui('窗口记录 ') + seq(requestWindow[1]) + ui(' · 模型回复 ') + seq(selected.request.seq)) : ''}
      ${errors.length ? '<h3>' + (selected.error ? ui('所选报错') : ui('工具报错 · ') + num(turn.errors.length) + ui(' 次')) + '</h3>' + errors.map(errorRecord).join('') : ''}
      ${selected.request || defaultRequest ? '<h3>' + (selected.request ? ui('所选模型请求') : ui('首个模型请求')) + '</h3>'
        + requestRecord(selected.request ?? defaultRequest) : ''}
      ${selected.request ? behaviorRecords(selected.request, selected.scenario) : ''}
      ${turn.requests.length > 1 ? ui`<details class="all-requests"><summary>查看本轮 ${num(turn.requests.length)} 次模型请求</summary>
        ${turn.requests.map(requestRecord).join('')}</details>` : ''}
      ${pressureDraft || modelDraft || stopDraft}${nativeLinks(session)}`;
    showDrawer(content, Boolean(list), ui('原始记录'));
  }

  function workLink(item, index = null) {
    const date = dayFormat.format(item.at);
    const title = item.round ? turnTitle(item.round) : `<strong>${esc(workspace(item))} · #${item.seq}</strong>`;
    let value, description;
    if (item.kind === 'goals') {
      description = ui('目标 #') + item.seq + ' · ' + date + ' · ' + num(item.changes.length) + ui(' 条状态记录');
      value = goalStates[item.phase][0];
    } else if (item.kind === 'deliveries') {
      description = (item.names[0] || ui('交付 #') + item.seq) + ' · ' + date;
      value = num(item.files) + ui(' 项');
    } else if (item.kind === 'children') {
      description = ui('子任务 #') + item.seq + (item.report ? ui(' · 回传前主线 ') + num(item.parentReplies) + ui(' 次模型回复') : ' · ' + date);
      value = item.report ? time(item.elapsed) : ui('未见回传');
    } else {
      description = ui('压缩 #') + item.seq + ' · ' + date;
      value = item.comparable ? small(item.before.input) + ' → ' + small(item.after.input)
        : item.actions.some(action => action.error) ? ui('有报错') : ui('无可比请求');
    }
    return `<button class="row-link" type="button" ${index == null ? 'data-work-item="' + item.id + '"' : 'data-item="' + index + '"'}>
      <span>${title}<small title="${esc(description)}">${esc(description)}</small></span><span class="row-value">${esc(value)}</span></button>`;
  }

  const pointerLine = pointer => seq(pointer.seq) + (pointer.turn == null ? '' : ui(' · 第 ') + pointer.turn + ui(' 轮'))
    + ' · ' + esc(dateFormat.format(pointer.at));
  function workDetail(item) {
    const session = data.sessions[item.session];
    const { kind, round } = item;
    const roundContext = round ? [
      round.prompt == null ? '' : ui('用户消息 ') + seq(round.prompt),
      round.requests.length ? ui('末次模型回复 ') + seq(round.requests.at(-1).seq) : '',
    ].filter(Boolean).join(' · ') : '';
    let body, draft;
    if (kind === 'goals') {
      const status = goalStates[item.phase][0];
      body = ui`<h3>目标状态 · ${status}</h3>` + item.changes.map(change =>
        record(goalActions[change.operation] ?? ui('状态更新'), pointerLine(change), goalStates[change.phase][0])).join('');
      const context = item.changes.map(change => roundsBySession[item.session].get(change.turn)).filter(Boolean);
      const firstRound = context[0], lastRound = context.at(-1);
      draft = evidenceDraft(session, ui('围绕目标核对需求、状态变化和有记录的产物或验证结果。'),
        [firstRound?.prompt ?? firstRound?.seq, lastRound?.requests.at(-1)?.seq ?? lastRound?.endSeq],
        ui`DSH 的目标状态记录为 ${status}，登记 #${item.seq}，末次状态变更 #${item.changes.at(-1).seq}。`);
    } else if (kind === 'deliveries') {
      body = record(ui('交付登记 · ') + num(item.files) + ui(' 项产物'), pointerLine(item), roundContext)
        + (item.names.length ? ui('<h3>登记的产物</h3><ul class="delivery-files">')
          + item.names.map(name => '<li>' + esc(name) + '</li>').join('')
          + (item.files > item.names.length ? ui('<li>另有 ') + num(item.files - item.names.length) + ui(' 项</li>') : '') + '</ul>' : '');
      draft = evidenceDraft(session, ui('对照生效的用户要求、交付产物和实际执行的验证，逐项说明目前能确认的验收结果。'),
        [item.seq, round?.prompt, round?.requests.at(-1)?.seq]);
    } else if (kind === 'children') {
      body = record(ui('子任务登记'), pointerLine(item))
        + (item.report ? record(ui('首次结算回传'), pointerLine(item.report), ui('间隔 ') + time(item.elapsed) + ui(' · 主线 ') + num(item.parentReplies) + ui(' 次模型回复'))
          : record(ui('回传'), ui('截至该会话切点未见匹配的结算回传')));
      draft = evidenceDraft(session, ui('核对委派的任务、回传结果，以及主会话怎样使用和验证这些结果。'),
        [item.seq, item.report?.seq, round?.prompt]);
    } else {
      const request = (label, value) => value ? record(label,
        ui('回复 ') + seq(value.seq) + ui(' · 第 ') + value.turn + ui(' 轮 · ') + esc(modelRoute(value.model)),
        ui('上报输入 ') + num(value.input) + ' token') : record(label, ui('未见相邻的结算记录'));
      body = ui('<h3>压缩记录</h3>') + item.actions.map(action => {
        const before = pressureAt(session, action.seq - 1), after = action.end ? pressureAt(session, action.end.seq) : null;
        const occupancy = action.end && before != null && after != null ? ui('窗口占用 ') + occupancyText(before) + ' → ' + occupancyText(after) : '';
        return record(ui('压缩开始 ') + seq(action.seq),
          action.end ? ui('结束 ') + seq(action.end.seq) + ui(' · 用时 ') + time(action.elapsed) + (action.error ? ui(' · 结束记录有报错') : '') : ui('未见结束记录'),
          [occupancy, action.summary ? ui('摘要记录 ') + seq(action.summary.seq) : ''].filter(Boolean).join(' · '));
      }).join('') + ui('<h3>前后请求</h3>') + request(ui('压缩前'), item.before) + request(ui('压缩后'), item.after);
      draft = evidenceDraft(session, ui('比较压缩前后保留的任务材料，再核对后续行动怎样接上当前任务。'),
        [item.seq, item.before?.seq, item.after?.seq, item.actions[0]?.summary?.seq, item.actions.at(-1)?.end?.seq]);
    }
    const content = ui`<div class="eyebrow">${esc(workspace(item))} · 会话 ${shortSession(item)}</div>
      <h2 id="drawer-title">${workNames[kind]}</h2>
      <p class="drawer-sub">${pointerLine(item)}</p>${body}${draft}${nativeLinks(session)}`;
    showDrawer(content, Boolean(list), ui('原始记录'));
  }

  function openWorkList(kind, items, title = workNames[kind]) {
    const sorted = [...items].sort((a, b) => (kind === 'children' ? Number(!!a.report) - Number(!!b.report) : 0) || b.at - a.at);
    openList(title, plural(sorted.length, workUnits[kind]), 'work', sorted);
  }
  function sampleRow(item, index, type) {
    if (type === 'work') return workLink(item, index);
    const turn = item.turn;
    const date = dayFormat.format(turn.at);
    let description, value;
    if (type === 'requests') {
      const { request } = item;
      const windowSample = Number.isFinite(item.ratio);
      const anchor = request.line == null ? ui`请求 #${request.seq}` : ui`原生记录第 ${request.line} 行`;
      description = modelName(request.model) + ' · ' + anchor
        + (!portable && windowSample ? ui(' · 首 token ') + time(request.ttft) : ' · ' + date);
      value = item.dimension === 'input' ? num(request.input) + ' token'
        : windowSample ? occupancyText(item.ratio) : num(request.output) + ' token';
    } else if (type === 'occupancy') {
      const action = item.occupancy;
      description = action.tool + ' · ' + (action.status === 1 ? data.categories[action.category] ?? ui('报错') : ui('正常返回'))
        + ' #' + action.result + (action.elapsed == null ? '' : ' · ' + time(action.elapsed));
      value = portable ? time(action.elapsed) : occupancyText(action.ratio);
    } else if (type === 'errors') {
      const { error } = item;
      description = data.categories[error.category] + ' · ' + error.tool + ' #' + error.failed + ' · ' + date;
      value = error.returned == null ? ui('无同参返回') : time(error.recovery);
    } else {
      description = modelName(turn.model) + ' · ' + date + ' · ' + shortSession(turn);
      value = list.value(turn);
    }
    return `<button class="row-link" type="button" data-item="${index}">
      <span>${turnTitle(turn)}<small>${esc(description)}</small></span>
      <span class="row-value">${esc(value)}</span></button>`;
  }
  function showList() {
    const { title, description, type, items, page } = list;
    const pages = Math.max(1, Math.ceil(items.length / pageSize));
    const start = page * pageSize;
    const content = ui`<div class="eyebrow">实录样本</div><h2 id="drawer-title">${esc(title)}</h2>
      <p class="drawer-sub">${esc(description)}</p><div class="rows">
      ${items.slice(start, start + pageSize).map((item, i) => sampleRow(item, start + i, type)).join('')}</div>
      ${pages > 1 ? ui`<div class="list-paging">
        <button type="button" class="text-button" data-page="-1" ${page === 0 ? 'disabled' : ''}>‹ 上一页</button>
        <span>${page + 1} / ${pages}</span>
        <button type="button" class="text-button" data-page="1" ${page + 1 === pages ? 'disabled' : ''}>下一页 ›</button>
      </div>` : ''}`;
    showDrawer(content, false, ui('样本列表'));
  }
  function openList(title, description, type, items, value) {
    list = { title, description, type, items, value, page: 0 };
    showList();
  }
  function openMarks(mark, overlap, title) {
    if (overlap.length <= 1) {
      list = null;
      openTurn(mark.turn);
      return;
    }
    const items = [mark, ...overlap.filter(other => other !== mark)];
    openList(title, ui`${num(items.length)} 轮在所选点附近重叠`, 'turns', items, turn => time(turn.wait));
  }
  function openCategory(group) {
    const items = [...group.items].sort((a, b) => (b.error.recovery ?? -1) - (a.error.recovery ?? -1) || b.turn.at - a.turn.at);
    openList(data.categories[group.id], ui`${num(group.turns.size)} 轮 · ${num(group.items.length)} 次报错 · ${num(group.paired)} 次有同参非报错返回`,
      'errors', items);
  }

  function openActionSamples(title, description, actions) {
    const items = actions.map(occupancy => ({ turn: occupancy.turn, error: occupancy.error, occupancy,
      request: occupancy.turn.requests.find(request => request.seq === occupancy.request) }));
    if (items.length === 1) {
      list = null;
      openTurn(items[0].turn, items[0]);
    } else openList(title, description, 'occupancy', items);
  }

  function openWindowBand({ label, items }) {
    const title = portable && state.windowMode === 'tool' ? label
      : (state.windowDimension === 'input' ? ui('输入量 ') : ui('窗口占用 ')) + label;
    if (state.windowMode === 'model') {
      const field = portable ? 'output' : 'ttft';
      const sorted = [...items].sort((a, b) => (b.request[field] ?? -1) - (a.request[field] ?? -1));
      openList(title, plural(items.length, ui('次模型请求')) + (portable ? ui(' · 按输出量排序') : ui(' · 按首 token 等待排序')), 'requests', sorted);
    } else {
      const failures = items.filter(isWindowError).length;
      const sorted = [...items].sort((a, b) => Number(isWindowError(b)) - Number(isWindowError(a))
        || (b.elapsed ?? -1) - (a.elapsed ?? -1));
      openActionSamples(title, plural(failures, ui('次所选报错')) + ' / ' + plural(items.length, ui('次有结果调用')), sorted);
    }
  }

  function refresh() {
    view = derive();
    renderOverview();
    renderWork();
    renderLists();
    if (portable) renderPortableModels();
    else { renderBehavior(); renderCohort(); }
    renderWindow();
    renderPlots();
  }
  const inputs = [['project', 'project'], ['period', 'period'], ['model', 'model'], ['input-size', 'input'],
    ['tool-mode', 'toolMode'], ['feedback-type', 'feedback']];
  for (const [id, key] of inputs) $(id).addEventListener('change', event => {
    state[key] = event.target.value;
    if (key === 'input') scenarioInputs[state.scenario] = state.input;
    state.expanded = false;
    refresh();
  });
  const windowInputs = [['window-route', 'windowRoute'], ['window-tool', 'windowTool'], ['window-error', 'windowError'], ['window-dimension', 'windowDimension']];
  for (const [id, key] of windowInputs) $(id).addEventListener('change', event => {
    state[key] = event.target.value;
    renderWindow();
  });
  const main = $('overview-page');
  main.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const { turn, error, bin, cohort, scenario, action, end, goal, workItem, windowMode, windowBand, case: sample } = button.dataset;
    if (windowMode && windowMode !== state.windowMode) {
      state.windowMode = windowMode;
      for (const control of main.querySelectorAll('[data-window-mode]')) {
        control.setAttribute('aria-pressed', String(control.dataset.windowMode === windowMode));
      }
      renderWindow();
    } else if (scenario && scenario !== state.scenario) {
      state.scenario = scenario;
      state.input = scenarioInputs[scenario];
      $('input-size').value = state.input;
      state.expanded = false;
      for (const control of main.querySelectorAll('[data-scenario]')) control.setAttribute('aria-pressed', String(control.dataset.scenario === scenario));
      refresh();
    } else if (sample != null) {
      const item = examples[Number(sample)];
      list = null;
      openTurn(item.turn, { ...item, scenario: state.scenario });
    } else if (turn != null) {
      list = null;
      openTurn(rows[Number(turn)]);
    } else if (error != null) {
      openCategory(view.categories.find(group => group.id === Number(error)));
    } else if (workItem != null) {
      list = null;
      workDetail(workItems[Number(workItem)]);
    } else if (end != null) {
      const group = view.work.byEnd.find(group => group.phase === end);
      const samples = [...group.turns].sort((a, b) => (b.end ?? -1) - (a.end ?? -1) || b.at - a.at);
      openList(outcomes[end][0], plural(samples.length, ui('轮')), 'turns', samples.map(turn => ({ turn })), turn => time(turn.end));
    } else if (goal != null) {
      openWorkList('goals', view.work.goals.filter(item => item.phase === goal), goalStates[goal][0] + ui('的目标'));
    } else if (bin != null) {
      const selected = view.bins[Number(bin)];
      const items = [...selected.requests].sort((a, b) => b.request.output - a.request.output || b.turn.at - a.turn.at)
        .map(item => ({ ...item, scenario: state.scenario }));
      openList(ui('输出 ') + selected.label + ' token', plural(items.length, ui('次模型请求')), 'requests', items);
    } else if (windowBand != null) {
      openWindowBand(windowView.bins[Number(windowBand)]);
    } else if (cohort != null) {
      const group = view.cohorts[Number(cohort)];
      const items = [...group.requests].sort((a, b) => caseScore(b) - caseScore(a) || b.turn.at - a.turn.at)
        .map(item => ({ ...item, scenario: state.scenario }));
      const description = [data.models[group.model].provider, group.effort ?? ui('档位未记录'), toolModeNames[group.toolMode],
        plural(items.length, ui('次模型请求'))].filter(Boolean).join(' · ');
      openList(modelName(group.model), description, 'requests', items);
    } else if (action === 'wait-list') {
      openList(ui('首段正文等待'), plural(view.waits.length, ui('轮有正文计时')), 'turns', view.waits.map(turn => ({ turn })), turn => time(turn.wait));
    } else if (action === 'models') {
      state.expanded = !state.expanded;
      renderBehavior();
      renderCohort();
      main.querySelector('[data-action=models]')?.focus();
    } else if (action && Object.hasOwn(view.work, action) && Object.hasOwn(workNames, action)) {
      openWorkList(action, view.work[action]);
    }
  });
  const sessionView = mountSessionEval({ data, $, num, esc, time, dayFormat, option, metric, empty, fraction, dot,
    chart: { frame, xGrid, yGrid, line, circle, showPlot, plotEmpty },
    getActions: session => actionsBySession[session],
    openActions: openActionSamples,
    openWork: (kind, session, anchor) => {
      const items = workItems.filter(item => item.session === session && item.kind === kind);
      if (anchor == null) return openWorkList(kind, items);
      const item = items.find(item => item.seq === anchor);
      if (item) {
        list = null;
        workDetail(item);
      }
    },
  });
  let activePage = 'overview';
  function switchPage(page, session) {
    activePage = page;
    $('overview-page').hidden = page !== 'overview';
    $('session-page').hidden = page !== 'session';
    for (const button of document.querySelectorAll('.page-nav button')) {
      button.setAttribute('aria-pressed', String(button.dataset.view === page));
    }
    if (page === 'session') sessionView.select(session);
    else renderPlots();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  for (const button of document.querySelectorAll('.page-nav button')) {
    button.addEventListener('click', () => switchPage(button.dataset.view));
  }
  dialog.addEventListener('click', async event => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right) dialog.close();
      return;
    }
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.id === 'drawer-close') dialog.close();
    if (button.dataset.sessionJump != null) {
      dialog.close();
      switchPage('session', Number(button.dataset.sessionJump));
    }
    if (button.id === 'drawer-back') showList();
    if (button.dataset.page != null && list) {
      list.page += Number(button.dataset.page);
      showList();
    }
    if (button.dataset.item != null && list) {
      const item = list.items[Number(button.dataset.item)];
      if (list.type === 'work') workDetail(item);
      else openTurn(item.turn, item);
    }
    if (button.dataset.action === 'copy-draft') {
      const field = button.closest('.draft').querySelector('textarea');
      const status = button.nextElementSibling;
      try {
        await navigator.clipboard.writeText(field.value);
        status.textContent = ui('已复制');
      } catch {
        field.select();
        status.textContent = document.execCommand('copy') ? ui('已复制') : ui('已选中文字，可按 Ctrl+C');
      }
    }
  });
  dialog.addEventListener('close', () => { list = null; });
  let resize;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resize);
    resize = requestAnimationFrame(activePage === 'session' ? sessionView.draw : renderPlots);
  });
  $('overview-loading').hidden = true;
  $('overview-nav').hidden = false;
  $('snapshot-controls').hidden = false;
  $('overview-page').hidden = false;
  const sessionButton = document.querySelector('[data-view="session"]');
  sessionButton.disabled = !data.sessions.length || portable;
  sessionButton.hidden = portable;
  if (portable) {
    document.body.classList.add('portable-overview');
    $('native-overview-method').hidden = true;
    $('portable-overview-method').hidden = false;
    $('overview-source').textContent = ui('原生会话记录');
    $('work-rail').hidden = true;
    $('work-title').textContent = ui('轮次执行');
    $('work-description').textContent = ui('按记录中的轮次状态和用时汇总。');
    $('model-scenarios').hidden = $('model-detail').hidden = $('model-cost').hidden = true;
    $('portable-models').hidden = false;
    $('model-title').textContent = ui('按模型对照');
    $('wait-section').hidden = document.querySelector('[href="#wait-section"]').hidden = true;
    $('model-section').hidden = document.querySelector('[href="#model-section"]').hidden = !hasUsage;
    const modelButton = document.querySelector('[data-window-mode="model"]');
    modelButton.disabled = !hasUsage;
    modelButton.setAttribute('aria-pressed', String(hasUsage));
    document.querySelector('[data-window-mode="tool"]').setAttribute('aria-pressed', String(!hasUsage));
  }
  refresh();
  if (location.hash === '#session' && !sessionButton.disabled) switchPage('session');
})();
