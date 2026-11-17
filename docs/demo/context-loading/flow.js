(() => {
  'use strict';
  const $=id=>document.getElementById(id),sample=window.CONTEXT_LOADING_SAMPLE,layouts=window.CONTEXT_LOADING_LAYOUTS;
  const groups=sample.groups.map((group,index)=>({...group,index,tokens:group.items.reduce((n,item)=>n+item.tokens,0)}));
  const total=groups.reduce((n,group)=>n+group.tokens,0),fmt=n=>n.toLocaleString('en-US');
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const modes={initial:{title:'接口与规则分别装填，汇合为首次请求',subtitle:'Standard · 示例工作目录',stages:['系统基底','能力接口','Skill 目录','适用指令','环境补充','用户输入']},skill:{title:'目录先进入请求，正文按需展开',subtitle:'示例：读取 trace-analysis',stages:['发现目录','读取正文','形成下一请求']},conditional:{title:'条件命中时补充适用内容',subtitle:'示例：访问带有额外指令的子目录',stages:['核对目录','处理适用指令','形成下一请求']}};
  const state={mode:'initial',stage:6,selected:null,condition:true,playing:false,timer:null,pulse:false};
  let orientation=innerWidth<800?'vertical':'horizontal';
  function amount(ids){return groups.filter(g=>ids.includes(g.id)&&g.index<state.stage).reduce((n,g)=>n+g.tokens,0);}
  function requestAmount(){return state.mode==='initial'?amount(groups.map(g=>g.id)):state.mode==='skill'?total+(state.stage>=2?2840:0):total+(state.condition&&state.stage>=2?420:0);}
  function membership(id){return {capabilities:['tools','catalog'],rules:['system','instructions'],assembly:['runtime','user'],request:groups.map(g=>g.id)}[id]??[];}
  function nodeContent(id){
    if(state.mode==='initial'){
      if(id==='preset')return {ref:'配置',lines:['Standard · 当前预设','按适用范围组装'],ready:true};
      const ids=membership(id),current=amount(ids),all=groups.filter(g=>ids.includes(g.id));
      return {ref:id==='request'?'本次请求':'内容层',lines:id==='request'?[`${all.filter(g=>g.index<state.stage).length} 个内容层 · ${all.filter(g=>g.index<state.stage).reduce((n,g)=>n+g.items.length,0)} 项`,`≈ ${fmt(current)} tokens`,'Skill 正文尚未读取']:[...all.map(g=>`${g.name} · ${g.index<state.stage?fmt(g.tokens)+' tokens':'待装填'}`),`本层：${fmt(current)} tokens`],ready:current>0};
    }
    if(state.mode==='skill')return {
      current:{ref:'已有请求',lines:[`≈ ${fmt(total)} tokens`,'已包含 Skill 目录'],ready:true},
      catalog:{ref:'目录',lines:['trace-analysis','目录描述：180 tokens','已含在原请求中'],ready:state.stage>=1},
      retained:{ref:'保留内容',lines:['系统、工具、指令与任务',`≈ ${fmt(total)} tokens`,'不重复计算目录'],ready:true},
      body:{ref:'按需正文',lines:['trace-analysis',state.stage>=2?'正文：2,840 tokens':'正文尚未读取','调用后才进入上下文'],ready:state.stage>=2},
      request:{ref:'下一请求',lines:['保留内容 + 新增正文',`≈ ${fmt(requestAmount())} tokens`,state.stage>=2?'目录不重复加入':'等待正文读取'],ready:state.stage>=3}
    }[id];
    return {
      current:{ref:'已有请求',lines:[`≈ ${fmt(total)} tokens`,'已包含当前适用指令'],ready:true},
      condition:{ref:'适用条件',lines:[],ready:state.stage>=1},
      extra:{ref:'条件命中',lines:['子目录 AGENTS.md',state.condition&&state.stage>=2?'新增：420 tokens':'尚未加入本次请求','仅适用于对应路径'],ready:state.condition&&state.stage>=2},
      unchanged:{ref:'条件未命中',lines:['保留当前适用指令','不追加子目录内容',`≈ ${fmt(total)} tokens`],ready:!state.condition&&state.stage>=2},
      request:{ref:'下一请求',lines:['保留原有内容',`≈ ${fmt(requestAmount())} tokens`,state.condition&&state.stage>=2?'已补充适用目录指令':'沿用当前指令范围'],ready:state.stage>=3}
    }[id];
  }
  function currentNode(){
    if(state.mode==='initial')return state.stage?({system:'rules',tools:'capabilities',catalog:'capabilities',instructions:'rules',runtime:'assembly',user:'request'})[groups[state.stage-1].id]:'preset';
    return state.mode==='skill'?['current','catalog','body','request'][state.stage]:['current','condition',state.condition?'extra':'unchanged','request'][state.stage];
  }
  function text(lines,x,y,className,anchor='start',lineHeight=17){return `<text class="${className}" x="${x}" y="${y}" text-anchor="${anchor}">${lines.map((line,i)=>`<tspan x="${x}" dy="${i?lineHeight:0}">${escape(line)}</tspan>`).join('')}</text>`;}
  function diagram(){
    const layout=layouts[state.mode][orientation],active=currentNode();
    const edges=layout.edges.map(edge=>{
      const end=edge.end,arrow=orientation==='vertical'?`M${end.x-4} ${end.y-6}L${end.x} ${end.y}L${end.x+4} ${end.y-6}`:`M${end.x-6} ${end.y-4}L${end.x} ${end.y}L${end.x-6} ${end.y+4}`;
      const ready=nodeContent(edge.from).ready&&nodeContent(edge.to).ready,current=ready&&edge.to===active;
      const pulse=state.pulse&&current&&!matchMedia('(prefers-reduced-motion: reduce)').matches?`<circle r="2.3" class="flow-packet" style="offset-path:path('${edge.path}')"/>`:'';
      return `<g class="flow-link ${current?'is-current':''} ${ready?'':'is-waiting'}"><path class="flow-link-line" d="${edge.path}"/><path class="flow-arrow" d="${arrow}"/><rect class="flow-link-label-bg" x="${edge.labelBox.x}" y="${edge.labelBox.y}" width="${edge.labelWidth}" height="${edge.labelHeight}" rx="3"/>${text(edge.labelLines,edge.labelX,edge.labelY,'flow-link-label','middle',13)}${pulse}</g>`;
    }).join('');
    const nodes=layout.nodes.map(node=>{
      const data=nodeContent(node.id),decision=node.kind==='decision',cx=node.width/2;
      const shape=decision?`<path class="flow-node-shape" d="M${cx} 1L${node.width-1} ${node.height/2}L${cx} ${node.height-1}L1 ${node.height/2}Z"/>`:`<rect class="flow-node-shape" x="1" y="1" width="${node.width-2}" height="${node.height-2}" rx="${node.kind==='result'?13:7}"/>`;
      const labelY=decision?node.height/2+5:45,x=decision?cx:15,anchor=decision?'middle':'start';
      return `<g class="flow-node ${node.kind==='result'?'is-endpoint':''} ${data.ready?'':'is-waiting'} ${active===node.id?'is-current':''} ${state.selected===node.id?'is-selected':''}" data-node="${node.id}" tabindex="0" role="button" aria-label="${escape(node.label+'，'+data.lines.join('，'))}" aria-pressed="${state.selected===node.id}" transform="translate(${node.x} ${node.y})"><title>${escape(node.label)}</title>${shape}${text([data.ref],x,decision?36:21,'flow-node-ref',anchor)}${text(node.titleLines,x,labelY,'flow-node-title',anchor)}${text(data.lines,x,labelY+node.titleLines.length*18+5,'flow-node-detail',anchor,16)}</g>`;
    }).join('');
    return `<svg width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="group" aria-label="${modes[state.mode].title}">${edges}${nodes}</svg>`;
  }
  function details(){
    const id=state.selected;if(!id){$('detail').hidden=true;return;}
    const node=layouts[state.mode][orientation].nodes.find(n=>n.id===id),data=nodeContent(id);
    let rows=[],description;
    if(state.mode==='initial'){
      const own=groups.filter(group=>membership(id).includes(group.id));
      rows=own.flatMap(group=>group.items.map(item=>[item.name,group.index<state.stage?fmt(item.tokens)+' tokens':'待装填']));
      description=id==='preset'?'预设提供系统提示、工具声明和 Skill 目录；适用指令与运行信息按当前范围加入。':id==='capabilities'?'这里计量工具的用途与参数，以及 Skill 的名称和目录描述。Skill 正文在读取之后单独追加。':id==='rules'?'系统基底与个人、项目指令分别保留来源。当前节点是便于阅读的组装分组。':id==='assembly'?'只加入本次适用的环境信息与当前任务消息。尚未触发的动态内容保持未计量。':'示例六层内容合计 6,680 tokens。阶段控制展示各层加入后的累计值，未包含按需 Skill 正文。';
    }else if(state.mode==='skill'){
      description=id==='catalog'?'180 tokens 的目录描述已包含在原请求的 6,680 tokens 中。发现它不会再次增加请求体积。':id==='body'?'只有实际读取正文后，示例才增加 2,840 tokens。正式接入时还需沿工具返回与下一请求核对携带情况。':'示例对比保留内容与新增正文：6,680 + 2,840 = 9,520 tokens。';
      rows=[['原请求',fmt(total)+' tokens'],['目录描述','180 tokens · 已包含'],['新增正文',state.stage>=2?'2,840 tokens':'尚未读取']];
    }else{
      description='上方开关模拟访问更深目录。命中条件才追加适用指令；没有触发时不能据此把提供者的正文记为零。';
      rows=[['原请求','6,680 tokens'],['目录条件',state.condition?'已模拟访问':'未访问'],['补充指令',state.condition&&state.stage>=2?'420 tokens':'未加入当前请求']];
    }
    $('detail').hidden=false;$('detail').innerHTML=`<div class="detail-heading"><h3>${escape(node.label)}</h3><span>${escape(data.ref)}</span><button id="close-detail" type="button" aria-label="关闭内容详情">收起 ×</button></div><p>${escape(description)}</p>${rows.length?`<div class="detail-list">${rows.map(([label,value])=>`<div><strong>${escape(label)}</strong><small>${escape(value)}</small></div>`).join('')}</div>`:''}`;
  }
  function render(){
    const mode=modes[state.mode];
    $('flow-title').textContent=mode.title;$('flow-subtitle').textContent=mode.subtitle;$('total').textContent=fmt(requestAmount());
    $('stage').max=mode.stages.length;$('stage').value=state.stage;
    $('stage-label').textContent=state.stage?mode.stages[state.stage-1]+(state.mode==='initial'?'已加入':''):'等待装填';
    $('position').textContent=String(state.stage).padStart(2,'0')+' / '+String(mode.stages.length).padStart(2,'0');
    $('previous').disabled=state.stage===0;$('next').disabled=state.stage===mode.stages.length;
    $('play').textContent=state.playing?'暂停':'回放装填';$('play').setAttribute('aria-pressed',state.playing);
    $('condition-option').hidden=state.mode!=='conditional';
    document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.mode===state.mode));
    $('stage-ticks').innerHTML=mode.stages.map((label,i)=>`<button type="button" data-stage="${i+1}" aria-current="${state.stage===i+1?'step':'false'}"><small>${String(i+1).padStart(2,'0')}</small>${label}</button>`).join('');
    const scroll=$('flow-scroll'),left=scroll.scrollLeft;$('flow-canvas').innerHTML=diagram();scroll.scrollLeft=left;details();
  }
  function stop(){clearInterval(state.timer);state.timer=null;state.playing=false;}
  function step(value){state.stage=Math.max(0,Math.min(modes[state.mode].stages.length,Number(value)));state.pulse=true;render();}
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-mode],[data-node],[data-stage],#close-detail');if(!target)return;
    if(target.dataset.mode){stop();state.mode=target.dataset.mode;state.stage=modes[state.mode].stages.length;state.selected=null;state.pulse=false;$('flow-scroll').scrollLeft=0;render();}
    else if(target.dataset.node){state.selected=state.selected===target.dataset.node?null:target.dataset.node;state.pulse=false;render();}
    else if(target.dataset.stage){stop();step(target.dataset.stage);}
    else if(target.id==='close-detail'){state.selected=null;render();}
  });
  document.addEventListener('keydown',event=>{if(event.target.matches('[data-node]')&&['Enter',' '].includes(event.key)){event.preventDefault();const id=event.target.dataset.node;state.selected=state.selected===id?null:id;state.pulse=false;render();document.querySelector(`[data-node="${id}"]`)?.focus({preventScroll:true});}});
  $('play').onclick=()=>{if(state.playing){stop();render();return;}state.playing=true;state.selected=null;step(0);state.timer=setInterval(()=>{step(state.stage+1);if(state.stage===modes[state.mode].stages.length){stop();render();}},1250);};
  $('previous').onclick=()=>{stop();step(state.stage-1);};$('next').onclick=()=>{stop();step(state.stage+1);};$('stage').oninput=event=>{stop();step(event.target.value);};
  $('condition-toggle').onchange=event=>{state.condition=event.target.checked;state.pulse=true;render();};
  $('theme').onclick=()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';$('theme').textContent=dark?'深色':'浅色';};
  window.addEventListener('resize',()=>{const next=innerWidth<800?'vertical':'horizontal';if(next!==orientation){orientation=next;state.pulse=false;render();}});
  window.addEventListener('pagehide',stop);
  render();
})();
