import {ui as __ttUi} from "./ui-locale.js";
import { diagnosisDirections } from './diagnosis-review.js';
import { toolNameHtml } from './tool-colors.js';
import {renderObservationHeader,renderDispositionCell,renderUnassignedObservation} from './diagnosis-observations.js';
export { diagnosisDirections, directionReason } from './diagnosis-review.js';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=at=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'}).format(at);
const groupName=g=>g.kind==='wait'?g.tool:g.label||g.code;
const toolLabel=g=>g.kind==='unclassified'?e(g.tool):toolNameHtml(g.tool);
const meta=g=>[g.kind==='wait'?__ttUi('长调用'):g.tool,g.exception&&g.exception!=='exception'?g.exception:null,__ttUi`${g.turns} 轮`,__ttUi`${g.sessions} 个会话`].filter(Boolean).join(' · ');
const after=g=>g.kind==='wait'?(g.successful??g.entries?.filter(r=>r.status==='returned').length??0):g.paired;
const afterLabel=data=>data.mode==='wait'?__ttUi('非报错返回'):__ttUi('有同参后续返回');
const remainingLabel=data=>data.mode==='wait'?__ttUi('报错或结果未确认'):__ttUi('未找到同参配对');

function directionCount(data,id){const groups=data.groups.filter(g=>g.count>0&&g.directions?.includes(id)),base=data.groups.filter(g=>(g.baseDirections??g.directions)?.includes(id));return {groups:groups.length,records:groups.reduce((sum,g)=>sum+g.count,0),baseGroups:base.length,baseRecords:base.reduce((sum,g)=>sum+(g.baseCount??g.count),0)};}
function directionFilter(data,state){
  if(data.mode==='wait'||state.layout==='matrix')return '';
  return __ttUi`<label class="diagnosis-direction-select"><span>处理方向</span><select data-eval-control="direction" aria-label="处理方向"><option value="all" ${state.direction==='all'?'selected':''}>全部方向</option>${diagnosisDirections.map(d=>__ttUi`<option value="${d.id}" ${state.direction===d.id?'selected':''}>${d.name} · ${directionCount(data,d.id).groups} 类</option>`).join('')}</select></label>`;
}
const layouts=[{id:'matrix',name:__ttUi('处置矩阵')},{id:'bars',name:__ttUi('数量对比')},{id:'heatmap',name:__ttUi('会话热图')}];
function picker(state,mode){return __ttUi`<div class="diagnosis-design-picker" role="group" aria-label="诊断图表">${layouts.filter(row=>mode!=='wait'||row.id!=='matrix').map(row=>`<button data-eval-action="layout" data-value="${row.id}" aria-pressed="${state.layout===row.id}">${row.name}</button>`).join('')}</div>`;}
function selectedGroups(data,state){const reference=state.layout==='matrix'&&data.range;return data.groups.map((g,index)=>({...g,index})).filter(g=>(g.count>0||reference)&&(!state.direction||state.direction==='all'||g.directions?.includes(state.direction)||reference&&g.baseDirections?.includes(state.direction)));}
function rows(data,state){return selectedGroups(data,state).sort((a,b)=>data.range&&state.layout==='matrix'?(b.baseCount??b.count)-(a.baseCount??a.count):b.count-a.count).slice(0,state.expanded?Infinity:8);}
function more(data,state){const total=selectedGroups(data,state).length;return total>8?`<button class="diagnosis-show-more" data-eval-action="more">${state.expanded?__ttUi('收起'):__ttUi('展开全部 ')+total+__ttUi(' 类反馈')} <span>${state.expanded?'↑':'↓'}</span></button>`:'';}
function title(heading,sub){return `<div class="diagnosis-chart-heading"><h3>${heading}</h3><span>${sub}</span></div>`;}

