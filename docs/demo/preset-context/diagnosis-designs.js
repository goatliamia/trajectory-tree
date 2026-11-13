import { diagnosisDirections } from './diagnosis-review.js';
import { toolNameHtml } from './tool-colors.js';
export { diagnosisDirections, directionReason } from './diagnosis-review.js';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=at=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'}).format(at);
const groupName=g=>g.kind==='wait'?g.tool:g.label||g.code;
const toolLabel=g=>g.kind==='unclassified'?e(g.tool):toolNameHtml(g.tool);
const meta=g=>[g.kind==='wait'?'长调用':g.tool,g.exception&&g.exception!=='exception'?g.exception:null,`${g.turns} 轮`,`${g.sessions} 个会话`].filter(Boolean).join(' · ');
const after=g=>g.kind==='wait'?g.entries.filter(r=>r.status==='returned').length:g.paired;
const afterLabel=data=>data.mode==='wait'?'非报错返回':'有同参后续返回';
const remainingLabel=data=>data.mode==='wait'?'报错或结果未确认':'未找到同参配对';

function directionCount(data,id){const groups=data.groups.filter(g=>g.directions?.includes(id));return {groups:groups.length,records:groups.reduce((sum,g)=>sum+g.count,0)};}
function directionFilter(data,state){
  if(data.mode==='wait'||state.layout==='matrix')return '';
  return `<label class="diagnosis-direction-select"><span>处理方向</span><select data-eval-control="direction" aria-label="处理方向"><option value="all" ${state.direction==='all'?'selected':''}>全部方向</option>${diagnosisDirections.map(d=>`<option value="${d.id}" ${state.direction===d.id?'selected':''}>${d.name} · ${directionCount(data,d.id).groups} 类</option>`).join('')}</select></label>`;
}
const layouts=[{id:'matrix',name:'处置矩阵'},{id:'bars',name:'数量对比'},{id:'heatmap',name:'会话热图'}];
function picker(state,mode){return `<div class="diagnosis-design-picker" role="group" aria-label="诊断图表">${layouts.filter(row=>mode!=='wait'||row.id!=='matrix').map(row=>`<button data-eval-action="layout" data-value="${row.id}" aria-pressed="${state.layout===row.id}">${row.name}</button>`).join('')}</div>`;}
function selectedGroups(data,state){return data.groups.map((g,index)=>({...g,index})).filter(g=>!state.direction||state.direction==='all'||g.directions?.includes(state.direction));}
function rows(data,state){return selectedGroups(data,state).sort((a,b)=>b.count-a.count).slice(0,state.expanded?Infinity:8);}
function more(data,state){const total=selectedGroups(data,state).length;return total>8?`<button class="diagnosis-show-more" data-eval-action="more">${state.expanded?'收起':'展开全部 '+total+' 类反馈'} <span>${state.expanded?'↑':'↓'}</span></button>`:'';}
function title(heading,sub){return `<div class="diagnosis-chart-heading"><h3>${heading}</h3><span>${sub}</span></div>`;}

function bars(data,state){
  const list=rows(data,state),max=Math.max(1,...list.map(g=>g.count));
  return title(data.mode==='wait'?'哪些工具的长调用最多':'哪些反馈出现最多',`按次数排序 · ${selectedGroups(data,state).length} 类`)+
  `<div class="diagnosis-bar-legend"><span><i class="unpaired"></i>${remainingLabel(data)}</span><span><i class="paired"></i>${afterLabel(data)}</span></div>
  <div class="diagnosis-bars">${list.map(g=>{const paired=after(g);return `<button class="diagnosis-bar-row" data-eval-action="group" data-index="${g.index}" aria-label="${e(groupName(g))}，${g.count} 条，查看记录"><span class="diagnosis-bar-label"><strong>${e(groupName(g))}</strong><small>${e(meta(g)).replace(e(g.tool),toolLabel(g))}</small></span><span class="diagnosis-bar-track"><span class="diagnosis-bar-fill" style="width:${g.count/max*100}%"><i class="unpaired" style="flex:${g.count-paired}"></i><i class="paired" style="flex:${paired}"></i></span></span><span class="diagnosis-bar-count">${g.count}</span></button>`;}).join('')}</div>${more(data,state)}<p class="diagnosis-chart-note">${data.mode==='wait'?'按至少持续 30 秒的调用计数':'同参配对：同轮、相同工具与参数的后续非报错返回'}</p>`;
}

