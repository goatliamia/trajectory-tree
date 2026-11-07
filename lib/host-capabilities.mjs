// Capabilities describe available evidence and actions, not feature parity.
// Keep this dependency-free: sync-view-assets also publishes it inside DSH.
export function hostCapabilities(payload) {
  const host = payload.host || 'dsh', context = payload.context || {};
  return {
    liveRefresh: host === 'dsh',
    requestTiming: host === 'dsh' ? 'official-stats' : 'unavailable',
    contextComposition: host === 'dsh' ? 'request-estimate' : context.current ? 'visible-text-estimate' : 'unavailable',
    childHistory: host === 'dsh' ? 'on-demand' : 'unavailable',
    ...payload.traceCapabilities,
    // These actions use the DSH bridge, even when another host is embedded.
    chatJump: host === 'dsh' && payload.traceCapabilities?.chatJump !== false,
    history: host === 'dsh' && payload.traceCapabilities?.history === true,
    host,
  };
}
