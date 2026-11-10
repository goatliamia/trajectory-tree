(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const options = window.__trajectoryDiagnosisOptions;
  let data = options ? null : JSON.parse($('diagnosis-data').textContent);
  const frames = { trace: $('trace-view'), eval: $('eval-view') };
  const editor = $('diagnosis-editor');
  const locale = globalThis.__trajectoryLocale ?? 'zh-CN';
  const t = (zh, en) => locale === 'en' ? en : zh;
  const ui = value => globalThis.__trajectoryUi?.(value) ?? value;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const unrecorded = t('未记录', 'Unrecorded');
  const unnamed = t('未记工具名', 'Unnamed tool');
  const fmt = value => Number.isFinite(value) ? number.format(value) : unrecorded;
  const turnLabel = turn => t(`第 ${turn} 轮`, `Turn ${turn}`);
  const stepLabel = step => t(`第 ${step} 步`, `Step ${step}`);
  const scopeLabel = turn => turn == null ? t('整段会话', 'Full session') : turnLabel(turn);
  const refs = seqs => seqs.slice(0, 3).map(seq => '#' + seq).join(t('、', ', ')) +
    (seqs.length > 3 ? t(` 等 ${seqs.length} 条`, ` and others (${seqs.length} total)`) : '');
  const signed = value => (value > 0 ? '+' : '') + fmt(value);

  function duration(ms) {
    if (!Number.isFinite(ms)) return unrecorded;
    if (ms < 1000) return `${ms}ms`;
    const minutes = Math.floor(ms / 60_000);
    return (minutes ? `${minutes}m ` : '') + `${fmt(ms / 1000 - minutes * 60)}s`;
  }

  let active = 'trace';
  let generated = '';
  let current;
  let anchor;
  const portable = () => data?.host && data.host !== 'dsh';
  const sourceArgs = () => ({ session: data.session, ...(Number.isSafeInteger(data.cut) ? { cut: data.cut } : {}),
    ...(portable() && data.logId ? { logId: data.logId } : {}) });
  const inspect = args => `trajectory_inspect(${JSON.stringify({ ...sourceArgs(), ...args })})`;

  function episodeSelection(episode, failedSeq) {
    const failures = failedSeq == null ? episode.failureSeqs : [failedSeq];
    const reads = failedSeq == null || episode.failureSeqs.length === 1 ? episode.readSeqs : [];
    const returned = episode.pairs.filter(pair => failures.includes(pair.failedSeq)).map(pair => pair.successSeq);
    return {
      kind: 'episode', label: `${turnLabel(episode.turn)} · ${ui(episode.reason)}`,
      scope: failedSeq == null ? t('选中枝条', 'Selected branch') : t('选中调用', 'Selected call'),
      facts: [
        `${t('报错', 'Errors')} ${refs(failures)} · ${episode.condition}`,
        reads.length ? `${t('读取', 'Reads')} ${refs(reads)}` : '',
        returned.length ? `${t('同参非报错返回', 'Non-error returns with the same arguments')} ${refs(returned)}`
          : t('本轮未见同参非报错返回', 'No non-error return with the same arguments was recorded in this turn'),
      ].filter(Boolean),
      first: failures[0], after: returned[0], sequences: failures,
    };
  }

  function roundSelection(numbers) {
    const rows = data.rounds.filter(row => numbers.includes(row.number));
    if (!rows.length) return null;
    const ranges = [];
    for (const { number } of rows) {
      const previous = ranges.at(-1);
      if (previous?.to === number - 1) previous.to = number;
      else ranges.push({ from: number, to: number });
    }
    const single = rows.length === 1;
    const labels = ranges.map(({ from, to }) => from === to ? from : `${from}–${to}`);
    return { kind: single ? 'turn' : 'rounds', label: single ? turnLabel(labels[0]) : t(`第 ${labels.join('、')} 轮`, `Turns ${labels.join(', ')}`),
      scope: single ? t('整轮', 'Full turn') : t(`${rows.length} 轮`, `${rows.length} turns`), ranges, roundFacts: rows.length <= 3 ? rows : [] };
  }

  function selectionModel(selection) {
    if (!selection) return null;
    const { kind, turn } = selection;
    if (kind === 'rounds') return roundSelection(selection.turns);
    if (kind === 'context') {
      const { current, previous, byStep, focus, categories, net } = selection;
      const ref = row => t(`第 ${row.turn} 轮${byStep ? `第 ${row.step} 步` : '末次有记录的'}请求（响应 #${row.seq}）`,
        byStep ? `turn ${row.turn}, step ${row.step} (response #${row.seq})` : `last recorded request in turn ${row.turn} (response #${row.seq})`);
      const parts = categories.filter(row => Number.isFinite(row.after) && (!previous || row.delta || row.key === focus))
        .sort((a, b) => Number(b.key === focus) - Number(a.key === focus) ||
          Math.abs(b.delta ?? b.after) - Math.abs(a.delta ?? a.after));
      const amounts = parts.map(row => previous
        ? `${ui(row.label)} ${signed(row.delta)} (${fmt(row.before)} → ${fmt(row.after)})`
        : `${ui(row.label)} ${fmt(row.after)}`);
      return { kind, current, previous,
        label: `${turnLabel(current.turn)}${byStep ? ` · ${stepLabel(current.step)}` : ''} · ${previous ? t('上下文增量', 'Context change') : t('上下文构成', 'Context composition')}`,
        scope: byStep ? t('请求对照', 'Request comparison') : t('轮末请求', 'Last request in turn'),
        facts: [previous ? t(`比较 ${ref(previous)} 到 ${ref(current)}`, `Compare ${ref(previous)} with ${ref(current)}`)
          : t(`观察 ${ref(current)}`, `Inspect ${ref(current)}`),
          previous ? t(`构成估算净变化 ${signed(net)} token`, `Estimated net change ${signed(net)} tokens`) : '',
          amounts.length ? t(`分来源（token）${amounts.join('、')}`, `Tokens by source: ${amounts.join(', ')}`) : '',
          focus ? `${t('关注 ', 'Focus on ')}${ui(categories.find(row => row.key === focus)?.label ?? t('所选来源', 'the selected source'))}` : ''].filter(Boolean) };
    }
    if (kind === 'bundle') {
      const objects = selection.items.map(selectionModel).filter(Boolean);
      if (objects.length <= 1) return objects[0] ?? null;
      const count = objects.length;
      const facts = objects.slice(0, 3).map(item => item.label + (item.first == null ? '' : ` #${item.first}`));
      const calls = new Set(objects.flatMap(row => row.sequences ?? [])).size;
      return { kind, label: t(`${count} 项记录`, `${count} records`), scope: t('圈选区域', 'Selected region'), objects,
        facts: [...(calls && calls !== count ? [t(`可批量核对 ${calls} 个调用序号`, `${calls} call sequences can be checked together`)] : []),
          ...(count > 3 ? [t(`范围内包括 ${facts.join('、')} 等 ${count} 项`, `Includes ${facts.join(', ')} and others (${count} total)`)] : facts)] };
    }
    if (kind === 'episode' || kind === 'failure') {
      const episode = kind === 'episode'
        ? data.episodes.find(row => row.id === selection.id)
        : data.episodes.find(row => row.failureSeqs.includes(selection.seq));
      return episode ? episodeSelection(episode, kind === 'failure' ? selection.seq : null) : null;
    }
    if (kind === 'result') {
      return {
        kind, label: selection.label,
        scope: `${turnLabel(turn)} · ${stepLabel(selection.step)}`,
        facts: [`${t('关联记录', 'Related records')} ${refs(selection.seqs)}`], first: selection.seqs[0], sequences: selection.seqs,
      };
    }
    if (kind === 'step') {
      const { step, from, to, calls, errors } = selection;
      return { kind, label: `${turnLabel(turn)} · ${stepLabel(step)}`, scope: t('行动步骤', 'Action step'),
        first: from, to, facts: [t(`${fmt(calls)} 次调用，${fmt(errors)} 次报错`, `${fmt(calls)} calls, ${fmt(errors)} errors`)] };
    }
    if (kind === 'steps') {
      const { steps } = selection;
      const windows = [];
      for (const { from, to } of steps) {
        const previous = windows.at(-1);
        if (previous?.to != null && to != null && from <= previous.to + 1) previous.to = Math.max(previous.to, to);
        else windows.push({ from, to });
      }
      const range = `${steps[0].step}–${steps.at(-1).step}`;
      return { kind, turn, label: `${turnLabel(turn)} · ${t(`第 ${range} 步`, `Steps ${range}`)}`,
        scope: t(`${steps.length} 步`, `${steps.length} steps`), windows, facts: [] };
    }
    if (kind === 'group') {
      const { tool, group } = selection;
      const examples = group.conditions.flatMap(condition => condition.examples);
      const candidates = [examples.find(row => row.returned != null), examples.find(row => row.returned == null)]
        .filter(Boolean).map(row => row.failed);
      const codes = group.conditions.map(condition => condition.code);
      return {
        kind, turn, tool, scope: scopeLabel(turn),
        label: `${tool || unnamed} × ${group.label}`,
        facts: [t(`整组 ${group.calls} 次报错，${group.matched} 次有同轮同参非报错返回`,
          `${group.calls} errors, ${group.matched} with a same-argument non-error return in the same turn`),
          `${t('错误码', 'Error codes')} ${codes.join(t('、', ', '))}`,
          candidates.length ? `${t('代表记录', 'Example records')} ${refs(candidates)}` : ''].filter(Boolean),
        first: candidates[0],
      };
    }
    if (kind === 'tool') {
      const { name, timing, slowest } = selection;
      return {
        kind, turn, tool: name,
        label: name == null ? t('全部工具', 'All tools') : name || unnamed, scope: scopeLabel(turn),
        facts: [t(`累计耗时 ${duration(timing.cumulativeMs)} · ${timing.pairedCalls}/${timing.calls} 次有起止记录`,
          `Cumulative duration ${duration(timing.cumulativeMs)} · ${timing.pairedCalls}/${timing.calls} calls timed`),
          timing.reportedCalls ? t(`宿主另记录 ${timing.reportedCalls} 次调用耗时，合计 ${duration(timing.reportedMs)}`,
            `${timing.reportedCalls} other host-reported durations total ${duration(timing.reportedMs)}`) : '',
          slowest.length ? `${t('最慢记录', 'Slowest calls')} ${refs(slowest.map(row => row.call))}` : ''].filter(Boolean),
        first: slowest[0]?.call,
      };
    }
    return null;
  }

  const methods = {
    '综合诊断': 'overall diagnosis', '工具与文件使用': 'tool and file use',
    '反复尝试': 'repeated attempts', '上下文持续使用': 'context continuity',
    '耗时与等待': 'latency and waiting', '用量与能力投入': 'usage and capability',
    '相应专项': 'method suited to the question',
  };
  const intent = (zh, en, method, askZh, askEn, options) =>
    ({ label: t(zh, en), method, ask: t(askZh, askEn), ...options });
  const questions = {
    episode: [
      intent('为什么受阻', 'What blocked progress?', '工具与文件使用', '核对当时缺少的前置条件和正式报错。', 'Check the missing prerequisites and recorded errors.'),
      intent('后来验收了吗', 'Was the work verified later?', '综合诊断', '按原任务的验收要求，分别核对调用返回、实际产物和验证证据。', 'Check the tool result, actual deliverable and verification evidence against the original requirements.', { after: true }),
      intent('下次怎么避免', 'How could this be avoided?', '反复尝试', '找出最早足以改变做法的反馈，以及下次可以提前做的检查。', 'Find the earliest actionable feedback and what could be checked sooner next time.'),
    ],
    result: [
      intent('这次操作带来了什么', 'What did this action yield?', '工具与文件使用', '核对操作目标、实际返回和获得的新信息。', 'Check the intended action, actual result and new information obtained.'),
      intent('后来用上了吗', 'Was this result used later?', '综合诊断', '沿后续动作检查这次结果怎样影响决定、产物或验证。', 'Check how the result affected later decisions, deliverables or verification.'),
    ],
    step: [
      intent('这一步推进了什么', 'What did this step advance?', '综合诊断', '核对这一步的目标、行动、返回和对后续的影响。', 'Check this step’s goal, actions, results and effect on later work.'),
      intent('为什么卡在这一步', 'Why did this step stall?', '工具与文件使用', '检查工具反馈、前置条件和随后的处理。', 'Check tool feedback, prerequisites and what happened next.'),
    ],
    steps: [
      intent('这几步怎么推进的', 'How did these steps progress?', '综合诊断', '按步骤串起行动、收到的反馈和产生的结果。', 'Connect actions, feedback and results in step order.'),
      intent('哪一步改变了结果', 'Which step changed the outcome?', '反复尝试', '核对哪些反馈被用上，以及哪个动作实际改变了结果。', 'Check which feedback was acted on and which action changed the outcome.'),
    ],
    context: [
      intent('拆上下文构成', 'Break down the context', '上下文持续使用', '按来源核对组成及增减，找出对应的新增、保留、替换或压缩记录。', 'Compare composition and changes by source. Locate records of additions, retention, replacements or compaction.'),
      intent('这些材料后来用上了吗', 'Was this material used later?', '上下文持续使用', '沿后续请求和动作核对材料怎样保留、更新以及被实际使用。', 'Follow later requests and actions to see how the material was retained, updated and used.'),
    ],
    bundle: [
      intent('这些记录说明什么', 'What do these records show?', '综合诊断', '围绕选中的对象串起行动、反馈和实际结果，核对它们之间有证据的联系。', 'Connect the selected actions, feedback and results where the records support a link.'),
      intent('哪里反复或受阻', 'What repeated or stalled?', '反复尝试', '找出重复尝试、得到的反馈和真正改变结果的动作。', 'Find repeated attempts, the feedback they received and what changed the outcome.'),
    ],
    group: [
      intent('这组报错集中在哪', 'Where did these errors cluster?', '工具与文件使用', '在选中范围内比较触发条件和出现位置，核对代表记录。', 'Compare where these errors occurred and what triggered them. Verify representative records.'),
      intent('后来怎么处理', 'How were these handled?', '反复尝试', '对照有同参返回和后续待确认的记录，检查实际改变的动作与结果。', 'Compare same-argument returns with unconfirmed follow-ups. Check what changed and what resulted.'),
    ],
    turn: [
      intent('这一轮推进了什么', 'What did this turn advance?', '综合诊断', '先核对本轮任务，再沿关键记录检查产物和验证。', 'Start with the task, then check its deliverables and verification against key records.', { view: 'overview' }),
      intent('时间花在哪', 'Where did the time go?', '耗时与等待', '比较模型处理、工具等待和后续依赖，找实际挡住推进的环节。', 'Compare model processing, tool waits and later dependencies to identify what held up progress.', { view: 'latency' }),
      intent('输出花在哪', 'What used the output tokens?', '用量与能力投入', '结合任务核对输出用于生成产物、工具调用还是反复汇报。', 'Check whether output went to deliverables, tool calls or repeated status updates.', { view: 'cost' }),
    ],
    rounds: [
      intent('这几轮怎么推进的', 'How did these turns progress?', '综合诊断', '先按阶段概览，再沿关键记录核对推进、产物和验证。', 'Start with the stages, then check progress, deliverables and verification against key records.', { view: 'overview' }),
      intent('耗时差在哪', 'Where did the timings differ?', '耗时与等待', '按轮比较输出、模型处理和工具等待，再核对影响推进的环节。', 'Compare output, model processing and tool waits by turn, then check what affected progress.', { view: 'latency' }),
      intent('哪里发生了返工', 'Where did rework occur?', '反复尝试', '核对重复尝试、收到的反馈和真正改变结果的动作。', 'Check repeated attempts, their feedback and which actions changed the outcome.', { view: 'repeats' }),
    ],
    tool: [
      intent('耗时主要来自哪', 'Where did the tool time go?', '耗时与等待', '区分一次长调用和累积等待，再核对哪些调用挡住了后续推进。', 'Separate individual slow calls from cumulative waits. Check which calls held up later work.'),
      intent('怎么减少等待', 'How could waiting be reduced?', '耗时与等待', '找出可以提前得到所需结果的做法，并给出保持验收的验证方式。', 'Find ways to obtain the needed result earlier and verify they still meet the requirements.'),
    ],
  };

  const toolSupplyQuestion = intent('查工具来源与供给', 'Inspect tool source and availability', '用量与能力投入',
    '核对这项工具在选中范围内的声明和调用，说明来源覆盖，按已确认的来源给出适用策略。',
    'Check the tool declarations and calls in scope. State what is known about their sources and which host strategies apply.', { view: 'cost' });

  function inspectSelectedCalls(sequences) {
    const sorted = [...new Set(sequences)].sort((a, b) => a - b);
    const queries = [];
    for (let i = 0; i < sorted.length; i += data.maxCallSelection) {
      const args = { view: 'io', seqs: sorted.slice(i, i + data.maxCallSelection),
        groupBy: 'tool', limit: 10, samples: false, ...(portable() ? { includeSelf: true } : {}) };
      queries.push(inspect(args));
    }
    return [t('批量核对所选调用。', 'Check the selected calls in batches.'), ...queries].join('\n');
  }

  function evidenceEntry(item, question) {
    if (item.kind === 'tool' && question.view === 'cost') {
      const turns = item.turn == null ? {} : { turns: { from: item.turn, to: item.turn } };
      const query = inspect({ view: 'cost', focus: { tool: item.tool }, ...turns, limit: 1, samples: false });
      return t(`从 ${query} 核对声明与调用。`, `Use ${query} to check declarations and calls.`);
    }
    if (item.kind === 'bundle') {
      const sequences = item.objects.flatMap(row => row.sequences ?? []);
      const direct = sequences.length ? [inspectSelectedCalls(sequences)] : [];
      return [...direct, ...item.objects.filter(row => !row.sequences).map(row => evidenceEntry(row, question))].join('\n');
    }
    if (item.kind === 'context') {
      const from = item.previous?.turn ?? item.current.turn;
      const query = inspect({ view: 'context', format: 'data', turns: { from, to: item.current.turn } });
      return t(`从 ${query} 开始取证。`, `Start with ${query}.`);
    }
    if (item.kind === 'steps') {
      const windows = item.windows.map(({ from, to }) => to == null ? t(`从 #${from} 取关联记录`, `linked records from #${from}`) : `#${from}–#${to}`);
      const query = inspect({ view: 'overview', turns: { from: item.turn, to: item.turn }, samples: false });
      return t(`先用 ${query} 获取 snapshot，再用 trajectory_read 分段核对 ${windows.join('、')}。`,
        `Get the snapshot from ${query}, then use trajectory_read to check ${windows.join(', ')} in batches.`);
    }
    const first = question.after && item.after != null ? item.after : item.first;
    const read = Number.isSafeInteger(first) ? `trajectory_read(${JSON.stringify({ ...sourceArgs(), seq: first,
      ...(portable() ? { linked: true } : { format: 'linked' }) })})` : null;
    if (item.kind === 'episode' || item.kind === 'result') {
      if (!question.after && item.sequences.length > 1) return inspectSelectedCalls(item.sequences);
      return t(`从 ${read} 开始取证。`, `Start with ${read}.`);
    }
    if (item.kind === 'step') {
      return t(`从 ${read} 查这一步。`, `Check this step with ${read}.`) + (item.to == null ? '' :
        t(`再沿返回的 snapshot，用 trajectory_read 分段核对 #${first}–#${item.to}。`,
          ` Use that snapshot to read #${first}–#${item.to} in batches with trajectory_read.`));
    }
    const isGroup = item.kind === 'group';
    const view = isGroup || item.kind === 'tool' ? 'io' : question.view ?? 'latency';
    const args = { view, ...(portable() ? { includeSelf: true } : {}) };
    if (item.kind === 'rounds' && ['overview', 'latency', 'cost'].includes(view)) args.groupBy = 'turn';
    if (item.kind === 'tool') args.groupBy = 'tool';
    if (item.tool) args.focus = { tool: item.tool };
    if (isGroup) args.outcome = 'error';
    const ranges = item.ranges;
    if (ranges?.length > 1) {
      const query = inspect({ ...args, turns: ranges[0] });
      const rest = ranges.slice(1).map(range => JSON.stringify(range)).join(t('、', ', '));
      return t(`从 ${query} 开始，沿用 snapshot 分别查询其余 turns：${rest}。`,
        `Start with ${query}. Reuse its snapshot to query the remaining turns separately: ${rest}.`);
    }
    if (ranges?.length) args.turns = ranges[0];
    else if (item.turn != null) args.turns = { from: item.turn, to: item.turn };
    const query = inspect(args);
    return t(`用 ${query} ${isGroup ? '按列出的错误码核对' : '查询'}。`,
      `Use ${query}${isGroup ? ' to check the listed error codes' : ''}.`) +
      (read == null ? '' : t(`必要时用 ${read}。`, ` If needed, use ${read}.`));
  }

  function fill(item, question) {
    const showOutput = question.view === 'cost' || (item.kind === 'rounds' && question.method === '耗时与等待');
    const showToolSupply = item.kind === 'tool' && question.view === 'cost';
    const facts = item.roundFacts ? item.roundFacts.map(row => {
      const label = item.kind === 'turn' ? '' : `${turnLabel(row.number)} `;
      const output = showOutput && row.outputRecords
        ? t(`，已记录输出 ${fmt(row.output)} token（${row.outputRecords}/${row.requests} 条响应）`,
          `, ${fmt(row.output)} recorded output tokens (${row.outputRecords}/${row.requests} responses)`) : '';
      return t(`${label}耗时 ${duration(row.ms)}，${row.calls} 次调用、${row.errors} 次报错${output}`,
        `${label}duration ${duration(row.ms)}, ${row.calls} calls, ${row.errors} errors${output}`);
    }) : showToolSupply ? [] : item.facts;
    const entry = data.host === 'codex' ? '$trace-analysis' : data.host === 'claude' ? '/trajectory-tree:trace-analysis' : '';
    const text = [
      ...(entry ? [entry] : []),
      question.prompt ?? t(`请分析「${question.label}」。${question.ask}`, `Analyze: ${question.label} ${question.ask}`),
      t(`范围为会话 ${data.session} 截至 #${data.cut}。`, `Scope: session ${data.session} through #${data.cut}.`),
      ...(data.host === 'claude' && data.file ? [`Transcript ${data.file}`] : []),
      t(`选中${item.label}（${item.scope}）${facts.length ? ' · ' + facts.join('。') : ''}。`,
        `Selected: ${item.label} (${item.scope})${facts.length ? ' · ' + facts.join('. ') : ''}.`),
      t(entry ? `采用「${question.method}」方法。` : `使用 trace-analysis 的「${question.method}」方法。`,
        entry ? `Apply the ${methods[question.method]} method.` : `Apply the ${methods[question.method]} method from trace-analysis.`),
      evidenceEntry(item, question),
      t('引用关键记录序号，说明能确认到哪一步。', 'Cite the key record numbers and state what the evidence can confirm.'),
    ].join('\n');
    const draft = $('draft');
    const prefix = generated && draft.value.endsWith(generated)
      ? draft.value.slice(0, -generated.length)
      : draft.value ? draft.value + '\n\n' : '';
    draft.value = prefix + text;
    generated = text;
    draft.scrollTop = 0;
  }

  function action(label, run) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', run);
    return button;
  }

  function positionEditor() {
    const frame = frames[active]?.getBoundingClientRect() ?? { top: 0, left: 0 };
    const { width, height } = editor.getBoundingClientRect();
    const left = frame.left + anchor.left - width - 10;
    const right = frame.left + anchor.right + 10;
    const fitsRight = right + width <= innerWidth - 12;
    const fitsSide = fitsRight || left >= 12;
    const top = frame.top + anchor.top;
    const below = frame.top + anchor.bottom + 8;
    const y = fitsSide ? top : below + height <= innerHeight - 12 ? below : top - height - 8;
    const x = fitsRight ? right : fitsSide ? left : frame.left + anchor.right - width;
    editor.style.top = `${Math.max(12, Math.min(y, innerHeight - height - 12))}px`;
    editor.style.left = `${Math.max(12, Math.min(x, innerWidth - width - 12))}px`;
  }

  function chooseQuestion(question, button) {
    for (const choice of editor.querySelectorAll('.intents button')) {
      choice.setAttribute('aria-pressed', String(choice === button));
    }
    $('custom').hidden = true;
    fill(current, question);
    positionEditor();
  }

  function openEditor(item, buttonBounds, view) {
    current = item;
    anchor = buttonBounds;
    $('selection-title').textContent = item.label;
    $('question').value = '';
    $('diagnosis-status').textContent = '';
    const intents = item.kind === 'tool' && data.host === 'dsh' && item.tool
      ? [...questions.tool, toolSupplyQuestion] : questions[item.kind];
    const choices = intents.map(question => action(question.label, event => chooseQuestion(question, event.currentTarget)));
    $('questions').replaceChildren(...choices);
    editor.hidden = false;
    const preferred = view ? Math.max(0, intents.findIndex(question => question.view === view)) : 0;
    chooseQuestion(intents[preferred], choices[preferred]);
    $('draft').focus({ preventScroll: true });
    $('draft').scrollTop = 0;
  }

  function openView(name) {
    editor.hidden = true;
    active = name;
    const hint = $('view-hint');
    hint.textContent = name === 'trace' ? t('长按点选 · 按住后拖动圈选', 'Hold to select · Hold and drag to select a region')
      : t('点图看详情 · 在详情里提问', 'Select a chart item · Ask from its details');
    hint.title = name === 'trace' ? t('聚焦图上对象后，也可按 Shift+Enter 选取', 'Focus an item and press Shift+Enter to select it') : '';
    for (const [key, frame] of Object.entries(frames)) frame.hidden = key !== name;
    for (const button of $('tabs').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.view === name));
    }
    if (!frames[name].hasAttribute('srcdoc')) frames[name].srcdoc = data.views[name];
  }

  window.addEventListener('message', event => {
    if (event.data?.type !== 'diagnosis-demo-confirm' || frames[active]?.contentWindow !== event.source) return;
    const { selection, anchor, view } = event.data;
    if (![anchor?.top, anchor?.left, anchor?.right, anchor?.bottom].every(Number.isFinite)) return;
    const item = selectionModel(selection);
    if (item) openEditor(item, anchor, view);
  });
  window.addEventListener('resize', () => { if (!editor.hidden) positionEditor(); });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !editor.hidden) editor.hidden = true;
  });
  $('close-editor').onclick = () => { editor.hidden = true; };
  $('tabs')?.addEventListener('click', event => {
    const button = event.target.closest('button[data-view]');
    if (button && button.dataset.view !== active) openView(button.dataset.view);
  });
  $('ask-custom').addEventListener('click', () => {
    $('custom').hidden = !$('custom').hidden;
    positionEditor();
    if (!$('custom').hidden) $('question').focus();
  });
  $('custom').addEventListener('submit', event => {
    event.preventDefault();
    const prompt = $('question').value.trim();
    if (prompt && current) chooseQuestion({ prompt, method: '相应专项', view: 'overview' }, $('ask-custom'));
  });

  if (!options) {
    $('diagnosis-mode').textContent = t('DSH 输入框预览', 'DSH draft preview');
    $('source').textContent = t(`DSH 实录 · ${fmt(data.rounds.length)} 轮 · ${fmt(data.calls)} 次调用 · ${fmt(data.errors)} 次报错 · #${data.cut}`,
      `DSH records · ${fmt(data.rounds.length)} turns · ${fmt(data.calls)} calls · ${fmt(data.errors)} errors · #${data.cut}`);
    openView('trace');
    return;
  }

  window.__diagnosisDemoAsk = (selection, button, view) => {
    const source = options.source();
    if (!source?.session || !Number.isSafeInteger(source.cut)) return;
    if (data && data.session !== source.session) { $('draft').value = ''; generated = ''; }
    data = source;
    const item = selectionModel(selection);
    if (item) openEditor(item, button.getBoundingClientRect(), view);
  };
  const apply = $('diagnosis-apply'), status = $('diagnosis-status'), draft = $('draft');
  const embeddedDsh = options.mode === 'dsh' && parent !== window;
  editor.querySelector('.editor-actions').hidden = false;
  apply.hidden = !embeddedDsh && options.mode !== 'pi';
  apply.textContent = embeddedDsh ? t('填入对话', 'Fill conversation') : t('复制 Pi 装填指令', 'Copy Pi draft command');
  const unavailable = t('对话暂不可用，可复制草稿', 'Conversation unavailable. You can copy the draft.');
  const copy = async (text, label) => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const input = document.createElement('textarea');
      input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      input.value = text;
      document.body.append(input);
      input.select();
      const copied = document.execCommand?.('copy');
      input.remove();
      if (!copied) { draft.select(); status.textContent = t('可手动复制草稿', 'Copy the selected draft manually.'); return; }
    }
    status.textContent = label;
  };
  $('diagnosis-copy').onclick = () => copy(draft.value, t('草稿已复制', 'Draft copied'));
  apply.onclick = () => {
    if (!data || !draft.value.trim()) return;
    if (embeddedDsh) {
      apply.disabled = true;
      parent.postMessage({ type: 'analysis-diagnosis-draft', sessionId: data.session, prompt: draft.value }, location.origin);
      setTimeout(() => { if (apply.disabled) { apply.disabled = false; status.textContent = unavailable; } }, 2000);
      return;
    }
    const encoder = new TextEncoder();
    const tooLong = t('草稿较长，请复制正文', 'Draft too long for a command. Copy the draft text instead.');
    if (encoder.encode(draft.value).length > 8192) { status.textContent = tooLong; return; }
    const encoded = btoa(Array.from(encoder.encode(JSON.stringify({ session: data.session, prompt: draft.value })), byte => String.fromCharCode(byte)).join(''))
      .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    if (encoded.length > 16384) { status.textContent = tooLong; return; }
    copy('/trajectory --draft ' + encoded, t('装填指令已复制', 'Draft command copied'));
  };
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'analysis-diagnosis-ack' ||
        event.data.sessionId !== data?.session) return;
    apply.disabled = false;
    status.textContent = event.data.applied ? t('已填入对话', 'Conversation filled') : unavailable;
    if (event.data.applied) editor.hidden = true;
  });
})();
