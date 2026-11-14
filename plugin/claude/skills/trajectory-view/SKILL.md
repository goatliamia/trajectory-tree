---
name: trajectory-view
description: 生成并打开当前或指定 Claude Code 会话的轨迹树、Eval、项目总览或代码执行视图。
---

用 Node 运行本目录相对路径 `../../../../scripts/trajectory-view.mjs --host claude --file <transcript_path> --serve`，将返回的 `url` 打开到浏览器。当前会话使用 SessionStart 绑定提供的 transcript_path；分析其他会话时使用明确指定的文件。

按用户请求选择生成内容：默认轨迹树，`--eval` 打开会话 Eval，`--code` 直接进入 Eval 的代码执行分析。项目总览使用 `--overview --dir "<transcript 所在目录>"`，或用 `--overview` 配合重复的 `--file` 选择会话。一次只选一种；保留选中 transcript 的来源，随后从页面点选进入原诊断流程。

The interface automatically follows the browser language. Add `--lang en` or `--lang zh-CN` only when a language is explicitly requested; `--lang auto` restores automatic selection. Preserve the language of the source conversation.

轨迹图长按或聚焦对象后按 Shift+Enter 可选取诊断，填写问题后复制草稿。取证沿同一 transcript、cut 和 logId。受管终端会回收后台进程时，加 `--keep-alive` 并保留执行会话。
