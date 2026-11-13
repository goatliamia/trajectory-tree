// Direction leads, not repair/retention decisions. Shared by Node and the
// browser grouping runtime; keep this function self-contained for serialization.
// Normative rules and counterexamples: docs/diagnostic-rules.md.
export function diagnosticLayer(a) {
  if(a?.layer)return a.layer;
  const code=a?.code??'';
  if(['INVALID_ARGS','INVALID_TOOL_OUTPUT','UNSUPPORTED_SCHEMA'].includes(code))return 'tool-contract';
  if(/^(?:HOST_|TOOL_CONTEXT_|TOOL_ACTIVATION_|APPROVAL_UNAVAILABLE|UNKNOWN_TOOL)/.test(code)||code==='browser-unavailable')return 'host-environment';
  if(/^JOB_/.test(code))return 'background-job';
  if(code==='COMMAND_SYNTAX'&&a?.program==='PowerShell')return 'shell-parse';
  if(code==='COMMAND_ARGUMENT'||code==='COMMAND_NOT_FOUND')return 'command-binding';
  if(/^FS_/.test(code))return 'filesystem';
  if(/^COMMAND_|^CODE_/.test(code))return 'program';
  if(/^(?:APPROVAL_|ASK_CANCELLED|ABORTED|WEB_ABORTED)/.test(code))return 'control';
  if(code==='TOOL_OUTCOME_UNKNOWN')return 'recorded-outcome';
  return null;
}

export function diagnosticSignals(group) {
  const rows=group.entries??[],signals=[];
  const add=(direction,rule,label,summary,factors)=>signals.push({direction,rule,version:'v1',label,summary,factors,
    state:'lead',evidence:{code:group.code,pattern:group.pattern??null,records:rows.length,turns:group.turns,
      refs:rows.slice(0,4).map(r=>({session:r.source?.session??r.session,seq:r.seq,result:r.result}))}});
  if(group.kind==='wait'||['control','lookup'].includes(group.focus))return signals;
  const repeated=group.turns>1;
  const repair=['arguments','contract','implementation','validation','access'];
  if(repair.includes(group.focus))add('repair','D-R1',group.focus==='validation'?'核对产物或检查器':'核对输入与实现',
    '已有反馈指向输入、执行条件或具体实现；沿原调用定位可调整的位置。',
    ['对齐原参数、执行器和错误位置','区分辅助脚本、任务产物与检查器','核对已有修改及原执行链的验证结果']);
  if(group.focus==='availability'){
    add('repair','D-R1','核对环境配置','反馈指向可用性或运行环境，先核对配置、作用域和调用入口。',
      ['实际注册、加载和运行状态','动作应在本机、子进程还是远端执行','是否已有同环境下的成功调用']);
    add('capability','D-C1','核对能力供给','已有命令、工具、服务或上下文不可用的线索；查清缺少的是能力还是使用条件。',
      ['任务需要完成的具体动作','已安装、已加载、可发现、可调用与权限分别核对','检查本地与远端边界，优先使用已有能力']);
  }
  if(['guard','recovery','cancellation','outcome','input','external'].includes(group.focus))add('recover',
    group.focus==='external'?'D-O2':'D-O1',group.focus==='guard'?'核对保护条件':group.focus==='outcome'?'查明实际结果':group.focus==='external'?'核对退出含义':'核对后续状态',
    group.focus==='guard'?'保护条件未被接受；结合先前读取、文件版本与后续调用调查。':'先核对原操作已产生的效果、停止来源和后续结果，再判断是否需要继续。',
    [group.focus==='external'?'外层与子程序状态、探测未命中及主动停止':'是否已有副作用、仍在运行或得到后续结果','用户是否希望继续、当前任务是否已完成','按具体效果选择恢复或观察，保留原权限边界']);
  if(group.focus==='recovery'&&repeated)add('repair','D-R2','重复的环境反馈','相同服务或运行环境反馈跨尝试出现，可调查持续的配置或实现因素。',
    ['比较各次触发条件及环境版本','核对已有恢复是否有效','找同环境的成功对照']);
  const evidence=[...new Set(rows.map(r=>r.pattern||r.evidence||'').filter(Boolean))];
  const specific=Boolean(group.pattern)||evidence.length===1&&rows.every(row=>
    row.diagnosticIds?.includes(evidence[0])||row.syntax?.diagnostics?.some(item=>item.id===evidence[0]));
  if(repeated&&specific&&['arguments','availability'].includes(group.focus))add('knowledge','D-K1','重复的调用约束',
    '同一具体调用约束或执行模式跨尝试重现，值得核对能否形成或更新复用方法。',
    ['共同的缺失字段、参数规则或执行边界','当时已收到的 AGENTS.md、工具说明、Skill 与注入','已有成功改法、适用条件及原说明是否应更新']);
  if(repeated&&group.focus==='guard'&&rows.some(r=>r.priorRead))add('knowledge','D-K3','保护条件反复失配',
    '部分调用此前已有成功读取，仍跨轮触发保护；可调查观测状态与操作流程如何失配。',
    ['读取与修改之间的版本、Agent 和作用域变化','工具当时给出的保护契约及已有指导','已验证的有效操作流程，避免追加同义提醒']);
  return signals;
}
