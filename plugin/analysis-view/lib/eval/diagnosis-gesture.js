(() => {
  const boxOf = (a, b) => ({
    left: Math.min(a.x, b.x), top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y),
  });
  const clamp = (n, min, max) => Math.max(min, Math.min(n, max));
  const mouse = event => ({ x: event.clientX, y: event.clientY });
  const t = (zh, en) => globalThis.__trajectoryLocale === 'en' ? en : zh;

  window.__bindDiagnosisGesture = ({ surfaceFor, point, region }) => {
    const style = document.createElement('style');
    style.textContent = `
      #diagnosis-selection { position: fixed; inset: 0; z-index: 200; pointer-events: none; }
      #diagnosis-selection .selection-mark { position: absolute; box-sizing: border-box; min-width: 6px; min-height: 6px;
        border: 1px solid #0675e5; border-radius: 3px; background: #0675e514; }
      #diagnosis-confirm { position: absolute; display: flex; align-items: center; gap: 6px; pointer-events: auto;
        max-width: min(240px, calc(100vw - 16px)); height: 30px; padding: 0 9px; border: 0; border-radius: 6px;
        background: #0068d6; color: white; font: 12px "Segoe UI", "Microsoft YaHei", sans-serif; cursor: pointer; }
      #diagnosis-confirm[hidden] { display: none; }
      #diagnosis-confirm:hover { background: #005bbd; }
      #diagnosis-confirm:focus-visible { outline: 2px solid #0068d6; outline-offset: 2px; }
      #diagnosis-confirm span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .diagnosis-holding, .diagnosis-holding * { cursor: crosshair !important; user-select: none; }
    `;
    document.head.append(style);
    const layer = document.createElement('div');
    layer.id = 'diagnosis-selection';
    const marks = document.createElement('div');
    marks.setAttribute('aria-hidden', 'true');
    const confirm = document.createElement('button');
    confirm.id = 'diagnosis-confirm';
    confirm.type = 'button';
    confirm.hidden = true;
    confirm.title = t('确认选区并装填草稿', 'Confirm selection and fill draft');
    confirm.innerHTML = '<span aria-hidden="true">✓</span><span></span>';
    const label = confirm.lastElementChild;
    layer.append(marks, confirm);
    document.body.append(layer);

    let press;
    let pending;
    let suppressClickUntil = 0;

    function draw(boxes) {
      marks.replaceChildren(...boxes.map(box => {
        const mark = document.createElement('div');
        mark.className = 'selection-mark';
        Object.assign(mark.style, {
          left: box.left + 'px', top: box.top + 'px',
          width: (box.right - box.left) + 'px', height: (box.bottom - box.top) + 'px',
        });
        return mark;
      }));
    }

    function clearSelection() {
      pending = undefined;
      confirm.hidden = true;
      marks.replaceChildren();
    }

    function bounds(surface) {
      const box = surface.getBoundingClientRect();
      return { left: Math.max(0, box.left), top: Math.max(0, box.top),
        right: Math.min(innerWidth, box.left + surface.clientWidth),
        bottom: Math.min(innerHeight, box.top + surface.clientHeight) };
    }

    function clip(box, limit) {
      return { left: clamp(box.left, limit.left, limit.right), top: clamp(box.top, limit.top, limit.bottom),
        right: clamp(box.right, limit.left, limit.right), bottom: clamp(box.bottom, limit.top, limit.bottom) };
    }

    function showSelection(choice, box, surface, extend) {
      if (!choice) { clearSelection(); return; }
      const visible = clip(box, bounds(surface));
      const isSingleRound = choice.selection.kind === 'rounds' && choice.selection.turns.length === 1;
      const parts = isSingleRound && extend ? new Map(pending?.parts) : null;
      if (parts) {
        const [number] = choice.selection.turns;
        if (parts.has(number)) parts.delete(number);
        else parts.set(number, visible);
        if (!parts.size) { clearSelection(); return; }
        const turns = [...parts.keys()].sort((a, b) => a - b);
        const count = turns.length;
        choice = { selection: { kind: 'rounds', turns }, label: count === 1
          ? t('第 ' + turns[0] + ' 轮', 'Turn ' + turns[0]) : t(count + ' 轮', count + ' turns') };
      }
      pending = { choice, parts };
      draw(parts ? [...parts.values()] : [visible]);
      label.textContent = choice.label;
      confirm.setAttribute('aria-label', t('确认选区 · ', 'Confirm selection · ') + choice.label);
      confirm.hidden = false;
      const width = confirm.offsetWidth;
      confirm.style.left = clamp(visible.right - width, 8, innerWidth - width - 8) + 'px';
      confirm.style.top = (visible.bottom + 38 < innerHeight ? visible.bottom + 6 : Math.max(8, visible.top - 36)) + 'px';
    }

    confirm.onclick = () => {
      window.__diagnosisDemoAsk(pending.choice.selection, confirm);
      confirm.hidden = true;
      pending = undefined;
    };

    function release() {
      const last = press;
      press = undefined;
      if (!last) return;
      clearTimeout(last.timer);
      last.surface.classList.remove('diagnosis-holding');
      return last;
    }

    window.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClickUntil = 0;
      if (confirm.contains(event.target)) return;
      const surface = surfaceFor(event.target);
      if (!surface) { clearSelection(); return; }
      const start = mouse(event);
      const target = event.target;
      const state = { id: event.pointerId, surface, start };
      press = state;
      state.timer = setTimeout(() => {
        if (press !== state) return;
        state.held = true;
        const hit = target.isConnected ? target : document.elementFromPoint(start.x, start.y);
        state.choice = hit ? point(hit, start, surface) : null;
        surface.classList.add('diagnosis-holding');
        surface.setPointerCapture(state.id);
        confirm.hidden = true;
        const initial = state.choice?.box ?? boxOf({ x: start.x - 5, y: start.y - 5 }, { x: start.x + 5, y: start.y + 5 });
        draw([clip(initial, bounds(surface))]);
      }, 390);
    }, true);

    window.addEventListener('pointermove', event => {
      if (event.pointerId !== press?.id) return;
      const end = mouse(event);
      const moved = Math.hypot(end.x - press.start.x, end.y - press.start.y) >= 6;
      if (!press.held) {
        if (moved) { release(); clearSelection(); }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (moved || press.box) {
        press.box = clip(boxOf(press.start, end), bounds(press.surface));
        draw([press.box]);
      }
    }, { capture: true, passive: false });

    window.addEventListener('pointerup', event => {
      if (event.pointerId !== press?.id) return;
      const last = release();
      if (!last.held) { clearSelection(); return; }
      suppressClickUntil = performance.now() + 300;
      if (last.box) showSelection(region(last.box, last.surface), last.box, last.surface, false);
      else showSelection(last.choice, last.choice?.box, last.surface, true);
    }, true);

    window.addEventListener('pointercancel', event => {
      if (event.pointerId === press?.id) { release(); clearSelection(); }
    }, true);
    window.addEventListener('blur', () => {
      if (press) { release(); clearSelection(); }
    });
    for (const type of ['click', 'dblclick']) window.addEventListener(type, event => {
      if (performance.now() >= suppressClickUntil || confirm.contains(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    for (const type of ['touchmove', 'contextmenu', 'selectstart']) window.addEventListener(type, event => {
      if (press?.held) event.preventDefault();
    }, { capture: true, passive: false });

    window.addEventListener('scroll', () => {
      if (press) release();
      clearSelection();
    }, true);
    window.addEventListener('resize', () => { release(); clearSelection(); });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && (press || pending)) {
        if (press?.held) suppressClickUntil = performance.now() + 300;
        release();
        clearSelection();
        event.stopImmediatePropagation();
        return;
      }
      if (!event.shiftKey || event.key !== 'Enter') return;
      const target = event.target;
      const surface = surfaceFor(target);
      if (!surface) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      requestAnimationFrame(() => {
        if (!target.isConnected) return;
        const box = target.getBoundingClientRect();
        const selected = point(target, { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }, surface);
        if (!selected) return;
        showSelection(selected, selected.box, surface, true);
        confirm.focus({ preventScroll: true });
      });
    }, true);
  };
})();
