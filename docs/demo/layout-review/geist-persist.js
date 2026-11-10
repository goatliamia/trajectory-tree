  // 勾选状态按会话记住:切回对话再回来,不应该被重置成默认全开。
  (function () {
    const key = 'geist.layers.' + (data.mainSession || 'local');
    const managed = ['context', 'files'].filter(name => typeof data.traceViewDefaults?.[name] === 'boolean');
    for (const name of managed) if (!data.traceViewDefaults[name]) overviewLayers.delete(name);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch { saved = null; }
    const explicit = new Set(Object.keys(saved?.layers || {}));
    if (saved && typeof saved === 'object') {
      for (const [name, on] of Object.entries(saved.layers || {})) { if (on) overviewLayers.add(name); else overviewLayers.delete(name); }
      if (typeof geistActorLayers === 'object') for (const [name, on] of Object.entries(saved.actors || {})) geistActorLayers[name] = on;
    }
    let timer = 0;
    const save = () => {
      const layers = {}, actors = {};
      document.querySelectorAll('[data-br-layer]').forEach(input => {
        const name = input.dataset.brLayer;
        if (!managed.includes(name)) layers[name] = input.checked;
      });
      for (const name of managed) if (explicit.has(name)) layers[name] = overviewLayers.has(name);
      document.querySelectorAll('[data-actor-layer]').forEach(input => { actors[input.dataset.actorLayer] = input.checked; });
      try { localStorage.setItem(key, JSON.stringify({ layers, actors })); } catch { /* 存不下就算了 */ }
    };
    document.addEventListener('change', event => {
      const input = event.target;
      if (!input?.matches) return;
      const name = input.dataset.brLayer ?? input.dataset.actionLayer;
      if (!input.matches('[data-br-layer],[data-actor-layer]') && !managed.includes(name)) return;
      if (name) {
        explicit.add(name);
        input.checked ? overviewLayers.add(name) : overviewLayers.delete(name);
      }
      else if (typeof geistActorLayers === 'object') geistActorLayers[input.dataset.actorLayer] = input.checked;
      clearTimeout(timer); timer = setTimeout(save, 120);
    }, true);
  })();
