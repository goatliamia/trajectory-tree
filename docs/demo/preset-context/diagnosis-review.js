export const diagnosisDirections = [
  {id:'repair',name:'修复实现',long:'修复环境与实现',description:'核对代码、参数、依赖与配置',color:'#3485ed'},
  {id:'recover',name:'恢复观察',long:'恢复与观察',description:'核对保护、中断和后续处理',color:'#1aaa91'},
  {id:'capability',name:'补齐能力',long:'补齐能力',description:'核对缺失、加载状态与可调用性',color:'#f59a36'},
  {id:'knowledge',name:'保留方法',long:'保留可复用方法',description:'核对已验证方法的复用价值',color:'#9561dd'},
];

export function directionReason(group,id) {
  const signal=group.signals?.find(signal=>signal.direction===id);
  if(signal)return signal.summary;
  if(id==='knowledge')return '核对已有指导、实际处理结果和复用条件，判断应更新原说明，还是提炼新的方法。';
  if(id==='capability')return '从任务需要的动作出发，核对已有能力、加载状态、调用入口与权限，判断缺少的是能力还是使用条件。';
  if(id==='recover')return '核对停止原因、已产生的效果和后续进展，判断是否需要恢复。';
  return '沿原始输入和执行链定位问题，在对应的代码、配置或调用方式上验证改法。';
}

export function reviewFactors(group,id) {
  const signal=group.signals?.find(signal=>signal.direction===id);
  if(signal)return signal.factors;
  const factors = {
    repair: ['原始参数、实际执行器与失败阶段', '相关配置、依赖、接口契约及版本', '原执行链中的后续处理与验证结果'],
    recover: ['用户选择、中断来源与原操作的实际效果', '已有后续是否完成任务、是否还需要继续', '恢复条件、重复执行的影响与验证方式'],
    capability: ['任务需要完成的具体动作与验收条件', '当时已安装、已加载、可发现、可调用的能力与权限', '已有说明是否可用：AGENTS.md、工具定义、Skill 与注入内容'],
    knowledge: ['当时已经收到的说明及是否过期、冲突或难以使用', '实际奏效的处理步骤、成功对照与验证结果', '适用条件、失效条件，以及应更新的原说明或方法位置'],
  };
  return factors[id] ?? ['任务要求与实际结果', '原始反馈、执行条件及后续处理', '当时已有的能力和上下文供给'];
}

export function classificationNote(group) {
  const codes = {
    APPROVAL_REJECTED:'宿主记录用户明确拒绝，不提供重新执行的授权。',
    APPROVAL_CANCELLED:'宿主记录审批取消；工具主体是否开始需沿记录核对。',
    APPROVAL_UNAVAILABLE:'宿主未取得可用审批服务或通道。',
    TOOL_CONTEXT_UNAVAILABLE:'工具需要的 Agent、服务或 turn 上下文不可用。',
    UNKNOWN_TOOL:'工具没有注册到当前调用入口，或不允许直接调用。',
    TOOL_ACTIVATION_FAILED:'宿主判断工具可用性时失败；不能据此认定工具未安装。',
    INVALID_TOOL_OUTPUT:'返回值没有满足工具的输出契约。',
    UNSUPPORTED_SCHEMA:'工具声明使用了当前适配器不支持的 Schema。',
    ATTACHMENT_PROJECTION_UNSUPPORTED:'当前投递路径不支持这类附件格式。',
    ATTACHMENT_FILES_UNSUPPORTED:'当前模型或投递路径不支持文件附件。',
  };
  return codes[group.code] ?? (group.focus==='input'?'返回指向附件内容、类型或容量限制。':group.focus==='lookup'?'脚本与退出状态提示探测可能未命中，需核对搜索目的。':group.interpretation ?? '按原始反馈核对具体原因。');
}

export function syntaxLabel(syntax) {
  return ({parsed:'解析通过',recovered:'发现语法问题','not-configured':'未配置解析器','not-selected':'本次未解析',
    'no-source':'缺少原始脚本','time-budget':'解析超时','input-budget':'脚本超出解析范围',
    'provider-unavailable':'解析器不可用','pwsh-unavailable':'未找到 PowerShell','provider-failed':'解析未完成',
    'protocol-mismatch':'解析协议不匹配',pending:'解析结果不完整'})[syntax?.state] ?? '未解析';
}

