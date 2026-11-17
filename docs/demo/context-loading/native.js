document.addEventListener('DOMContentLoaded', () => {
  const data = window.CONTEXT_NATIVE;
  const $ = id => document.getElementById(id);
  if (!data?.frames?.length) {
    document.querySelector('.assembly').classList.add('no-data');
    document.querySelector('.assembly').textContent = '请先在仓库根目录运行 node scripts/build-context-loading-native.mjs，生成绑定真实日志的本地预览。';
    return;
  }
  const frames = data.frames, last = frames.at(-1), fragments = data.fragments;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const short = (s, n = 115) => String(s).replace(/\s+/g, ' ').slice(0, n);
  const clock = time => new Intl.DateTimeFormat('en-GB', { timeZone: data.source.timezone, hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(time) + '.' + String(time % 1000).padStart(3, '0');
  const date = new Intl.DateTimeFormat('sv-SE', {timeZone:data.source.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(last.time);
  const totalMessages = last.slots.length;
  let position = 0, playing = false, timer, animations = [], selectedId = null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const status = frame => {
    const f = fragments[frame.fragment];
    if (frame.type === 'agent/inbox/spliced') return frame.removedCount
      ? { title: '从队列取出', copy: f?.label + '已认领，尚未写入消息历史。', readout: f?.label + '从 ' + frame.target + ' 队列取出；暂不计入 messages[]。' }
      : { title: f?.label + '入队', copy: '等待从 ' + frame.target + ' 队列取出。', readout: f?.label + '进入 ' + frame.target + ' 队列；此时还没有写入模型消息历史。' };
    if (frame.type === 'turn/start') return {title:'第 1 轮开始',copy:'队列中的内容仍保留各自身份。',readout:'第 1 轮开始。接下来，宿主认领待处理队列。'};
    if (frame.type === 'step/start') return {title:'第 1 步开始',copy:'即将准备这一步的模型上下文。',readout:'第 1 步开始。此时消息历史仍为空，已认领的消息尚未写入。'};
    if (frame.type === 'request/header') return {title:'记录工具声明',copy:data.tools.length + ' 项工具作为独立字段记录。',readout:'消息已有 ' + frame.slots.length + ' 段；现在记录 tools[]。工具声明不占消息历史中的位置。'};
    if (frame.type === 'request/context') return {title:'首次请求上下文',copy:'模型与窗口配置元数据已记录。',readout:'此切点保留 ' + frame.slots.length + ' 段消息与 ' + data.tools.length + ' 项工具声明，尚未包含模型回复。'};
    const slot = frame.slots.find(s => s.id === frame.fragment);
    return {title:'装入' + (f?.label || '消息'),copy:short(f?.text || '', 84),readout: (f?.label || '内容') + '写入 messages[' + slot?.ordinal + ']，role=' + f?.role + '。' + (f?.producer === 'system-prompt' ? '系统提示在这一个事件中整体写入。' : f?.producer === 'user' ? '它先于工作区指令、环境和 Skill 目录写入。' : '')};
  };
  function preview(f) {
    if (f.producer === 'skill-catalog' && f.entries) return f.entries.map(s => s.name).join(' · ');
    if (f.producer === 'runtime-context' && f.sections) return f.sections.map(s => s.text).join(' ');
    if (f.producer === 'agent-instructions') return (f.paths?.join(' · ') || '') + ' · ' + short(f.text.replace(/<[^>]+>/g, ''), 120);
    return short(f.text.replace(/<[^>]+>/g, ''), f.producer === 'system-prompt' ? 210 : 140);
  }
  function wire(origin, target, animate) {
    const svg = $('wiring');
    svg.replaceChildren();
    if (!origin || !target) return;
    const box = $('scene').getBoundingClientRect(), a = origin.getBoundingClientRect(), b = target.getBoundingClientRect();
    const mobile = box.width < 640;
    const x1 = (mobile ? a.left + a.width / 2 : a.right) - box.left;
    const y1 = (mobile ? a.bottom : a.top + Math.min(a.height / 2, 31)) - box.top;
    const x2 = (mobile ? b.left + b.width / 2 : b.left) - box.left;
    const y2 = (mobile ? b.top : b.top + b.height / 2) - box.top;
    const bend = mobile ? Math.round((y1 + y2) / 2) : Math.round((x1 + x2) / 2);
    const d = mobile ? `M ${x1} ${y1} V ${bend} H ${x2} V ${y2}` : `M ${x1} ${y1} H ${bend} V ${y2} H ${x2}`;
    const ns = 'http://www.w3.org/2000/svg';
    const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); path.setAttribute('class', 'wire'); svg.append(path);
    const dot = document.createElementNS(ns, 'rect'); dot.setAttribute('width', '5'); dot.setAttribute('height', '5'); dot.setAttribute('class', 'wire-dot'); svg.append(dot);
    const len = path.getTotalLength(), point = path.getPointAtLength(len);
    dot.setAttribute('x', point.x - 2.5); dot.setAttribute('y', point.y - 2.5);
    if (animate && !reduce.matches) {
      const samples = Array.from({length:49}, (_, i) => { const p = path.getPointAtLength(len * i / 48); return {transform:`translate(${p.x - point.x}px, ${p.y - point.y}px)`}; });
      animations.push(dot.animate(samples, {duration:600,easing:'linear',fill:'both'}));
      animations.push(path.animate([{strokeDasharray:len,strokeDashoffset:len},{strokeDasharray:len,strokeDashoffset:0}], {duration:600,easing:'ease-out'}));
    }
  }
  function stop() {
    playing = false; clearTimeout(timer); $('play-label').textContent = '重放真实装配'; $('play-icon').textContent = '▶';
  }
  function render(animate = false) {
    animations.forEach(a => a.cancel()); animations = [];
    const frame = frames[position], current = status(frame), previous = frames[position - 1];
    const oldRects = new Map([...$('messages').children].map(el => [el.dataset.id, el.getBoundingClientRect()]));
    const oldPendingRects = new Map([...$('pending').querySelectorAll('[data-fragment]')].map(el => [el.dataset.fragment, el.getBoundingClientRect()]));
    $('source-date').textContent = date + ' · 冻结会话';
    $('pending-count').textContent = String(frame.pending.length).padStart(2, '0');
    $('pending').innerHTML = frame.pending.length ? frame.pending.map(p => {
      const f = fragments[p.id];
      return '<button class="pending-card" type="button" data-fragment="' + esc(p.id) + '"><span class="queue-label"><span>' + esc(p.target || 'claimed') + '</span><span>' + (p.state === 'claimed' ? '已取出' : '待处理') + '</span></span><strong>' + esc(f.label) + '</strong><span class="snippet">' + esc(preview(f)) + '</span></button>';
    }).join('') : '<div class="pending-empty">' + (frame.seq < 15 ? '没有待处理消息' : '队列已清空。<br>后续内容直接写入消息历史。') + '</div>';
    $('event-seq').textContent = 'SEQ ' + String(frame.seq).padStart(2, '0');
    $('event-title').textContent = current.title;
    $('event-copy').textContent = current.copy;
    $('event-type').textContent = frame.type;
    $('incoming').setAttribute('aria-label', '查看原始事件 seq ' + frame.seq);
    $('message-count').textContent = frame.slots.length + ' / ' + totalMessages;
    $('messages').innerHTML = frame.slots.map(slot => {
      const f = fragments[slot.id], active = selectedId ? slot.id === selectedId : frame.fragment === slot.id && frame.operation;
      return '<button type="button" class="message ' + esc(f.producer || '') + (active ? ' active' : '') + '" data-index="' + slot.ordinal + '" data-id="' + esc(slot.id) + '" data-fragment="' + esc(slot.id) + '" aria-label="messages[' + slot.ordinal + '] ' + esc(f.label) + '"><span class="message-head"><span><strong>' + esc(f.label) + '</strong><span class="role">' + esc(f.role) + '</span></span><span class="seq">#' + slot.seq + '</span></span><span class="message-text">' + esc(preview(f)) + '</span></button>';
    }).join('');
    $('request-empty').hidden = frame.slots.length > 0;
    $('request-state').textContent = frame.configured ? 'seq ' + frame.seq + ' · 首条模型消息之前' : frame.slots.length ? '已写入 ' + frame.slots.length + ' 段，保留逻辑顺序' : '消息历史为空';
    $('tools-region').classList.toggle('loaded', frame.tools);
    $('tools').classList.toggle('active', frame.type === 'request/header');
    $('tools').disabled = !frame.tools;
    $('tools-empty').hidden = frame.tools;
    $('tools-content').hidden = !frame.tools;
    $('tool-count').textContent = data.tools.length;
    $('tool-names').textContent = data.tools.slice(0, 6).map(t => t.name || t.function?.name).join('\n') + '\n…';
    $('tools-seq').textContent = '# ' + data.source.toolsHeaderSeq;
    $('clock').textContent = clock(frame.time);
    const dt = frame.elapsedMs, gap = previous ? frame.time - previous.time : 0;
    $('elapsed').textContent = '+' + (dt / 1000).toFixed(3) + ' s' + (gap > 1000 ? ' · 间隔 ' + (gap / 1000).toFixed(1) + ' s' : '');
    $('readout').textContent = current.readout;
    $('position').textContent = String(position + 1).padStart(2, '0') + ' / ' + String(frames.length).padStart(2, '0');
    $('timeline').max = frames.length - 1; $('timeline').value = position; $('timeline').setAttribute('aria-valuetext', 'seq ' + frame.seq + '，' + current.title);
    $('previous').disabled = position === 0; $('next').disabled = position === frames.length - 1;
    $('range-start').textContent = 'seq ' + frames[0].seq; $('range-end').textContent = 'seq ' + last.seq;
    let target = null;
    if (frame.type === 'request/header') target = $('tools');
    else if (frame.operation) target = [...$('messages').children].find(el => el.dataset.id === frame.fragment);
    wire($('incoming'), target, animate);
    if (animate && target && !reduce.matches) {
      const from = $('incoming').getBoundingClientRect(), to = target.getBoundingClientRect();
      const pendingFrom = oldPendingRects.get(frame.fragment) || from;
      animations.push(target.animate([{transform:`translate(${pendingFrom.left - to.left}px, ${pendingFrom.top - to.top}px)`,opacity:.25},{transform:'translate(0, 0)',opacity:1}], {duration:640,easing:'cubic-bezier(.22,.7,.16,1)'}));
      for (const el of $('messages').children) {
        const before = oldRects.get(el.dataset.id), after = el.getBoundingClientRect();
        if (before && el !== target && Math.abs(before.top - after.top) > 1) animations.push(el.animate([{transform:`translateY(${before.top - after.top}px)`},{transform:'none'}], {duration:260,easing:'ease-out'}));
      }
    }
  }
  function go(next, animate = true) { stop(); selectedId = null; const before=position;position = Math.max(0, Math.min(frames.length - 1, next)); render(animate && position>before); }
  function advance() {
    if (!playing) return;
    if (position === frames.length - 1) {stop();return;}
    position++; selectedId = null; render(true);
    const frame = frames[position];
    timer = setTimeout(advance, ['turn/start','step/start'].includes(frame.type) ? 800 : 1500);
  }
  function start() {
    if (position === frames.length - 1) {position=0;selectedId=null;render(true);}
    playing=true; $('play-label').textContent='暂停'; $('play-icon').textContent='Ⅱ'; timer=setTimeout(advance,1400);
  }
  $('play').addEventListener('click', () => {if (playing) stop();else start();});
  $('previous').addEventListener('click', () => go(position - 1));
  $('next').addEventListener('click', () => go(position + 1));
  $('timeline').addEventListener('input', e => go(Number(e.target.value), false));
  $('end').addEventListener('click', () => go(frames.length - 1));
  function show(kind, title, note, content) {
    stop(); $('detail-kind').textContent=kind; $('detail-title').textContent=title; $('detail-note').textContent=note; $('detail-body').innerHTML=content; $('details').showModal();
  }
  function showFragment(id) {
    const f = fragments[id], slot = frames[position].slots.find(s => s.id === id);
    selectedId = id; render(false);
    show('NATIVE MESSAGE', f.label, (slot ? 'messages[' + slot.ordinal + '] · ' : '尚未写入历史 · ') + 'role=' + f.role + ' · source=' + f.producer + (slot ? ' · seq ' + slot.seq : '') + ' · ' + f.characters.toLocaleString() + ' 字符', '<pre>' + esc(f.text) + '</pre>');
  }
  $('scene').addEventListener('click', e => {const el=e.target.closest('[data-fragment]'); if(el)showFragment(el.dataset.fragment);});
  $('incoming').addEventListener('click', () => {
    const frame=frames[position];
    if (frame.type === 'request/header') {$('tools').click();return;}
    if(frame.fragment){showFragment(frame.fragment);return;}
    show('NATIVE EVENT','seq '+frame.seq, clock(frame.time)+' · '+frame.type, '<pre>'+esc(JSON.stringify({seq:frame.seq,type:frame.type,time:frame.time,turn:frame.turn,step:frame.step},null,2))+'</pre>');
  });
  $('tools').addEventListener('click', () => show('REQUEST HEADER', data.tools.length + ' 项工具声明', 'seq ' + data.source.toolsHeaderSeq + ' · 保持原生 tools[] 次序；不插入 messages[]。', data.tools.map(t => '<details><summary>'+esc(t.name||t.function?.name)+'</summary><pre>'+esc(JSON.stringify(t,null,2))+'</pre></details>').join('')));
  $('source').addEventListener('click', () => show('SOURCE & COVERAGE', '这一次装配的边界', data.source.session, '<div class="source-notes"><p>数据来自冻结会话的首次请求准备阶段，原始事件范围 seq '+data.source.sourceStart+'–'+data.source.cut+'。首条模型消息为 seq '+data.source.firstModelSeq+'，不在图内。</p><p>横向移动表示内容写入。中部自上而下的位置来自官方 SurfaceManager 的逻辑消息顺序；右侧工具来自 request/header.tools。这是适配器转换前的结构，不声称是供应商的字节布局。</p><p>队列取出与历史写入分别呈现。系统提示在一个 system/message 事件中整体写入；日志没有记录其内部各节的装配时刻。</p><p>回放间隔经过压缩，事件的顺序和时间戳保留。片段高度用于阅读，不表示 tokens。最后的 request/context 是配置元数据，不作为“已发送”事件。</p><p>来源：<code>'+esc(data.source.log)+'</code><br>冻结源摘要：<code>'+esc(data.source.sourceHash)+'</code></p></div>'));
  $('close-details').addEventListener('click', () => { $('details').close();selectedId=null;render(false); });
  $('details').addEventListener('cancel', () => {selectedId=null;render(false);});
  $('theme').addEventListener('click', () => {const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';$('theme').textContent=dark?'浅色':'深色';$('theme').setAttribute('aria-label',dark?'切换为浅色':'切换为深色');});
  new ResizeObserver(() => {
    const frame=frames[position]; let target=null;
    if(frame.type==='request/header')target=$('tools');
    else if(frame.operation)target=[...$('messages').children].find(el=>el.dataset.id===frame.fragment);
    wire($('incoming'),target,false);
  }).observe($('scene'));
  document.addEventListener('visibilitychange', () => {if(document.hidden)stop();});
  if (reduce.matches) position=frames.length-1;
  render();
  if (!reduce.matches) start();
});
