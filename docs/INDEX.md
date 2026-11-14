# 功能索引

Trajectory Tree 把 DSH、Pi、Codex 和 Claude Code 的会话记录组织成执行路径、Eval 和可复核的诊断证据。

| 模块 | 用途 | 入口与实现 |
| --- | --- | --- |
| 正式接入审查 | 收拢诊断装填职责，检查 Eval 转正、持久化缓存与跨宿主安装闭环 | [本轮设计与验收](release-review.md) |
| 模型取证入口 | 各宿主实际工具/CLI、已确认的接入缺口与统一配置查询设计 | [现状与工具设计](model-access-review.md) |
| 宿主接入 | 读取宿主原生记录并保留分支、事件定位和数据粒度 | [各宿主命令与打包](host-entrypoints.md) · [能力与语言](host-compatibility.md) · [适配器](../analyzers/) |
| 轨迹树 | 浏览行动路径、工具反馈、文件、目标和上下文变化 | [路径页](analysis-view-design.md) · [页面装配](../view/render.mjs) · [DSH 加载](../plugin/analysis-view/lib/trace-stages.js) |
| 单会话 Eval | 在同一切点查看轮次耗时、用量、工具和报错，按选区生成诊断草稿 | [统计口径](metric-framework.md) · [数据模型](../plugin/analysis-view/lib/eval/data.mjs) · [便携入口](../view/eval.mjs) |
| Eval 总览 | 按预设查看当前配置、Skill 使用、诊断和窗口表现；保留历史证据与跨重启缓存 | [总览入口](host-entrypoints.md#eval-总览) · [首页设计](eval-home.md) · [正式服务](../plugin/analysis-view/lib/eval/workspace-service.mjs) · [便携总览](../plugin/analysis-view/lib/eval/overview/) |
| 取证查询 | 从摘要下钻到原始记录、关联调用、文件或统计切点 | [DSH 工具](../plugin/trajectory-tools/README.md) · [便携 CLI / MCP / Pi](../plugin/portable-tools/README.md) · [字段](trajectory-fields.md) |
| 代码执行分析 | 在 Eval 单列命令与 PTC 失败信号、原代码、执行链和后续结果，按记录装填根因诊断 | [命令取证](host-entrypoints.md#命令诊断) · [代码执行方法](../skill/trace-analysis/references/code-execution.md) · [通用处置](../skill/trace-analysis/references/disposition.md) |
| 工具摘要与错误位置 | 共用增删行数、读取量和字符量；在详情定位报错行列与原因，保持 PTC 层级 | [口径、排版与性能](tool-feedback.md) · [共用实现](../lib/tool-feedback.mjs) |
| 诊断方法 | 把用户的关注点变成可执行的取证步骤，并给出可核查的改法 | [诊断入口与方法索引](diagnostic-prompts.md) · [过程诊断](../skill/trace-analysis/SKILL.md) · [静态剖面](../skill/context-profile/SKILL.md) |
| 诊断判定规则 | 识别反馈与执行层，直接生成四类处置线索；图、详情和装填共用依据与调查指南 | [规则与验收](diagnostic-rules.md) · [旧记录复核](diagnostic-rules.md#当前真实记录的基线) · [独立处置规则](../plugin/analysis-view/lib/eval/diagnostic-rules.mjs) |
| 上下文重合指标 | 在当前预设跨系统提示、项目指令、工具说明、Skill 与注入片段比较相同文本，展示原句、来源、加载位置与覆盖比例 | [指标口径与入口](context-overlap.md) · [分析器](../analyzers/context-overlap.mjs) |
| 注入来源研究 | 核对插件绑定入口、条件触发、实际消息与归属边界；包含 rc3 真实插件的隔离探针 | [机制与验证](injection-provenance-research.md) · [可复现探针](../scripts/probe-injection-hooks.mjs) |
| 加载项管理 | 右侧抽屉汇总 Skill 使用情况，按预设独立停用与恢复；工具、插件明确作用范围与缓存影响 | [交互与原生路径](capability-management.md) · [可撤回覆盖](capability-management.md#可撤回覆盖与原生清理) · [策略组件](../plugin/analysis-view/lib/skill-policy.js) |
| 报告 | 从 Eval 同切点指标组织结论、交叉分布、证据流程图与构成图，装配为独立 HTML | [Eval 数据与组件](../report/AUTHORING.md#使用-eval-指标) · [流程图](../report/flow.mjs) · [编写流程](report-authoring-workflow.md) · [渲染入口](../scripts/trajectory-report.mjs) |
| 测试与分发 | 检查关系、记录覆盖、浏览器交互及真实归档包入口 | [关系与回归](relation-ci.md) · [验收语料](../experiments/README.md#任务验收-eval) · [包验收](../scripts/test-trajectory-packages.mjs) |

[代码语义地图](code-map.md)记录入口、数据流和 CR 观察到的源码依赖。维护目标见[路线图](ROADMAP.md)，早期草案与实验结果见[历史归档](archive/README.md)。

## 构建与源码归属

| 路径 | 维护方式 |
| --- | --- |
| `plugin/analysis-view/lib/trace/page.html`、`page.js` 和轨迹模型 | [路径页移植脚本](../scripts/port-geist-page.mjs)使用 `docs/demo/layout-review/` 与 `view/assets/` |
| `plugin/analysis-view/lib/trace/shared/` | [共享资源脚本](../scripts/sync-view-assets.mjs)从 `lib/`、视图资源与查询工具同步 |
| `plugin/analysis-view/lib/eval/workspace/` | [Eval 同步脚本](../scripts/sync-eval-workspace.mjs)从页面源码及采集/分析模块生成安装资源 |
| 各宿主的诊断 skill | [Skill 同步脚本](../scripts/sync-host-skills.mjs)从 `skill/` 分发正文、资源和宿主元数据 |
| `dist/trajectory-tree-*` | [宿主打包脚本](../scripts/package-trajectory.mjs)按入口依赖和资源清单生成 |
| `.dsh/` 与 `report/out/` | 本地数据、检查和导出产物 |
