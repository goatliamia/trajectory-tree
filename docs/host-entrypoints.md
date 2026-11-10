# 宿主入口与分发

视图生成是确定性代码，不调用模型；报告由模型使用取证方法撰写，再交给组件渲染。

| 宿主 | 查看会话 | Eval | 过程诊断 | 静态剖面 |
| --- | --- | --- | --- | --- |
| Codex | `$trajectory-view` | `$trajectory-eval` | `$trace-analysis` | `$context-profile` |
| Pi | `/trajectory` | `/trajectory --eval` | Pi 版 `trace-analysis` skill | Pi 版 `context-profile` skill |
| Claude Code | `/trajectory-tree:trajectory-view` | `/trajectory-tree:trajectory-eval` | `/trajectory-tree:trace-analysis` | `/trajectory-tree:context-profile` |
| DSH Web | `/trajectory` | 会话「评估」标签 | `trace-analysis` | `context-profile` |

## Eval 总览

| 宿主 | 入口 | 数据范围 |
| --- | --- | --- |
| DSH Web | 左侧栏「Eval 总览」 | 已登记工作区中的会话，略过归档会话和分叉继承的历史 |
| Pi | `/trajectory --overview` | 当前所选分支和同一会话目录中的近期会话 |
| Codex | `$trajectory-eval` 请求项目总览，或 `--host codex --overview` | App Server 当前目录的近期会话。用 `--project PATH` 或重复 `--thread ID` / `--file SNAPSHOT` 选范围 |
| Claude Code | `/trajectory-tree:trajectory-eval` 请求项目总览，或 `--host claude --overview --dir PATH` | 绑定 transcript 的同目录，或重复 `--file` 选择 transcript |

目录和项目查询默认选最近 20 段，可用 `--limit 1..100` 调整。用 `--lang en` 或 `--lang zh-CN` 固定语言。总览以有结果的工具调用为报错分母。便携端按实际输入量比较，在请求同时有窗口容量时可改按占用率分档。

Codex 项目查询遇到历史读取超时时，会保留已读会话并在总览标出未读取数量。已有的会话快照可用 `--file SNAPSHOT` 加入对照。

Codex 使用官方推荐的 skills 入口，不新增已弃用的 custom prompt slash 文件。插件包使用根 `plugin.json`，从根 `skills/` 发现 skill；本地 marketplace 指向生成后的 Codex 包，不指向含私有日志的整个工作目录。它是本地可安装包，尚未提交公共插件目录。

## 命令诊断

DSH、Codex、Pi 和 Claude Code 的工具明细及 Eval 概览会按记录到的运行证据归因。宿主结果用于统计调用和报错，归因单独展示。组合脚本里的候选原因留在样本中。查询工具的逐次 I/O 数据也带有归因和关联记录。

```sh
node scripts/trajectory-view.mjs --host codex --eval --cr-root "<parser checkout>" --open
node scripts/trajectory-query.mjs --host codex --tool trajectory_command_diagnose --cr-root "<parser checkout>" --request args.json
```

`--cr-root` 指向包含 `code_relations/providers/pwsh_syntax.ps1` 的目录，也可为宿主进程配置 `TRAJECTORY_CR_ROOT`。补查按已记录的 PowerShell 类型选择 Windows PowerShell 5.1 或 PowerShell 7，可用 `--pwsh PATH` 或 `TRAJECTORY_CR_PWSH` 指定本机解析器。每批最多解析 12 条原始脚本。Codex 从匹配的 rollout 取原始 `-Command`，Pi、Claude Code 和 DSH 从可确认的 PowerShell 调用参数取脚本。

Eval 和总览按所选范围内的已记录报错统计归因，分开计入已归因、候选原因、待定位和无文字返回。四个宿主共用归因规则，实际覆盖随任务与日志字段而变化。可选脚本解析为样例补充位置和候选原因。

