(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const data = JSON.parse($('command-data').textContent);
  const requested = new URLSearchParams(location.search).get('lang');
  const language = requested && /^(en|zh)(-|$)/i.test(requested) ? requested : data.locale || navigator.language || 'en';
  const en = !/^zh/i.test(language);
  const t = (zh, english) => en ? english : zh;
  const locale = en ? 'en' : 'zh-CN';
  const fmt = new Intl.NumberFormat(locale);
  const rateFmt = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const num = n => n == null ? '—' : fmt.format(n);
  const percent = n => n == null ? '—' : rateFmt.format(n);
  const ms = n => n == null ? '—' : n < 1000 ? num(Math.round(n)) + ' ms' : num(Math.round(n / 100) / 10) + ' s';
  const set = (id, text) => { $(id).textContent = text; };
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const button = (text, cls) => {
    const node = el('button', text, cls);
    node.type = 'button';
    return node;
  };
  const swatch = color => {
    const node = el('i', null, 'swatch');
    node.setAttribute('aria-hidden', 'true');
    node.style.setProperty('--tone', color);
    return node;
  };
  const legend = (id, items) => {
    for (const [text, color] of items) {
      const node = el('span');
      node.append(swatch(color), document.createTextNode(text));
      $(id).append(node);
    }
  };

  const labels = {
    syntax: t('脚本语法', 'Shell syntax'), pattern: t('搜索表达式', 'Search pattern'),
    path: t('文件或路径', 'File or path'), permission: t('访问权限', 'Permissions'),
    timeout: t('等待超时', 'Timeout'), child: t('子程序报错', 'Child process'),
    connection: t('连接失败', 'Connection failure'), encoding: t('编码错误', 'Encoding error'),
    argument: t('命令或参数', 'Command or argument'), check: t('验证未通过', 'Verification failed'),
    'no-match': t('疑似搜索未命中', 'Likely no search matches'),
    'unresolved-output': t('有输出，未归类', 'Unclassified output'),
    'unresolved-empty': t('无输出', 'No output'),
    returned: t('正常返回', 'Returned'), unrecorded: t('结果待确认', 'Result unknown'),
  };
  const unclassified = ['unresolved-output', 'unresolved-empty'];
  const reasonKey = row => row.cause.kind === 'unresolved' ? unclassified[row.cause.outputRecorded ? 0 : 1] : row.cause.kind;
  const reasonLabel = row => labels[reasonKey(row)] || reasonKey(row);
  const action = row => ({
    read: t('读取', 'Read'), query: t('查询', 'Lookup'), run: t('运行', 'Run'), write: t('修改', 'Write'),
  })[row.operation] || row.operation;
  const resultText = {
    'unresolved-output': t('宿主标记了失败，返回内容里未识别到具体错误信号。', 'The host marked the call as failed. Its output did not identify a recognized cause.'),
    'unresolved-empty': t('宿主标记了失败，记录里没有可用于判断原因的输出。', 'The host marked the call as failed. The record contains no output to diagnose.'),
    'no-match': t('单条 rg 之后外层退出码为 1，返回为空，符合未命中的表现。', 'The shell exited with 1 after one rg call, with empty output. This is consistent with no matches.'),
    returned: t('宿主记录为正常返回。', 'The host recorded a normal return.'),
    unrecorded: t('该切点内没有确认调用结果。', 'The result was not confirmed at this cut.'),
  };
  const parserStates = {
    'not-configured': t('本地语法解析未配置', 'Local syntax parsing is not configured'),
    'no-source': t('原始脚本未取得', 'Original script unavailable'),
    'not-selected': t('未在本批解析', 'Not parsed in this batch'),
    'input-budget': t('超出本批解析预算', 'Outside this batch budget'),
    'provider-unavailable': t('语法解析器不可用', 'Syntax parser unavailable'),
    'pwsh-unavailable': t('本机 PowerShell 不可用', 'Local PowerShell unavailable'),
    'provider-failed': t('语法解析器未返回结果', 'Syntax parser returned no results'),
    'protocol-mismatch': t('语法解析版本不匹配', 'Syntax parser version mismatch'),
    pending: t('暂无语法结果', 'Syntax result unavailable'),
    parsed: t('本地语法检查通过', 'Local syntax check passed'),
    recovered: t('本地语法检查发现错误', 'Local syntax check found errors'),
  };
  const syntaxNotes = {
    'brace-path-list': [
      t('花括号里的逗号触发了解析错误', 'The comma inside the braces triggered a parse error'),
      t('PowerShell 将目录/{a,b} 当作脚本语法解析。搜索多个文件时，把每个完整路径作为单独参数。', 'PowerShell parses dir/{a,b} as shell syntax. To search multiple files, pass each full path as a separate argument.'),
      "rg -n 'pattern' 'dir/a.js' 'dir/b.js'",
    ],
    MissingArgument: [
      t('参数列表缺少参数', 'An argument is missing'),
      t('检查报错位置附近的分隔符。补齐缺少的参数，或移除多余的逗号。', 'Check the delimiters near the reported location. Supply the missing argument or remove an extra comma.'),
    ],
    MissingExpression: [
      t('运算符或分隔符后缺少表达式', 'An expression is missing after an operator or delimiter'),
      t('检查报错位置附近的符号，并补齐它需要的值。', 'Check the symbol at the reported location and supply the value it expects.'),
    ],
    EmptyPipeElement: [
      t('管道里有空段', 'The pipeline has an empty stage'),
      t('检查管道符两侧。补齐命令，或移除多余的管道符。', 'Check both sides of the pipe. Supply a command or remove the extra pipe.'),
    ],
    MissingEndParenthesisInExpression: [
      t('表达式缺少右括号', 'The expression is missing a closing parenthesis'),
      t('检查相邻表达式的括号配对，在对应的位置补上 )。', 'Check the matching parentheses and add ) where the expression ends.'),
    ],
    MissingEndCurlyBrace: [
      t('语句块缺少右花括号', 'The block is missing a closing brace'),
      t('从报错位置检查代码块边界，在对应的位置补上 }。', 'Check the block boundaries and add } where the block ends.'),
    ],
    TerminatorExpectedAtEndOfString: [
      t('字符串缺少结束引号', 'The string is missing its closing quote'),
      t('核对字符串起止位置，使用与开头相配的引号结束字符串。', 'Check the string boundaries and close it with the matching quote.'),
    ],
  };

  const rows = [...data.rows].sort((a, b) => b.seq - a.seq);
  const failed = rows.filter(row => row.status === 'error');
  const classified = failed.filter(row => row.attribution?.certainty === 'confirmed' ||
    !row.attribution && !['unresolved', 'no-match'].includes(row.cause.kind)).length;
  const selected = rows.find(row => row.seq === data.selected) || failed[0] || rows[0];
  const filters = { turn: '', duration: '', reason: '' };
  const pageSize = 12;
  const choices = [];
  const readouts = {
    turn: t('点格子筛选轮次，悬停可看报错次数和分母。', 'Select a cell to filter by turn. Hover to see errors and the denominator.'),
    duration: t('点柱子筛选耗时区间。', 'Select a bar to filter by duration.'),
    reason: t('点一类查看对应记录。', 'Select a category to view its records.'),
  };
  const turnScopes = new Map();
  let current = selected, page = 0, durationMode = 'rate';

  document.documentElement.lang = locale;
  document.title = t('PowerShell 命令诊断', 'PowerShell command diagnostics');
  set('product', t('轨迹树', 'Trajectory Tree'));
  set('crumb', t('/ 命令诊断', '/ Command diagnostics'));
  set('cut', 'Codex · ' + t('截至 #', 'Through #') + data.cut + (data.synthetic ? t(' · 模拟记录', ' · Synthetic') : ''));
  set('heading', t('命令诊断', 'Command diagnostics'));
  set('subtitle', t('查看 PowerShell 调用在哪里报错，点开记录追到具体位置。', 'Find where PowerShell calls failed and open the evidence.'));
  set('overview-title', t('调用概览', 'Call overview'));
  set('turn-title', t('轮次报错率', 'Error rate by turn'));
  set('duration-title', t('耗时与返回', 'Duration and outcome'));
  set('reason-title', t('报错分类', 'Recorded error categories'));
  set('records-title', t('调用记录', 'Call records'));
  set('reason-note', t('按宿主返回归类', 'Classified from host output'));
  set('clear', t('清除筛选', 'Clear filters'));
  set('prev', t('上一页', 'Previous'));
  set('next', t('下一页', 'Next'));
  set('mode-count', t('次数', 'Count'));
  set('mode-rate', t('报错率', 'Rate'));
  set('rate-note', t('宿主报错 ÷ 已确认结果', 'Host errors ÷ confirmed results'));

  const known = rows.filter(row => row.status !== 'unknown').length;
  for (const [name, value, sub] of [
    [t('命令调用', 'Command calls'), rows.length],
    [t('宿主报错', 'Host errors'), failed.length, known ? percent(failed.length / known) : null],
    [t('已归类', 'Classified'), classified, '/ ' + num(failed.length)],
  ]) {
    const box = el('div'), count = el('dd', num(value), 'num');
    if (sub) count.append(el('small', ' ' + sub));
    box.append(el('dt', name), count);
    $('summary').append(box);
  }

  for (const [value, label] of [
    ['all', t('全部调用', 'All calls')], ['error', t('仅宿主报错', 'Host errors')],
    ['returned', labels.returned], ['unknown', labels.unrecorded],
  ]) {
    const option = el('option', label);
    option.value = value;
    $('status').append(option);
  }
  $('status').value = selected?.status === 'error' ? 'error' : 'all';
  $('status').setAttribute('aria-label', t('调用结果', 'Call outcome'));
  $('query').placeholder = t('搜序号、程序、原因', 'Record, program, reason');
  $('query').setAttribute('aria-label', $('query').placeholder);
  for (const [name, cls] of [
    [t('调用', 'Call')], [t('轮次', 'Turn')], [t('程序或动作', 'Program or action')], [t('结果', 'Outcome')],
    [t('退出码', 'Exit'), 'end'], [t('耗时', 'Duration'), 'end'],
  ]) {
    const th = el('th', name, cls);
    th.scope = 'col';
    $('head').append(th);
  }

  function updateReadout(dimension) {
    const active = choices.find(choice => choice.dimension === dimension && choice.value === filters[dimension]);
    set(dimension + '-readout', active?.description || readouts[dimension]);
  }

  function mark(node, dimension, value, label, description) {
    choices.push({ node, dimension, value, label, description });
    node.dataset.filter = dimension;
    node.dataset.value = value;
    node.title = description;
    node.setAttribute('aria-label', description);
    const show = () => set(dimension + '-readout', description);
    node.addEventListener('pointerenter', show);
    node.addEventListener('focus', show);
    node.addEventListener('pointerleave', () => updateReadout(dimension));
    node.addEventListener('blur', () => updateReadout(dimension));
    node.addEventListener('click', () => {
      filters[dimension] = filters[dimension] === value ? '' : value;
      if (dimension === 'reason' && filters.reason && ['returned', 'unknown'].includes($('status').value)) {
        $('status').value = 'all';
      }
      resetPage();
    });
  }

  const stats = () => ({ returned: 0, error: 0, unknown: 0 });
  const add = (counts, row) => { counts[row.status]++; };
  const total = counts => counts.returned + counts.error + counts.unknown;
  const errorRate = counts => counts.error + counts.returned ? counts.error / (counts.error + counts.returned) : null;
  function outcomeText(counts) {
    const returned = counts.error + counts.returned;
    const knownText = num(counts.error) + ' / ' + num(returned) + t(' 次报错', ' host errors') + (returned ? ' (' + percent(errorRate(counts)) + ')' : '');
    return knownText + (counts.unknown ? ' · ' + num(counts.unknown) + t(' 次待确认', ' unknown') : '');
  }

  const heatColors = ['#e9f2ff', '#fff0df', '#ffdfbd', '#ffc28c', '#f8a366'];
  function buildTurns() {
    const byTurn = new Map();
    for (const row of rows) {
      if (!Number.isSafeInteger(row.turn)) continue;
      if (!byTurn.has(row.turn)) byTurn.set(row.turn, stats());
      add(byTurn.get(row.turn), row);
    }
    if (!byTurn.size) {
      set('turn-note', t('暂无轮次数据', 'No turn data'));
      readouts.turn = '';
      return;
    }
    const ordered = [...byTurn.keys()].sort((a, b) => a - b);
    const first = ordered[0], last = ordered.at(-1), span = Math.max(1, Math.ceil((last - first + 1) / 72));
    const groups = new Map();
    for (const [turn, counts] of byTurn) {
      const start = first + Math.floor((turn - first) / span) * span;
      if (!groups.has(start)) groups.set(start, stats());
      const group = groups.get(start);
      group.returned += counts.returned;
      group.error += counts.error;
      group.unknown += counts.unknown;
    }
    set('turn-note', num(byTurn.size) + t(' 轮有调用', ' turns with calls') + (span > 1 ? ' · ' + t('每格 ', '') + span + t(' 轮', ' turns per cell') : ''));
    let hasUnknown = false;
    for (let start = first; start <= last; start += span) {
      const counts = groups.get(start), end = Math.min(last, start + span - 1);
      const range = start === end ? num(start) : num(start) + '–' + num(end);
      const label = t('第 ', start === end ? 'Turn ' : 'Turns ') + range + t(' 轮', '');
      if (!counts) {
        const gap = el('span', null, 'gap');
        gap.title = label + ' · ' + t('无 PowerShell 调用', 'No PowerShell calls');
        gap.setAttribute('aria-hidden', 'true');
        $('turns').append(gap);
        continue;
      }
      const rate = errorRate(counts);
      const level = rate == null ? 'unknown' : rate === 0 ? 0 : rate <= .05 ? 1 : rate <= .15 ? 2 : rate <= .3 ? 3 : 4;
      hasUnknown ||= rate == null;
      const node = button(String(start));
      node.dataset.level = level;
      node.style.setProperty('--tone', heatColors[level] ?? 'var(--unknown-fill)');
      turnScopes.set(String(start), { start, end });
      mark(node, 'turn', String(start), label, label + ' · ' + outcomeText(counts));
      $('turns').append(node);
    }
    legend('turn-legend', [
      ...['0%', '≤5%', '≤15%', '≤30%', '>30%'].map((label, i) => [label, heatColors[i]]),
      ...(hasUnknown ? [[t('待确认', 'Unknown'), 'var(--unknown-fill)']] : []),
    ]);
  }

  const durationBins = [
    [0, 1000, '<1'], [1000, 3000, '1–3'], [3000, 10000, '3–10'],
    [10000, 30000, '10–30'], [30000, 60000, '30–60'], [60000, Infinity, '≥60'],
  ].map(([min, max, range]) => ({ min, max, range, counts: stats() }));
  const inBin = (row, bin) => row.durationMs != null && row.durationMs >= bin.min && row.durationMs < bin.max;
  const durationColors = { returned: 'var(--blue-fill)', error: 'var(--error-fill)', unknown: 'var(--unknown-fill)' };
  const durationMarks = [];
  function buildDuration() {
    let measured = 0;
    for (const row of rows) {
      const bin = durationBins.find(item => inBin(row, item));
      if (!bin) continue;
      add(bin.counts, row);
      measured++;
    }
    if (!measured) {
      $('histogram').hidden = $('duration-modes').hidden = $('rate-note').hidden = true;
      set('duration-note', t('没有记录耗时', 'No duration recorded'));
      readouts.duration = '';
      return;
    }
    set('duration-note', num(measured) + ' / ' + num(rows.length) + t(' 次有耗时 · 秒', ' timed · seconds'));
    const outcomes = ['returned', 'error', ...(durationBins.some(bin => bin.counts.unknown) ? ['unknown'] : [])];
    legend('duration-legend', outcomes.map(kind => [kind === 'returned' ? labels.returned :
      kind === 'error' ? t('宿主报错', 'Host errors') : labels.unrecorded, durationColors[kind]]));
    durationBins.forEach((bin, index) => {
      const node = button(null, 'column'), value = el('strong', null, 'num');
      const stack = el('span', null, 'stack');
      const parts = {};
      for (const outcome of outcomes) {
        const part = swatch(durationColors[outcome]);
        parts[outcome] = part;
        stack.append(part);
      }
      const sample = el('span', total(bin.counts) ? 'n=' + num(bin.counts.returned + bin.counts.error) : '', 'sample num');
      node.append(value, stack, el('span', bin.range, 'range num'), sample);
      durationMarks.push({ bin, value, parts, sample });
      const { min, max, counts } = bin;
      const interval = (min === 0 ? '<1' : max === Infinity ? '≥60' : min / 1000 + '–<' + max / 1000) + t(' 秒', ' s');
      const label = t('耗时 ', 'Duration ') + interval;
      mark(node, 'duration', String(index), label, label + ' · ' + num(total(counts)) + t(' 次调用 · ', ' calls · ') + outcomeText(counts));
      node.disabled = total(counts) === 0;
      $('duration-columns').append(node);
    });
    renderDuration();
  }

  function renderDuration() {
    const countMode = durationMode === 'count';
    const max = Math.max(2, ...durationBins.map(bin => total(bin.counts)));
    const step = Math.max(1, 10 ** (Math.floor(Math.log10(max)) - 1));
    const top = Math.ceil(max / (2 * step)) * (2 * step);
    const rateMax = Math.max(1, Math.ceil(10 * Math.max(0, ...durationBins.map(bin => errorRate(bin.counts) ?? 0)))) / 10;
    const scale = countMode ? top : rateMax;
    const format = countMode ? num : percent;
    $('duration-axis').replaceChildren(...[scale, scale / 2, 0].map(tick => el('span', format(tick))));
    $('mode-count').setAttribute('aria-pressed', String(countMode));
    $('mode-rate').setAttribute('aria-pressed', String(!countMode));
    for (const { bin, value, parts, sample } of durationMarks) {
      const { counts } = bin, rate = errorRate(counts);
      value.textContent = total(counts) ? (countMode ? num(total(counts)) : percent(rate)) : '';
      sample.hidden = countMode;
      for (const [outcome, part] of Object.entries(parts)) {
        const value = countMode ? counts[outcome] : outcome === 'error' ? rate ?? 0 : 0;
        part.style.height = 100 * value / scale + '%';
        part.hidden = value === 0;
      }
    }
    $('duration-legend').hidden = !countMode;
    $('rate-note').hidden = countMode;
  }

  function buildReasons() {
    const counts = new Map();
    for (const row of failed) {
      const key = reasonKey(row);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const diagnosed = [...counts].filter(([key]) => !unclassified.includes(key)).sort((a, b) => b[1] - a[1]);
    const max = diagnosed[0]?.[1] || 1;
    for (const [key, count] of diagnosed) {
      const node = button(null, 'reason'), track = el('span', null, 'track'), bar = el('i');
      bar.style.width = 100 * count / max + '%';
      track.append(bar);
      track.setAttribute('aria-hidden', 'true');
      node.append(el('span', labels[key]), track, el('b', num(count), 'num'));
      mark(node, 'reason', key, labels[key], labels[key] + ' · ' + num(count) + t(' 次', ' calls'));
      $('reasons').append(node);
    }
    if (!diagnosed.length) $('reasons').append(el('p', failed.length ? t('暂无可归类的报错', 'No classified errors') :
      t('该切点没有报错', 'No host errors at this cut'), 'quiet'));
    for (const key of unclassified) {
      const count = counts.get(key);
      if (!count) continue;
      const node = button();
      node.append(el('span', labels[key]), el('b', num(count), 'num'));
      mark(node, 'reason', key, labels[key], labels[key] + ' · ' + num(count) + t(' 次。', ' calls. ') + resultText[key]);
      $('residual').append(node);
      $('residual').hidden = false;
    }
  }

  function position(mark) {
    return mark.line ? 'L' + mark.line + (mark.column ? ':' + mark.column : '') : '';
  }

  function renderDiagnosis(row) {
    const native = row.syntax.diagnostics?.[0];
    const mark = native || row.cause.reported || {};
    const note = syntaxNotes[mark.hint || mark.id];
    const place = position(mark);
    const location = place ? (native ? t('脚本 ', 'Script ') : t('运行返回 ', 'Runtime report ')) + place : '';
    const box = el('section', null, 'diagnosis'), header = el('header');
    header.append(el('h3', t('语法诊断', 'Syntax diagnosis')), el('span', location, 'num'));
    box.append(header, el('p', note?.[0] || t('PowerShell 在解析脚本时退出。', 'PowerShell exited while parsing the script.')));
    if (note?.[1]) box.append(el('p', note[1]));
    if (note?.[2]) box.append(el('pre', note[2]));
    return box;
  }

  function renderDetail() {
    const panel = $('details');
    panel.replaceChildren();
    const heading = el('h2', current ? '#' + current.seq : t('命令详情', 'Command detail'), 'num');
    heading.id = 'detail-title';
    heading.tabIndex = -1;
    if (!current) {
      panel.append(heading, el('p', t('选择一条命令查看诊断。', 'Select a command to view its diagnosis.'), 'quiet'));
      return;
    }
    const row = current, why = row.cause, syntax = row.syntax;
    const title = el('div'), header = el('div', null, 'detail-head');
    title.append(heading, el('p', 'PowerShell' + (why.program === 'pwsh' ? '' : ' · ' + (why.program || action(row))), 'quiet'));
    header.append(title, el('span', reasonLabel(row), 'badge' + (row.status === 'error' ? ' error' : '')));
    panel.append(header, el('p', t('第 ', 'Turn ') + num(row.turn) + t(' 轮', '') + ' · ' + t('退出码 ', 'Exit ') + num(row.exitCode) +
      ' · ' + t('返回 ', 'Result ') + (row.resultSeq == null ? '—' : '#' + row.resultSeq) + ' · ' + ms(row.durationMs), 'quiet detail-meta'));

    if (why.kind === 'syntax') panel.append(renderDiagnosis(row));
    if (row.attribution?.certainty === 'candidate' && why.kind !== 'no-match') {
      const { program, site } = row.attribution;
      panel.append(el('p', t('候选原因', 'Possible cause') + ' · ' + program + ' · ' + position(site ?? {}), 'quiet detail-meta'));
    }
    const runtime = el('section', null, 'detail-section');
    runtime.append(el('h3', t('运行证据', 'Runtime evidence')));
    if (why.evidence) runtime.append(el('pre', why.evidence));
    else runtime.append(el('p', resultText[reasonKey(row)] || t('可按关联序号核对运行返回。', 'Use the linked sequence to inspect the result.'), 'quiet'));
    if (why.outputBefore) runtime.append(el('p', t('这条错误之前已有输出。', 'There was output before this error.'), 'quiet'));
    if (why.site?.line) runtime.append(el('p', t('脚本中对应的命令', 'Matching command in the script') + ' · ' +
      why.site.name + ' · ' + position(why.site), 'quiet'));
    if (why.code) runtime.append(el('pre', why.code.file + ':' + why.code.line + (why.code.column ? ':' + why.code.column : '')));
    panel.append(runtime);

    const structure = el('details', null, 'detail-section');
    structure.append(el('summary', t('语法与原始记录', 'Syntax and original record')),
      el('p', (parserStates[syntax.state] || syntax.state) + (syntax.runtime ? ' · PowerShell ' + syntax.runtime : ''), 'quiet'));
    if (syntax.rolloutLine) structure.append(el('p', t('原始 argv', 'Original argv') + ' · JSONL L' + syntax.rolloutLine, 'quiet'));
    if (syntax.sha256) structure.append(el('p', 'SHA-256 ' + syntax.sha256.slice(0, 16) + '…', 'quiet'));
    for (const item of syntax.diagnostics || []) {
      structure.append(el('p', [item.id, position(item), item.message].filter(Boolean).join(' · '), 'quiet'));
    }
    if (syntax.commands?.length) {
      const sites = el('div', null, 'sites');
      for (const item of syntax.commands) sites.append(el('code', (item.name || t('动态调用', 'Dynamic call')) + ' · ' + position(item)));
      structure.append(sites);
    }
    if ((syntax.commandCount || 0) > (syntax.commands?.length || 0)) {
      structure.append(el('p', t('共 ', '') + num(syntax.commandCount) + t(' 个命令位置', ' command sites'), 'quiet'));
    }
    panel.append(structure);

    const pointer = { session: data.session, cut: data.cut, logId: data.logId };
    const args = el('textarea'), actions = el('div', null, 'copy-actions'), feedback = el('p', null, 'quiet copy-feedback');
    args.readOnly = true;
    args.hidden = true;
    feedback.setAttribute('role', 'status');
    function copy(label, parameters) {
      const node = button(label);
      node.onclick = async () => {
        args.value = JSON.stringify({ ...pointer, ...parameters }, null, 2);
        args.setAttribute('aria-label', label);
        try {
          await navigator.clipboard.writeText(args.value);
          args.hidden = true;
          feedback.textContent = t('参数已复制。', 'Arguments copied.');
        } catch {
          args.hidden = false;
          args.focus();
          args.select();
          feedback.textContent = t('参数已选中，按 Ctrl 或 Cmd + C 复制。', 'Arguments selected. Press Ctrl or Cmd + C to copy.');
        }
      };
      return node;
    }
    actions.append(copy(t('复制诊断工具参数', 'Copy diagnosis arguments'), { seqs: [row.seq] }),
      copy(t('复制原记录参数', 'Copy source record arguments'), { seq: row.seq, linked: true }));
    panel.append(actions, feedback, args);
  }

  function syncSelection() {
    for (const tr of $('rows').querySelectorAll('[data-seq]')) {
      const active = tr.dataset.seq === String(current?.seq);
      tr.dataset.selected = String(active);
      tr.querySelector('button').setAttribute('aria-pressed', String(active));
    }
  }

  function renderRows() {
    const search = $('query').value.trim().toLowerCase(), status = $('status').value;
    const sequence = /^#?(\d+)$/.exec(search)?.[1];
    const turn = turnScopes.get(filters.turn), bin = filters.duration === '' ? null : durationBins[Number(filters.duration)];
    const matches = rows.filter(row => (status === 'all' || row.status === status) &&
      (!turn || row.turn >= turn.start && row.turn <= turn.end) &&
      (!bin || inBin(row, bin)) && (!filters.reason || reasonKey(row) === filters.reason) &&
      (!search || (sequence ? row.seq === Number(sequence) || row.resultSeq === Number(sequence) :
        [row.shell, row.cause.program, action(row), reasonLabel(row), row.cause.reported?.id, row.syntax.diagnostics?.[0]?.id]
          .some(value => String(value || '').toLowerCase().includes(search)))));
    const pages = Math.max(1, Math.ceil(matches.length / pageSize));
    page = Math.min(Math.max(page, 0), pages - 1);
    const visible = matches.slice(page * pageSize, (page + 1) * pageSize);
    if (!visible.includes(current)) current = visible[0] || null;
    set('match-link', t('查看 ', 'View ') + num(matches.length) + t(' 条记录 ↓', ' records ↓'));
    set('page-index', num(matches.length) + t(' 条 · 第 ', ' records · Page ') + (page + 1) + ' / ' + pages + t(' 页', ''));
    $('prev').disabled = page === 0;
    $('next').disabled = page + 1 >= pages;
    $('clear').hidden = status === 'all' && !search && !Object.values(filters).some(Boolean);

    $('active').replaceChildren();
    for (const choice of choices) {
      const pressed = filters[choice.dimension] === choice.value;
      choice.node.setAttribute('aria-pressed', String(pressed));
      if (!pressed) continue;
      const remove = button(choice.label + ' ×');
      remove.setAttribute('aria-label', t('取消筛选 ', 'Remove filter ') + choice.label);
      remove.onclick = () => { filters[choice.dimension] = ''; resetPage(); };
      $('active').append(remove);
    }
    for (const dimension of Object.keys(filters)) updateReadout(dimension);

    const body = $('rows');
    body.replaceChildren();
    for (const row of visible) {
      const tr = el('tr');
      tr.dataset.seq = row.seq;
      const first = el('td'), choose = button('#' + row.seq, 'num');
      choose.setAttribute('aria-label', t('查看调用 #', 'View call #') + row.seq);
      first.append(choose);
      const result = el('td'), badge = el('span', null, 'result');
      const color = row.status === 'error' ? 'var(--error-fill)' : durationColors[row.status];
      badge.append(swatch(color), el('span', reasonLabel(row)));
      result.append(badge);
      tr.append(first, el('td', num(row.turn), 'num'), el('td', row.cause.program || action(row)), result,
        el('td', num(row.exitCode), 'num end'), el('td', ms(row.durationMs), 'num end'));
      tr.addEventListener('click', () => {
        current = row;
        syncSelection();
        renderDetail();
        if (matchMedia('(max-width: 830px)').matches) {
          $('detail-title').focus({ preventScroll: true });
          $('details').scrollIntoView({ block: 'start' });
        }
      });
      body.append(tr);
    }
    if (!visible.length) {
      const tr = el('tr'), cell = el('td', t('没有符合筛选条件的调用。', 'No calls match the filters.'), 'empty');
      cell.colSpan = 6;
      tr.append(cell);
      body.append(tr);
    }
    syncSelection();
    renderDetail();
  }

  function resetPage() {
    page = 0;
    renderRows();
  }
  $('status').onchange = () => {
    if ($('status').value !== 'error' && $('status').value !== 'all') filters.reason = '';
    resetPage();
  };
  $('query').oninput = resetPage;
  $('clear').onclick = () => {
    for (const dimension of Object.keys(filters)) filters[dimension] = '';
    $('status').value = 'all';
    $('query').value = '';
    resetPage();
  };
  $('prev').onclick = () => { page--; renderRows(); };
  $('next').onclick = () => { page++; renderRows(); };
  for (const mode of ['count', 'rate']) $('mode-' + mode).onclick = () => {
    durationMode = mode;
    renderDuration();
  };

  buildTurns();
  buildDuration();
  buildReasons();
  if (selected) {
    const status = $('status').value;
    const before = rows.filter(row => row.seq > selected.seq && (status === 'all' || row.status === status)).length;
    page = Math.floor(before / pageSize);
  }
  renderRows();
})();
