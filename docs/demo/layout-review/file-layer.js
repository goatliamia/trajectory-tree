  let reviewFileOperations = data.context?.fileOperations || [];
  let reviewFileSelection = null, reviewFileGroups = [], reviewFilesInScope = [], reviewFileTouchGroups = [];
  let reviewFileLayoutCache = null, reviewFileGeometry = null, reviewFileStatusState = null;
  let reviewActionFileFrame = null, reviewFilesFramePending = false;
  function reviewRefreshActionFiles() {
    if (reviewFilesFramePending) return;
    reviewFilesFramePending = true;
    requestAnimationFrame(() => {
      reviewFilesFramePending = false;
      if (view !== 'path' || !reviewActionFileFrame || !$('review-files-layer')) return;
      const { t, x, base, gutter } = reviewActionFileFrame, vp = $('graph-scroll');
      const left = vp.scrollLeft;
      reviewActionFileFrame.viewportLeft = left;
      $('review-files-layer').innerHTML = reviewActionFiles(t, x, base, left + gutter, left + reviewActionFileFrame.viewportWidth - gutter);
      reviewFilesBind();
    });
  }
  function reviewFileLabel(members) {
    if (typeof geistSkillMaterialLabel === 'function') { const label = geistSkillMaterialLabel(members); if (label) return label; }
    if (members.length === 1) {
      // 单独显示一个文件时,先给它的身份:读 / 改 / 受阻,再给次数。
      const f = members[0].file;
      const kind = f.changes.length ? ui('改') : f.reads.length ? ui('读') : f.failed.length ? ui('受阻') : ui('待确认');
      const count = f.changes.length || f.reads.length || f.failed.length;
      return '[' + kind + '] ' + f.label + (count ? ' · ' + count : '');
    }
    const representative = members.reduce((best, { file }) => file.operations.length > best.operations.length ? file : best, members[0].file);
    return representative.label.split('/').at(-1) + ui(' 等 ') + members.length + ui(' 个');
  }
  function reviewFileIcon(x, y) {
    return '<path d="M' + x + ' ' + (y - 5) + 'h5l3 3v8h-8zM' + (x + 5) + ' ' + (y - 5) + 'v3h3" class="review-file-icon"/>';
  }
  function reviewTrimFileLabel(text, width) {
    let label = text, removed = 0;
    while (label.length > 1 && reviewMeasure(label) > width - 30) {
      removed++;
      const keep = Math.max(1, text.length - removed), before = Math.ceil(keep / 2), after = Math.floor(keep / 2);
      label = text.slice(0, before) + '…' + (after ? text.slice(-after) : '');
      if (removed >= text.length) return '…';
    }
    return label;
  }
  function reviewGetFileLayout(geometry, context, build) {
    const operations = reviewFileOperations, operationCount = operations.length;
    const filesEnabled = overviewLayers.has('files');
    const skills = typeof geistSkillMaterials === 'function' && geistActorLayers.skills ? geistSkills : null;
    const cached = reviewFileLayoutCache;
    if (cached && cached.geometry === geometry && cached.context === context && cached.operations === operations &&
        cached.operationCount === operationCount && cached.filesEnabled === filesEnabled && cached.skills === skills) {
      return cached.layout;
    }
    const layout = build(filesEnabled);
    reviewFileLayoutCache = { geometry, context, operations, operationCount, filesEnabled, skills, layout };
    return layout;
  }
  function reviewPackFiles(scope, point, bounds, obstacles, filesEnabled) {
    const files = fileObjects(reviewFileOperations, scope);
    const materials = typeof geistSkillMaterials === 'function' ? geistSkillMaterials(files, scope) : files;
    const points = new Map(), lanes = [];
    if (!filesEnabled && !materials.some(file => file.skillId)) return { files, points, lanes };
    const items = { read: [], change: [] };
    for (const file of materials) {
      if (!filesEnabled && !file.skillId) continue;
      const filePoints = [];
      let start = Infinity, end = -Infinity;
      for (const operation of file.operations) {
        const x = point(operation);
        if (!Number.isFinite(x)) continue;
        filePoints.push({ operation, x });
        start = Math.min(start, x);
        end = Math.max(end, x);
      }
      if (filePoints.length) points.set(file.id, filePoints);
      const x = (start + end) / 2;
      if (Number.isFinite(x)) items[file.lane].push({ file, x, start, end });
    }
    for (const lane of ['read', 'change']) {
      const groups = packFileObjects(items[lane], {
        left: bounds.left + 4, right: bounds.right - 4, measure: reviewMeasure, label: reviewFileLabel,
        obstacles: obstacles[lane] || [],
      });
      lanes.push({ lane, groups, visible: groups.some(group => !group.hidden) });
    }
    return { files, points, lanes };
  }
  function reviewFileLayer(layout, base, left, right, lowerY, laneX) {
    reviewFileGroups = [];
    reviewFilesInScope = layout.files;
    reviewFileGeometry = { base, left, right, layout };
    if (!layout.lanes.length) return '';
    let html = '<g class="review-file-object-layer">';
    for (const { lane, groups, visible } of layout.lanes) {
      const y = lane === 'read' ? 84 : lowerY;
      if (visible) html += brText(laneX, y + 4, lane === 'read' ? ui('材料') : ui('修改'), 'review-file-lane-label ' + lane, 'end');
      for (const p of groups) {
        if (p.hidden || p.right < left - 60 || p.left > right + 60) continue;
        const index = reviewFileGroups.length; reviewFileGroups.push({ ...p, y, lane });
        const selected = p.members.some(m => m.file.id === reviewFileSelection);
        const label = reviewTrimFileLabel(p.label, p.width);
        html += brGroup('class="review-file-object ' + lane + (selected ? ' selected' : '') + '" data-file-group="' + index + '" aria-pressed="' + selected + '"',
          '<rect x="' + p.left + '" y="' + (y - 10) + '" width="' + p.width + '" height="20" rx="4" class="review-file-body"/>' +
          reviewFileIcon(p.left + 8, y) + brText(p.left + 23, y + 3.5, label, 'review-file-name', 'start'),
          p.members.length === 1 ? p.members[0].file.path + ui('；点击突出它的读写位置') : p.members.length + ui(' 个文件集中在这里；点击选择文件'));
      }
    }
    html += '<g id="review-file-touch-layer">' + reviewFileTouchMarkup() + '</g></g>';
    return html;
  }
  function reviewOverviewFiles(layout, mapTime, base, left, right, height) {
    // The renderer creates fresh rows during a pan, but their timeline coordinates stay put.
    const geometry = layout.map(({ turn, x, end }) => [turn.number, turn.start, endOf(turn), x, end].join(':')).join('|');
    const bounds = { left: layout[0]?.x ?? 54, right: layout.at(-1)?.end ?? right };
    const boundaries = overviewLayers.has('context') ? reviewContextData.boundaries : null;
    const fileLayout = reviewGetFileLayout(geometry, boundaries, filesEnabled => {
      const scope = new Set(layout.map(row => row.turn.number));
      const read = (boundaries || []).filter(event => event.kind === 'compaction').map(event => {
        const x = mapTime(event.time);
        return { left: x - 15, right: x + 15 };
      });
      return reviewPackFiles(scope, operation => mapTime(operation.time), bounds, { read }, filesEnabled);
    });
    return reviewFileLayer(fileLayout, base, left, right, height - 44, bounds.left - 9);
  }
  function reviewActionFiles(t, x, base, left, right) {
    const halfGap = t.steps.length > 1 ? (x(1) - x(0)) / 2 : 56;
    const bounds = { left: x(0) - halfGap, right: x(t.steps.length - 1) + halfGap };
    const contextEnabled = overviewLayers.has('context');
    // Panning an action path keeps the coordinate function from its last full draw.
    const fileLayout = reviewGetFileLayout(x, contextEnabled, filesEnabled => {
      const indices = new Map(t.steps.map((step, i) => [step.number, i]));
      const change = [];
      if (contextEnabled) for (const [index, step] of t.steps.entries()) {
        const info = reviewStepContext(t, step);
        const amount = info ? Object.values(info.parts).reduce((sum, value) => sum + Math.max(0, -value), 0) : 0;
        if (amount) change.push({ left: x(index) - 40, right: x(index) + 40 });
      }
      return reviewPackFiles(new Set([t.number]), op => indices.has(op.step) ? x(indices.get(op.step)) : NaN, bounds, { change }, filesEnabled);
    });
    return reviewFileLayer(fileLayout, base, left, right, base + 78, bounds.left - 9);
  }
  function reviewFileTouchMarkup() {
    reviewFileTouchGroups = [];
    if (!overviewLayers.has('files') || !reviewFileSelection || !reviewFileGeometry) return '';
    const { base, left, right, layout } = reviewFileGeometry;
    if (layout.touches?.file !== reviewFileSelection) {
      layout.touches = { file: reviewFileSelection, groups: fileTouchClusters(layout.points.get(reviewFileSelection) || []) };
    }
    let html = '';
    for (const p of layout.touches.groups) {
      if (p.x < left - 10 || p.x > right + 10) continue;
      const index = reviewFileTouchGroups.length; reviewFileTouchGroups.push(p);
      const read = p.kind === 'read', y = base + (read ? -18 : 18), tone = p.members.some(m => m.operation.status === 'error') ? 'failed' : read ? 'read' : 'change';
      const body = '<path d="M' + p.x + ' ' + (base + (read ? -4 : 4)) + 'V' + y + '" class="review-file-tick"/>' +
        (read ? '<circle cx="' + p.x + '" cy="' + y + '" r="3.5" class="review-file-touch-dot"/>' : '<rect x="' + (p.x - 3.5) + '" y="' + (y - 3.5) + '" width="7" height="7" rx="1.5" class="review-file-touch-dot"/>');
      const first = p.members[0].operation;
      html += brGroup('class="review-file-touch ' + tone + '" data-file-touch="' + index + '"', body + (p.members.length > 1 ? '<circle cx="' + p.x + '" cy="' + y + '" r="6" class="review-file-touch-ring"/>' : ''),
        p.members.length > 1 ? p.members.length + ui(' 次相邻') + (read ? ui('读取') : ui('写入/修改')) + ui('；点击展开') : ui('第 ') + first.turn + ui(' 轮 / 第 ') + first.step + ui(' 步 · ') + (read ? ui('读取') : ui('写入/修改')) + (first.status === 'returned' ? ui('已返回') : ui('未成功或未确认')));
    }
    return html;
  }
  function reviewSelectFile(id) {
    reviewFileSelection = id;
    if (reviewOverviewBookmark) reviewOverviewBookmark.file = id;
    reviewApplyFileFocus();
    reviewFileStatus();
  }
  function reviewClearFileSelection() {
    reviewSelectFile(null);
    $('graph-scroll').focus({ preventScroll: true });
  }
  function reviewApplyFileFocus() {
    const enabled = overviewLayers.has('files');
    $('canvas').classList.toggle('review-files-on', enabled);
    const selected = (enabled && reviewFileSelection ? reviewFilesInScope.find(f => f.id === reviewFileSelection)?.operations : null) || [];
    $('canvas').classList.toggle('review-file-focused', selected.length > 0);
    const steps = new Set(selected.map(o => o.turn + ':' + o.step)), seqs = new Set(selected.map(o => o.seq));
    $('graph').querySelectorAll('[data-file-group]').forEach(el => {
      const group = reviewFileGroups[Number(el.dataset.fileGroup)];
      const chosen = group.members.some(m => m.file.id === reviewFileSelection);
      const related = view === 'path' && group.members.some(m => m.file.operations.some(o => o.step === turn().steps[selectedStep]?.number));
      el.classList.toggle('selected', chosen); el.classList.toggle('step-related', related);
      el.setAttribute('aria-pressed', String(chosen));
      const selectedFile = group.members.find(m => m.file.id === reviewFileSelection)?.file;
      el.querySelector('.review-file-name').textContent = reviewTrimFileLabel(selectedFile ? '✓ ' + selectedFile.label : group.label, group.width);
      el.querySelector('title').textContent = selectedFile ? ui('已选：') + selectedFile.path + (group.members.length > 1 ? ui('；本组共 ') + group.members.length + ui(' 个文件，点击可换选') : ui('；点击查看读写位置')) :
        group.members.length === 1 ? group.members[0].file.path + ui('；点击突出它的读写位置') : group.members.length + ui(' 个文件集中在这里；点击选择文件');
    });
    $('graph').querySelectorAll('.review-action-step').forEach(el => el.classList.toggle('file-related', steps.has(turn().number + ':' + turn().steps[Number(el.dataset.step)]?.number)));
    $('graph').querySelectorAll('[data-review-branch]').forEach(el => {
      const group = reviewBranchesNow[Number(el.dataset.reviewBranch)];
      el.classList.toggle('file-related', group.members.some(m => [...m.e.failureSeqs, ...m.e.readSeqs, ...m.e.pairs.map(p => p.successSeq)].some(seq => seqs.has(seq))));
    });
    const layer = $('review-file-touch-layer');
    if (layer) layer.innerHTML = reviewFileTouchMarkup();
    reviewBindFileTouches();
  }
  function reviewBindFileTouches() {
    $('graph').querySelectorAll('[data-file-touch]').forEach(el => {
      const open = () => {
        const cluster = reviewFileTouchGroups[Number(el.dataset.fileTouch)];
        if (cluster.members.length > 1) {
          const file = reviewFilesInScope.find(f => f.id === reviewFileSelection);
          reviewOpenFileHistory(file, cluster.members.map(p => p.operation)); return;
        }
        const op = cluster.members[0].operation;
        if (view === 'path' && turn().number === op.turn) reviewJumpToStep(turn(), op.step);
        else reviewEnterPath(op.turn, op.step);
      };
      el.onclick = e => { e.stopPropagation(); open(); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
  }
  function reviewFilesBind() {
    $('graph').querySelectorAll('[data-file-group]').forEach(el => {
      const group = reviewFileGroups[Number(el.dataset.fileGroup)];
      const open = () => {
        if (group.members.length > 1) { reviewOpenFilePicker(group.members.map(m => m.file)); return; }
        const file = group.members[0].file; reviewSelectFile(file.id); reviewOpenFileHistory(file);
      };
      el.onclick = e => { e.stopPropagation(); open(); };
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
    reviewApplyFileFocus(); reviewFileStatus();
    if (typeof geistBindSkillMaterials === 'function') geistBindSkillMaterials();
  }
  function reviewFileStatus() {
    let status = $('review-file-status');
    if (!status) { status = document.createElement('div'); status.id = 'review-file-status'; status.className = 'review-file-status'; $('graph-caption').append(status); }
    status.setAttribute('aria-hidden', String(!overviewLayers.has('files')));
    const previous = reviewFileStatusState;
    if (previous?.status === status && previous.view === view && previous.files === reviewFilesInScope && previous.selection === reviewFileSelection) return;
    reviewFileStatusState = { status, view, files: reviewFilesInScope, selection: reviewFileSelection };
    const selected = reviewFileSelection && reviewFilesInScope.find(f => f.id === reviewFileSelection);
    status.innerHTML = selected
      ? '<strong title="' + esc(selected.path) + '">' + esc(selected.label) + '</strong><span>' + (view === 'path' ? ui('本轮 · ') : ui('全程 · ')) + ui('读 ') + selected.reads.length + ui(' 次 · 写入/修改 ') + selected.changes.length + ui(' 次') + (selected.failed.length ? ' · ' + selected.failed.length + ui(' 次受阻') : '') + ui('</span><button id="review-file-history">全程记录 ↗</button><button id="review-file-clear" aria-label="取消文件选择" title="取消选择（Esc）">× 取消选择</button>')
      : ui('<span>上方读取 · 下方写入/修改</span><button id="review-file-all">') + (view === 'overview' ? ui('全程 ') : ui('本轮 ')) + reviewFilesInScope.length + ui(' 个文件 ↗</button><span class="review-file-source-note">按已记录的操作</span>');
    if ($('review-file-all')) $('review-file-all').onclick = () => reviewOpenFilePicker(reviewFilesInScope);
    if ($('review-file-clear')) $('review-file-clear').onclick = reviewClearFileSelection;
    if ($('review-file-history')) $('review-file-history').onclick = () => reviewOpenFileHistory(selected);
  }
  function reviewOpenFilePicker(files) {
    reviewOpenDetail({ title: ui('这段执行涉及的文件'), subtitle: ui('选择文件，查看它在整段会话中的修改过程'),
      html: '<div class="review-file-list">' + (files.length ? files.map((f, i) => '<button data-pick-file="' + i + '"><strong>' + esc(f.label) + ui('</strong><span>读取 ') + f.reads.length + ui(' 次 · 写入/修改 ') + f.changes.length + ui(' 次') + (f.failed.length ? ui(' · 受阻 ') + f.failed.length + ui(' 次') : '') + '</span><small>' + esc(f.path) + '</small></button>').join('') : ui('<p class="review-file-evidence-note">这段执行没有记录直接的文件读写操作。</p>')) + '</div>',
      bind: () => $('review-detail-body').querySelectorAll('[data-pick-file]').forEach(el => el.onclick = () => { const file = files[Number(el.dataset.pickFile)]; reviewCloseDetail(); reviewSelectFile(file.id); reviewOpenFileHistory(file); }) });
  }
  function reviewOpenFileHistory(file, operations = file.operations) {
    reviewOpenDetail({ title: file.label, subtitle: ui('形成过程 · ') + operations.length + ui(' 条读写记录'),
      html: '<div class="review-file-history">' + operations.map(op => '<button data-file-step="' + op.seq + '"><span class="' + op.kind + '">' + (op.kind === 'read' ? ui('读取') : ui('写入/修改')) + ui('</span><div><strong>第 ') + op.turn + ui(' 轮 · 第 ') + op.step + ui(' 步</strong><small>') + esc(reviewContextData.callFacts?.[op.seq]?.outcome || (op.status === 'returned' ? ui('工具已返回') : op.status === 'error' ? ui('操作受阻') : ui('结果未记录'))) + ui('</small></div><span>查看这一步 ↗</span></button>')).join('') + '</div>' +
        ui('<p class="review-file-evidence-note">按文件工具的操作记录展示；本预览尚未接入最终文件差异。</p>'),
      bind: () => $('review-detail-body').querySelectorAll('[data-file-step]').forEach(el => el.onclick = () => {
        const op = file.operations.find(o => o.seq === Number(el.dataset.fileStep));
        reviewCloseDetail();
        if (view === 'path' && turn().number === op.turn) reviewJumpToStep(turn(), op.step);
        else reviewEnterPath(op.turn, op.step);
      }) });
  }
  function reviewMarkBranchFiles(events) {
    if (!overviewLayers.has('files')) return;
    const seqs = new Set(events.flatMap(e => [...e.failureSeqs, ...e.readSeqs, ...e.pairs.map(p => p.successSeq)]));
    $('graph').querySelectorAll('[data-file-group]').forEach(el => {
      const group = reviewFileGroups[Number(el.dataset.fileGroup)];
      el.classList.toggle('branch-related', group.members.some(m => m.file.operations.some(o => seqs.has(o.seq))));
    });
  }
