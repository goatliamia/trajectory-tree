  // Antigravity host adapter for the shared Geist Trajectory Tree renderer.
  const agyUi = (zh, en) => window.__trajectoryLocale === 'en' ? en : zh;
  const agyValue = n => Number.isFinite(n) ? geistContextNumber(n) : agyUi('未记录', 'Not recorded');
  const agyHeader = header;
  header = function() {
    agyHeader();
    $('session-name').textContent = agyUi('ANTIGRAVITY · 本地会话', 'ANTIGRAVITY · Local session');
    $('session-facts').innerHTML = session.totals.turns + agyUi(' 轮', ' turns') + '<span>/</span>' + session.totals.steps + agyUi(' 步', ' steps') + '<span>/</span>' + session.totals.calls + agyUi(' 次调用', ' tool calls');
  };
  showSource = function() {
    const rows = [
      [agyUi('来源', 'Source'), agyUi('conversations/<id>.db（SQLite 原生步骤与 gen_metadata）+ transcript_full.jsonl（完整正文）', 'conversations/<id>.db (native steps & gen_metadata) + transcript_full.jsonl (full text)')],
      [agyUi('单位', 'Units'), agyUi('每次 USER_INPUT 开启一轮，PLANNER_RESPONSE 为模型步，GENERIC 为工具执行步，CHECKPOINT 为压缩切点。', 'Each USER_INPUT starts a turn; PLANNER_RESPONSE is a model step; GENERIC is a tool step; CHECKPOINT marks compaction.')],
      [agyUi('计时', 'Timing'), agyUi('工具起止来自 steps.metadata 原生时间戳；首字等待与流式耗时来自 gen_metadata。', 'Tool intervals come from steps.metadata timestamps; TTFT and stream duration come from gen_metadata.')],
      [agyUi('上下文与用量', 'Context & usage'), agyUi('宿主仅保留最近一次请求的完整提示（7 类估算在「上下文构成」页签查看）；历史轮次实报用量与缓存回落在「单对话 Eval」查看。', 'Host retains full prompt only for the latest request (see Context Composition tab); historical reported usage & cache drops appear in Single-Session Eval.')],
      [agyUi('子代理', 'Subagents'), agyUi('当前展示子代理委派调用与角色摘要，不递归展开子会话轨迹。', 'Shows subagent delegation calls and role summaries without recursively loading child transcripts.')],
    ];
    openDrawer(agyUi('Antigravity 数据依据', 'Antigravity data sources'), agyUi('本地数据库与日志 · 只读', 'Local DB & transcript · read only'), rows.map(([k, v]) => '<div class="source-row"><span>' + esc(k) + '</span>' + esc(v) + '</div>').join(''));
  };

  // Populate step timing directly from Antigravity's native gen_metadata + tool intervals
  geistStatsByStep.clear();
  for (const t of session.turns) {
    for (const s of t.steps) {
      const toolSum = s.calls.reduce((sum, c) => sum + (Number.isFinite(c.durationMs) ? c.durationMs : 0), 0);
      const timedCalls = s.calls.filter(c => Number.isFinite(c.durationMs));
      geistStatsByStep.set(t.number + ':' + s.number, {
        turn: t.number,
        step: s.number,
        model: s.timing?.modelMs ?? null,
        ttft: s.timing?.ttftMs ?? null,
        decode: s.timing?.decodeMs ?? null,
        toolWall: timedCalls.length ? Math.max(...timedCalls.map(c => c.end)) - Math.min(...timedCalls.map(c => c.start)) : null,
        tool: timedCalls.length ? toolSum : null,
        calls: timedCalls.map(c => ({ seq: c.seq, name: c.name, ms: c.durationMs })),
        tools: s.calls.map(c => ({ name: c.name, count: 1 })),
        toolPending: s.calls.filter(c => c.status === 'unknown').length,
      });
    }
  }

  // Override context drawer for turns to show Antigravity's native reported usage cleanly
  reviewOpenContext = function(number, stepNumber) {
    const rows = (reviewContextData.usage || []).filter(row => row.turn === number && (stepNumber == null || row.step === stepNumber));
    const html = '<p class="review-explain">' + agyUi('Antigravity 宿主会裁掉历史请求的完整提示，因此按轮展示已记录的实报用量；最近请求的 7 类来源构成可在「上下文构成」页签缩放查看。', 'Antigravity strips older full prompts, so turn details show recorded usage; inspect the latest 7-category breakdown in the Context Composition tab.') + '</p>' +
      (rows.length ? rows.map(({ step, seq, model, usage: u }) => '<div class="source-row"><span>' + agyUi('第 ' + step + ' 步 · #' + seq, 'Step ' + step + ' · #' + seq) + (model ? ' · ' + esc(model) : '') + '</span>' +
        agyUi('输入 ', 'Input ') + agyValue(u.input) + agyUi(' · 缓存读 ', ' · Cache read ') + agyValue(u.cacheRead) +
        (u.cacheWrite ? agyUi(' · 缓存写 ', ' · Cache write ') + agyValue(u.cacheWrite) : '') +
        agyUi(' · 输出 ', ' · Output ') + agyValue(u.output) + ' tokens</div>').join('') : '<p>' + agyUi('该范围暂无实报用量记录。', 'No recorded usage in this scope.') + '</p>');
    openDrawer(agyUi('第 ' + number + ' 轮 · Antigravity 用量', 'Turn ' + number + ' · Antigravity usage'), agyUi('gen_metadata 实报用量', 'Recorded usage'), html);
  };

  const agyCaption = geistArrangeCaption;
  geistArrangeCaption = function() {
    agyCaption();
    let button = $('agy-source-link');
    if (!button) {
      button = document.createElement('button');
      button.id = 'agy-source-link';
      button.className = 'geist-text-action quiet';
      button.onclick = showSource;
      $('geist-legend')?.append(button);
    }
    button.textContent = agyUi('Antigravity 数据依据 ↗', 'Antigravity data sources ↗');
  };

  // Sync dark/light theme from parent sidecar frame if embedded
  try {
    const syncParentTheme = () => {
      const parentTheme = window.parent !== window ? window.parent.document?.documentElement?.dataset?.theme : null;
      if (parentTheme === 'dark' || parentTheme === 'light') {
        document.documentElement.dataset.theme = parentTheme;
      }
    };
    syncParentTheme();
    if (window.parent !== window && window.parent.document?.documentElement) {
      new MutationObserver(syncParentTheme).observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  } catch {}