Codex、Pi 和 Claude Code 的 CLI 及专用 MCP 连接支持 `trajectory_command_diagnose`。CLI 用 `--tool schema --commands` 查看参数。Codex 的 `--commands` 仍可打开独立的调试页。 [配置示例](../plugin/portable-tools/README.md#命令诊断)

## 方法来源

过程诊断和静态剖面的源文件在 `skill/trace-analysis` 和 `skill/context-profile`。综合诊断直接放在 `trace-analysis/SKILL.md`，专项方法按问题读取。工具返回统计、记录与原文位置。`ENTRY_PROMPTS.process/profile` 保留调用相应 skill 的请求文本。 [诊断方法索引](diagnostic-prompts.md)

`node scripts/sync-host-skills.mjs` 生成各宿主方法 skill；`--check` 检查同步状态。Codex 和 Claude Code 只补充各自 CLI 路径与会话来源，Pi 使用已注册的工具；工具声明由 CLI 的 `--tool schema` 读取。项目自身的 `.agents/skills` 保留通用分析方法。

DSH 在本项目优先读取 `.dsh/skills`，其中的 `description` 写用途，`whenToUse` 写适用时机。插件通过 `ctx.skills.register` 提供同一份元数据和资源目录，供其他项目使用。Codex、Pi 和 Claude Code 从共用正文生成各自的 `SKILL.md`。工具的用途在工具简介里，默认值与使用条件在参数声明里。

## 构建

```sh
node scripts/sync-host-skills.mjs
node scripts/package-trajectory.mjs --host codex
node scripts/package-trajectory.mjs --host pi
node scripts/package-trajectory.mjs --host claude
```

包分别位于 `dist/trajectory-tree-codex`、`dist/trajectory-tree-pi` 和 `dist/trajectory-tree-claude`，包含脚本、字体、组件与所需的 TypeBox 依赖。来源清单及内容哈希在各包的 `bundle-manifest.json`。

用 `npm pack <包目录> --pack-destination <输出目录>` 生成归档。将三个便携包和 DSH 的 `plugin/trajectory-tools`、`plugin/analysis-view` 两个包放在同一输出目录，可用 `node scripts/test-trajectory-packages.mjs --dir <输出目录>` 验证解包后的入口。

Codex：构建后刷新或重启客户端，在 Plugins Directory 选择 `Trajectory Tree 本地插件` 源并安装。缺少当前会话 ID 时生成器要求明确的 `--thread`，不改选最近会话。

Pi：`pi -e ./dist/trajectory-tree-pi`。`/trajectory` 从 SessionManager 读取选定分支及当前作用域，生成后打开系统浏览器；`--no-open` 返回链接。没有向会话发送额外分析提示词。

Claude Code：`claude --plugin-dir ./dist/trajectory-tree-claude`。原生 `SessionStart` hook 在启动、恢复、清空、压缩或 fork 时提供当前 `session_id` 与 `transcript_path`，不在每轮提示重复注入；CLI 显式读取该文件。支持可见消息、工具参数与结果及已记录用量，详情见 [Claude 插件](../plugin/claude/README.md)。

在 DSH 里，`/trajectory` 打开当前会话的轨迹树，「评估」使用同一数据管线。两种视图都能生成诊断草稿并填入对话。共享资源由 `node scripts/sync-view-assets.mjs` 生成，打包前自动同步。取证插件附带两项诊断 skill 及其引用资源。在插件管理中打开「轨迹树」可调整右栏搜索和视图默认值。 [视图插件设置](../plugin/analysis-view/README.md#插件设置)

## 运行与资源

```sh
node scripts/trajectory-view.mjs --host codex --serve
node scripts/trajectory-view.mjs --host pi --file session.jsonl --open
```

独立视图文件包含字体；本地服务只绑定 127.0.0.1，只暴露随机路径对应的一个生成文件，不监听历史变化。同一输出文件复用服务，闲置 15 分钟或总运行 1 小时后关闭。生成器不会调用模型或修改原会话。

报告核心一同封装。`trajectory-report` 的 query/prepare 可使用 `--host codex` 或 `--host pi --file ...`；DSH 沿用宿主连接。AI 选证据、写 Markdown、声明组件，渲染器装配 HTML。

参考：OpenAI [插件打包](https://developers.openai.com/plugins/build/plugins)、[Skills](https://learn.chatgpt.com/docs/build-skills)；Pi [扩展命令](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。DSH 使用本机 0.2.2-alpha.2 的 commandUi 与 SkillRegistry 类型定义核对。
