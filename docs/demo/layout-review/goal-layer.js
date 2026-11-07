  function reviewGoalBand(goalData, markers, mapTime, gy) {
    const life = markers.filter(m => m.operation && m.operation !== 'read');
    const reads = markers.filter(m => m.operation === 'read');
    const goalState = { create: ui('创建'), resume: ui('恢复'), pause: ui('暂停'), edit: ui('编辑'), complete: ui('完成'), blocked: ui('受阻') };
    const goalClass = operation => Object.hasOwn(goalState, operation) ? operation : '';
    const goalLabel = operation => Object.hasOwn(goalState, operation) ? goalState[operation] : operation;
    // 起点用该目标的所有记录(含读取),终点用生命周期最后一条;一个会话可有多个目标,各自一段。
    const byGoalAll = new Map();
    for (const m of markers) { const key = m.goalId || 'goal'; if (!byGoalAll.has(key)) byGoalAll.set(key, []); byGoalAll.get(key).push(m); }
    const byGoalLife = new Map();
    for (const m of life) { const key = m.goalId || 'goal'; if (!byGoalLife.has(key)) byGoalLife.set(key, []); byGoalLife.get(key).push({ ...m, x: mapTime(m.time) }); }
    // 先把每条目标摊成一段,再按范围重叠错行;行长一致的区间才不会互相压。
    const goals = [];
    for (const [id, list] of byGoalLife) {
      const pts = list.filter(m => Number.isFinite(m.x));
      if (!pts.length) continue;
      const all = (byGoalAll.get(id) || []).map(m => ({ ...m, x: mapTime(m.time) })).filter(m => Number.isFinite(m.x));
      goals.push({ id, pts, x0: all.length ? all[0].x : pts[0].x, x1: pts[pts.length - 1].x });
    }
    const goalLanes = [];
    // 标签按实际字宽截断,并按"线 + 标签"的宽度占行,避免两段目标文字叠在一起。
    const goalCompact = goal => {
      const own = (goalData.goals || []).find(x => x.id === goal.id) || null;
      const objective = String(own?.objective || goalData.objective || ui('目标')).replace(/\s+/g, ' ');
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
    let band = '<g class="goal-band" data-goal-band="1" role="button" tabindex="0" aria-label="' + esc(ui('会话目标')) + '" style="cursor:pointer;pointer-events:all">';
    for (const goal of goals) {
      const { pts, x0, x1, compact } = goal, laneY = gy - goal.lane * 22;
      const last = pts[pts.length - 1];
      // 不用胶囊:一条实线加两端刻度就够,事件点是线上的刻度。
      band += '<path d="M' + x0 + ' ' + laneY + 'H' + x1 + '" class="goal-line"/>';
      band += '<path d="M' + x0 + ' ' + (laneY - 5) + 'v10M' + x1 + ' ' + (laneY - 5) + 'v10" class="goal-cap"/>';
      for (const m of pts) band += '<circle cx="' + m.x + '" cy="' + laneY + '" r="3.2" class="goal-dot ' + goalClass(m.operation) + '"><title>' + esc(goalLabel(m.operation)) + ui(' · 第 ') + esc(m.turn) + ui(' 轮 · seq ') + esc(m.seq) + '</title></circle>';
      band += '<text x="' + x0 + '" y="' + (laneY - 7) + '" class="goal-label"><tspan class="goal-text">' + esc(compact) + '</tspan><tspan class="goal-state ' + goalClass(last.operation) + '" dx="6">' + esc(goalLabel(last.operation)) + '</tspan></text>';
    }
    const readDots = reads.map(m => {
      const x = mapTime(m.time);
      return Number.isFinite(x) ? '<circle cx="' + x + '" cy="' + gy + ui('" r="1.6" class="goal-read"><title>读取目标 · 第 ') + esc(m.turn) + ui(' 轮</title></circle>') : '';
    }).join('');
    return goals.length || readDots ? band + readDots + '</g>' : '';
  }

  function reviewOpenGoalSummary(goal) {
    const label = ui('目标 ') + (goal.phase || 'active') + (goal.roundsStarted != null && goal.maxGoalRounds != null ? ' · ' + goal.roundsStarted + '/' + goal.maxGoalRounds : '');
    const rows = [[ui('目标'), goal.objective || ui('未记录')], [ui('阶段'), goal.phase || ui('未记录')],
      [ui('轮次'), goal.roundsStarted != null ? goal.roundsStarted + ' / ' + (goal.maxGoalRounds ?? '?') : ui('未记录')],
      [ui('变更'), (goal.markers || []).map(marker => (marker.operation || '') + '@' + marker.seq).join(' · ') || ui('未记录')]];
    openDrawer(ui('会话目标'), label, '<dl class="geist-timing-facts">' + rows.map(([key, value]) => '<div><dt>' + esc(key) + '</dt><dd>' + esc(value) + '</dd></div>').join('') + '</dl>');
  }
