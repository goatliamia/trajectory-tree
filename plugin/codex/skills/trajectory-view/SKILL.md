---
name: trajectory-view
description: 生成并打开当前或指定 Codex 会话的轨迹树、Eval、项目总览或代码执行视图。
---

用 Node 运行本目录相对路径 `../../../../scripts/trajectory-view.mjs --host codex --serve`，把返回的 `url` 打开到浏览器或预览面板。默认当前会话，指定其他会话时加 `--thread ID`。

按用户请求选择生成内容：默认轨迹树，`--eval` 打开会话 Eval，`--overview` 打开当前项目总览，`--code` 直接进入 Eval 的代码执行分析。一次只选一种。总览可以加 `--project PATH`，或重复 `--thread ID`、`--file SNAPSHOT` 选定来源；这些入口沿用同一数据和诊断流程。

The interface automatically follows the browser language. Add `--lang en` or `--lang zh-CN` only when a language is explicitly requested; `--lang auto` restores automatic selection. Preserve the language of the source conversation.
