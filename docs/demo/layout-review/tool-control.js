  function reviewToolMarker(calls, x, y, { retries = 0, compact = false } = {}) {
    const summary = summarizeControls(calls), errors = calls.filter(call => call.status === 'error').length;
    const timeout = calls.some(call => /TIMEOUT/.test(call.error?.code || ''));
    const control = summary?.primary, blocked = control && control.state !== 'approved';
    const state = blocked ? control.state : timeout ? 'timeout' : errors ? 'error' : retries ? 'retry' : control?.state;
    if (!state) return '';
    const en = globalThis.__trajectoryLocale === 'en';
    const title = [summary ? controlSummaryTitle(summary, globalThis.__trajectoryLocale) : '', errors ? (en ? 'Tool errors: ' : '工具报错 ') + errors : '', retries ? (en ? 'Retries: ' : '重试 ') + retries : ''].filter(Boolean).join(' · ');
    const symbol = control && state === control.state ? 'policy' : state;
    return '<g class="review-tool-marker trace-symbol-mark" data-trace-symbol="' + symbol + '" data-marker-state="' + esc(state) + '"' + (control ? ' data-control-state="' + esc(control.state) + '"' : '') + ' transform="translate(' + x + ' ' + y + ')" aria-label="' + esc(title) + '"><title>' + esc(title) + '</title><g' + (compact ? ' transform="scale(.9)"' : '') + '>' + traceSymbolGlyph(symbol) + '</g></g>';
  }
  function reviewResultControlCalls(result) {
    if (result.kind !== 'incident') return result.calls || [];
    const seqs = new Set(result.incident.failureSeqs);
    return session.turns.find(turn => turn.number === result.turn)?.steps.flatMap(step => step.calls).filter(call => seqs.has(call.seq)) || [];
  }
  function reviewControlChips(call) {
    return toolControls(call).map(signal => '<span class="geist-tool-control" data-control-state="' + esc(signal.state) + '">' + esc(controlTitle(signal, globalThis.__trajectoryLocale)) + '</span>').join('');
  }
  function reviewControlEvidence(call) {
    return toolControls(call).map(signal => '<div class="geist-control-evidence"><strong>' + esc(controlTitle(signal, globalThis.__trajectoryLocale)) + '</strong><small>' +
      esc([signal.host, signal.source, signal.requestId, signal.seq != null ? '#' + signal.seq : null, signal.code].filter(Boolean).join(' · ')) + '</small>' +
      (signal.evidence ? '<p>' + esc(signal.evidence) + '</p>' : '') + '</div>').join('');
  }
