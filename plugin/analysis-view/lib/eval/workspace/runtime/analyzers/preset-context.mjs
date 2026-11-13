import { createHash } from 'node:crypto';

export const presetContextCategories = [
  ['system', '系统提示'], ['instructions', 'AGENTS.md / 项目指令'],
  ['tools', '工具定义'], ['catalog', 'Skill 目录'], ['context', '环境与插件补充'],
];
export const contentHash = value => createHash('sha256').update(typeof value === 'string' || ArrayBuffer.isView(value) ? value : JSON.stringify(value)).digest('hex').slice(0, 20);
export const textContent = message => (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('\n');
const replacement = event => event.surfaceOp && typeof event.surfaceOp === 'object';
const parseArgs = value => { try { return typeof value === 'string' ? JSON.parse(value) : value ?? {}; } catch { return {}; } };
const add = (map, key, value = 1) => map.set(key, (map.get(key) ?? 0) + value);

// The preset in the creation header can change before the first turn.
export function recordedPreset(header, events, through = Infinity) {
  let preset = header.agentPreset ?? null;
  for (const event of events) if (event.seq <= through && event.type === 'agent-preset/selected') preset = event.data.agentPreset;
  return preset ?? 'unrecorded';
}

export function projectPresetContext(header, events, { deriveEventMessage, foldSurface, estimateMessage, estimateContent, estimateToolsTokens }, {summaryOnly=false,inheritedEventCount}={}) {
  const bySeq = new Map(events.map(event => [event.seq, event]));
  const first = events.find(event => event.type === 'assistant/message' && !replacement(event));
  if (!first) return null;
  const seedEnd = Number.isSafeInteger(inheritedEventCount) ? inheritedEventCount-1 : header.isSeeded ? events.find(event => event.type === 'session/end-seed')?.seq ?? Infinity : -1;
  const tools = new Map(), skills = new Map(), calls = new Map(), dispatches = new Set(), evidence = new Map(), skillLoads=new Set();
  const tool = name => { if (!tools.has(name)) tools.set(name, { name, calls: 0, requests: 0, versions: new Set(), seq: null, firstCall: null }); return tools.get(name); };
  const skill = name => { if (!skills.has(name)) skills.set(name, { name, catalogs: 0, loads: 0, seq: null, path: null, loadEvents:[] }); return skills.get(name); };
  const loadSkill=(row,event,kind,path=null)=>{
    const d=event.data??{},message=deriveEventMessage(event),callId=message?.toolCallId??message?.source?.callId??d.callId;
    const identity=event.type==='tool/ptc-dispatch'&&d.rootCallId!=null&&d.subCallId!=null?'ptc:'+JSON.stringify([d.rootCallId,d.subCallId]):callId?'call:'+callId:'seq:'+event.seq;
    const key=row.name+':'+identity;if(skillLoads.has(key))return;skillLoads.add(key);
    row.loads++;row.loadSeq??=event.seq;row.loadEvents.push({seq:event.seq,time:Number.isFinite(event.time)?event.time:null,kind,path});
  };
  const keep = (event, value) => {
    if(!summaryOnly)evidence.set(event.seq, { session: header.id, seq: event.seq, type: event.type, time: event.time, value });
    return event.seq;
  };
  let activeTools = [], title = '', requestCount = 0, turn = null;
  const compactions = [];
  for (const event of events) {
    const d = event.data ?? {};
    if (event.type === 'session/title') title = d.title ?? d.text ?? title;
    if (event.type === 'turn/start') turn = d.turn;
    if (event.type === 'request/header') {
      activeTools = (d.header?.tools ?? []).filter(item => typeof item.name === 'string');
      for (const item of activeTools) {
        const row = tool(item.name); row.versions.add(contentHash(item)); row.seq ??= event.seq;
        row.description ??= item.description ?? '';
      }
    }
    if (event.type === 'assistant/message' && !replacement(event) && event.seq > seedEnd) {
      requestCount++;
      for (const item of activeTools) tool(item.name).requests++;
    }
    const message = deriveEventMessage(event);
    if (message?.source?.kind === 'skill-catalog' && !replacement(event)) {
      for (const entry of message.source.entries ?? []) {
        if (!entry.name) continue;
        const row = skill(entry.name); row.catalogs++; row.seq ??= event.seq;
        row.description ??= entry.description ?? ''; row.path ??= entry.path ?? null;
      }
    }
    if (message?.source?.kind === 'skill-invocation' && !replacement(event) && event.seq > seedEnd && message.source.name) {
      const row = skill(message.source.name); loadSkill(row,event,'manual');
    }
    if (event.type === 'tool/call') {
      calls.set(d.callId, event);
      if (event.seq > seedEnd && d.name) { const row = tool(d.name); row.calls++; row.firstCall ??= event.seq; }
    }
    if (event.type === 'tool/ptc-dispatch' || event.type === 'tool/ptc-dispatch-start') {
      const key = JSON.stringify([d.rootCallId, d.subCallId]);
      if (event.seq > seedEnd && d.name && !dispatches.has(key)) {
        dispatches.add(key); const row = tool(d.name); row.calls++; row.firstCall ??= event.seq;
      }
    }
    if (event.type === 'tool/result' && !replacement(event) && event.seq > seedEnd) {
      const call = calls.get(message?.toolCallId ?? message?.source?.callId ?? d.callId);
      if (call?.data.name === 'skill' && !message?.isError && !d.error) {
        const args = parseArgs(call.data.arguments), name = textContent(message).match(/<skill_content\s+name="([^"]+)"/)?.[1] ?? args.name ?? args.skill;
        if (typeof name === 'string') { const row = skill(name);
          const base=textContent(message).match(/Base directory for this skill:\s*([^\r\n]+)/)?.[1];if(base)row.path??=base.replace(/[\\/]$/,'')+'/SKILL.md';
          loadSkill(row,event,'skill',row.path);
          keep(event,{name,text:textContent(message)}); }
      }
      if (['read','read_file'].includes(call?.data.name) && !message?.isError && !d.error) {
        const args=parseArgs(call.data.arguments), path=String(args.file_path??args.path??'').replaceAll('\\','/');
        const name=path.match(/\/([^/]+)\/SKILL\.md$/i)?.[1];
        if(name&&skills.has(name)){const row=skill(name);loadSkill(row,event,'read',path);row.path??=path;keep(event,{name,path,text:textContent(message)});}
      }
    }
    if (event.type === 'tool/ptc-dispatch' && d.name === 'skill' && event.seq > seedEnd && !d.error && d.isError !== true) {
      const args = parseArgs(d.arguments), name = args.name ?? args.skill;
      if (typeof name === 'string' && (d.result != null || d.content != null)) { const row = skill(name);
        const text=textContent({content:d.content??d.result?.content??[]}),base=text.match(/Base directory for this skill:\s*([^\r\n]+)/)?.[1];
        if(base)row.path??=base.replace(/[\\/]$/,'')+'/SKILL.md';loadSkill(row,event,'skill',row.path);keep(event,{name,text}); }
    }
    if(event.type==='tool/ptc-dispatch'&&['read','read_file'].includes(d.name)&&event.seq>seedEnd&&!d.error&&d.isError!==true){
      const args=parseArgs(d.arguments),path=String(args.file_path??args.path??'').replaceAll('\\','/'),name=path.match(/\/([^/]+)\/SKILL\.md$/i)?.[1];
      if(name&&skills.has(name)&&(d.result!=null||d.content!=null)){const row=skill(name);loadSkill(row,event,'read',path);row.path??=path;keep(event,{name,path,text:textContent({content:d.content??d.result?.content??[]})});}
    }
    if (!summaryOnly && event.type === 'compaction/summary' && event.seq > seedEnd) {
      const start = events.findLast(row => row.seq < event.seq && row.type === 'compaction/start' && row.data.compactionId === d.compactionId);
      const summary = (d.summary ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
      const reduced = new Map();
      for (const seq of d.shadowedSeqs ?? []) {
        const original = bySeq.get(seq), msg = original && deriveEventMessage(original);
        if (!msg) continue;
        const key = msg.source?.kind === 'skill-catalog' ? 'Skill 目录' : msg.source?.kind === 'agent-instructions' ? '项目指令'
          : msg.role === 'tool' ? '工具结果' : msg.role === 'assistant' ? '助手消息' : msg.source?.kind === 'user' ? '用户消息' : '其他上下文';
        add(reduced, key, estimateMessage(msg));
      }
      compactions.push({ seq: event.seq, startSeq: start?.seq ?? event.seq, turn: start?.data.turn ?? turn, time: event.time,
        summaryTokens: estimateContent(d.summary ?? []), originalTokens: d.shadowedTokenCount ?? null,
        messages: d.shadowedSeqs?.length ?? null, reduced: [...reduced].map(([name, tokens]) => ({ name, tokens })),
        preview: summary.slice(0, 500), evidence: keep(event, { summary, shadowedRange: d.shadowedRange, shadowedSeqs: d.shadowedSeqs, provider: d.provider, model: d.model }) });
    }
  }
  if (!requestCount) return null;
  const contiguous = events.every((event, index) => event.seq === index);
  const initial = { available: false, categories: {}, items: [], total: null };
  // Seeded histories already contain prior work; do not call their first response a new-session baseline.
  if (!summaryOnly && contiguous && !header.isSeeded && !header.delegationDepth) {
    try {
      const prefix = events.filter(event => event.seq < first.seq), surface = foldSurface(prefix);
      const headerEvent = prefix.findLast(event => event.type === 'request/header');
      const categories = Object.fromEntries(presetContextCategories.map(([key]) => [key, 0]));
      for (const seq of surface.nodes) {
        const event = bySeq.get(typeof seq === 'number' ? seq : seq.seq);
        if (!event) continue;
        const message = surface.projectedMessages?.get?.(event.seq) ?? deriveEventMessage(event);
        if (!message || ['assistant', 'tool'].includes(message.role) || message.source?.kind === 'user') continue;
        const source = message.source ?? {}, body = textContent(message);
        if (!body) continue;
        const category = message.role === 'system' ? 'system' : source.kind === 'agent-instructions' ? 'instructions' : source.kind === 'skill-catalog' ? 'catalog' : 'context';
        const tokens = estimateMessage(message); categories[category] += tokens;
        const paths = (source.changes ?? []).map(change => change.path).filter(Boolean);
        const item = { category, producer: source.kind ?? 'unrecorded', recordedPlugin: source.plugin ?? null, name: paths.join('、') || (category === 'system' ? '系统提示' : category === 'catalog' ? 'Skill 目录' : source.plugin ?? source.kind ?? '其他补充'),
          seq: event.seq, hash: contentHash(body), tokens, chars: body.length, preview: body.slice(0, 420), paths,
          sections: (source.sections ?? []).map(section => ({ name: section.name, text: section.text, tokens: estimateContent([{type:'text',text:section.text}]) })),
          truncated: /Workspace instruction budget[^\n]*:.*(?:truncated|omitted)/.test(body),
          evidence: keep(event, { source, text: body }) };
        initial.items.push(item);
      }
      if (headerEvent) {
        const declarations = headerEvent.data.header?.tools ?? [];
        categories.tools = estimateToolsTokens(headerEvent.data.header);
        for (const schema of declarations) {
          initial.items.push({ category: 'tools', producer: 'tool-registry', name: schema.name, seq: headerEvent.seq,
            hash: contentHash(schema), tokens: estimateToolsTokens({ tools: [schema] }), chars: JSON.stringify(schema).length,
            description: schema.description ?? '', preview: schema.description ?? '', evidence: headerEvent.seq });
        }
        keep(headerEvent, { tools: declarations });
      }
      Object.assign(initial, { available: Boolean(headerEvent), categories, total: Object.values(categories).reduce((a,b) => a+b,0), inputCut: first.seq - 1 });
    } catch (error) { initial.reason = error.message; }
  }
  // Keep short call evidence for the source-to-use drilldown without copying complete results.
  for (const row of tools.values()) if (row.firstCall != null) {
    const event = bySeq.get(row.firstCall); keep(event, { name: row.name, arguments: parseArgs(event.data.arguments) });
  }
  for(const row of tools.values())if(row.seq!=null&&!evidence.has(row.seq)){const event=bySeq.get(row.seq);keep(event,{tools:event.data.header?.tools??[]});}
  for(const row of skills.values())for(const seq of [row.seq,row.loadSeq])if(seq!=null&&!evidence.has(seq)){const event=bySeq.get(seq),message=deriveEventMessage(event);keep(event,{source:message?.source,text:textContent(message)});}
  return { session: { id: header.id, preset: recordedPreset(header, events, first.seq), createdAt: header.createdAt,
    lastAt: events.at(-1)?.time, cut: events.at(-1)?.seq, title: title || header.id, seeded: Boolean(header.isSeeded),
    requests: requestCount, calls: [...tools.values()].reduce((n,row) => n+row.calls,0), initial,
    tools: [...tools.values()].map(row => ({ ...row, versions: [...row.versions] })), skills: [...skills.values()], compactions }, evidence: [...evidence.values()] };
}
