# 功能索引

Trajectory Tree 把 DSH、Pi、Codex 和 Claude Code 的会话记录组织成执行路径、Eval 和可复核的诊断证据。

| 模块 | 用途 | 入口与实现 |
| --- | --- | --- |
| 宿主接入 | 读取宿主原生记录并保留分支、事件定位和数据粒度 | [各宿主命令与打包](host-entrypoints.md) · [能力与语言](host-compatibility.md) · [适配器](../analyzers/) |
| 轨迹树 | 浏览行动路径、工具反馈、文件、目标和上下文变化 | [路径页](analysis-view-design.md) · [页面装配](../view/render.mjs) · [DSH 加载](../plugin/analysis-view/lib/trace-stages.js) |
| 单会话 Eval | 在同一切点查看轮次耗时、用量、工具和报错，按选区生成诊断草稿 | [统计口径](metric-framework.md) · [数据模型](../plugin/analysis-view/lib/eval/data.mjs) · [便携入口](../view/eval.mjs) |
| Eval 总览 | 按项目汇总会话、对照模型与窗口指标，汇集程序归纳的诊断线索；具体调查交给 Agent | [总览入口](host-entrypoints.md#eval-总览) · [信号规则](../plugin/analysis-view/lib/eval/findings.mjs) · [共用页面](../plugin/analysis-view/lib/eval/overview/) |
| 取证查询 | 从摘要下钻到原始记录、关联调用、文件或统计切点 | [DSH 工具](../plugin/trajectory-tools/README.md) · [便携 CLI / MCP / Pi](../plugin/portable-tools/README.md) · [字段](trajectory-fields.md) |
| 代码执行分析 | 在 Eval 单列命令与 PTC 失败信号、原代码、执行链和后续结果，按记录装填根因诊断 | [命令取证](host-entrypoints.md#命令诊断) · [代码执行方法](../skill/trace-analysis/references/code-execution.md) · [通用处置](../skill/trace-analysis/references/disposition.md) |
| 诊断方法 | 把用户的关注点变成可执行的取证步骤，并给出可核查的改法 | [诊断入口与方法索引](diagnostic-prompts.md) · [过程诊断](../skill/trace-analysis/SKILL.md) · [静态剖面](../skill/context-profile/SKILL.md) |
| 报告 | 从 Eval 同切点指标组织结论、交叉分布、证据流程图与构成图，装配为独立 HTML | [Eval 数据与组件](../report/AUTHORING.md#使用-eval-指标) · [流程图](../report/flow.mjs) · [编写流程](report-authoring-workflow.md) · [渲染入口](../scripts/trajectory-report.mjs) |
| 测试与分发 | 检查关系、记录覆盖、浏览器交互及真实归档包入口 | [关系与回归](relation-ci.md) · [验收语料](../experiments/README.md#任务验收-eval) · [包验收](../scripts/test-trajectory-packages.mjs) |

[代码语义地图](code-map.md)记录入口、数据流和 CR 观察到的源码依赖。维护目标见[路线图](ROADMAP.md)，早期草案与实验结果见[历史归档](archive/README.md)。

## 构建与源码归属

| 路径 | 维护方式 |
| --- | --- |
| `plugin/analysis-view/lib/trace/page.html`、`page.js` 和轨迹模型 | [路径页移植脚本](../scripts/port-geist-page.mjs)使用 `docs/demo/layout-review/` 与 `view/assets/` |
| `plugin/analysis-view/lib/trace/shared/` | [共享资源脚本](../scripts/sync-view-assets.mjs)从 `lib/`、视图资源与查询工具同步 |
| 各宿主的诊断 skill | [Skill 同步脚本](../scripts/sync-host-skills.mjs)从 `skill/` 分发正文、资源和宿主元数据 |
| `dist/trajectory-tree-*` | [宿主打包脚本](../scripts/package-trajectory.mjs)按入口依赖和资源清单生成 |
| `.dsh/` 与 `report/out/` | 本地数据、检查和导出产物 |
