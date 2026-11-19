import {ui as __ttUi} from "./ui-locale.js";
import {apiFetch,wireDraftActions} from './workspace-api.js';
import {buildDiagnosisDraft,reviewFactors,classificationNote,syntaxLabel,diagnosisDirections,directionReason} from './diagnosis-review.js';
import {toolNameHtml} from './tool-colors.js';
import {renderDiagnosticFrames,renderDiagnosticSummary,renderToolMeasure} from './tool-feedback.js';
import {renderDiagnosisWorkspace,renderInvestigationRecords,renderRequestFacts,installWindowBrush} from './diagnosis-workspace.js';
import {observationChoices,renderObservationEvidence} from './diagnosis-observations.js';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=value=>value==null?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:1});
const date=ts=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(ts);
const time=value=>value==null?'—':value>=60000?n(value/60000)+__ttUi(' 分'):value>=1000?n(value/1000)+__ttUi(' 秒'):n(value)+' ms';
function recordChain(r){
  if(r.status!=='error')return __ttUi`<div class="record-chain"><span><i></i><strong>调用</strong><small>#${r.seq}</small></span><span class="${r.status==='returned'?'has-return':'unpaired'}"><i></i><strong>${r.status==='returned'?__ttUi('非报错返回'):__ttUi('结果未确认')}</strong><small>${r.result==null?'—':'#'+r.result}</small></span></div>`;
  return __ttUi`<div class="record-chain">${r.priorRead?__ttUi`<span><i></i><strong>更早读取</strong><small>#${r.priorRead.seq}</small></span>`:''}<span><i></i><strong>本次反馈</strong><small>#${r.result??r.seq}</small></span><span class="${r.returned!=null?'has-return':'unpaired'}"><i></i><strong>${r.returned!=null?__ttUi('同参后续返回'):__ttUi('未找到同参配对')}</strong><small>${r.returned!=null?'#'+r.returned:'—'}</small></span></div>`;
}

function renderContextWindow(row){
  const context=row.contextWindow;
  return __ttUi`<div><dt>对应窗口占用</dt><dd>${context?.ratio==null?__ttUi('未记录'):n(context.ratio)+'%'+(context.state==='outside-capacity'?__ttUi(' · 超出容量，待核对'):'')}</dd></div>${context?.used!=null&&context.capacity!=null?__ttUi`<div><dt>已用 / 容量</dt><dd>${n(context.used)} / ${n(context.capacity)}</dd></div>`:''}${context?.basis?__ttUi`<div><dt>窗口记录口径</dt><dd>${e(context.basis)}</dd></div>`:''}${context?.request!=null?__ttUi`<div><dt>关联请求</dt><dd>#${e(context.request)}</dd></div>`:''}`;
}

