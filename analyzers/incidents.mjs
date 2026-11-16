// Analyzer: incidents (v2) — recorded signals with evidence anchors.
// Same serialized call arguments, marked error results, or turns without
// recorded calls/messages do not determine task impact or a required action.
//
// 形状来自唯一一份声明(issue #6):plugin/analysis-view/lib/incident-shape.js。
// 位置是反的(仓库脚本 import 包里的文件),因为运行期 import 不到仓库脚本 —— 声明必须跟着包走。
import {computeIncidents} from '../plugin/analysis-view/lib/incident-facts.js';

export const incidents = {
  id: 'incidents',
  version: 2,
  definition: '从当前记录检测连续同参调用、工具错误结果、无调用或助手消息记录的轮次；影响与处置另行核对。',
  events: ['turn/start', 'assistant/message', 'tool/call', 'tool/result'],
  misjudge: '重复调用可能是轮询；错误后可能换路径完成；缺少事件可能涉及运行中、中止或读取边界。不得直接推断冗余、目标失败或未推进。',
  run(events) { return computeIncidents(events); },
  // 表格摘要随 analyzer 自带(issue #4):空表也不能是空单元格
  summary(f) {
    const list = f.incidents || [];
    if (list.length === 0) return '0 incidents';
    const byType = {};
    for (const inc of list) byType[inc.type] = (byType[inc.type] || 0) + 1;
    const noun = f.incidentCount === 1 ? 'incident' : 'incidents';
    return `${f.incidentCount} ${noun}: ` + Object.entries(byType).map(([type, n]) => `${type}×${n}`).join(', ');
  }
};