function sampleRecords(entries) {
  const chosen=[],seen=new Set();
  // Give each session a representative before adding adjacent records.
  for(const r of entries){if(!seen.has(r.session)){chosen.push(r);seen.add(r.session);}if(chosen.length===12)break;}
  for(const r of entries){if(chosen.length===12)break;if(!chosen.includes(r))chosen.push(r);}
  return chosen;
}
const ranges = values => [...new Set(values)].sort((a,b)=>a-b).reduce((out,no)=>{
  if(out.at(-1)?.to===no-1)out.at(-1).to=no;else out.push({from:no,to:no});return out;
},[]);

export function buildDiagnosisDraft({group,direction='overall',question='',preset='',sources=[]}) {
  const entries=group.entries??[],chosen=sampleRecords(entries),label=diagnosisDirections.find(d=>d.id===direction)?.long ?? '综合核对';
  const powershell=entries.some(r=>r.powerShell),execution=powershell||entries.some(r=>/^run_?code$/i.test(r.tool));
  const lines=[`请诊断 ${preset} 预设下的「${group.label||group.tool||'所选会话范围'}」。`,
    `关注方向：${label}。这是用户选择的核对方向，最终处置按证据判断。`,
    ...(question.trim()?[`用户补充：${question.trim()}`]:[]),
    '使用 trace-analysis 分析此选区；处置方法见该 Skill 的 references/disposition.md。',
    ...(execution?['相关专项方法：references/code-execution.md。']:[]),
    ...(powershell?['相关专项方法：references/powershell.md。']:[]),
    ...(['capability','knowledge'].includes(direction)?['供给核对入口：context-profile；结合选区当时的材料与能力。']:[]),
    ...(group.signals?.find(signal=>signal.direction===direction)?.factors??[]).slice(0,3).map(factor=>'程序线索的核对因素：'+factor),
    ...(group.code?[`程序线索：${group.code}；${classificationNote(group)}`]:[]),
    ...(entries.length?[`所选 ${entries.length} 条记录，草稿带入 ${chosen.length} 条代表记录：`]:['按当前时间和项目筛选取证，也检查成功过程。']),
  ];
  const bySource=new Map();
  for(const r of chosen){
    const key=JSON.stringify([r.session,r.cut]);if(!bySource.has(key))bySource.set(key,{session:r.session,cut:r.cut,rows:[]});bySource.get(key).rows.push(r);
    lines.push(`- ${r.session}，第 ${r.turn} 轮，调用 #${r.seq} → ${r.result==null?'返回未记录':'#'+r.result}；工具状态 ${r.status}；识别 ${r.code||'未分类'}${r.reportedCode?'；宿主码 '+r.reportedCode:''}${r.exitCode!=null?'；进程退出标记 '+r.exitCode:''}${r.returned!=null?'；同参后续 #'+r.returned:''}`);
    if(r.command?.source)lines.push('  命令摘录：'+r.command.source.excerpt);
    if(r.evidence)lines.push('  反馈依据：'+(r.attributionBasis??'记录')+' · '+r.evidence);
    if(r.syntax)lines.push(`  静态解析：${syntaxLabel(r.syntax)}${r.syntax.runtime?'；解析器 '+r.syntax.edition+' '+r.syntax.runtime:''}${r.syntax.sha256?'；脚本 SHA-256 '+r.syntax.sha256:''}`);
    for(const d of r.syntax?.diagnostics??[])lines.push(`  ${d.id} L${d.line??'?'}:${d.column??'?'} ${d.message}`);
  }
  lines.push('从以下实际查询开始，沿 snapshot 继续读取原文与关联记录：');
  for(const {session,cut,rows} of bySource.values()){
    lines.push(`trajectory_inspect(${JSON.stringify({session,cut,view:'io',seqs:rows.map(r=>r.seq),groupBy:'tool',limit:12,samples:false,format:'data'})})`);
    lines.push(`trajectory_read(${JSON.stringify({session,cut,seq:rows[0].seq,format:'linked'})})`);
    if(['capability','knowledge'].includes(direction))lines.push(`trajectory_inspect(${JSON.stringify({session,cut,view:'context',turns:{from:rows[0].turn,to:rows[0].turn},format:'data'})})`);
  }
  if(!entries.length)for(const source of sources.slice(0,8))for(const turns of ranges(source.turns).slice(0,3)){
    lines.push(`trajectory_inspect(${JSON.stringify({session:source.session,cut:source.cut,view:'overview',turns,groupBy:'turn',limit:12,samples:false,format:'data'})})`);
  }
  if(!entries.length&&sources.length)lines.push(`完整选区共 ${sources.length} 个会话；以上为开始查询的位置，按问题扩展取证。`);
  lines.push('引用关键记录，分别说明已确认事实、待补证据、建议及验证方式。是否补能力或保留方法，要结合已有供给、任务结果与复用条件。');
  return lines.join('\n');
}
