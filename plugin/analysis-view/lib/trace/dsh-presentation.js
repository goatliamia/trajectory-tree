  // 左边抽屉里凡是能"查看本轮行动路径"的地方,都配一个"跳到该轮对话"。
  // 统一在 openDrawer 出口补一个按钮,不在每个调用点重复写。
  (function () {
    if (window.parent === window || data.traceCapabilities?.chatJump !== true) return;
    const base = openDrawer;
    openDrawer = function (title, description, html, back, turnNumber) {
      base(title, description, html, back);
      const body = $('drawer-body');
      if (!body || body.querySelector('[data-chat-jump]')) return;
      const text = String(title || '') + ' ' + String(description || '');
      const match = text.match(/第\s*(\d+)\s*轮|Turn\s+(\d+)|(\d+)\s+turns?/i);
      const turn = turnNumber ?? Number(match?.[1] || match?.[2] || match?.[3]);
      if (!Number.isInteger(turn) || turn < 1) return;
      const row = document.createElement('div');
      row.className = 'drawer-actions';
      const button = document.createElement('button');
      button.className = 'action-button';
      button.dataset.chatJump = String(turn);
      button.textContent = ui('跳到第 ') + turn + ui(' 轮对话 ↗');
      button.onclick = () => window.parent.postMessage({ type: 'analysis-trace-jump', turn }, location.origin);
      // 并到已有动作行里,不要另起一列。
      const existing = body.querySelector('.drawer-actions');
      if (existing) existing.append(button); else { row.append(button); body.append(row); }
    };
  })();