function bars(data,state){
  const list=rows(data,state),max=Math.max(1,...list.map(g=>g.count));
  return (state.compact?'':title(data.mode==='wait'?__ttUi('哪些工具的长调用最多'):__ttUi('哪些反馈出现最多'),__ttUi`按次数排序 · ${selectedGroups(data,state).length} 类`))+
  `<div class="diagnosis-bar-legend"><span><i class="unpaired"></i>${remainingLabel(data)}</span><span><i class="paired"></i>${afterLabel(data)}</span></div>
  <div class="diagnosis-bars">${list.map(g=>{const paired=after(g);return __ttUi`<button class="diagnosis-bar-row" data-eval-action="group" data-index="${g.index}" aria-label="${e(groupName(g))}，${g.count} 条，查看记录"><span class="diagnosis-bar-label"><strong>${e(groupName(g))}</strong><small>${e(meta(g)).replace(e(g.tool),toolLabel(g))}</small></span><span class="diagnosis-bar-track"><span class="diagnosis-bar-fill" style="width:${g.count/max*100}%"><i class="unpaired" style="flex:${g.count-paired}"></i><i class="paired" style="flex:${paired}"></i></span></span><span class="diagnosis-bar-count">${g.count}</span></button>`;}).join('')}</div>${more(data,state)}<p class="diagnosis-chart-note">${data.mode==='wait'?__ttUi('按至少持续 30 秒的调用计数'):__ttUi('同参配对：同轮、相同工具与参数的后续非报错返回')}</p>`;
}

function heatmap(data,state){
  const list=rows(data,state);
  const level=value=>value===0?0:value<=2?1:value<=5?2:value<=10?3:4;
  const shades=['#f6f6f6','#e3f0ff','#bddcff','#7fbafa','#3485ed'];
  const sessionCount=data.columns.length,min=Math.max(640,225+sessionCount*58+40);
  return (state.compact?'':title(__ttUi('反馈集中在哪些会话'),__ttUi`${data.columns.length} 个会话 · 按开始时间排序`))+
  __ttUi`<div class="diagnosis-heat-legend"><span>每格记录数</span>${['0','1–2','3–5','6–10','>10'].map((label,i)=>`<span><i style="background:${shades[i]}"></i>${label}</span>`).join('')}</div>
  <div class="diagnosis-heat-scroll"><div class="diagnosis-heatmap" role="group" aria-label="反馈类型与会话热图" style="--session-count:${Math.max(1,sessionCount)};min-width:${min}px"><div class="diagnosis-heat-axis"><span>反馈类型</span>${data.columns.map((c,index)=>`<span title="${e(c.title)} · ${e(c.project)}"><b>S${index+1}</b><small>${day(c.at)}</small></span>`).join('')}<span>合计</span></div>
  ${list.map(g=>`<div class="diagnosis-heat-row"><button class="diagnosis-heat-label" data-eval-action="group" data-index="${g.index}"><strong>${e(groupName(g))}</strong><small>${toolLabel(g)}${g.exception&&g.exception!=='exception'?' · '+e(g.exception):''}</small></button>${g.cells.map(cell=>{const column=data.columns[cell.column],shade=level(cell.count),label=__ttUi`${groupName(g)} · S${cell.column+1} ${column.title} · ${cell.count} 条`;return cell.count?`<button class="diagnosis-heat-cell ${shade===4?'strong':''}" style="--cell-color:${shades[shade]}" data-eval-action="group" data-index="${g.index}" data-session="${e(cell.session)}" title="${e(label)}" aria-label="${e(label)}">${cell.count}</button>`:'<span class="diagnosis-heat-cell empty">—</span>';}).join('')}<span class="diagnosis-heat-total">${g.count}</span></div>`).join('')}</div></div>${more(data,state)}
  <details class="diagnosis-session-key"><summary>会话索引</summary><div>${data.columns.map((c,index)=>`<span><b>S${index+1}</b><time>${day(c.at)}</time><span>${e(c.title)}<small>${e(c.project)}</small></span></span>`).join('')}</div></details>`;
}

