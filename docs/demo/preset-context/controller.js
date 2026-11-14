import {apiFetch,nativeWorkspace} from './workspace-api.js';
import { renderSkillBodyGroup } from './skill-visuals.js';
import { installCapabilityManagement, managementButton } from './capability-management.js';
import { renderOverlapExamples } from './overlap-preview.js';
import { installEvalViews } from './eval-views.js';
import { installContextOverlap } from './context-overlap.js';
import { currentUsageState } from './home-overview.js';
import { installCompositionHover } from './home-composition.js';
import { installPresetNavigation } from './preset-navigation.js';
import { layouts, originInfo, entriesOf, bundleLabel, renderLayout } from './variants.js';
import { renderSkills, renderSkillDetail, renderSkillComparison, renderSkillEvents, globalSkillPreset } from './skill-manager.js';

export function installController({$,state,categoryInfo,entity,documentBody,esc,tokens,date,current,getData,setData}) {
  const query=new URLSearchParams(location.search);
  state.layout=layouts.some(row=>row.id===query.get('layout'))?query.get('layout'):'desk';
  state.preset=query.get('preset');state.category='all';state.origin=null;state.bundle=null;
  const tabs={home:'首页',skills:'Skill 管理',diagnosis:'诊断',window:'上下文窗口'};
  state.tab=Object.hasOwn(tabs,query.get('tab'))?query.get('tab'):'home';
  const period=[1,7,30].includes(Number(query.get('period')))?Number(query.get('period')):7;
  const ui={originFilter:'all',skillPeriod:period,skillQuery:'',skillOrigin:'all',skillSort:'usage',skillUnused:false,skillRange:null,skillKind:'all',skillActivity:'all',skillChanged:false,overlapExample:'trigger'};
  $('time-range').value=String(period);
  $('time-range').onchange=()=>{const url=new URL(location.href);url.searchParams.set('period',$('time-range').value);location.assign(url);};
  const detailUi={skillRange:null,skillKind:'all'};
  const presetNavigation=installPresetNavigation($('preset-navigator'),{getPresets:()=>getData()?.presets??[],getCurrent:()=>getData()?current().id:null,onSelect:selectPreset});
  state.diagnosisScope=query.get('diagnosis_scope')==='context'?'context':'records';
  $('retained-panel').innerHTML='<nav class="diagnosis-scope" aria-label="诊断范围"><button type="button" data-diagnosis-scope="records">执行记录</button><button type="button" data-diagnosis-scope="context">加载项</button></nav><div id="eval-analysis-panel"></div><div id="context-analysis-panel" hidden></div>';
  const evalViews=installEvalViews($('eval-analysis-panel')),contextView=installContextOverlap($('context-analysis-panel'));
  const diagnosisScope=$('retained-panel').querySelector('.diagnosis-scope');
  diagnosisScope.onclick=event=>{const button=event.target.closest('[data-diagnosis-scope]');if(!button)return;state.diagnosisScope=button.dataset.diagnosisScope;renderOverview();};
  $('refresh').insertAdjacentHTML('beforebegin','<button type="button" class="tt-button" data-manage-kind="tool">管理加载项</button>');
  installCapabilityManagement({current,getData,onSaved:()=>load(),openSkill:name=>showSkill(name)});
  document.addEventListener('keydown',()=>document.body.dataset.input='keyboard',true);
  document.addEventListener('pointerdown',()=>document.body.dataset.input='pointer',true);
  function highlightOrigin(origin){
    const panel=$('overview-panel').querySelector('.origin-composition');if(!panel)return;
    const sector=origin?panel.querySelector(`.fan-sector[data-origin="${origin}"]`):null;
    const card=origin?panel.querySelector(`button[data-fan-link="${origin}"]`):null;
    const linked=sector??card;
    panel.querySelectorAll('[data-fan-link]').forEach(node=>{node.classList.toggle('is-linked',Boolean(origin&&node.dataset.fanLink===origin));node.classList.toggle('is-dimmed',Boolean(origin&&node.dataset.fanLink!==origin));});
    panel.querySelector('[data-fan-center-label]').textContent=linked?.dataset.fanLabel??(card?originInfo[origin].name:'已计量静态内容');
    panel.querySelector('[data-fan-center-value]').textContent=linked?.dataset.fanValue??(card?'—':current().statistics.total>0?tokens(current().statistics.total):'—');
    panel.querySelector('[data-fan-center-share]').textContent=linked?.dataset.fanShare&&linked.dataset.fanShare!=='—'?'占已计量 '+linked.dataset.fanShare:card?'暂无已计量占用':'tokens · 估算';
  }
  function updateUrl(){const url=new URL(location.href);url.searchParams.set('layout',state.layout);url.searchParams.set('preset',state.preset);url.searchParams.set('tab',state.tab);url.searchParams.set('diagnosis_scope',state.diagnosisScope);url.searchParams.delete('skill_view');history.replaceState(null,'',url);}
  function renderSkillPanel(restoreFocus=true){const focused=document.activeElement?.id,position=focused==='skill-query'?$('skill-query').selectionStart:null;$('skill-management-panel').innerHTML=renderSkills(current(),getData(),ui);if(restoreFocus&&focused&&focused.startsWith('skill-')){$(focused)?.focus({preventScroll:true});if(position!=null)$('skill-query')?.setSelectionRange(position,position);}}
  function renderOverview(){const data=getData(),preset=current();
    document.body.dataset.layout=state.tab==='home'?state.layout:'desk';
    document.querySelector('.design-switcher').hidden=true;
    $('overview-panel').hidden=state.tab!=='home';$('skill-management-panel').hidden=state.tab!=='skills';
    const retained=['diagnosis','window'].includes(state.tab);$('retained-panel').hidden=!retained;
    const contextSelected=state.tab==='diagnosis'&&state.diagnosisScope==='context';
    diagnosisScope.hidden=state.tab!=='diagnosis';diagnosisScope.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.diagnosisScope===state.diagnosisScope)));
    $('eval-analysis-panel').hidden=contextSelected;$('context-analysis-panel').hidden=!contextSelected;
    if(retained){$('retained-panel').setAttribute('aria-labelledby',state.tab+'-tab');if(contextSelected){evalViews.cancel();contextView.render(preset.id);}else{contextView.cancel();evalViews.render(preset.id,state.tab);}}else{evalViews.cancel();contextView.cancel();}
    $('workspace-tabs').querySelectorAll('[data-workspace-tab]').forEach(button=>{const selected=button.dataset.workspaceTab===state.tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
    $('skill-tab-count').textContent=preset.skills.length;
    if(!$('refresh').disabled)$('refresh').textContent=state.tab!=='home'&&!contextSelected?'刷新使用记录':'刷新配置';
    $('overview-panel').innerHTML=renderLayout(preset,data,state.layout,ui,categoryInfo);
    $('design-options').innerHTML=layouts.map(row=>`<button type="button" data-layout-choice="${row.id}" aria-pressed="${row.id===state.layout}"><span>${row.letter}</span>${row.name}</button>`).join('');
    $('preset-title').textContent='Eval';
    $('preset-subtitle').textContent='配置与使用分析';
    $('captured-at').textContent=date(state.tab==='home'||contextSelected?data.capturedAt:preset.statistics.usage.asOf??data.capturedAt)+' 采集';
    $('footer-status').textContent=state.tab==='home'||contextSelected?'本地配置 · '+date(data.capturedAt):'本地使用记录 · '+date(preset.statistics.usage.asOf??data.capturedAt);
    presetNavigation.render();
    if(state.tab==='skills')renderSkillPanel();
    updateUrl();
  }
  function openDetail({kind='all',origin=null,bundle=null,unused=false,usageState='all',instructionScope='all',index}={}){
    state.category=kind;state.origin=origin;state.bundle=bundle;state.unused=unused;state.usageState=usageState;state.instructionScope=instructionScope;state.query='';
    state.open=index!==undefined?kind+':'+index:kind==='instructions'&&current().instructions.length===1?'instructions:0':null;
    $('search').value='';renderDetail();
    if(!$('detail-dialog').open)$('detail-dialog').showModal();
    $('detail-dialog').scrollTop=0;
    if(index!==undefined)$('current-list').querySelector('details[open]')?.scrollIntoView({block:'start'});
  }
  function renderDetail(){
    const p=current(),data=getData(),all=entriesOf(p);
    const scoped=all.filter(item=>(!state.origin||item.origin===state.origin)&&(!state.bundle||item.row.provenance?.bundle===state.bundle));
    const selected=scoped.filter(item=>(state.category==='all'||item.kind===state.category)&&(state.category!=='instructions'||state.instructionScope==='all'||(item.row.scope==='个人指令')===(state.instructionScope==='personal')));
    const rows=selected.filter(item=>(!state.unused||item.row.usage?.unusedCandidate)&&(!state.usageState||state.usageState==='all'||currentUsageState(item.row)===state.usageState)&&(!state.query||[item.row.name,item.row.displayPath,item.row.package,item.row.description,item.row.sourceLabel,...item.row.workspaceNames??[]].filter(Boolean).join(' ').toLowerCase().includes(state.query.toLowerCase())));
    const origin=originInfo[state.origin],bundle=data.bundleInventory?.find(row=>row.name===state.bundle);
    const title=state.bundle?bundleLabel(bundle):origin?.name??categoryInfo[state.category]?.title??'当前内容';
    $('detail-breadcrumb').textContent=p.name+' / '+(origin?.name??'当前上下文');
    $('section-title').textContent=title;
    $('bundle-control')?.remove();
    if(state.bundle)$('detail-context').insertAdjacentHTML('beforebegin','<div id="bundle-control">'+managementButton('bundle',state.bundle,{enabled:bundle?.enabled})+'</div>');
    $('section-description').textContent=state.unused?'有多次可见记录，但在当前观察范围内未见使用。':origin?.description??(bundle?.meta?.description?.zh??categoryInfo[state.category]?.description??'当前文件、声明与注册来源');
    $('section-metric').textContent=selected.length+' 项';
    $('categories').innerHTML=[['all','全部'],...Object.entries(categoryInfo).map(([id,c])=>[id,c.label])].map(([id,label])=>`<button class="category-button" data-detail-category="${id}" aria-pressed="${id===state.category}">${label}<small>${id==='all'?scoped.length:scoped.filter(item=>item.kind===id).length}</small></button>`).join('');
    const known=selected.filter(item=>item.row.measuredTokens!=null),size=known.reduce((sum,item)=>sum+item.row.measuredTokens,0),pending=selected.length-known.length;
    $('detail-context').innerHTML=`<span>已计量 <strong>${known.length?'≈ '+tokens(size)+' tokens':'—'}</strong></span><span>${pending} 项待组装</span>${state.origin||state.bundle?'<span>来源保留在每项内容上</span>':''}`;
    if(state.category==='instructions'){
      $('section-description').textContent='开局带入个人全局指令与会话工作目录对应的项目目录链；成功操作更深目录的文件后，再补充适用指令。';
      if(state.instructionScope!=='all'){
        $('detail-context').innerHTML+=`<div class="home-detail-usage"><strong>${state.instructionScope==='personal'?'个人全局':'项目指令'} · ${rows.length} 份</strong><button type="button" id="home-clear-instructions">查看全部 ×</button></div>`;
        $('home-clear-instructions').onclick=()=>{state.instructionScope='all';renderDetail();};
      }
    }
    if(state.usageState&&state.usageState!=='all'){
      const label=state.usageState==='used'?(state.category==='skills'?'正文有读取':'有调用记录'):state.usageState==='unused'?'未见使用':'记录不足';
      $('detail-context').innerHTML+=`<div class="home-detail-usage"><strong>${label} · ${rows.length} 项</strong><button type="button" id="home-clear-usage">查看全部 ×</button></div>`;
      $('home-clear-usage').onclick=()=>{state.usageState='all';renderDetail();};
    }
    if(state.category==='system')$('detail-context').innerHTML+=`<p class="system-explanation">${p.completePrompt?'这个预设启用了完整系统提示替换。工具声明仍单独提供。':'“You are a coding agent…” 是预设身份前缀。完整系统提示由 Harness 身份、该前缀和各插件注册的片段共同组装；以下按来源展开。'}</p>`;
    $('unused-control').hidden=!selected.some(item=>item.row.usage);$('unused-only').checked=state.unused;
    $('list-count').textContent=rows.length+' / '+selected.length+' 项';
    $('current-list').innerHTML=rows.length?rows.map(item=>entity(item.row,item.index,item.kind)).join(''):`<div class="empty-state"><strong>${state.unused?'当前范围没有符合条件的未使用项':state.query?'没有匹配内容':'这个预设未配置此类内容'}</strong>${state.unused?'可见证据不足的项目不会算作未使用。':'只展示当前配置。'}</div>`;
    $('current-list').querySelectorAll('details').forEach(detail=>detail.addEventListener('toggle',()=>{if(detail.open){state.open=detail.dataset.entity;$('current-list').querySelectorAll('details[open]').forEach(other=>{if(other!==detail)other.open=false;});}else if(state.open===detail.dataset.entity)state.open=null;}));
    let note='当前正文与配置来自磁盘；动态注册及完整请求组装仍待运行时确认。';
    if(state.category==='skills')note='目录中的名称与描述随预设提供。正文按需加载，展开查看不代表它已经进入模型上下文。';
    if(state.unused)note=state.category==='skills'?'可先检查用途描述、适用任务和正文读取入口；低频本身不代表无用。':'结合任务类型和所属插件判断使用背景，不引导修改工具语义。';
    $('current-note').hidden=false;$('current-note').textContent=note;
  }
  function about(){const data=getData(),p=current(),u=p.statistics.usage;
    $('source-dialog').querySelector('h2').textContent='来源与统计口径';
    $('source-detail').innerHTML=`<p>当前配置读取于 ${esc(date(data.capturedAt))}，工作目录 <code>${esc(data.workspace.path)}</code>。</p><p><strong>来源使用 DSH 原生插件管理器的只读清单。</strong>官方标记与 installation / profile 来源、插件中文名称和图标均沿用本机 DSH 元数据。没有按包名前缀猜测归属。</p><p>“我的指令与 Skill”按实际文件来源归类，加载器的官方身份不改变文件归属。未匹配的内容单列待确认。</p><p>体积来自 DSH 估算器。动态片段未计入总量，Skill 只计目录；正文按需加载。${p.toolMode==='PTC'?'PTC 的工具声明计量不等于 SDK 组装体积。':''}</p><p>使用背景来自同预设最近 ${u.sessions} 个已读会话（跨项目），按当前能力名称关联。至少 3 个会话可见且零次使用才列为“未见使用”。${u.sessions?'记录覆盖 '+esc(date(u.from))+' 至 '+esc(date(u.to))+'；历史采集于 '+esc(date(u.asOf))+'。':''}</p><p>原文仅保留现版本。所有配置和记录留在本机，尚未连接实时请求组装。</p>`;
    $('source-dialog').showModal();
  }
  function openSkillView(html,label='Skill 管理'){$('skill-dialog-label').textContent=label==='全部预设'?'Skill / 全部预设':current().name+' / '+label;$('skill-detail').innerHTML=html;if(!$('skill-dialog').open)$('skill-dialog').showModal();$('skill-dialog').scrollTop=0;}
  function detailSkill(name){return [...current().skills,...current().disabledSkills??[]].find(s=>s.name===name)??getData().presets.flatMap(p=>[...p.skills,...p.disabledSkills??[]]).find(s=>s.name===name);}
  function showSkill(name,variant){if(detailUi.name!==name){detailUi.name=name;detailUi.skillVariant=0;}if(variant!==undefined)detailUi.skillVariant=variant;const skill=detailSkill(name);if(skill)openSkillView(renderSkillDetail(current(),skill,{...ui,...detailUi},documentBody,getData()),'全部预设');}
  $('skill-detail').addEventListener('change',event=>{if(event.target.matches('[data-skill-variant]')){detailUi.skillVariant=Number(event.target.value);showSkill(event.target.dataset.skillVariant);}});
  function handleSkillAction(event){const button=event.target.closest('[data-skill-action]');if(!button)return;const a=button.dataset,p=current();
    if(['show-overlap-example','overlap-example'].includes(a.skillAction)){ui.overlapExample=a.example;openSkillView(renderOverlapExamples(getData().demoExamples,ui.overlapExample),'重合分析示例');return;}
    if(a.skillAction==='activity'){ui.skillActivity=ui.skillActivity===a.value?'all':a.value;ui.skillChanged=false;ui.skillUnused=false;renderSkillPanel();return;}
    if(a.skillAction==='changed'){ui.skillChanged=!ui.skillChanged;ui.skillActivity='all';ui.skillUnused=false;renderSkillPanel();return;}
    if(a.skillAction==='clear-activity'){ui.skillActivity='all';ui.skillChanged=false;renderSkillPanel();return;}
    if(a.skillAction==='body-group'){openSkillView(renderSkillBodyGroup(p,JSON.parse(a.names||'[]')),'正文构成');return;}
    if(['date','kind','clear-chart'].includes(a.skillAction)){
      const scope=button.closest('[data-chart-skill]')?.dataset.chartSkill,selection=scope?detailUi:ui;
      if(a.skillAction==='date'){ui.skillActivity='all';ui.skillChanged=false;ui.skillUnused=false;}
      if(a.skillAction==='date')selection.skillRange=selection.skillRange?.start===Number(a.start)?null:{start:Number(a.start),end:Number(a.end)};
      if(a.skillAction==='kind')selection.skillKind=selection.skillKind===a.kind?'all':a.kind;
      if(a.skillAction==='clear-chart'){selection.skillRange=null;selection.skillKind='all';}
      if(scope)showSkill(scope);
      else renderSkillPanel(false);
      const root=scope?$('skill-detail'):$('skill-management-panel');
      const next=a.skillAction==='date'?root.querySelector(`[data-skill-action="date"][data-start="${a.start}"]`):a.skillAction==='kind'?root.querySelector(`[data-skill-action="kind"][data-kind="${a.kind}"]`):root.querySelector('[data-skill-action="date"][tabindex="0"]');
      if(event.type==='keydown'||document.body.dataset.input==='keyboard')next?.focus({preventScroll:true});return;
    }
    if(a.skillAction==='open'){detailUi.skillRange=null;detailUi.skillKind='all';showSkill(a.name);}
    if(a.skillAction==='compare')openSkillView(renderSkillComparison(p,a.left,a.right,a.from),'Description 对照');
    if(a.skillAction==='events'){const scope=button.closest('[data-chart-skill]')?.dataset.chartSkill,skill=scope&&detailSkill(scope),source=skill?globalSkillPreset(getData(),p,skill):p;openSkillView(renderSkillEvents(source,scope?{...ui,...detailUi}:ui,scope),'读取记录');}
    if(a.skillAction==='checks'||a.skillAction==='context-overlap'){$('skill-dialog').close();state.tab='diagnosis';state.diagnosisScope='context';renderOverview();}
    if(a.skillAction==='tool'&&p.tools[Number(a.index)]){$('skill-dialog').close();openDetail({kind:'tools',index:Number(a.index)});}
  }
  $('workspace-tabs').onclick=event=>{const button=event.target.closest('[data-workspace-tab]');if(!button)return;state.tab=button.dataset.workspaceTab;renderOverview();};
  $('workspace-tabs').onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const keys=Object.keys(tabs),index=keys.indexOf(state.tab);state.tab=event.key==='Home'?keys[0]:event.key==='End'?keys.at(-1):keys[(index+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length];renderOverview();$(state.tab+'-tab').focus();};
  $('skill-management-panel').onclick=handleSkillAction;$('skill-detail').onclick=handleSkillAction;
  $('skill-management-panel').oninput=event=>{if(event.target.id==='skill-query'){ui.skillQuery=event.target.value;renderSkillPanel();}};
  $('skill-management-panel').onchange=event=>{const el=event.target;if(el.id==='skill-period'){ui.skillPeriod=el.value==='all'?'all':Number(el.value);ui.skillRange=null;}else if(el.id==='skill-origin')ui.skillOrigin=el.value;else if(el.id==='skill-sort')ui.skillSort=el.value;else if(el.id==='skill-unused'){ui.skillUnused=el.checked;ui.skillActivity='all';ui.skillChanged=false;ui.skillRange=null;ui.skillKind='all';}else return;renderSkillPanel();};
  for(const root of [$('skill-management-panel'),$('skill-detail')]){
    function showTip(target){const panel=target?.closest('.skill-chart-panel'),tip=panel?.querySelector('.skill-chart-tooltip');if(!tip)return;const r=target.getBoundingClientRect(),p=panel.getBoundingClientRect();tip.textContent=target.dataset.chartLabel.replace(' · ','\n');tip.hidden=false;const bounds=tip.getBoundingClientRect(),half=bounds.width/2+8;tip.style.left=Math.max(half,Math.min(p.width-half,r.left-p.left+r.width/2))+'px';tip.style.top=Math.max(4,r.top-p.top-bounds.height-7)+'px';}
    function hideTip(event){if(event.relatedTarget instanceof Element&&event.relatedTarget.closest('[data-chart-label]')===event.target.closest('[data-chart-label]'))return;root.querySelectorAll('.skill-chart-tooltip').forEach(tip=>tip.hidden=true);}
    root.addEventListener('pointerover',event=>{const target=event.target.closest('[data-chart-label]');if(target)showTip(target);});
    root.addEventListener('pointerout',hideTip);root.addEventListener('focusout',hideTip);
    root.addEventListener('focusin',event=>{const target=event.target.closest('[data-chart-label]');if(target)showTip(target);});
    root.addEventListener('keydown',event=>{const column=event.target.closest('[data-chart-label]');if(!column){if(['Enter',' '].includes(event.key)&&event.target.matches('g[data-skill-action],path[data-skill-action],text[data-skill-action]')){event.preventDefault();handleSkillAction(event);}return;}
      if(['Enter',' '].includes(event.key)){event.preventDefault();handleSkillAction(event);}
      if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const columns=[...column.parentElement.querySelectorAll('[data-chart-label]')],i=columns.indexOf(column);const next=event.key==='Home'?columns[0]:event.key==='End'?columns.at(-1):columns[Math.max(0,Math.min(columns.length-1,i+(event.key==='ArrowRight'?1:-1)))];columns.forEach(node=>node.tabIndex=node===next?0:-1);next.focus();}
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();root.querySelector('[data-skill-action="clear-chart"]')?.dispatchEvent(new MouseEvent('click',{bubbles:true}));root.querySelectorAll('.skill-chart-tooltip').forEach(tip=>tip.hidden=true);}
    });
  }
  const skillVisualRoot=$('skill-management-panel');
  function linkMapItem(target){const name=target?.closest('[data-map-name]')?.dataset.mapName;skillVisualRoot.querySelectorAll('[data-map-name]').forEach(node=>node.classList.toggle('is-linked',Boolean(name&&node.dataset.mapName===name)));}
  skillVisualRoot.addEventListener('pointerover',event=>linkMapItem(event.target));
  skillVisualRoot.addEventListener('focusin',event=>linkMapItem(event.target));
  skillVisualRoot.addEventListener('pointerleave',()=>linkMapItem(null));
  function visualTip(target){const region=target?.closest('.skill-landscape-chart'),tip=region?.querySelector('.visual-tooltip');if(!tip)return;tip.textContent=target.dataset.vizTip.replace('｜','\n');tip.hidden=false;const a=target.getBoundingClientRect(),r=region.getBoundingClientRect(),half=tip.getBoundingClientRect().width/2+6;tip.style.left=Math.max(half,Math.min(r.width-half,a.left-r.left+a.width/2))+'px';tip.style.top=Math.max(0,a.top-r.top-tip.getBoundingClientRect().height-10)+'px';}
  skillVisualRoot.addEventListener('pointerover',event=>{const target=event.target.closest('[data-viz-tip]');if(target)visualTip(target);});
  skillVisualRoot.addEventListener('focusin',event=>{const target=event.target.closest('[data-viz-tip]');if(target)visualTip(target);});
  for(const type of ['pointerout','focusout'])skillVisualRoot.addEventListener(type,()=>skillVisualRoot.querySelectorAll('.visual-tooltip').forEach(tip=>tip.hidden=true));
  $('close-skill-dialog').onclick=()=>$('skill-dialog').close();
  $('overview-panel').onclick=event=>{const button=event.target.closest('[data-action]');if(!button)return;
    const a=button.dataset;
    if(a.action==='eval-tab'){state.tab=a.tab;renderOverview();$('workspace-tabs').scrollIntoView({block:'start',behavior:'smooth'});}
    if(a.action==='category')openDetail({kind:a.kind,origin:a.origin||null,unused:a.unused==='true',usageState:a.usageState||'all',instructionScope:a.instructionScope||'all',index:a.index===undefined?undefined:Number(a.index)});
    if(a.action==='composition-item'){
      if(a.kind==='skills'){const skill=current().skills[Number(a.index)];if(skill)showSkill(skill.name,Number(a.variant));}
      else openDetail({kind:a.kind,origin:a.origin,index:Number(a.index)});
    }
    if(a.action==='origin')openDetail({origin:a.origin});
    if(a.action==='bundle')openDetail({bundle:a.bundle});
    if(a.action==='about')about();
    if(a.action==='filter-origin'){ui.originFilter=a.origin;renderOverview();}
  };
  $('overview-panel').onkeydown=event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('circle[data-action],path[data-action]')){event.preventDefault();const target=event.target.dataset;if(target.action==='origin')openDetail({origin:target.origin});else openDetail({kind:target.kind,usageState:target.usageState||'all'});}};
  installCompositionHover($('overview-panel'),current);
  $('overview-panel').addEventListener('pointerover',event=>{const linked=event.target.closest('[data-fan-link]');if(linked)highlightOrigin(linked.dataset.fanLink);});
  $('overview-panel').addEventListener('pointerout',event=>{if(!event.target.closest('[data-fan-link]'))return;const next=event.relatedTarget instanceof Element?event.relatedTarget.closest('[data-fan-link]'):null;const focused=document.activeElement?.closest('[data-fan-link]');highlightOrigin(next?.dataset.fanLink??focused?.dataset.fanLink??null);});
  $('overview-panel').addEventListener('focusin',event=>{const linked=event.target.closest('[data-fan-link]');if(linked)highlightOrigin(linked.dataset.fanLink);});
  $('overview-panel').addEventListener('focusout',event=>{if(!event.target.closest('[data-fan-link]'))return;const next=event.relatedTarget instanceof Element?event.relatedTarget.closest('[data-fan-link]'):null;highlightOrigin(next?.dataset.fanLink??null);});
  $('design-options').onclick=event=>{const button=event.target.closest('[data-layout-choice]');if(!button)return;state.layout=button.dataset.layoutChoice;ui.originFilter='all';renderOverview();window.scrollTo({top:0,behavior:'instant'});};
  function selectPreset(id){state.preset=id;ui.originFilter='all';ui.skillRange=null;ui.skillKind='all';ui.skillActivity='all';ui.skillChanged=false;renderOverview();}
  $('categories').onclick=event=>{const button=event.target.closest('[data-detail-category]');if(button)openDetail({kind:button.dataset.detailCategory,origin:state.origin,bundle:state.bundle});};
  $('search').oninput=()=>{state.query=$('search').value;state.open=null;renderDetail();};
  $('unused-only').onchange=()=>{state.unused=$('unused-only').checked;state.usageState='all';state.open=null;renderDetail();};
  $('close-detail').onclick=()=>$('detail-dialog').close();$('close-dialog').onclick=()=>$('source-dialog').close();$('about').onclick=about;
  for(const id of ['detail-dialog','source-dialog','skill-dialog'])$(id).addEventListener('click',event=>{if(event.target!==$(id))return;const r=$(id).getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$(id).close();});
  $('detail-dialog').addEventListener('close',()=>{document.body.classList.remove('has-detail');});
  let loadRevision=0,progressRevision=-1,polling=false,pollStarted=false;
  function showProgress(progress){
    let node=$('history-progress');if(!node){node=document.createElement('div');node.id='history-progress';node.className='history-progress';node.role='status';$('workspace-tabs').after(node);}
    node.hidden=!progress?.loading&&!progress?.error&&!progress?.unread&&!progress?.omitted&&!progress?.configurationChecking&&!progress?.configurationError;
    node.textContent=[progress?.configurationChecking?'正在核对配置':progress?.configurationError,progress?.error??(progress?.loading?'正在更新使用记录 · '+progress.done+' / '+progress.total:progress?.unread?progress.unread+' 个会话尚未读取，已保留其余结果':''),progress?.omitted?progress.omitted+' 个超出本次范围的会话未纳入':null].filter(Boolean).join(' · ');
  }
  async function load(){
    const revision=++loadRevision;
    const [response,examples]=await Promise.all([apiFetch('/data.json',{cache:'no-store'}),apiFetch('/api/overlap-examples',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null)]);
    if(!response.ok)throw Error('当前配置暂时无法读取');const data=await response.json();if(revision!==loadRevision)return;
    data.demoExamples=examples;setData(data);if(!data.presets.some(row=>row.id===state.preset))state.preset=data.defaultPreset??data.presets[0]?.id;
    if(!data.presets.length)throw Error('当前工作区没有可读取的预设');
    renderOverview();
    if(nativeWorkspace()){
      const select=$('workspace-scope');select.innerHTML='<option value="all">全部工作区</option>';
      for(const workspace of data.workspaces??[]){const option=document.createElement('option');option.value=workspace.id;option.textContent=workspace.name||workspace.path;option.selected=workspace.id===data.workspace.id;select.append(option);}
      select.value=data.workspace.id??'all';select.onchange=()=>{const url=new URL(window.location.href);url.searchParams.set('workspace',select.value);window.location.assign(url);};
      showProgress(data.progress);if(!pollStarted){pollStarted=true;poll();}
    }
  }
  async function poll(){
    if(polling)return;polling=true;
    try{
      if(document.hidden)return;
      const response=await apiFetch('/api/status');if(!response.ok)return;const progress=await response.json();showProgress(progress);
      if(progress.revision!==progressRevision&&!document.querySelector('dialog[open]')){progressRevision=progress.revision;evalViews.invalidate();await load();}
    }catch{}finally{polling=false;setTimeout(poll,2000);}
  }
  $('refresh').onclick=async()=>{ui.skillRange=null;ui.skillKind='all';ui.skillActivity='all';ui.skillChanged=false;ui.skillUnused=false;detailUi.skillRange=null;detailUi.skillKind='all';if(state.tab==='skills')renderSkillPanel(false);const button=$('refresh'),usage=state.tab!=='home'&&!(state.tab==='diagnosis'&&state.diagnosisScope==='context');button.disabled=true;button.textContent=usage?'读取使用记录…':'读取中…';try{const response=await apiFetch(usage?'/api/refresh-usage':'/api/refresh',{method:'POST'});if(!response.ok)throw Error('刷新未完成，请重试');evalViews.invalidate();await load();$('load-error').hidden=true;}catch(error){$('load-error').hidden=false;$('load-error').textContent=error.message;}finally{button.disabled=false;button.textContent=state.tab!=='home'&&!(state.tab==='diagnosis'&&state.diagnosisScope==='context')?'刷新使用记录':'刷新配置';}};
  load().catch(error=>{$('load-error').hidden=false;$('load-error').textContent=error.message;});
}