function heatmap(data,state){
  const list=rows(data,state);
  const level=value=>value===0?0:value<=2?1:value<=5?2:value<=10?3:4;
  const shades=['#f6f6f6','#e3f0ff','#bddcff','#7fbafa','#3485ed'];
  const sessionCount=data.columns.length,min=Math.max(640,225+sessionCount*58+40);
  return title('反馈集中在哪些会话',`${data.columns.length} 个会话 · 按开始时间排序`)+
  `<div class="diagnosis-heat-legend"><span>每格记录数</span>${['0','1–2','3–5','6–10','>10'].map((label,i)=>`<span><i style="background:${shades[i]}"></i>${label}</span>`).join('')}</div>
  <div class="diagnosis-heat-scroll"><div class="diagnosis-heatmap" role="group" aria-label="反馈类型与会话热图" style="--session-count:${Math.max(1,sessionCount)};min-width:${min}px"><div class="diagnosis-heat-axis"><span>反馈类型</span>${data.columns.map((c,index)=>`<span title="${e(c.title)} · ${e(c.project)}"><b>S${index+1}</b><small>${day(c.at)}</small></span>`).join('')}<span>合计</span></div>
  ${list.map(g=>`<div class="diagnosis-heat-row"><button class="diagnosis-heat-label" data-eval-action="group" data-index="${g.index}"><strong>${e(groupName(g))}</strong><small>${toolLabel(g)}${g.exception&&g.exception!=='exception'?' · '+e(g.exception):''}</small></button>${g.cells.map(cell=>{const column=data.columns[cell.column],shade=level(cell.count),label=`${groupName(g)} · S${cell.column+1} ${column.title} · ${cell.count} 条`;return cell.count?`<button class="diagnosis-heat-cell ${shade===4?'strong':''}" style="--cell-color:${shades[shade]}" data-eval-action="group" data-index="${g.index}" data-session="${e(cell.session)}" title="${e(label)}" aria-label="${e(label)}">${cell.count}</button>`:'<span class="diagnosis-heat-cell empty">—</span>';}).join('')}<span class="diagnosis-heat-total">${g.count}</span></div>`).join('')}</div></div>${more(data,state)}
  <details class="diagnosis-session-key"><summary>会话索引</summary><div>${data.columns.map((c,index)=>`<span><b>S${index+1}</b><time>${day(c.at)}</time><span>${e(c.title)}<small>${e(c.project)}</small></span></span>`).join('')}</div></details>`;
}

function matrix(data,state){
  const list=rows(data,state);
  return title('反馈与处理方向',`${selectedGroups(data,state).length} 类线索 · 选择方向，准备诊断`)+
  `<div class="disposition-matrix-scroll"><div class="disposition-matrix" role="group" aria-label="四类诊断处置矩阵"><div class="disposition-matrix-head"><div class="disposition-axis-label"><span>已记录反馈</span>${state.direction&&state.direction!=='all'?'<button data-eval-action="direction" data-value="all">清除方向筛选 ×</button>':''}</div>${diagnosisDirections.map(d=>{const totals=directionCount(data,d.id);return `<button class="disposition-direction-head" data-eval-action="direction" data-value="${d.id}" aria-pressed="${state.direction===d.id}" ${totals.groups?'':'disabled'} style="--direction-color:${d.color}" title="${e(d.description)}"><span><i></i>${d.name}</span>${totals.groups?`<strong>${totals.groups}<small> 类线索</small></strong><small>${totals.records} 条记录</small>`:'<strong class="direction-open-label">主动核对</strong><small>选择下方任一反馈</small>'}</button>`;}).join('')}</div>
  ${list.map(g=>`<div class="disposition-matrix-row"><button class="disposition-label" data-eval-action="group" data-index="${g.index}"><strong>${e(groupName(g))}</strong><span>${g.count} 次 · ${g.turns} 轮 · ${g.sessions} 个会话</span><small>${toolLabel(g)}${g.entries.some(r=>r.powerShell)?' · PowerShell':''}${g.exception&&g.exception!=='exception'?' · '+e(g.exception):''}</small></button>${diagnosisDirections.map(d=>`<button class="disposition-cell ${g.directions?.includes(d.id)?'has-evidence':'open-direction'} ${state.direction===d.id?'selected':''}" data-eval-action="group" data-index="${g.index}" data-direction="${d.id}" style="--direction-color:${d.color}" aria-label="从${d.name}方向核对${e(groupName(g))}"><i>${g.directions?.includes(d.id)?'↗':'+'}</i><span>${g.directions?.includes(d.id)?e(g.signals?.find(signal=>signal.direction===d.id)?.label??'有线索'):'选择'}</span></button>`).join('')}</div>`).join('')}</div></div>${more(data,state)}<p class="diagnosis-chart-note">色块表示程序线索；四个方向均可主动发起诊断。</p>`;
}

export function renderDiagnosisDesigns(data,state){
  const effective={...state,layout:data.mode==='wait'&&state.layout==='matrix'?'bars':state.layout},own=selectedGroups(data,effective);
  return `<div class="diagnosis-chart-toolbar">${directionFilter(data,effective)}${picker(effective,data.mode)}</div>`+(own.length?`<section class="diagnosis-design-chart" data-design="${effective.layout}">${effective.layout==='heatmap'?heatmap(data,effective):effective.layout==='bars'?bars(data,effective):matrix(data,effective)}</section>`:'<div class="analysis-empty">当前范围没有这类线索。</div>');
}
