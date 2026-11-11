---
name: trajectory-eval
description: 打开当前或指定 Claude Code 会话的 Eval，查看统计和原文证据，再选择要诊断的问题。
disable-model-invocation: true
---

使用命令参数或用户明确指定的 transcript，默认使用 SessionStart 绑定提供的当前 `transcript_path`。没有路径时，请用户提供文件。

用 Node 运行 `"${CLAUDE_PLUGIN_ROOT}/scripts/trajectory-view.mjs" --host claude --file "<transcript_path>" --eval --open`，把返回的本地 `url` 提供给用户。

用户要项目总览时，改用 `--host claude --overview --dir "<transcript 所在目录>" --open`。也可以重复 `--file` 选定记录。用 `--lang en` 或 `--lang zh-CN` 固定界面语言。

用户指定代码执行、PowerShell 或 PTC 报错时，用 `--code` 替代 `--eval`，直接进入同一 transcript 的代码执行分析。运行指标、代码执行与处理线索共用同一切点。

在 Eval 里选择范围和指标，将整段诊断草稿贴回 Claude Code 提示框，确认范围后发送。草稿已带 `/trajectory-tree:trace-analysis`。取证时使用草稿中的 transcript 路径并保留 `cut` 和 `logId`。如果工具无法校验原切点，重新打开同一 transcript 的 Eval 获取选区。

统计以选定 transcript 为范围。工具结果按调用 ID 配对，消息用量按消息 ID 去重。任务完成、真实副作用和恢复质量需要结合用户要求、工具结果与验收证据判断。