function windowTrack(group,range){
  const window=group.window;if(!window)return '';const max=Math.max(1,...window.bins),number=value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:1});
  const label=window.min==null?__ttUi('窗口未记录'):(window.min===window.max?number(window.min):number(window.min)+'–'+number(window.max))+'%';
  const description=__ttUi`全部 ${group.baseCount} 条反馈，${window.measured} 条有效窗口读数${window.missing?'，'+window.missing+__ttUi(' 条未记录'):''}${window.mismatch?'，'+window.mismatch+__ttUi(' 条超出容量待核对'):''}${range?__ttUi('；当前区间 ')+group.count+__ttUi(' 条'):''}。刻度 0–100%，柱高在本行内归一。`;
  return `<span class="disposition-window" title="${e(description)}"><span class="disposition-window-track" role="img" aria-label="${e(description)}">${range?`<i class="disposition-window-range" style="left:${range.from}%;width:${range.to-range.from}%"></i>`:''}${window.bins.map((count,index)=>count?`<i class="disposition-window-bin" style="left:${index*5}%;height:${Math.max(15,count/max*100)}%">${range&&window.selected[index]?`<b style="height:${window.selected[index]/count*100}%"></b>`:''}</i>`:'').join('')}</span><small>${label}</small></span>`;
}

function directionHeading(data,state,d){
  const totals=directionCount(data,d.id),present=totals.groups||data.range&&totals.baseGroups;
  return __ttUi`<button class="disposition-direction-head" data-eval-action="direction" data-value="${d.id}" aria-pressed="${state.direction===d.id}" ${present?'':'disabled'} style="--direction-color:${d.color}" title="${e(d.description)}；候选线索不代表原因或处置已确认"><span><i></i>${d.name}</span>${present?__ttUi`<strong>${totals.groups}${data.range?`<em> / ${totals.baseGroups}</em>`:''}<small> 类候选</small></strong><small>${totals.records}${data.range?' / '+totals.baseRecords:''} 条反馈</small>`:__ttUi('<strong class="direction-open-label">主动核对</strong><small>选择任一反馈</small>')}</button>`;
}

function unifiedMatrix(data,state){
  const list=rows(data,state);
  return __ttUi`<div class="disposition-plot-toolbar"><span>反馈</span><div>${renderObservationHeader(data,state)}</div></div>
    <div class="disposition-matrix-scroll"><div class="disposition-matrix" role="group" aria-label="四类诊断处置矩阵">
      <div class="disposition-matrix-head"><div class="disposition-axis-label"><span>类型与记录数</span>${state.direction&&state.direction!=='all'?__ttUi('<button data-eval-action="direction" data-value="all">清除方向筛选 ×</button>'):''}</div>${diagnosisDirections.map(d=>directionHeading(data,state,d)).join('')}</div>
      ${list.map(group=>__ttUi`<div class="disposition-matrix-row ${group.count?'':'outside-window'}" data-window-count="${group.count}" data-window-total="${group.baseCount??group.count}">
        <button class="disposition-label" data-eval-action="group" data-index="${group.index}" ${group.count?'':'disabled'}><strong>${e(groupName(group))}</strong><small>${toolLabel(group)} · ${group.turns} 轮 · ${group.sessions} 个会话</small><span class="disposition-record-count">${group.count}${data.range?' / '+group.baseCount:''}<small> 次</small>${group.paired?__ttUi`<small class="disposition-followup" title="同轮、同工具和参数的后续非报错返回；任务结果仍需核对">${group.paired} 次有同参后续返回</small>`:''}</span>${renderUnassignedObservation(group,data,state)}</button>
        ${diagnosisDirections.map(direction=>renderDispositionCell(group,data,state,direction)).join('')}
      </div>`).join('')||__ttUi('<div class="analysis-empty">当前范围没有这类线索。</div>')}
    </div></div>${more(data,state)}<p class="diagnosis-chart-note">程序线索提示核对方向；原因与复盘价值仍待判断。${data.range?__ttUi('灰线为全量，选区不改变行的位置。'):''}</p>`;
}

