  const reviewGoalOperations = { create: ui('创建'), resume: ui('恢复'), pause: ui('暂停'), edit: ui('编辑'), complete: ui('完成'),
    block: ui('受阻'), blocked: ui('受阻'), clear: ui('清除目标'), read: ui('读取目标') };
  const reviewGoalOperation = marker => Object.hasOwn(reviewGoalOperations, marker.operation) ? reviewGoalOperations[marker.operation] : marker.operation || ui('变更');
  const reviewGoalClass = marker => marker.operation === 'block' ? 'blocked' : Object.hasOwn(reviewGoalOperations, marker.operation) ? marker.operation : '';
  function reviewGoalRecord(goal, id) {
    const records = goal.goals || [];
    return records.find(record => record.id === id) || ((id != null ? id === goal.id : records.length <= 1) ? goal : {});
  }
  function reviewGoalEventLabel(marker) {
    const turn = Number.isSafeInteger(marker.turn) ? ui(' · 第 ') + marker.turn + ui(' 轮') : '';
    return reviewGoalOperation(marker) + turn + ' · seq ' + marker.seq;
  }
  function reviewGoalBand(goalData, markers, mapTime, gy) {
    const life = markers.filter(m => m.operation && m.operation !== 'read');
    const reads = markers.filter(m => m.operation === 'read');
    // 起点用该目标的所有记录(含读取),终点用生命周期最后一条;一个会话可有多个目标,各自一段。
    const byGoalAll = new Map();
    for (const m of markers) { const key = m.goalId ?? null; if (!byGoalAll.has(key)) byGoalAll.set(key, []); byGoalAll.get(key).push(m); }
    const byGoalLife = new Map();
    for (const m of life) { const key = m.goalId ?? null; if (!byGoalLife.has(key)) byGoalLife.set(key, []); byGoalLife.get(key).push({ ...m, x: mapTime(m.time) }); }
    // 先把每条目标摊成一段,再按范围重叠错行;行长一致的区间才不会互相压。
    const goals = [];
    for (const [id, list] of byGoalLife) {
      const pts = list.filter(m => Number.isFinite(m.x));
      if (!pts.length) continue;
      const all = (byGoalAll.get(id) || []).map(m => ({ ...m, x: mapTime(m.time) })).filter(m => Number.isFinite(m.x));
      const objective = reviewGoalRecord(goalData, id).objective || pts.at(-1).objective || ui('会话目标');
      goals.push({ objective, pts, x0: all.length ? all[0].x : pts[0].x, x1: pts[pts.length - 1].x });
    }
    const goalLanes = [];
    // 标签按实际字宽截断,并按"线 + 标签"的宽度占行,避免两段目标文字叠在一起。
    const goalCompact = goal => {
      const objective = String(goal.objective).replace(/\s+/g, ' ');
      const limit = Math.max(24, Math.max(18, goal.x1 - goal.x0) - 28);
      let compact = objective;
      if (tlMeasure(compact) > limit) {
        let lo = 1, hi = compact.length;
        while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (tlMeasure(compact.slice(0, mid) + '…') <= limit) lo = mid; else hi = mid - 1; }
        compact = compact.slice(0, lo) + '…';
      }
      return compact;
    };
    for (const goal of goals) {
      goal.compact = goalCompact(goal);
      goal.labelW = tlMeasure(goal.compact);
      const lane = goalLanes.findIndex(right => right < goal.x0 - 12);
      const laneIndex = lane < 0 ? goalLanes.length : lane;
      goalLanes[laneIndex] = Math.max(goal.x1, goal.x0 + goal.labelW + 10);
      goal.lane = Math.min(laneIndex, 2);
    }
    const dot = (m, x, y, radius, css) => brGroup('class="goal-marker" data-goal-marker="' + esc(m.seq) + '"',
      '<circle class="br-hit" cx="' + x + '" cy="' + y + '" r="5"/><circle cx="' + x + '" cy="' + y + '" r="' + radius + '" class="' + css + '"/>', reviewGoalEventLabel(m));
    let bands = '', dots = '';
    for (const goal of goals) {
      const { pts, x0, x1, compact } = goal, laneY = gy - goal.lane * 22;
      const last = pts.at(-1), hitWidth = Math.max(x1 - x0, goal.labelW, 8) + 10;
      const band = '<rect class="br-hit" x="' + (x0 - 5) + '" y="' + (laneY - 19) + '" width="' + hitWidth + '" height="24"/>' +
        '<path d="M' + x0 + ' ' + laneY + 'H' + x1 + '" class="goal-line"/>' +
        '<path d="M' + x0 + ' ' + (laneY - 5) + 'v10M' + x1 + ' ' + (laneY - 5) + 'v10" class="goal-cap"/>' +
        '<text x="' + x0 + '" y="' + (laneY - 7) + '" class="goal-label"><tspan class="goal-text">' + esc(compact) + '</tspan><tspan class="goal-state ' + reviewGoalClass(last) + '" dx="6">' + esc(reviewGoalOperation(last)) + '</tspan></text>';
      bands += brGroup('class="goal-band" data-goal-band="' + esc(last.seq) + '"', band, goal.objective);
      for (const m of pts) dots += dot(m, m.x, laneY, 3.2, 'goal-dot ' + reviewGoalClass(m));
    }
    const readDots = reads.map(m => {
      const x = mapTime(m.time);
      return Number.isFinite(x) ? dot(m, x, gy, 1.6, 'goal-read') : '';
    }).join('');
    return bands + readDots + dots;
  }

  function reviewOpenGoalSummary(goal, marker) {
    const id = marker.goalId ?? null, record = reviewGoalRecord(goal, id);
    const events = goal.markers.filter(event => (event.goalId ?? null) === id);
    const started = marker.roundsStarted ?? record.roundsStarted, max = marker.maxGoalRounds ?? record.maxGoalRounds;
    const rows = [[ui('目标'), marker.objective || record.objective || ui('未记录')],
      [ui('阶段'), marker.phase || record.phase || ui('未记录')], [ui('轮次'), started != null ? started + ' / ' + (max ?? '?') : ui('未记录')]];
    const jump = Number.isSafeInteger(marker.turn) && marker.turn > 0;
    const choices = events.length > 1 ? '<div class="review-list">' + events.map(event =>
      '<button data-goal-select="' + esc(event.seq) + '" aria-current="' + (event.seq === marker.seq) + '">' + esc(reviewGoalEventLabel(event)) + '</button>').join('') + '</div>' : '';
    const actions = jump ? ui('<div class="drawer-actions"><button class="action-button primary" id="review-goal-path">在行动路径中查看 ↗</button></div>') : '';
    openDrawer(ui('会话目标'), reviewGoalEventLabel(marker), '<dl class="geist-timing-facts">' + rows.map(([key, value]) => '<div><dt>' + esc(key) + '</dt><dd>' + esc(value) + '</dd></div>').join('') + '</dl>' + choices + actions, null, jump ? marker.turn : null);
    $('drawer-body').querySelectorAll('[data-goal-select]').forEach(el => el.onclick = () => {
      const event = events.find(e => e.seq === Number(el.dataset.goalSelect));
      if (event) reviewOpenGoalSummary(goal, event);
    });
    if (jump) $('review-goal-path').onclick = () => { closeDrawer(); reviewEnterPath(marker.turn, marker.step); };
  }
