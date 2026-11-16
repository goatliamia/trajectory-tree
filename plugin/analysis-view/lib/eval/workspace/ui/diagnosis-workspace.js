import {ui as __ttUi} from "./ui-locale.js";
import {toolNameHtml} from './tool-colors.js';
import {renderDiagnosisDesigns,diagnosisDirections} from './diagnosis-designs.js';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=value=>value==null?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:1});
const time=value=>value==null?'—':value>=60000?n(value/60000)+__ttUi(' 分'):value>=1000?n(value/1000)+__ttUi(' 秒'):n(value)+' ms';
const modes=[['review',__ttUi('调查线索')],['repeated',__ttUi('跨轮重复')],['wait',__ttUi('长调用')],['control',__ttUi('控制与探测')],['all',__ttUi('全部反馈')]];
const select=(key,label,options,selected)=>`<label class="dw-select"><span>${label}</span><select data-investigation-control="${key}" aria-label="${label}">${options.map(([id,text])=>`<option value="${e(id)}" ${String(id)===String(selected)?'selected':''}>${e(text)}</option>`).join('')}</select></label>`;

export function renderInvestigationRecords(data){
  const selection=data.selection,rows=selection.records;
  return __ttUi`<div class="dw-records-heading"><h4>原始记录</h4><span>${selection.total?selection.offset+1:0}–${Math.min(selection.offset+selection.pageSize,selection.total)} / ${selection.total}</span></div><div class="dw-record-list">${rows.map((row,index)=>{
    const request=row.recordType==='request',window=row.contextWindow,label=request?__ttUi('模型请求'):row.command?.feedback?__ttUi('命令反馈'):row.status==='error'?__ttUi('工具报错'):row.status==='returned'?__ttUi('非报错返回'):__ttUi('结果未确认');
    return __ttUi`<button data-eval-action="record" data-index="${index}" class="dw-record"><span><strong>${request?__ttUi('模型请求'):toolNameHtml(row.tool)}</strong><small>${e(row.sessionTitle)} · 第 ${row.turn} 轮 · #${row.seq}</small></span><span>${window?.ratio==null?__ttUi('窗口未记录'):n(window.ratio)+'%'+(window.state==='outside-capacity'?__ttUi(' · 待核对'):'')}<small>${request?__ttUi('首 token ')+time(row.ttft):__ttUi('调用 ')+time(row.durationMs??row.elapsed)}</small></span><span class="dw-record-state">${label} ↗</span></button>`;
  }).join('')||`<p class="dw-empty">${data.range?__ttUi('当前选区在此窗口区间内没有记录。清除区间可恢复查看。'):data.scope.sessions?__ttUi('当前范围没有这类记录，可调整线索或筛选条件。'):__ttUi('当前范围没有可用的历史记录。')}</p>`}</div>
    ${selection.total>selection.pageSize?__ttUi`<div class="dw-pagination"><button data-eval-action="record-page" data-offset="${Math.max(0,selection.offset-selection.pageSize)}" ${selection.offset===0?'disabled':''}>上一组</button><button data-eval-action="record-page" data-offset="${selection.offset+selection.pageSize}" ${selection.offset+selection.pageSize>=selection.total?'disabled':''}>下一组</button></div>`:''}`;
}

const compactSelect=(key,label,options,selected)=>select(key,label,options,selected).replace('class="dw-select"','class="dw-select dw-compact-select"');
const chevron='<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg>';

function windowEditor(data,state){
  const range=data.range;
  return __ttUi`<span class="dw-window-filter"><details class="dw-window-dimension" data-investigation-detail="window" ${state.windowOpen?'open':''}><summary aria-label="窗口区间，${range?range.from+'–'+range.to+'%':__ttUi('全部')}"><span>区间</span><b>${range?range.from+'–'+range.to+'%':__ttUi('全部')}</b>${chevron}</summary><div class="dw-window-content dw-window-editor" aria-label="窗口区间"><div class="dw-range-editor"><label>起点 %<input type="number" data-window-input="from" aria-label="窗口区间起点，百分比" min="0" max="100" step="1" value="${range?.from??0}"></label><span>—</span><label>终点 %<input type="number" data-window-input="to" aria-label="窗口区间终点，百分比" min="0" max="100" step="1" value="${range?.to??100}"></label><button class="analysis-primary" data-eval-action="apply-window">应用</button></div><p class="dw-window-error" role="status" data-window-error></p></div></details>${range?__ttUi('<button class="dw-window-clear" data-eval-action="clear-window" aria-label="清除窗口筛选" title="清除窗口筛选">×</button>'):''}</span>`;
}

function routeFilters(data,state){
  const count=Number(data.model!=='all')+Number(data.tool!=='all');
  return __ttUi`<details class="dw-route-filter" data-investigation-detail="routes" ${state.filterOpen?'open':''}><summary aria-label="筛选模型与工具"><span>模型与工具${count?' · '+count:''}</span>${chevron}</summary><div class="dw-route-content">${select('model',__ttUi('模型'),[['all',__ttUi('全部模型')],...data.routes.map(route=>[route.index,route.name+' · '+route.provider])],data.model)}${select('tool',__ttUi('工具'),[['all',__ttUi('全部工具')],...data.tools.map(name=>[name,name])],data.tool)}${count?__ttUi('<button class="text-action" data-eval-action="clear-routes">恢复全部</button>'):''}</div></details>`;
}

export function renderDiagnosisWorkspace(data,state){
  const chartState={direction:'all',expanded:false,observation:'window',...state,layout:'matrix',compact:true,unified:true};
  const matrix=data.matrix??{records:data.groups.reduce((sum,group)=>sum+group.count,0),totalRecords:data.groups.reduce((sum,group)=>sum+(group.baseCount??group.count),0)},recordCount=data.range?matrix.records+' / '+matrix.totalRecords:String(matrix.records);
  return __ttUi`<div class="dw dw-matrix dw-compact dw-unified"><div class="dw-chart-header"><h2>反馈与处理方向</h2><span class="dw-chart-scope" title="工具报错 ${data.summary.errors} · 命令反馈 ${data.summary.commandFeedback} · ${data.scope.turns} 轮">${recordCount} ${data.mode==='wait'?__ttUi('次长调用'):__ttUi('条反馈')} · ${data.scope.sessions} 个会话</span><button class="analysis-scope-review" data-eval-action="review-scope" ${data.selection.total?'':'disabled'}>诊断范围 ↗</button></div>
    <div class="dw-chart-toolbar">${compactSelect('mode',__ttUi('反馈范围'),modes,data.mode)}${compactSelect('family',__ttUi('反馈类型'),[['all',__ttUi('全部类型')],...data.families.map(family=>[family.id,family.label+' · '+family.count])],data.family)}${windowEditor(data,state)}${routeFilters(data,state)}${state.direction&&state.direction!=='all'?`<button class="text-action" data-eval-action="direction" data-value="all">${e(diagnosisDirections.find(direction=>direction.id===state.direction)?.name)} ×</button>`:''}
    <span class="dw-toolbar-spacer"></span><details class="dw-more"><summary aria-label="更多诊断操作" title="更多"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.2"/><circle cx="10" cy="10" r="1.2"/><circle cx="16" cy="10" r="1.2"/></svg></summary><div class="dw-more-menu"><button data-eval-action="records">原始记录 ↗</button><button data-eval-action="method">统计口径 ↗</button></div></details></div>
    ${renderDiagnosisDesigns(data,chartState)}${data.baseGroupCount>200?__ttUi`<p class="dw-note">显示 200 / ${data.baseGroupCount} 类，请进一步筛选。</p>`:''}</div>`;
}

export function renderRequestFacts(row){
  const window=row.contextWindow;
  return __ttUi`<details class="analysis-record" open><summary><span><strong>${e(row.sessionTitle)}</strong><small>第 ${row.turn} 轮 · 请求 #${row.seq} · ${e(row.modelLabel)}</small></span></summary><dl><div><dt>请求输入</dt><dd>${n(row.input)} tokens</dd></div><div><dt>窗口容量</dt><dd>${n(window?.capacity)}</dd></div><div><dt>窗口占用</dt><dd>${window?.ratio==null?__ttUi('未记录'):n(window.ratio)+'%'}</dd></div><div><dt>首 token 等待</dt><dd>${time(row.ttft)}</dd></div><div><dt>输出</dt><dd>${n(row.output)} tokens</dd></div></dl><p class="analysis-observed">记录定位：${e(row.session)} · #${row.seq}</p></details>`;
}

