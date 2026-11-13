import { renderSkillLandscape } from './skill-visuals.js';
import { skillPresetControls } from './capability-management.js';
import { renderOverlapExamples } from './overlap-preview.js';
import { originInfo } from './variants.js';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=value=>value==null?'—':value>=1000?(value/1000).toFixed(1)+'k':Math.round(value).toLocaleString('zh-CN');
const DAY=86400000,ZONE=8*3600000;
const day=ts=>new Date(ts+ZONE).toISOString().slice(0,10);
const short=ts=>ts==null?'未观测':day(ts).slice(5).replace('-','/');
const full=ts=>ts==null?'未观测':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(ts);
const badge=s=>`<span class="origin-badge ${s.provenance?.origin??'unknown'}">${originInfo[s.provenance?.origin??'unknown'].short}</span>`;
const kinds={skill:'Skill 调用',read:'正文读取',manual:'手动唤起'};

export function skillWindow(preset,period=30,names=null){
  const asOf=preset.statistics.usage.asOf??preset.skillManagement?.capturedAt??Date.now();
  const source=(preset.skillManagement?.events??[]).filter(event=>event.time!=null&&event.time<=asOf&&(!names||names.has(event.name)));
  const end=Math.floor((asOf+ZONE)/DAY)*DAY-ZONE+DAY;
  const start=period==='all'?Math.floor(((Math.min(...source.map(row=>row.time),asOf))+ZONE)/DAY)*DAY-ZONE:end-Number(period)*DAY;
  const span=Math.max(1,Math.ceil((end-start)/DAY)),step=Math.max(1,Math.ceil(span/30));
  const bins=Array.from({length:Math.ceil(span/step)},(_,i)=>({start:start+i*step*DAY,end:Math.min(end,start+(i+1)*step*DAY),skill:0,read:0,manual:0,total:0}));
  const events=source.filter(row=>row.time>=start&&row.time<end);
  for(const event of events){const bin=bins[Math.floor((event.time-start)/(step*DAY))];if(!bin)continue;bin[event.kind]=(bin[event.kind]??0)+1;bin.total++;}
  return {events,bins,start,end,asOf,totals:Object.fromEntries(Object.keys(kinds).map(kind=>[kind,events.filter(row=>row.kind===kind).length]))};
}
export function selectSkillEvents(window,{skillRange=null,skillKind='all'}={}){
  return window.events.filter(event=>(!skillRange||event.time>=skillRange.start&&event.time<skillRange.end)&&(skillKind==='all'||event.kind===skillKind));
}
function chart(window,{mini=false,selection=null,kind='all',idPrefix='overview',widthOverride=null}={}){
  if(!mini){
    const width=widthOverride??(globalThis.matchMedia?.('(max-width:560px)')?.matches?320:idPrefix==='overview'?820:620),height=176,left=30,right=12,top=22,bottom=30,plot=height-top-bottom,step=(width-left-right)/Math.max(1,window.bins.length-1);
    const count=bin=>kind==='all'?bin.total:bin[kind]??0,max=Math.max(1,...window.bins.map(count)),y=value=>height-bottom-value/max*plot;
    const points=window.bins.map((bin,i)=>[left+i*step,y(count(bin))]);
    return `<svg class="skill-chart-svg skill-trend" viewBox="0 0 ${width} ${height}" role="group" aria-label="读取次数趋势"><line class="chart-grid" x1="${left}" x2="${width-right}" y1="${top}" y2="${top}"/><line class="chart-grid" x1="${left}" x2="${width-right}" y1="${height-bottom}" y2="${height-bottom}"/><text x="0" y="${top+4}">${max}</text><text x="0" y="${height-bottom+3}">0</text><path class="skill-trend-area" d="M ${left} ${height-bottom} L ${points.map(p=>p.join(' ')).join(' L ')} L ${points.at(-1)?.[0]??left} ${height-bottom} Z"/><polyline class="skill-trend-line" points="${points.map(p=>p.join(',')).join(' ')}"/>
    ${window.bins.map((bin,i)=>{const [x,py]=points[i],active=selection?.start===bin.start,label=`${day(bin.start)}${bin.end-bin.start>DAY?' 至 '+day(bin.end-DAY):''} · ${count(bin)} 次`;return `<g id="skill-${e(idPrefix)}-bin-${bin.start}" class="skill-chart-bin" role="button" tabindex="${selection?active?0:-1:i===0?0:-1}" aria-pressed="${active}" aria-label="${label}，筛选日期" data-skill-action="date" data-start="${bin.start}" data-end="${bin.end}" data-chart-label="${label}｜调用 ${bin.skill} · 读取 ${bin.read} · 手动 ${bin.manual}"><rect class="chart-hit" x="${Math.max(left-8,x-step/2)}" y="${top-10}" width="${i===0||i===window.bins.length-1?step/2+8:step}" height="${plot+22}"/>${active?`<line class="skill-date-guide" x1="${x}" x2="${x}" y1="${top-6}" y2="${height-bottom+9}"/>`:''}<circle class="skill-trend-point" cx="${x}" cy="${py}" r="${active?5:count(bin)?2.5:0}"/><circle class="skill-keyboard-point" cx="${x}" cy="${py}" r="7"/></g>`;}).join('')}<text x="${left}" y="${height-4}">${short(window.start)}</text><text x="${width/2}" y="${height-4}" text-anchor="middle">${short((window.start+window.end)/2)}</text><text x="${width-right}" y="${height-4}" text-anchor="end">${short(window.end-DAY)}</text></svg>`;
  }
  const width=mini?100:650,height=mini?30:132,left=mini?0:26,top=mini?1:8,bottom=mini?0:26,plot=height-top-bottom,max=Math.max(1,...window.bins.map(bin=>bin.total));
  const bar=(width-left)/Math.max(1,window.bins.length),y=count=>height-bottom-count/max*plot;
  const columns=window.bins.map((bin,i)=>{let below=0;const rects=Object.keys(kinds).map(type=>{const count=bin[type]??0;if(!count)return '';const result=`<rect x="${left+i*bar+bar*.15}" y="${y(below+count)}" width="${bar*.7}" height="${count/max*plot}" class="load-${type}${kind!=='all'&&kind!==type?' chart-muted':''}" rx="1"/>`;below+=count;return result;}).join('');const label=`${day(bin.start)}${bin.end-bin.start>DAY?' 至 '+day(bin.end-DAY):''} · ${bin.total} 次｜调用 ${bin.skill} · 读取 ${bin.read} · 手动 ${bin.manual}`;return `<g ${mini?'':`id="skill-${e(idPrefix)}-bin-${bin.start}" tabindex="${selection?selection.start===bin.start?0:-1:i===0?0:-1}" role="button" aria-pressed="${selection?.start===bin.start}" aria-label="${label}，点选筛选记录" data-skill-action="date" data-start="${bin.start}" data-end="${bin.end}" data-chart-label="${label}" class="skill-chart-bin ${selection&&selection.start!==bin.start?'chart-unselected':''}"`}>
    ${mini?`<title>${label}</title>`:`<rect class="chart-hit" x="${left+i*bar}" y="${top-4}" width="${bar}" height="${plot+8}" rx="3"/>`}${rects||`<rect x="${left+i*bar+bar*.15}" y="${height-bottom-1}" width="${bar*.7}" height="1" class="load-empty"/>`}</g>`;}).join('');
  return `<svg class="${mini?'skill-spark':'skill-chart-svg'}" viewBox="0 0 ${width} ${height}" ${mini?'aria-hidden="true"':'role="group" aria-label="按实际发生时间统计的调用与读取次数"'}>${mini?'':`<line x1="${left}" x2="${width}" y1="${top}" y2="${top}" class="chart-grid"/><line x1="${left}" x2="${width}" y1="${height-bottom}" y2="${height-bottom}" class="chart-grid"/><text x="0" y="${top+4}">${max}</text><text x="0" y="${height-bottom+3}">0</text>`}${columns}${mini?'':`<text x="${left}" y="${height-5}">${short(window.start)}</text><text x="${left+(width-left)/2}" y="${height-5}" text-anchor="middle">${short((window.start+window.end)/2)}</text><text x="${width}" y="${height-5}" text-anchor="end">${short(window.end-DAY)}</text>`}</svg>`;
}
function chartPanel(preset,window,ui={},name=''){
  const selected=selectSkillEvents(window,ui),range=ui.skillRange,kind=ui.skillKind??'all';
  return `<section class="skill-chart-panel" data-chart-skill="${e(name)}"><div class="skill-chart-heading"><div><span>读取趋势</span><strong>${selected.length}<small>次${range?' · '+short(range.start):''}</small></strong></div><div class="skill-chart-legend" role="group" aria-label="按读取类型筛选">${Object.entries(kinds).map(([type,label])=>`<button type="button" data-skill-action="kind" data-kind="${type}" aria-pressed="${kind==='all'||kind===type}"><i class="load-${type}"></i>${label} <b>${window.totals[type]}</b></button>`).join('')}</div></div>
    ${chart(window,{selection:range,kind,idPrefix:name||'overview',widthOverride:ui.skillChartWidth})}<div class="skill-chart-tooltip" role="status" hidden></div>
    <div class="skill-chart-selection" aria-live="polite"><span>${range?`${short(range.start)}${range.end-range.start>DAY?' – '+short(range.end-DAY):''} · ${selected.length} 次读取${kind!=='all'?' · '+kinds[kind]:''}`:kind!=='all'?`仅看${kinds[kind]}`:`${new Set(window.events.map(r=>r.name)).size} 项 Skill 有读取记录`}</span><div>${range||kind!=='all'?'<button type="button" data-skill-action="clear-chart">清除筛选</button>':''}<button type="button" data-skill-action="events">查看记录 ↗</button></div></div></section>`;
}
export function renderSkillEvents(preset,ui,name){const names=name?new Set([name]):new Set(preset.skills.filter(s=>!ui.skillOrigin||ui.skillOrigin==='all'||s.provenance?.origin===ui.skillOrigin).map(s=>s.name)),window=skillWindow(preset,ui.skillPeriod??30,names);return `<div class="skill-detail-title"><h2>${e(name||'Skill 读取记录')}</h2><p>${preset.scopeAll?"全部预设共":"同预设最近"} ${preset.statistics.usage.sessions} 个已读会话。</p></div>${eventRecords(selectSkillEvents(window,ui),{open:true})}`;}
function pairButton(pair,from){return `<button type="button" class="skill-pair-button" data-skill-action="compare" data-left="${e(pair.left)}" data-right="${e(pair.right)}" ${from?`data-from="${e(from)}"`:''}><span><strong>${e(from?(pair.left===from?pair.right:pair.left):pair.left+' ↔ '+pair.right)}</strong><small>${e(pair.reason)}${pair.shared.length?' · '+e(pair.shared.slice(0,2).join('、')):''}</small></span><b>↗</b></button>`;}
function eventRecords(events,{open=false,links=true}={}){
  return `<details class="skill-event-details selected-records" ${open?'open':''}><summary>所选范围的读取记录 <span>${events.length}</span></summary>${events.slice().reverse().map(row=>`<div><span>${full(row.time)}</span><strong>${kinds[row.kind]??e(row.kind)}</strong>${links?`<button data-skill-action="open" data-name="${e(row.name)}">${e(row.name)} ↗</button>`:''}<small>${e(row.sessionTitle??row.session)} · #${row.seq}</small></div>`).join('')||'<p>这个范围没有观测到读取记录。</p>'}</details>`;
}
export function renderSkills(preset,data,ui){
  const analysis=preset.skillManagement,period=ui.skillPeriod??30,search=(ui.skillQuery??'').toLowerCase(),origin=ui.skillOrigin??'all';
  const current=preset.skills.filter(s=>(origin==='all'||s.provenance?.origin===origin));
  const window=skillWindow(preset,period,new Set(current.map(s=>s.name))),selected=selectSkillEvents(window,ui),counts=new Map();for(const event of selected)counts.set(event.name,(counts.get(event.name)??0)+1);
  const chartFiltered=ui.skillRange||ui.skillKind&&ui.skillKind!=='all';
  const rows=current.filter(s=>(!chartFiltered||counts.has(s.name))&&(!ui.skillActivity||ui.skillActivity==='all'||ui.skillActivity==='read'&&counts.has(s.name)||ui.skillActivity==='unread'&&!counts.has(s.name))&&(!ui.skillChanged||s.freshness?.modifiedAfterLastRead)&&(!ui.skillUnused||s.usage.unusedCandidate)&&(!search||[s.name,s.description,s.sourceLabel].join(' ').toLowerCase().includes(search))).sort((a,b)=>ui.skillSort==='size'?b.bodyTokens-a.bodyTokens:ui.skillSort==='updated'?b.modifiedAt-a.modifiedAt:ui.skillSort==='last'?(b.usage.lastLoadedAt??0)-(a.usage.lastLoadedAt??0):(counts.get(b.name)??0)-(counts.get(a.name)??0)||a.name.localeCompare(b.name));
  const pairs=analysis?.pairs??[],repetitions=analysis?.repetitions,repeatCount=repetitions?.checks.filter(row=>row.matches.length).length??0;
  return `<div class="skills-heading"><div><h2>Skill 管理</h2><p>使用记录、内容大小与维护情况。</p></div><span>${preset.skills.length} 项当前 Skill</span></div><div class="skill-overview-strip"><span><b>${preset.skills.length}</b> 项当前 Skill</span><span>正文合计 <b>≈ ${n(preset.statistics.skillBodies)}</b> tokens</span><span>最近 ${preset.statistics.usage.sessions} 个同预设会话</span></div>
  <div class="skill-controls"><select id="skill-period" aria-label="调用图时间范围">${[[30,'近 30 天'],[90,'近 90 天'],['all','全部观察窗口']].map(([v,label])=>`<option value="${v}" ${String(v)===String(period)?'selected':''}>${label}</option>`).join('')}</select><select id="skill-origin" aria-label="Skill 来源">${[['all','全部来源'],['official','DSH 官方'],['personal','我的内容'],['plugin','我的插件']].map(([v,label])=>`<option value="${v}" ${v===origin?'selected':''}>${label}</option>`).join('')}</select></div>
  ${current.length?renderSkillLandscape(preset,current,counts,ui,chartPanel(preset,window,{...ui,skillChartWidth:globalThis.document?.getElementById('skill-management-panel')?.clientWidth||820}),data.demoExamples):`<div class="empty-state"><strong>${preset.skills.length?'所选来源没有 Skill':'这个预设未配置 Skill 目录'}</strong></div>`}
  <div class="skill-findings-strip"><span>当前 Skill · ${preset.skills.length} 项</span><span>目录 ≈ ${n(preset.statistics.categories.find(c=>c.id==='skills').tokens)} tokens · 正文按需加载</span></div>
  ${ui.skillActivity&&ui.skillActivity!=='all'||ui.skillChanged?`<div class="skill-list-selection"><span>列表筛选：${ui.skillChanged?'最近读取后有修改':ui.skillActivity==='read'?'有读取记录':'无读取记录'}</span><button data-skill-action="clear-activity">清除 ×</button></div>`:''}<div class="skill-list-heading"><label class="skill-search"><span aria-hidden="true">⌕</span><input type="search" id="skill-query" aria-label="查找 Skill" placeholder="查找名称、用途或来源" value="${e(ui.skillQuery??'')}"></label><h3><span>${rows.length} 项</span></h3><label><input type="checkbox" id="skill-unused" title="样本中至少 3 个会话可见，且没有读取记录" ${ui.skillUnused?'checked':''}>未见使用</label><select id="skill-sort" aria-label="Skill 排序">${[['usage','按读取次数'],['last','按最近读取'],['updated','按文件修改时间'],['size','按正文大小']].map(([v,label])=>`<option value="${v}" ${v===(ui.skillSort??'usage')?'selected':''}>${label}</option>`).join('')}</select></div>
  <div class="skill-manager-list">${rows.map(s=>{const related=pairs.filter(pair=>pair.left===s.name||pair.right===s.name),own=skillWindow(preset,period,new Set([s.name]));return `<article class="managed-skill"><button class="managed-skill-main" data-skill-action="open" data-name="${e(s.name)}"><span class="managed-skill-label"><strong>${e(s.name)}</strong><span class="managed-skill-description">${e(s.description)}</span><span class="skill-time-line">${badge(s)}<span>文件修改 ${short(s.modifiedAt)}</span><span>最近读取 ${short(s.usage.lastLoadedAt)}</span></span></span><span class="managed-skill-use">${chart(own,{mini:true})}<strong>${counts.get(s.name)??0}<small>次</small></strong></span><span class="managed-skill-size"><strong>${n(s.bodyTokens)}</strong><small>正文 tokens</small><span>目录 ${n(s.catalogTokens)}</span></span><span class="managed-arrow">›</span></button>${related.length?`<button class="skill-related-link" data-skill-action="open" data-name="${e(s.name)}">${related.length} 项职责或约束线索${related.some(pair=>pair.references.length)?' · 含明确引用关系':''} →</button>`:''}</article>`;}).join('')||'<p class="skill-list-empty">没有符合当前筛选的 Skill。</p>'}</div>
  <p class="quiet-note">使用记录更新于 ${full(window.asOf)}。${preset.skills.some(s=>s.usage.untimed)?'部分历史读取缺少发生时间，未画入图中。':''}</p>`;
}
export function globalSkillPreset(data,preset,skill){
  if(!data?.presets)return preset;
  const parts=data.presets.flatMap(p=>[...p.skills,...p.disabledSkills??[]].filter(s=>s.name===skill.name).map(s=>({p,s})));
  const unique=rows=>[...new Map(rows.map(r=>[JSON.stringify([r.session,r.seq,r.time,r.kind]),r])).values()];
  const events=unique(parts.flatMap(({s})=>(s.usage?.events??[]).map(e=>({...e,name:skill.name}))));
  const samples=[...new Map(parts.flatMap(({s})=>s.usage?.samples??[]).map(s=>[s.session,s])).values()];
  const aggregate={...skill,usage:{...skill.usage,events,count:samples.reduce((sum,s)=>sum+s.count,0),visibleSessions:samples.filter(s=>s.visible).length,usedSessions:samples.filter(s=>s.count>0).length,lastLoadedAt:events.reduce((last,e)=>e.time==null?last:Math.max(last??0,e.time),null)}};
  return {...preset,name:'全部预设',scopeAll:true,skills:[aggregate],statistics:{...preset.statistics,usage:{...preset.statistics.usage,sessions:parts.reduce((n,{p})=>n+p.statistics.usage.sessions,0),asOf:Math.max(...parts.map(({p})=>p.statistics.usage.asOf??0))}},skillManagement:{...preset.skillManagement,events}};
}
export function renderSkillDetail(preset,skill,ui,documentBody,data){
  const global=globalSkillPreset(data,preset,skill),summary=global.skills.find(s=>s.name===skill.name)??skill;
  const window=skillWindow(global,ui.skillPeriod??30,new Set([skill.name])),pairs=preset.skillManagement.pairs.filter(p=>p.left===skill.name||p.right===skill.name),check=preset.skillManagement.repetitions.checks.find(row=>row.name===skill.name);
  return `<div class="skill-detail-title">${badge(skill)}<h2>${e(skill.name)}</h2><p>${e(skill.description)}</p></div>
  <div class="skill-global-summary"><strong>${summary.usage?.count??0}</strong><span>次读取</span><span class="skill-global-scope">全部预设</span></div>
  <dl class="skill-facts"><div><dt>当前文件修改</dt><dd>${full(skill.modifiedAt)}</dd></div><div><dt>最近读取</dt><dd>${full(summary.usage?.lastLoadedAt)}</dd></div><div><dt>目录 / 正文</dt><dd>${n(skill.catalogTokens)} / ${n(skill.bodyTokens)} tokens</dd></div><div><dt>有读取的会话</dt><dd>${summary.usage?.usedSessions??0} 个</dd></div></dl>
  ${skillPresetControls(skill,data)}${chartPanel(global,window,ui,skill.name)}<section class="co-skill-entry"><div><h3>上下文重合</h3><p>与当前预设中的指令、工具说明及其他 Skill 一起对照。</p></div><button class="text-action" data-skill-action="context-overlap">查看相同片段与来源 ↗</button></section>
  <details class="skill-current-body"><summary>当前正文 <span>${n(skill.bodyTokens)} tokens</span></summary><div class="document">${documentBody(skill.body)}</div><div class="skill-file-path">${e(skill.path)}</div></details>
  ${eventRecords(selectSkillEvents(window,ui),{open:Boolean(ui.skillRange),links:false})}`;
}
export function renderSkillComparison(preset,left,right,from){
  const pair=preset.skillManagement.pairs.find(p=>p.left===left&&p.right===right),a=preset.skills.find(s=>s.name===left),b=preset.skills.find(s=>s.name===right);
  if(!pair||!a||!b)return '<p>当前比较项已变化，请重新选择。</p>';
  const evidence=pair.evidence;
  return `${from?`<button class="skill-back" data-skill-action="open" data-name="${e(from)}">← 返回 Skill</button>`:''}<div class="skill-detail-title"><span class="eyebrow">Description 对照</span><h2>${e(pair.reason)}</h2><p>这是待核对的候选，尚未判定两个 Skill 功能重复。</p></div><div class="description-pair">${[a,b].map(s=>`<section>${badge(s)}<h3>${e(s.name)}</h3><p>${e(s.description)}</p><button data-skill-action="open" data-name="${e(s.name)}">查看正文与使用情况 ↗</button></section>`).join('')}</div>
  <section class="candidate-evidence"><h3>为什么列出这一对</h3><p>${e(pair.reason)}。${evidence.actions.length?'共同任务：'+e(evidence.actions.join('、'))+'。':''}${evidence.objects.length?'具体对象：'+e(evidence.objects.join('、'))+'。':''}${evidence.conflicts.length?'需核对的相反约束：'+e(evidence.conflicts.join('、'))+'。':''}</p><blockquote>${e(evidence.left)}</blockquote><blockquote>${e(evidence.right)}</blockquote></section>
  <p class="quiet-note">仅比较当前描述；正文只用于识别明确引用。没有模型推理，不把分数当成语义相似百分比，也不自动合并或停用。</p>`;
}
export function renderSkillChecks(preset,examples,selected){
  const a=preset.skillManagement,r=a.repetitions,d=a.descriptions;
  return `<div class="skill-detail-title"><span class="eyebrow">描述检查</span><h2>描述检查</h2><p>比较当前描述中的任务与约束，排除官方 Skill 之间的比较。</p></div>
  <section class="skill-review-section"><h3>职责或约束待核对 · ${a.pairs.length} 对</h3>${a.pairs.map(pair=>pairButton(pair)).join('')||'<p class="skill-review-empty">当前没有待核对的描述候选。</p>'}
  <p>已比较 ${d?.compared??0} 对；跳过 ${d?.excluded.official??0} 对官方 Skill、${d?.excluded.reference??0} 对明确引用关系${d?.excluded.phase?'、'+d.excluded.phase+' 对不同触发阶段':''}。</p>
  <details class="skill-method"><summary>检查依据与边界</summary><p>先统一词形和常见缩写，用稀疏词与短语特征检索；再同时核对具体对象、任务动作、覆盖程度、否定约束和触发阶段。仅共享 prompt、description 等通用词不会触发提示。</p><p>这是本地程序的保守筛选。改写较多、隐含意图和跨语言关系仍可能漏检；没有调用模型或下载模型。</p></details></section>
  <section class="skill-review-section"><h3>工具说明复述</h3><p>在 ${r.comparedTools}/${r.totalTools} 个工具的可读说明中比较长句原文。其余动态说明待运行时确认。</p>${r.checks.filter(c=>c.matches.length).map(c=>`<button class="skill-pair-button" data-skill-action="open" data-name="${e(c.name)}"><span><strong>${e(c.name)}</strong><small>${c.matches.length} 段重复原文待核对</small></span><b>↗</b></button>`).join('')||'<p class="skill-review-empty">当前未发现长句原文复述。</p>'}<div class="skill-comparison-note">遵循 Agent Experience：用途与发现入口要清楚，每项事实说明一次；关键约束保留在相关操作之前。工具名称引用、必要流程和补充材料不自动视为赘述。</div></section>${renderOverlapExamples(examples,selected)}`;
}
