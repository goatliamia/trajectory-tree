export const evalTabs={home:'首页',skills:'Skill 管理',diagnosis:'诊断'};
export const diagnosisScopes={records:'执行记录',context:'加载项',window:'上下文窗口'};

// Keep previously shared window links while using a single diagnosis entry.
export function evalRoute(tab,scope){
  return {tab:tab==='window'?'diagnosis':Object.hasOwn(evalTabs,tab)?tab:'home',
    diagnosisScope:tab==='window'?'window':Object.hasOwn(diagnosisScopes,scope)?scope:'records'};
}
