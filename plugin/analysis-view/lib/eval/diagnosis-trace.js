  (() => {
    document.head.insertAdjacentHTML('beforeend', '<style>.geist-result-branch .br-label, .review-action-pinned .br-note, .review-context-overflow-label { pointer-events: bounding-box; }</style>');
    const viewport = $('graph-scroll');
    const graph = $('graph');
    const panel = $('step-panel');
    const branchSelector = '[data-tool-result]';
    const stepSelector = '[data-step], [data-br-step], [data-tool-timing]';
    const barSelector = '[data-context-segment], .review-context-overflow-label, .review-context-capped';
    const roundSelector = '[data-br-round], [data-review-turn-activity], [data-review-duration-range], .review-action-pinned .br-note';
    const t = (zh, en) => globalThis.__trajectoryLocale === 'en' ? en : zh;
    const turnLabel = number => t('第 ' + number + ' 轮', 'Turn ' + number);
    const stepLabel = number => t('第 ' + number + ' 步', 'Step ' + number);

    function rounds(numbers) {
      if (!numbers.length) return null;
      const first = numbers[0], last = numbers.at(-1);
      return { selection: { kind: 'rounds', turns: numbers },
        label: first === last ? turnLabel(first) : t('第 ' + first + '–' + last + ' 轮', 'Turns ' + first + '–' + last) };
    }

    function resultChoice(result) {
      if (result.kind === 'incident') {
        if (result.incident.synthetic) return null;
        return { selection: { kind: 'episode', id: result.incident.id },
          label: turnLabel(result.turn) + ' · ' + (globalThis.__trajectoryUi?.(result.incident.reason) ?? result.incident.reason) };
      }
      if (!result.seqs.length) return null;
      const label = toolResultLabel(result);
      return { selection: { kind: 'result', label, turn: result.turn, step: result.step, seqs: result.seqs }, label };
    }

    function bundle(choices) {
      const items = choices.filter(Boolean);
      if (items.length <= 1) return items[0] ?? null;
      return { selection: { kind: 'bundle', items: items.map(item => item.selection) },
        label: t(items.length + ' 项记录', items.length + ' records') };
    }

    function branchChoices(node) {
      const group = geistOutcomeBranches[Number(node.dataset.toolResult)];
      return group ? group.members.map(({ result }) => resultChoice(result)) : [];
    }

    function stepLocation(node) {
      const key = node.dataset.brStep ?? node.dataset.toolTiming;
      if (!key) {
        const row = turn();
        return { row, step: row.steps[Number(node.dataset.step)] };
      }
      const [number, stepNumber] = key.split(':').map(Number);
      const row = brRound(number);
      return { row, step: row.steps.find(step => step.number === stepNumber) };
    }

    function stepRecord(step) {
      return { step: step.number, from: step.seq, to: step.endSeq, calls: step.calls.length, errors: step.errors };
    }

    function stepChoice(row, step) {
      return { selection: { kind: 'step', turn: row.number, ...stepRecord(step) },
        label: turnLabel(row.number) + ' · ' + stepLabel(step.number) };
    }

    function actionChoices() {
      const row = turn(), step = row.steps[selectedStep];
      const facts = stepInsight(row, step, session.overview.episodes, reviewContextData.callFacts).calls;
      return [...panel.querySelectorAll('.geist-tool-record[data-call-seq]')].map(node => {
        const fact = facts.find(row => row.seq === Number(node.dataset.callSeq));
        if (!Number.isSafeInteger(fact?.seq)) return { node };
        const failed = session.overview.episodes.some(episode => episode.failureSeqs.includes(fact.seq));
        const selection = failed ? { kind: 'failure', seq: fact.seq }
          : { kind: 'result', label: fact.title, turn: row.number, step: step.number, seqs: [fact.seq] };
        return { node, choice: { selection, label: fact.title } };
      });
    }

    function roundsAt(box, frame) {
      const scale = frame.width / graph.viewBox.baseVal.width;
      return rounds(overviewProjection.layout.filter(row =>
        frame.left + row.end * scale >= box.left && frame.left + row.x * scale <= box.right)
        .map(row => row.turn.number));
    }

    function contextChoice(target, node) {
      const stepNode = node.closest('[data-step]');
      const segment = target.closest('[data-context-segment]')?.dataset.contextSegment;
      let current, previous, change, net;
      if (stepNode) {
        const { row, step } = stepLocation(stepNode);
        const info = reviewStepContext(row, step);
        if (!info) return null;
        current = info.current;
        previous = reviewContextRequests[reviewContextStepIndex.get(row.number + ':' + step.number) - 1];
        change = key => info.parts[key];
        net = info.amount;
      } else {
        const info = reviewContextMap.get(Number(node.dataset.contextTurn));
        if (!info) return null;
        current = reviewContextRequests.find(row => row.seq === info.seq);
        previous = reviewContextRequests.find(row => row.seq === info.baselineSeq);
        change = key => info.parts[key].delta;
        net = info.net;
      }
      const ref = ({ turn, step, seq }) => ({ turn, step, seq });
      const categories = CONTEXT_CATEGORIES.map(({ key, label }) => ({
        key, label, before: previous?.[key], after: current[key], delta: previous ? change(key) : null,
      }));
      const scope = turnLabel(current.turn) + (stepNode ? ' · ' + stepLabel(current.step) : '');
      return { selection: { kind: 'context', current: ref(current), previous: previous ? ref(previous) : null,
        byStep: Boolean(stepNode), focus: segment, categories, net: previous ? net : null },
        label: scope + ' · ' + (previous ? t('上下文增量', 'Context change') : t('上下文构成', 'Context composition')) };
    }

    function contextBox(node) {
      const rects = [...node.querySelectorAll('[data-context-segment]')].map(mark => mark.getBoundingClientRect());
      if (!rects.length) return node.getBoundingClientRect();
      return { left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)),
        top: Math.min(...rects.map(r => r.top)), bottom: Math.max(...rects.map(r => r.bottom)) };
    }

    function point(target, position, surface) {
      if (surface === panel) {
        const entry = actionChoices().find(({ node }) => node.contains(target));
        return entry?.choice ? { ...entry.choice, box: entry.node.getBoundingClientRect() } : null;
      }
      // A turn's transparent hit area can cover a visible context segment.
      // Give the segment priority only for diagnosis, leaving normal clicks alone.
      if (target.matches('.br-hit') && target.closest('[data-br-round]')) {
        target = document.elementsFromPoint(position.x, position.y)
          .find(node => node.matches('[data-context-turn] [data-context-segment]')) ?? target;
      }
      const bar = target.closest('[data-context-turn]') ??
        (target.closest(barSelector) ? target.closest('[data-step]') : null);
      if (bar) {
        const choice = contextChoice(target, bar);
        return choice ? { ...choice, box: contextBox(bar) } : null;
      }
      const node = target.closest(branchSelector + ', ' + stepSelector + ', ' + roundSelector);
      let choice;
      if (node?.matches(branchSelector)) choice = bundle(branchChoices(node));
      else if (node?.matches(stepSelector)) {
        const { row, step } = stepLocation(node);
        if (step) choice = stepChoice(row, step);
      } else if (node?.dataset.reviewDurationRange) {
        const [first, last] = node.dataset.reviewDurationRange.split(':').map(Number);
        choice = rounds(session.turns.map(row => row.number).filter(number => number >= first && number <= last));
      } else if (node) choice = rounds([Number(node.dataset.brRound ?? node.dataset.reviewTurnActivity ?? turn().number)]);
      else if (view === 'overview') choice = roundsAt({ left: position.x, right: position.x }, graph.getBoundingClientRect());
      if (!choice) return null;
      const box = node?.getBoundingClientRect() ?? { left: position.x - 7, top: position.y - 7,
        right: position.x + 7, bottom: position.y + 7 };
      return { ...choice, box };
    }

    function inside(box, node) {
      const rect = node.getBoundingClientRect();
      const x = (rect.left + rect.right) / 2, y = (rect.top + rect.bottom) / 2;
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    }

    function intersects(box, node) {
      const rect = node.getBoundingClientRect();
      return box.left <= rect.right && box.right >= rect.left && box.top <= rect.bottom && box.bottom >= rect.top;
    }

    function region(box, surface) {
      if (surface === panel) return bundle(actionChoices().filter(({ node }) => intersects(box, node)).map(({ choice }) => choice));
      if (view === 'path') {
        const row = turn();
        const steps = [...graph.querySelectorAll('[data-step]')]
          .filter(node => intersects(box, node.querySelector('.br-hit') ?? node)).map(node => stepLocation(node).step);
        if (!steps.length) return null;
        if (steps.length === row.steps.length) return rounds([row.number]);
        if (steps.length === 1) return stepChoice(row, steps[0]);
        const span = steps[0].number + '–' + steps.at(-1).number;
        return { selection: { kind: 'steps', turn: row.number, steps: steps.map(stepRecord) },
          label: turnLabel(row.number) + ' · ' + t('第 ' + span + ' 步', 'Steps ' + span) };
      }
      const frame = graph.getBoundingClientRect();
      const mainY = frame.top + overviewProjection.mainY * frame.height / graph.viewBox.baseVal.height;
      if (mainY >= box.top - 5 && mainY <= box.bottom + 5) return roundsAt(box, frame);
      const branches = [...graph.querySelectorAll(branchSelector)].filter(node => inside(box, node.querySelector('.br-label') ?? node));
      return bundle(branches.flatMap(branchChoices)) ?? roundsAt(box, frame);
    }

    window.__bindDiagnosisGesture({
      surfaceFor(target) {
        if (session.id !== data.mainSession || !session.turns.length || view === 'overview' && !overviewProjection) return null;
        if (viewport.contains(target)) return viewport;
        return view === 'path' && target.closest('#step-panel .geist-tool-record') ? panel : null;
      },
      point, region,
    });
  })();
