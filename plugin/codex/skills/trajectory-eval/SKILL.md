---
name: trajectory-eval
description: 打开当前或指定 Codex 会话的 Eval 图表，按轮次检查有记录的用量、耗时和工具结果。
---

优先调用插件的 `trajectory_view`，指定 `session` 和 `view: "eval"`（代码执行用 `"code"`），把返回的 `url` 打开到浏览器或预览面板。当前对话 ID 从 `CODEX_THREAD_ID` 读取。

工具尚未连接时，用 Node 运行本目录相对路径 `../../../../scripts/trajectory-view.mjs --host codex --eval --serve`。指定其他会话时加 `--thread ID`，已捕获会话加 `--file SNAPSHOT`。

用户要项目总览时，改用 `--host codex --overview --serve`。默认按当前目录读取最近的项目会话，可用 `--project PATH` 或重复 `--thread ID`、`--file SNAPSHOT` 选定范围。用 `--lang en` 或 `--lang zh-CN` 固定界面语言。

用户指定代码执行、PowerShell 或 PTC 报错时，用 `--code` 替代 `--eval`，直接进入同一会话 Eval 的代码执行分析。运行指标、代码执行与处理线索共用同一切点。

从图表详情选择要诊断的轮次、工具或报错，复制草稿回 Codex 输入框，确认范围后发送。用随包的 `trajectory-query.mjs` 或已配置的轨迹 MCP 执行草稿里的查询，保留其中的 `cut` 和 `logId`。如果图表来自手动捕获的快照，CLI 取证也使用同一个 `--file` 和 `--rollout`（如有）。
