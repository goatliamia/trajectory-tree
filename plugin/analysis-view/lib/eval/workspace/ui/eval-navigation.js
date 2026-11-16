import {ui as __ttUi} from "./ui-locale.js";
export const evalTabs={home:__ttUi('首页'),skills:__ttUi('Skill 管理'),diagnosis:__ttUi('诊断')};
export const diagnosisScopes={records:__ttUi('执行记录'),context:__ttUi('加载项'),window:__ttUi('上下文窗口')};

// Keep previously shared window links while using a single diagnosis entry.
export function evalRoute(tab,scope){
  return {tab:tab==='window'?'diagnosis':Object.hasOwn(evalTabs,tab)?tab:'home',
    diagnosisScope:tab==='window'?'window':Object.hasOwn(diagnosisScopes,scope)?scope:'records'};
}
