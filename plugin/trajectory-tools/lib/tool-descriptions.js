export const TOOL_DESCRIPTIONS = {
  trajectory_search: '定位会话或匹配的历史记录。',
  trajectory_inspect: '汇总一段会话的执行情况，返回统计和可追读的位置。',
  trajectory_read: '读取指定记录的原文，支持关联片段和长字段续读。',
  trajectory_graph: '查看记录间的关系或会话谱系。',
};

export const INSPECT_DESCRIPTIONS = {
  view: 'overview 过程总览（默认），latency 耗时，cost 用量和工具定义，repeats 同参候选，io 工具与文件，context 上下文记录。',
  outcome: '仅 io。error 筛报错，abnormal 也包含结果未确认的调用。省略时包含全部。',
  samples: '摘要是否附带原文摘录，默认 true。false 保留取证指针。',
};

export const CUT_DESCRIPTION = '图表给出的末尾记录序号（含）。';