function matrix(data,state){
  if(state.unified)return unifiedMatrix(data,state);
  const list=rows(data,state);
  return (state.compact?'':title(__ttUi('反馈与处理方向'),__ttUi`${selectedGroups(data,state).length} 类线索 · 选择方向，准备诊断`))+
  __ttUi`<div class="disposition-matrix-scroll"><div class="disposition-matrix" role="group" aria-label="四类诊断处置矩阵"><div class="disposition-matrix-head"><div class="disposition-axis-label"><span>${state.unified?__ttUi('反馈 · 数量'):__ttUi('已记录反馈')}</span>${state.compact&&!state.unified?__ttUi('<small>调用前窗口 · 0–100%</small>'):''}${state.direction&&state.direction!=='all'?__ttUi('<button data-eval-action="direction" data-value="all">清除方向筛选 ×</button>'):''}</div>${state.unified?`<div class="disposition-observation-axis">${renderObservationHeader(data,state)}</div>`:''}${diagnosisDirections.map(d=>{const totals=directionCount(data,d.id),present=totals.groups||data.range&&totals.baseGroups;return `<button class="disposition-direction-head" data-eval-action="direction" data-value="${d.id}" aria-pressed="${state.direction===d.id}" ${present?'':'disabled'} style="--direction-color:${d.color}" title="${e(d.description)}"><span><i></i>${d.name}</span>${present?__ttUi`<strong>${totals.groups}${data.range?`<em> / ${totals.baseGroups}</em>`:''}<small> 类线索</small></strong><small>${totals.records}${data.range?' / '+totals.baseRecords:''} 条记录</small>`:__ttUi('<strong class="direction-open-label">主动核对</strong><small>选择下方任一反馈</small>')}</button>`;}).join('')}</div>
  ${list.map(g=>__ttUi`<div class="disposition-matrix-row ${g.count?'':'outside-window'}" data-window-count="${g.count}" data-window-total="${g.baseCount??g.count}"><button class="disposition-label" data-eval-action="group" data-index="${g.index}" ${g.count?'':'disabled'}><strong>${e(groupName(g))}</strong><span>${g.count}${data.range?' / '+g.baseCount:''} 次 · ${g.turns} 轮 · ${g.sessions} 个会话</span><small>${toolLabel(g)}${g.powerShell||g.entries?.some(r=>r.powerShell)?' · PowerShell':''}${g.exception&&g.exception!=='exception'?' · '+e(g.exception):''}</small>${state.compact?windowTrack(g,data.range):''}</button>${diagnosisDirections.map(d=>`<button class="disposition-cell ${g.count?(g.directions?.includes(d.id)?'has-evidence':'open-direction'):'empty-range'} ${state.direction===d.id?'selected':''}" data-eval-action="group" data-index="${g.index}" data-direction="${d.id}" ${g.count?'':'disabled'} style="--direction-color:${d.color}" aria-label="${g.count?__ttUi('从')+d.name+__ttUi('方向核对')+e(groupName(g)):e(groupName(g))+__ttUi('在所选窗口区间内没有记录')}">${g.count?`<i>${g.directions?.includes(d.id)?'↗':'+'}</i><span>${g.directions?.includes(d.id)?e(g.signals?.find(signal=>signal.direction===d.id)?.label??__ttUi('有线索')):__ttUi('选择')}</span>`:'—'}</button>`).join('')}</div>`).join('')||__ttUi('<div class="analysis-empty">当前范围没有这类线索。</div>')}</div></div>${more(data,state)}<p class="diagnosis-chart-note">${data.range?__ttUi('计数为所选窗口区间 / 全部记录；灰色行在此区间没有记录。'):__ttUi('色块表示程序线索；四个方向均可主动发起诊断。')}</p>`;
}

export function renderDiagnosisDesigns(data,state){
  const effective={...state,layout:state.unified?'matrix':data.mode==='wait'&&state.layout==='matrix'?'bars':state.layout},own=selectedGroups(data,effective);
  return (state.compact?'':`<div class="diagnosis-chart-toolbar">${directionFilter(data,effective)}${picker(effective,data.mode)}</div>`)+(own.length||state.unified?`<section class="diagnosis-design-chart" data-design="${effective.layout}">${effective.layout==='heatmap'?heatmap(data,effective):effective.layout==='bars'?bars(data,effective):matrix(data,effective)}</section>`:__ttUi('<div class="analysis-empty">当前范围没有这类线索。</div>'));
}
