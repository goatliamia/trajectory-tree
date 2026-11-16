import {ui as __ttUi} from "./ui-locale.js";
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=value=>value==null?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:1});
export const observationValue=(amount,definition)=>amount==null?'—':definition.unit==='ms'?(amount>=60000?n(amount/60000)+__ttUi(' 分'):amount>=1000?n(amount/1000)+__ttUi(' 秒'):n(amount)+' ms'):n(amount)+(definition.unit==='%'?'%':definition.unit==='tokens'?' tokens':'');
export const observationChoices=data=>[['count',__ttUi('反馈数量')],['window',__ttUi('窗口占用')],...data.metrics.map(metric=>[metric.id,metric.label+' · '+metric.stat]),['sessions',__ttUi('会话分布')]];
const rangeLabel=(from,to)=>from==null?__ttUi('未记录'):from===to?n(from)+'%':n(from)+'–'+n(to)+'%';
const definitionOf=data=>data.metrics.find(metric=>metric.id===data.metric);
const scaleOf=data=>Math.max(1,...data.groups.map(group=>group.observation?.max??0));

export function renderObservationHeader(data,state){
  const selected=state.observation??'window';
  const control=__ttUi`<label class="observation-control"><span>格内显示</span><select data-eval-control="observation" aria-label="主图观察维度">${observationChoices(data).map(([id,label])=>`<option value="${id}" ${selected===id?'selected':''}>${e(label)}</option>`).join('')}</select></label>`;
  if(selected==='window')return __ttUi`${control}<div class="observation-window-key"><div class="dw-window-brush observation-brush" role="group" aria-label="在主图拖选调用前窗口区间"><svg viewBox="0 0 1000 44" preserveAspectRatio="none" aria-label="调用前窗口 0 至 100%"><rect data-window-range class="observation-range" x="${16+(data.range?.from??0)*9.68}" y="0" width="${data.range?(data.range.to-data.range.from)*9.68:0}" height="40"/><line x1="16" x2="984" y1="30" y2="30"/>${Array.from({length:20},(_,index)=>__ttUi`<g data-window-band="${index}" role="button" tabindex="${index===Math.min(19,Math.floor((data.range?.from??0)/5))?0:-1}" aria-label="窗口 ${index*5}–${index*5+5}%，筛选主图"><rect x="${16+index*48.4}" y="0" width="48.4" height="42"/><path d="M${16+index*48.4} 25v5"/></g>`).join('')}</svg><div class="observation-axis"><span>0</span><span>50</span><span>100%</span></div></div><small data-window-label>${data.range?data.range.from+'–'+data.range.to+'%':__ttUi('拖选区间')}</small></div>`;
  if(selected==='sessions')return `${control}<span class="observation-key">${data.columns.map((column,index)=>`<span title="${e(column.title)}">S${index+1} ${e(new Date(column.at).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric',timeZone:'Asia/Shanghai'}))}</span>`).join('')}</span>`;
  if(selected==='count')return __ttUi`${control}<span class="observation-key">条长表示反馈数量${data.range?__ttUi(' · 灰线为全量'):''}</span>`;
  const definition=definitionOf(data),hasSamples=data.groups.some(group=>group.observation?.all.n>0);
  return __ttUi`${control}<span class="observation-key">共用刻度 0–${hasSamples?e(observationValue(scaleOf(data),definition)):'—'}${data.range?__ttUi(' · 灰线为全量'):''}<span>${definition.mode==='model'?__ttUi('请求去重'):__ttUi('调用记录')}</span></span>`;
}

function windowPlot(group,data){
  const window=group.window;if(!window)return __ttUi('<span class="observation-empty">未记录</span>');
  const active=data.range,max=Math.max(1,...window.bins);
  return `<div class="observation-window-plot"><svg viewBox="0 0 1000 44" preserveAspectRatio="none" aria-hidden="true"><rect data-window-range class="observation-range" x="${16+(active?.from??0)*9.68}" y="0" width="${active?(active.to-active.from)*9.68:0}" height="42"/><line x1="16" x2="984" y1="40" y2="40"/>${window.bins.map((count,index)=>count?`<rect class="${active?'observation-reference':'observation-current'}" x="${18+index*48.4}" y="${39-count/max*26}" width="44.4" height="${count/max*26}"/>${active&&window.selected[index]?`<rect class="observation-current" x="${18+index*48.4}" y="${39-window.selected[index]/max*26}" width="44.4" height="${window.selected[index]/max*26}"/>`:''}`:'').join('')}</svg>${window.bins.map((count,index)=>count?__ttUi`<button class="observation-bin" data-eval-action="window-band" data-from="${index*5}" data-to="${index*5+5}" style="left:${1.6+index*4.84}%;width:4.84%" aria-label="${e(group.label||group.tool)}，窗口 ${index*5}–${index*5+5}%，${count} 条反馈，筛选此区间" title="${index*5}–${index*5+5}% · ${count} 条反馈"></button>`:'').join('')}</div>`;
}

function observation(group,data,state){
  const selected=state.observation??'window';
  if(selected==='window'){
    const window=group.window,from=data.range?window?.selectedMin:window?.min,to=data.range?window?.selectedMax:window?.max;
    const coverage=[window?.missing?window.missing+__ttUi(' 条未记录'):'',window?.mismatch?window.mismatch+__ttUi(' 条待核对'):''].filter(Boolean).join(' · ');
    return {value:from==null?(window?.measured?__ttUi('无匹配'):__ttUi('未记录')):rangeLabel(from,to),sample:coverage||__ttUi('调用前窗口'),plot:windowPlot(group,data)};
  }
  if(selected==='count')return {value:group.count+(data.range?' / '+group.baseCount:'')+__ttUi(' 条'),sample:__ttUi('反馈记录'),plot:valuePlot(group.count,group.baseCount??group.count,Math.max(1,...data.groups.map(row=>row.baseCount??row.count)))};
  if(selected==='sessions')return {value:group.sessions+__ttUi(' 个会话'),sample:group.count+__ttUi(' 条反馈'),plot:''};
  const definition=definitionOf(data),current=group.observation?.selected??{value:null,n:0},base=group.observation?.all??{value:null,n:0};
  return {value:observationValue(current.value,definition),sample:current.n+' '+(definition.mode==='model'?__ttUi('个请求'):__ttUi('次调用')),plot:valuePlot(current.value,base.value,scaleOf(data))};
}

function valuePlot(current,base,max){
  return `<span class="observation-value-track" aria-hidden="true"><i style="width:${base==null?0:Math.min(100,base/max*100)}%"></i><b style="width:${current==null?0:Math.min(100,current/max*100)}%"></b></span>`;
}

export function renderDispositionCell(group,data,state,direction){
  const evidenced=group.directions?.includes(direction.id),reference=data.range&&group.baseDirections?.includes(direction.id),showPlot=evidenced||reference;
  const name=group.label||group.tool,selected=state.observation??'window',readout=observation(group,data,state);
  const label=group.signals?.find(signal=>signal.direction===direction.id)?.label??__ttUi('核对线索');
  const sessions=selected==='sessions'?`<div class="observation-sessions" style="--sessions:${Math.max(1,data.columns.length)}">${group.cells.map((cell,index)=>{const column=data.columns[index],description='S'+(index+1)+' '+column.title+' · '+cell.count+__ttUi(' 条反馈');return `<button class="observation-session-cell ${cell.count?'has-records':''}" data-eval-action="group" data-index="${group.index}" data-direction="${direction.id}" data-session="${e(cell.session)}" ${cell.count?'':'disabled'} title="${e(description)}" aria-label="${e(description)}">${cell.count||'—'}</button>`;}).join('')}</div>`:readout.plot;
  return `<div class="disposition-cell ${showPlot?'has-evidence':'open-direction'} ${!group.count?'empty-range':''} ${state.direction===direction.id?'selected':''}" style="--direction-color:${direction.color}" data-observation="${selected}"><button class="disposition-cell-action" data-eval-action="group" data-index="${group.index}" data-direction="${direction.id}" ${group.count?'':'disabled'} aria-label="${e(group.count?__ttUi('从')+direction.name+__ttUi('方向核对')+name:name+__ttUi('在所选窗口区间内没有记录'))}">${showPlot?`<span class="disposition-cell-title"><span>${e(label)}</span><i aria-hidden="true">↗</i></span><span class="disposition-cell-readout"><strong>${e(readout.value)}</strong><small>${e(readout.sample)}</small></span>`:__ttUi('<span class="disposition-cell-invite"><i aria-hidden="true">+</i><span>选择方向</span></span>')}</button>${showPlot?`<div class="disposition-cell-plot">${sessions}</div>`:''}</div>`;
}

export function renderUnassignedObservation(group,data,state){
  if(group.directions?.length||data.range&&group.baseDirections?.length)return '';
  const readout=observation(group,data,state);
  return __ttUi`<span class="disposition-unassigned-value" title="${e(readout.sample)}">${e(readout.value)}<small> · 方向待判断</small></span>`;
}

export function renderObservationEvidence(data){
  const definition=definitionOf(data),current=data.selection.metric;
  return __ttUi`<section class="observation-evidence"><p><strong>${e(definition.label)} ${e(observationValue(current.value,definition))}</strong><span>${current.n} 个有效${definition.mode==='model'?__ttUi('请求'):__ttUi('调用')}样本${definition.mode==='model'?__ttUi(' · 已去重'):''}</span></p><details><summary>同类记录对照</summary><label>对照范围 <select data-dialog-baseline aria-label="诊断指标对照范围"><option value="other" ${data.baseline==='other'?'selected':''}>${definition.mode==='model'?__ttUi('同模型'):__ttUi('同工具、同模型')}的其余记录</option>${data.histogram.filter(bin=>bin.count).map(bin=>__ttUi`<option value="${bin.index}" ${data.baseline===String(bin.index)?'selected':''}>窗口 ${bin.label}</option>`).join('')}</select></label><table><thead><tr><th>${definition.mode==='tool'?__ttUi('工具 · '):''}模型</th><th>选区</th><th>对照</th></tr></thead><tbody>${data.comparisons.map(row=>`<tr><th>${e([row.tool,row.modelLabel].filter(Boolean).join(' · '))}</th><td>${e(observationValue(row.selected.value,definition))}<small>n=${row.selected.n}</small></td><td>${e(observationValue(row.baseline.value,definition))}<small>n=${row.baseline.n}</small></td></tr>`).join('')||__ttUi('<tr><td colspan="3">没有可比较的有效样本。</td></tr>')}</tbody></table><small>按相同${definition.mode==='model'?__ttUi('模型'):__ttUi('工具与模型')}分别比较；差异不代表窗口造成了变化。</small></details></section>`;
}