export function installEvalViews(container,{expandComparison=false}={}){
  const requestedPeriod=Number(new URL(location.href).searchParams.get('period'));
  const common={period:[1,7,30].includes(requestedPeriod)?requestedPeriod:7,project:'all'};
  const requestedLayout=new URL(location.href).searchParams.get('diag_layout');
  const requestedObservation=new URL(location.href).searchParams.get('observation'),knownObservations=['count','window','sessions','elapsed','ttft','output','toolShare','errors','returned'];
  const observation=knownObservations.includes(requestedObservation)?requestedObservation:requestedLayout==='heatmap'?'sessions':'window';
  const state={mode:'review',family:'all',metric:!['count','window','sessions'].includes(observation)?observation:'elapsed',model:'all',tool:'all',focus:'all',focusSession:'',windowFrom:'',windowTo:'',baseline:'other',offset:0,observation,windowOpen:false,filterOpen:false,layout:'matrix',direction:'all',expanded:false};
  const view='diagnosis',dialog=document.getElementById('eval-dialog'),body=document.getElementById('eval-dialog-body');
  let preset,data,controller,version=0,reviewSelection,frameSources=new Map(),lastQuery='',stale=true;
  const brush=installWindowBrush(container,{getData:()=>data,onRange:applyWindowRange,onEscape:()=>{if(container.querySelector('.dw-window-dimension[open],.dw-route-filter[open],.dw-more[open]'))closeMenus(true);else applyWindowRange(null);}});
  function closeMenus(restoreFocus=false){
    const details=container.querySelectorAll('.dw-window-dimension,.dw-route-filter,.dw-more'),focused=[...details].find(node=>node.open&&node.contains(document.activeElement));
    for(const node of details)node.open=false;state.windowOpen=false;state.filterOpen=false;if(restoreFocus)focused?.querySelector('summary')?.focus({preventScroll:true});
  }
  async function applyWindowRange(range){
    const keyboard=document.body.dataset.input==='keyboard',active=document.activeElement,band=active?.dataset.windowBand,pointLabel=active?.matches('.observation-bin')?active.getAttribute('aria-label'):null;
    const restore=()=>{const target=band!=null?container.querySelector('[data-window-band="'+band+'"]'):pointLabel?[...container.querySelectorAll('.observation-bin')].find(point=>point.getAttribute('aria-label')===pointLabel):null;(target??container.querySelector('.dw-window-dimension>summary'))?.focus({preventScroll:true});};
    state.windowFrom=range?.from??'';state.windowTo=range?.to??'';state.focus='all';state.focusSession='';state.offset=0;closeMenus();const summary=container.querySelector('.dw-window-dimension>summary');if(summary)summary.querySelector('b').textContent=range?range.from+'–'+range.to+'%':__ttUi('全部');if(keyboard)restore();await render();
    if(keyboard)restore();
  }
  function applyWindowEditor(){
    const from=container.querySelector('[data-window-input="from"]'),to=container.querySelector('[data-window-input="to"]'),valid=Number.isFinite(from.valueAsNumber)&&Number.isFinite(to.valueAsNumber)&&from.valueAsNumber>=0&&to.valueAsNumber<=100&&from.valueAsNumber<to.valueAsNumber;
    for(const input of [from,to])input.setAttribute('aria-invalid',String(!valid));container.querySelector('[data-window-error]').textContent=valid?'':__ttUi('请输入 0–100% 内的区间，起点须小于终点。');
    if(valid)applyWindowRange({from:from.valueAsNumber,to:to.valueAsNumber});
  }
  document.addEventListener('pointerdown',event=>{for(const details of container.querySelectorAll('.dw-window-dimension,.dw-route-filter,.dw-more'))if(details.open&&!details.contains(event.target)){details.open=false;if(details.matches('.dw-window-dimension'))state.windowOpen=false;if(details.matches('.dw-route-filter'))state.filterOpen=false;}});
  container.addEventListener('keydown',event=>{if(event.key==='Escape'&&container.querySelector('.dw-window-dimension[open],.dw-route-filter[open],.dw-more[open]')){event.preventDefault();closeMenus(true);}else if(event.key==='Enter'&&event.target.matches('[data-window-input]')){event.preventDefault();applyWindowEditor();}});
  container.addEventListener('input',event=>{if(event.target.matches('[data-window-input]')){event.target.removeAttribute('aria-invalid');container.querySelector('[data-window-error]').textContent='';}});
  body.addEventListener('toggle',event=>{if(!event.target.matches('details.analysis-record')||!event.target.open)return;const target=event.target.querySelector('[data-code-frame-id]');if(!target)return;target.innerHTML=renderDiagnosticFrames(frameSources.get(target.dataset.codeFrameId)??[]);target.removeAttribute('data-code-frame-id');},true);
  function open(title,html){document.getElementById('eval-dialog-title').textContent=title;body.innerHTML=html;if(!dialog.open)dialog.showModal();dialog.scrollTop=0;}
  function facts(rows){
    frameSources=new Map(rows.map(r=>[r.session+':'+r.seq,r.codeFrames??[]]));
    const basis={'native-code':__ttUi('宿主错误码'),'native-stderr':__ttUi('标准错误输出'),'dsh-pwsh-stderr':__ttUi('DSH 返回的 stderr 段'),'runtime-output':__ttUi('返回文本'),'dsh-pwsh-marker':__ttUi('DSH 命令返回标记'),'script-and-exit':__ttUi('脚本与退出状态')};
    return rows.map(r=>r.recordType==='request'?renderRequestFacts(r):__ttUi`<details class="analysis-record"><summary><span><strong>${e(r.sessionTitle||r.session)}</strong><small>第 ${r.turn} 轮 · #${r.seq}${r.result!=null?' → #'+r.result:''} · ${toolNameHtml(r.tool)} ${renderToolMeasure(r.measure)}</small>${renderDiagnosticSummary(r.codeFrames)}</span><time>${date(r.at)}</time></summary><div data-code-frame-id="${e(r.session+':'+r.seq)}"></div>
      <dl>${renderContextWindow(r)}<div><dt>判定来源</dt><dd>${basis[r.attributionBasis]??__ttUi('记录状态')}${r.certainty==='candidate'?__ttUi(' · 候选'):''}</dd></div>${r.layer?__ttUi`<div><dt>发生层</dt><dd>${e(({'tool-contract':__ttUi('工具调用契约'),'host-environment':__ttUi('宿主与运行环境'),'background-job':__ttUi('后台任务'),'shell-parse':__ttUi('PowerShell 语法'),'command-binding':__ttUi('命令解析与参数绑定'),'filesystem':__ttUi('文件操作'),'program':__ttUi('程序执行'),'remote-shell':__ttUi('远端 shell'),'control':__ttUi('控制与取消'),'recorded-outcome':__ttUi('记录结果')})[r.layer]??r.layer)}</dd></div>`:''}${r.diagnosticIds?.length?__ttUi`<div><dt>运行时错误标识</dt><dd>${e(r.diagnosticIds.join(' · '))}</dd></div>`:''}<div><dt>工具状态</dt><dd>${r.status==='error'?__ttUi('工具报错'):r.status==='returned'?__ttUi('工具正常返回'):__ttUi('结果未确认')}</dd></div><div><dt>识别类型</dt><dd><code>${e(r.code??'—')}</code></dd></div>${r.reportedCode?__ttUi`<div><dt>宿主错误身份</dt><dd><code>${e(r.reportedName??'')} ${e(r.reportedCode)}</code></dd></div>`:''}${r.exitCode!=null?__ttUi`<div><dt>进程退出标记</dt><dd>${r.exitCode}</dd></div>`:''}${Number.isFinite(r.durationMs)?__ttUi`<div><dt>调用耗时</dt><dd>${time(r.durationMs)}</dd></div>`:''}${r.command?.workdir?__ttUi`<div><dt>工作目录</dt><dd>${e(r.command.workdir)}</dd></div>`:''}${r.powerShell?__ttUi`<div><dt>记录中的执行器</dt><dd>PowerShell${r.command?.edition?' · '+e(r.command.edition):__ttUi(' · 版本待核对')}</dd></div>`:''}${r.syntax?__ttUi`<div><dt>静态解析</dt><dd>${syntaxLabel(r.syntax)}${r.syntax.runtime?' · '+e(r.syntax.edition)+' '+e(r.syntax.runtime):''}</dd></div>`:''}${r.site?.line?__ttUi`<div><dt>定位</dt><dd>L${r.site.line}${r.site.column?':'+r.site.column:''}</dd></div>`:''}${r.priorRead?__ttUi`<div><dt>更早读取</dt><dd>第 ${r.priorRead.turn} 轮 · #${r.priorRead.seq} → #${r.priorRead.result}${r.priorRead.reloadedAfter!=null?__ttUi` · 期间会话重载 #${r.priorRead.reloadedAfter}（内存观测重置）`:''}</dd></div>`:''}<div><dt>同参后续返回</dt><dd>${r.returned!=null?'#'+r.returned:r.command?.feedback&&r.status!=='error'?__ttUi('沿原文核对'):__ttUi('未配对')}</dd></div></dl>
      ${r.command?.source?__ttUi`<h4>命令摘录</h4><pre>${e(r.command.source.excerpt)}</pre>`:''}${!r.codeFrames?.length&&r.syntax?.diagnostics?.length?__ttUi`<h4>解析依据</h4><pre>${e(r.syntax.diagnostics.map(d=>`${d.id} · L${d.line??'?'}:${d.column??'?'}\n${d.message}`).join('\n'))}</pre>`:''}${r.evidence&&!r.codeFrames?.length?`<p class="analysis-observed">${e(r.evidence)}</p>`:''}${recordChain(r)}${r.reportedMessage?__ttUi`<h4>返回摘录 · #${r.result??r.seq}</h4><pre>${e(r.reportedMessage)}</pre>`:''}${data.subject==='model'&&r.requestRecord?renderRequestFacts(r.requestRecord):''}</details>`).join('');
  }
  function reviewMethod(group,direction){
    return __ttUi`<p class="review-direction-reason">${e(directionReason(group,direction))}</p><ul>${reviewFactors(group,direction).map(f=>`<li>${e(f)}</li>`).join('')}</ul><p class="review-methods">方法：处置判断${group.entries?.some(r=>r.powerShell)?__ttUi(' · PowerShell 专项'):''}${['capability','knowledge'].includes(direction)?__ttUi(' · 上下文供给核对'):''}</p>`;
  }
  function openReview(group,direction='overall'){
    if(['count','window','sessions'].includes(state.observation))group={...group,contextSelection:state.windowFrom===''&&state.model==='all'&&state.tool==='all'?undefined:{...group.contextSelection,metric:'window',metricLabel:__ttUi('调用前窗口分布'),subject:'tool',samples:data.selection.window.measured}};
    else{const definition=data.metrics.find(metric=>metric.id===data.metric),band=data.histogram.find(bin=>String(bin.index)===data.baseline);group={...group,contextSelection:{...group.contextSelection,unit:definition.unit,comparisonBasis:band?__ttUi('调用前窗口 ')+band.label:(definition.mode==='model'?__ttUi('同模型'):__ttUi('同工具、同模型'))+__ttUi('的其余记录（排除所选指标样本）'),comparisonRows:data.comparisons.slice(0,6)}};}
    reviewSelection={group,direction};
    open(group.label||group.tool+__ttUi(' · 长调用'),__ttUi`<div class="analysis-detail-intro"><h2>${e(group.label||group.tool+__ttUi(' · 长调用'))}</h2><p>${group.recordCount??group.entries?.length??0} 条所选记录 · ${group.turns} 轮 · ${group.sessions} 个会话</p></div><div class="analysis-fact"><strong>已有证据</strong><p>${e((group.fact??'').replace(/[。.!！]+$/,''))}。${group.priorReads?group.priorReads+__ttUi(' 次可关联到更早的成功读取。'):''}</p>${group.code?`<p>${e(classificationNote(group))}</p>`:''}</div>
      ${!['count','window','sessions'].includes(state.observation)?renderObservationEvidence(data):''}<section class="review-composer"><label class="review-direction-label">诊断方向<select id="review-direction"><option value="overall" ${direction==='overall'?'selected':''}>综合核对</option>${diagnosisDirections.map(d=>`<option value="${d.id}" ${d.id===direction?'selected':''}>${d.name}</option>`).join('')}</select></label><div id="review-method">${reviewMethod(group,direction)}</div><label class="review-question-label" for="review-question">补充关注点 <span>选填</span></label><textarea id="review-question" rows="2" placeholder="例如：已有工具能否完成？哪次成功处理值得留下？"></textarea><button class="analysis-primary" data-eval-prepare>准备诊断草稿 ↗</button></section>
      ${group.entries?.length?__ttUi`<h3 class="review-evidence-title">代表记录 <small>${group.entries.length}</small></h3>${facts(group.entries)}`:''}`);
  }
  function method(){open(__ttUi('判定与统计口径'),view==='diagnosis'?__ttUi`<div class="analysis-detail-intro"><h2>先识别反馈，再核对原因</h2><p>分类沿用工具返回中的错误码、退出状态和可识别的错误文本。</p></div><ol class="analysis-method"><li><strong>记录事实</strong><p>“已识别”只表示反馈类型有依据，不表示根因已确认。</p></li><li><strong>读取命令反馈</strong><p>DSH pwsh 的非零退出不等于工具报错。另读返回末尾的退出、停止、超时与权限标记，再核对 stderr 和原始脚本。退出码 1 保留搜索未命中、中断等可能。</p></li><li><strong>静态解析</strong><p>使用 CR 的 PowerShell 解析器补充命令位置与语法证据，每会话最多 12 次；不执行历史脚本。解析器版本单列，未解析或缺失记录保留未知。</p></li><li><strong>聚合同类反馈</strong><p>按错误码、工具和执行环境分组；出现在多个轮次时标记为重复。重复本身不触发新增规范或修改实现的建议。</p></li><li><strong>关联后续返回</strong><p>只配对同轮、相同工具和相同参数的非报错返回。改参或换方案是否完成任务，需继续核对原记录。</p></li><li><strong>区分控制与故障</strong><p>用户拒绝、审批取消与探测未命中单列。能力不可用、运行上下文缺失、输出契约和附件反馈按原始错误码分组；分组不决定处置方向。</p></li><li><strong>检查文件保护</strong><p>FS_NOT_OBSERVED 表示当前文件观测条件未满足。它不等于历史上从未读取；详情会列出可关联的早期读取。</p></li></ol>`:__ttUi`<div class="analysis-detail-intro"><h2>比较同一统计口径</h2></div><p>模型请求按实际输入 token / 同路由窗口容量分档。工具按发起前的窗口占用分档，有结果的调用进入比率分母。</p><p>P90 表示 90% 的已记录读数不超过该值。缺少读数的记录不按零计算。区间之间是描述性比较，任务类型与模型差异仍需结合记录判断。</p><p>预设按会话开场记录归类，时间按轮次开始计算。${data.scope.failures?data.scope.failures+__ttUi(' 条源记录无法解析，未纳入。'):''}</p>`);}


  function queryOf(){const {observation,windowOpen,filterOpen,layout,direction,expanded,...filters}=state;return new URLSearchParams({...common,...filters,preset,view:'investigation'}).toString();}
  function paint(){if(!data)return;const control=document.activeElement?.dataset.evalControl;container.innerHTML=renderDiagnosisWorkspace(data,state);if(control&&document.body.dataset.input==='keyboard')container.querySelector('[data-eval-control="'+control+'"]')?.focus({preventScroll:true});}
  async function render(nextPreset=preset){
    if(preset&&nextPreset!==preset){Object.assign(state,{mode:'review',family:'all',model:'all',tool:'all',focus:'all',focusSession:'',windowFrom:'',windowTo:'',baseline:'other',offset:0,direction:'all',expanded:false});common.project='all';data=null;stale=true;}
    preset=nextPreset;const query=queryOf();if(!stale&&data&&query===lastQuery)return;
    const active=document.activeElement,focus=active?.dataset.investigationControl?{type:'data-investigation-control',value:active.dataset.investigationControl}:active?.dataset.evalControl?{type:'data-eval-control',value:active.dataset.evalControl}:active?.dataset.windowBand!=null?{type:'data-window-band',value:active.dataset.windowBand}:null;
    controller?.abort();controller=new AbortController();const own=++version;container.setAttribute('aria-busy','true');
    if(!data)container.innerHTML=__ttUi('<p class="analysis-loading">正在关联反馈与窗口记录…</p>');
    try{
      const response=await apiFetch('/api/eval-view?'+query,{signal:controller.signal});if(!response.ok)throw Error(__ttUi('读取失败'));
      const result=await response.json();if(own!==version)return;if(result.view!=='investigation'||!result.selection)throw Error('service-version');data=result;state.focus=data.selection.key;state.offset=data.selection.offset;state.metric=data.metric;state.baseline=data.baseline;lastQuery=queryOf();stale=false;paint();
      if(focus&&document.body.dataset.input==='keyboard'&&(document.activeElement===active||document.activeElement===document.body))container.querySelector('['+focus.type+'="'+focus.value+'"]')?.focus({preventScroll:true});
    }catch(error){if(error.name!=='AbortError'&&own===version)container.innerHTML='<div class="analysis-empty">'+(error.message==='service-version'?__ttUi('诊断服务尚未更新，请重载插件或重启 DSH 后再打开。'):__ttUi('暂时无法读取记录。'))+__ttUi('<button data-eval-action="retry">重新读取</button></div>');}
    finally{if(own===version)container.removeAttribute('aria-busy');}
  }
  async function selectRecords(focus='all',focusSession=''){
    state.focus=focus;state.focusSession=focusSession;state.offset=0;await render();
    return data?.selection.key===focus&&container.getAttribute('aria-busy')!=='true';
  }
  function openRecords(){open(__ttUi('原始记录'),__ttUi`<div class="analysis-detail-intro"><h2>当前范围的原始记录</h2><p>${data.selection.total} 条记录 · ${data.range?__ttUi('窗口 ')+data.range.from+'–'+data.range.to+'%':__ttUi('全部窗口占用，缺失读数单列')}</p></div>`+renderInvestigationRecords(data));}
  container.addEventListener('toggle',event=>{const detail=event.target.dataset.investigationDetail;if(detail==='routes')state.filterOpen=event.target.open;if(detail==='window')state.windowOpen=event.target.open;},true);
  container.addEventListener('click',async event=>{
    const button=event.target.closest('[data-eval-action]');if(!button)return;const action=button.dataset.evalAction;
    if(action==='retry'){stale=true;render();return;}if(!data)return;
    if(action==='direction'){state.direction=state.direction===button.dataset.value?'all':button.dataset.value;state.expanded=false;paint();return;}
    if(action==='layout'){state.layout=button.dataset.value;const url=new URL(location.href);url.searchParams.set('diag_layout',state.layout);history.replaceState(null,'',url);paint();return;}
    if(action==='more'){state.expanded=!state.expanded;paint();return;}
    if(action==='apply-window'){applyWindowEditor();return;}
    if(action==='window-band'){const from=Number(button.dataset.from),to=Number(button.dataset.to);applyWindowRange(data.range?.from===from&&data.range?.to===to?null:{from,to});return;}
    if(action==='clear-range'){applyWindowRange(null);return;}
    if(action==='clear-window'){applyWindowRange(null);return;}
    if(action==='clear-routes'){state.model='all';state.tool='all';state.focus='all';state.focusSession='';state.offset=0;closeMenus();render();return;}
    if(container.getAttribute('aria-busy')==='true')return;
    if(['records','method','review-scope'].includes(action))closeMenus();
    if(action==='group'){const group=data.groups[Number(button.dataset.index)];if(group&&await selectRecords(group.key,button.dataset.session??''))openReview(data.selection.group,button.dataset.direction??'overall');}
    if(action==='review-scope'&&await selectRecords())openReview(data.selection.group);
    if(action==='records'&&await selectRecords())openRecords();
    if(action==='method'){method();body.insertAdjacentHTML('afterbegin',__ttUi('<div class="analysis-detail-intro"><h2>同一组选区的关联证据</h2><p>窗口统一按调用前读数筛选。切换观察维度保持选区不变；请求指标关联到发起该调用的请求并去重。主图灰线是全量反馈、蓝线是当前区间；全量包含当前区间，只表示筛选前后的统计。缺失和超出容量的读数单列，未知结果不按成功计入比率。同工具与模型的其余记录对照见线索详情；差异不代表窗口造成了变化。</p></div>'));}
  });
  container.addEventListener('change',event=>{
    if(event.target.dataset.evalControl==='observation'){const next=event.target.value;if(!observationChoices(data).some(([id])=>id===next))return;const previous=state.metric;state.observation=next;state.metric=['count','window','sessions'].includes(next)?'elapsed':next;closeMenus();const url=new URL(location.href);url.searchParams.set('observation',next);url.searchParams.delete('diag_layout');history.replaceState(null,'',url);if(previous===state.metric)paint();else render();return;}
    if(event.target.dataset.evalControl==='layout'){state.layout=event.target.value;const url=new URL(location.href);url.searchParams.set('diag_layout',state.layout);history.replaceState(null,'',url);paint();return;}
    if(event.target.dataset.evalControl==='direction'){state.direction=event.target.value;paint();return;}
    const key=event.target.dataset.investigationControl;if(!key)return;state[key]=event.target.value;state.offset=0;state.focus='all';state.focusSession='';
    if(key==='mode'){state.family='all';state.direction='all';state.expanded=false;}if(key==='family'){state.mode='all';state.direction='all';state.expanded=false;}render();
  });
  body.onchange=async event=>{
    if(event.target.matches('[data-dialog-baseline]')&&reviewSelection){const chosenDirection=reviewSelection.direction,question=document.getElementById('review-question').value;state.baseline=event.target.value;await render();if(data.baseline!==state.baseline){event.target.value=data.baseline;return;}openReview(data.selection.group,chosenDirection);document.getElementById('review-question').value=question;body.querySelector('.observation-evidence details').open=true;return;}
    if(event.target.id==='review-direction'&&reviewSelection){reviewSelection.direction=event.target.value;document.getElementById('review-method').innerHTML=reviewMethod(reviewSelection.group,reviewSelection.direction);}
  };
  body.onclick=async event=>{
    const action=event.target.closest('[data-eval-action]');
    if(action?.dataset.evalAction==='record'){const row=data.selection.records[Number(action.dataset.index)];if(row)open(__ttUi('记录证据'),__ttUi('<button class="text-action" data-eval-action="back-records">← 返回原始记录</button>')+facts([row]));return;}
    if(action?.dataset.evalAction==='back-records'){openRecords();return;}
    if(action?.dataset.evalAction==='record-page'){state.offset=Number(action.dataset.offset);await render();openRecords();return;}
    if(event.target.closest('[data-eval-prepare]')&&reviewSelection){
      const draft=buildDiagnosisDraft({...reviewSelection,question:document.getElementById('review-question').value,preset,sources:data.selection.sources??data.scope.sources??[]});
      open(__ttUi('诊断草稿'),__ttUi`<div class="analysis-detail-intro"><h2>${e(reviewSelection.group.label||reviewSelection.group.tool)}</h2><p>已整理选区和证据入口，可编辑后填入对话。</p></div><textarea class="analysis-draft" aria-label="诊断草稿">${e(draft)}</textarea>`);
      wireDraftActions(body,{preferredSession:reviewSelection.group.entries?.[0]?.session});
    }
    if(event.target.closest('#copy-analysis-draft')){try{await navigator.clipboard.writeText(body.querySelector('textarea').value);document.getElementById('analysis-copy-status').textContent=__ttUi('已复制');}catch{body.querySelector('textarea').select();document.getElementById('analysis-copy-status').textContent=__ttUi('请复制已选中的文本');}}
  };
  document.getElementById('close-eval-dialog').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{if(state.focus!=='all'){state.focus='all';state.focusSession='';state.offset=0;render();}});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right)dialog.close();}});

  return {render,invalidate(){stale=true;},cancel(){brush.cancel();controller?.abort();version++;},revealComparison(){state.observation='window';paint();}};
}
