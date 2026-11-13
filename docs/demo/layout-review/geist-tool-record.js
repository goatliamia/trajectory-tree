  // The step inspector, result branches and error evidence use the same record.
  const geistRecordChevron = '<span class="geist-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path d="m5 6 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></span>';
  function geistRecordDisclosure(label, body, extra = '') {
    return '<details class="geist-result ' + extra + '"><summary>' + geistRecordChevron + label + '</summary>' + body + '</details>';
  }
  function geistRecordText(value, formatJson) {
    if (formatJson && !value.omitted) {
      try { return JSON.stringify(JSON.parse(value.text), null, 2); } catch {}
    }
    return value.text;
  }
  function geistToolRecord(call, options = {}) {
    let { step, turn: selectedTurn } = options;
    if (!step) for (const row of session.turns) {
      const found = row.steps.find(s => s.calls.some(c => c.seq === call.seq));
      if (found) { step = found; selectedTurn = row; break; }
    }
    const fact = options.fact || presentCallFact(call, reviewContextData.callFacts?.[call.seq] || call.fact);
    const measure = call.measure || (step ? reviewCallMeasure(call, step, selectedTurn.number) : null);
    const program = /^run_?code$/i.test(call.name || '');
    const args = insightJSON(call.args) || {};
    const title = program ? (args.description || ui('PTC 程序')) : fact.title || call.target || '';
    const frames = call.codeFrames?.length ? call.codeFrames : call.attribution?.codeFrames || [];
    const tone = call.status === 'error' || fact.tone === 'bad' ? 'bad' : fact.tone === 'unknown' ? 'unknown' : 'normal';
    const meta = [];
    const elapsed = call.start != null && call.end != null ? dur(Math.max(0, call.end - call.start)) : '';
    if (call.seq != null) meta.push('#' + call.seq + (call.resultSeq != null ? ' → #' + call.resultSeq : ''));
    if (call.inner || call.rootSeq != null) meta.push(ui('PTC 内部工具') + (call.rootSeq != null ? ' · #' + call.rootSeq : ''));
    const detail = fact.detail ? '<p class="geist-tool-record-detail">' + esc(fact.detail) + '</p>' : '';
    const rawBlock = (label, value, formatJson = false) => value?.text ? '<section class="geist-tool-source"><h4>' + label + '</h4><pre>' + esc(geistRecordText(value, formatJson)) + '</pre>' +
      (value.omitted ? '<span class="geist-result-note">' + ui('节选 · 另有 ') + value.omitted + ui(' 个字符未载入') + '</span>' : '') + '</section>' : '';
    const error = call.error?.code || call.error?.name;
    const attribution = globalThis.__trajectoryFailureText?.(call.attribution);
    const raw = '<div class="geist-tool-source-grid">' + rawBlock(ui('调用参数'), call.args, true) + rawBlock(ui('返回原文'), call.result) + '</div>';
    const outcome = frames.length ? globalThis.__trajectoryDiagnosticSummary?.(frames) : '<span class="geist-tool-record-outcome">' + esc(fact.outcome) + '</span>';
    return '<details class="geist-tool-record" data-tone="' + tone + '" data-call-seq="' + call.seq + '">' +
      '<summary class="geist-tool-record-toggle"><span class="geist-tool-record-head">' + geistRecordChevron +
      '<span class="geist-tool-record-name">' + globalThis.__trajectoryToolName(call.name) + '</span>' +
      '<span class="geist-tool-record-title" title="' + esc(call.target || title) + '">' + esc(title) + '</span>' +
      '<span class="geist-tool-record-amount">' + (globalThis.__trajectoryToolMeasure?.(measure) || '') + '</span>' +
      '<span class="geist-tool-record-elapsed">' + esc(elapsed) + '</span></span>' +
      (outcome ? '<span class="geist-tool-record-preview">' + outcome + '</span>' : '') + '</summary>' +
      '<div class="geist-tool-record-content"><div class="geist-tool-record-meta"><span>' + esc(meta.join(' · ')) + '</span>' + (options.actions || '') + '</div>' + detail +
      (frames.length ? globalThis.__trajectoryDiagnosticFrames(frames) : '') +
      (error ? '<p class="geist-tool-record-error">' + esc(error) + '</p>' : '') +
      (attribution ? '<p class="review-quiet">' + esc(attribution) + '</p>' : '') + raw + '</div></details>';
  }
  // All legacy branch/evidence entry points call this function as well.
  callEntry = function(call) { return geistToolRecord(call); };
