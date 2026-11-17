  // Rendering vocabulary only. Host adapters and the shared state models own
  // recognition; the graph and legend consume the same geometry here.
  const TRACE_MARKER_DOCK = { x: 14, y: -14 };
  const TRACE_SYMBOL_GLYPHS = {
    policy: '<path class="trace-symbol-shield" d="M0-5.5 4.5-3.7V-.3C4.5 2.6 2.7 4.5 0 5.8-2.7 4.5-4.5 2.6-4.5-.3v-3.4Z"/>',
    error: '<path d="m-3.5-3.5 7 7m0-7-7 7"/>',
    timeout: '<circle r="4.8"/><path d="M0-2.8V0l2 1.5"/>',
    retry: '<path d="M3.8-1a4 4 0 1 0-.8 4M4-4v3H1"/>',
    returned: '<path d="m-4 .1 2.5 2.6 5.8-6"/>',
    pending: '<circle cx="-3.3" r=".7" class="trace-symbol-dot"/><circle r=".7" class="trace-symbol-dot"/><circle cx="3.3" r=".7" class="trace-symbol-dot"/>',
    stop: '<path d="M-1.7-4v8m3.4-8v8"/>',
    gap: '<path d="m-3 3 2-6m1 6 2-6"/>',
    compact: '<path d="m-5.5-2.5 3.5 2.5-3.5 2.5m11-5L2 0l3.5 2.5"/>',
    capped: '<rect x="-6" y="-2.8" width="12" height="5.6" rx="2"/><circle cx="-3" r=".6" class="trace-symbol-dot"/><circle r=".6" class="trace-symbol-dot"/><circle cx="3" r=".6" class="trace-symbol-dot"/>',
    branch: '<path d="M-6 5V0q0-4 4-4h8"/>',
    selected: '<circle r="7" class="review-action-halo"/><circle r="4.5" class="review-action-node"/>',
    agent: '<path d="M-6 4q4 0 5-5t7-4"/>',
    goal: "<g transform=\"translate(-8 -8)\"><path d=\"M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5\"/><path d=\"M11.5 8C11.5001 8.69227 11.2948 9.36901 10.9102 9.94463C10.5257 10.5202 9.97901 10.9689 9.33944 11.2338C8.69986 11.4987 7.99609 11.5681 7.31712 11.433C6.63816 11.2979 6.01449 10.9645 5.52501 10.475C5.03548 9.98552 4.70209 9.36185 4.56702 8.68289C4.43195 8.00392 4.50127 7.30015 4.76619 6.66057C5.03112 6.021 5.47976 5.47436 6.05538 5.08978C6.631 4.70519 7.30774 4.49995 8.00001 4.5\"/><path d=\"M8.00024 7.99976L11.2 4.80005\"/><path d=\"M12.4719 5.62245C12.4246 5.66972 12.3569 5.69025 12.2913 5.67715L10.7814 5.37555C10.7022 5.35972 10.6402 5.29781 10.6244 5.2186L10.3228 3.70866C10.3097 3.6431 10.3302 3.57533 10.3775 3.52806L12.1826 1.723C12.2863 1.61929 12.4627 1.65879 12.5122 1.79684L12.9271 2.95225C12.9472 3.00847 12.9915 3.05272 13.0477 3.07291L14.2031 3.48774C14.3412 3.5373 14.3807 3.71368 14.277 3.81739L12.4719 5.62245Z\"/></g>",
    'retry-span': '<path d="M-5 0H5" class="review-retry-line"/>',
    coverage: '<path d="M-5 0H5" class="trace-symbol-coverage"/>',
  };
  function traceSymbolGlyph(symbol) { return TRACE_SYMBOL_GLYPHS[symbol] || ''; }
  function traceSymbolMark(symbol, x = 0, y = 0, state = '') {
    return '<g class="trace-symbol-mark" data-trace-symbol="' + symbol + '" data-marker-state="' + state + '" transform="translate(' + x + ' ' + y + ')">' + traceSymbolGlyph(symbol) + '</g>';
  }
  function traceSymbolPreview(symbol, state = '') {
    return '<svg viewBox="-8 -8 16 16" width="16" height="16" aria-hidden="true">' + traceSymbolMark(symbol, 0, 0, state) + '</svg>';
  }
  function reviewRenderSymbolLegend() {
    const legend = $('geist-legend'); if (!legend) return;
    const key = legend.querySelector('.br-key'), graph = $('graph'); if (!key || !graph) return;
    const en = globalThis.__trajectoryLocale === 'en', label = (zh, english) => en ? english : zh;
    const entries = [
      ['policy',label('审批 / 策略','Approval / policy'),'blocked'],
      ['error',label('工具报错','Tool error'),'error'],
    ];
    const conditional = [
      ['timeout','[data-trace-symbol="timeout"]',label('执行超时','Execution timeout'),'timeout'],
      ['retry','[data-trace-symbol="retry"]',label('步骤重试','Step retry'),'retry'],
      ['pending','[data-trace-symbol="pending"]',label('结果待返回','Result pending')],
      ['returned','[data-trace-symbol="returned"]',label('同参后续返回','Later same-input return')],
      ['compact','[data-context-compaction]',label('上下文压缩','Context compaction')],
      ['capped','.review-context-capped',label('柱高收起','Capped bar')],
      ['gap','.br-gap',label('轮间等待折叠','Folded turn gap')],
      ['retry-span','.review-retry',label('主线请求重试','Request retry on timeline')],
      ['stop','[data-br-stop]',label('轮次中止','Turn stopped')],
    ];
    for (const [id, selector, text, state] of conditional) if (graph.querySelector(selector)) entries.push([id,text,state]);
    const signature = [en,...entries.map(([id])=>id)].join(':');
    if (key.dataset.symbols === signature) return;
    key.classList.add('trace-symbols');
    key.innerHTML = entries.map(([id,text,state]) => '<span class="trace-symbol-item" data-legend-symbol="' + id + '">' + traceSymbolPreview(id,state) + '<span>' + text + '</span></span>').join('');
    key.dataset.symbols = signature;
    $('review-control-key')?.remove();
  }