export function installWindowBrush(container,{getData,onRange,onEscape}){
  let drag=null;
  const locate=event=>{const svg=drag.host.querySelector('svg'),rect=svg.getBoundingClientRect(),matrix=svg.getScreenCTM(),x=matrix?new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()).x:(event.clientX-rect.left)/rect.width*1000,p=(x-16)/968*100;return Math.max(0,Math.min(99.999,p));};
  const draw=range=>{for(const rect of container.querySelectorAll('[data-window-range]')){rect.setAttribute('x',String(16+(range?.from??0)/100*968));rect.setAttribute('width',String(range?(range.to-range.from)/100*968:0));}const label=container.querySelector('[data-window-label]');if(label)label.textContent=range?range.from+'–'+range.to+'%':__ttUi('拖选筛选 · 每格 5%');};
  const dragRange=p=>{let from=Math.round(Math.min(drag.from,p)/5)*5,to=Math.round(Math.max(drag.from,p)/5)*5;if(from===to){from=Math.min(from,95);to=from+5;}return {from,to};};
  container.addEventListener('pointerdown',event=>{const host=event.target.closest('.dw-window-brush');if(!host||event.button!==0)return;event.preventDefault();drag={host,startX:event.clientX,moved:false};drag.from=locate(event);host.classList.add('selecting');host.setPointerCapture(event.pointerId);});
  container.addEventListener('pointermove',event=>{if(!drag)return;if(Math.abs(event.clientX-drag.startX)>4)drag.moved=true;if(!drag.moved)return;drag.range=dragRange(locate(event));draw(drag.range);});
  container.addEventListener('pointerup',event=>{if(!drag)return;const p=locate(event),range=drag.moved?dragRange(p):{from:Math.floor(p/5)*5,to:Math.min(100,(Math.floor(p/5)+1)*5)},current=getData()?.range,toggle=!drag.moved&&current?.from===range.from&&current?.to===range.to;drag.host.classList.remove('selecting');drag=null;onRange(toggle?null:range);});
  container.addEventListener('pointercancel',()=>{if(!drag)return;draw(getData()?.range);drag.host.classList.remove('selecting');drag=null;});
  container.addEventListener('keydown',event=>{const band=event.target.closest('[data-window-band]');if(!band||event.ctrlKey||event.metaKey||event.altKey)return;const index=Number(band.dataset.windowBand);if(event.key==='Enter'||event.key===' '){event.preventDefault();onRange({from:index*5,to:index*5+5});}else if(event.key==='Escape'){event.preventDefault();if(onEscape)onEscape();else onRange(null);}else if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?19:Math.max(0,Math.min(19,index+(event.key==='ArrowRight'?1:-1)));container.querySelector('[data-window-band="'+next+'"]')?.focus({preventScroll:true});}});
  return {cancel(){if(drag){drag.host.classList.remove('selecting');drag=null;}}};
}
