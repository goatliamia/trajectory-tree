# 宿主入口与分发

视图生成是确定性代码，不调用模型；报告由模型使用取证方法撰写，再交给组件渲染。

Pi 的 `/trajectory`、Codex 的 `$trajectory-view` / `$trajectory-eval` 和 Claude Code 对应的 view / eval 命令均支持选择会话 Eval、项目总览或代码执行。Pi 用 `--eval`、`--overview`、`--code`；另两宿主将同一选项传给随包生成器。DSH 使用常驻面板，不新增生成图的 skill。

| 宿主 | 查看会话 | Eval | 过程诊断 | 静态剖面 |
| --- | --- | --- | --- | --- |
| Codex | `$trajectory-view` | `$trajectory-eval` | `$trace-analysis` | `$context-profile` |
| Pi | `/trajectory` | `/trajectory --eval` | Pi 版 `trace-analysis` skill | Pi 版 `context-profile` skill |
| Claude Code | `/trajectory-tree:trajectory-view` | `/trajectory-tree:trajectory-eval` | `/trajectory-tree:trace-analysis` | `/trajectory-tree:context-profile` |
| DSH Web | `/trajectory` | 会话「评估」标签 | `trace-analysis` | `context-profile` |

## Eval 总览

总览只保留跨会话统计，原先内置的「单会话」页已移除。单会话继续使用原 Eval 面板。两处共用程序信号归组规则，并随项目、时间、模型或轮次筛选更新；处置列表示可调查方向，不表示已经修复或需要保存长期知识。具体判断从选区草稿进入 `trace-analysis`，保留各来源的 session、cut 和便携宿主 logId。全局的跨会话草稿分别列出每段来源的查询；便携快照不假定绑定当前活动会话。

DSH 首批会话到达后即显示图表，余下记录分批补齐；页眉保留已读进度，读取中断会保留已读部分。缓存命中不等待大日志队列；原始日志仍经过单个低优先级队列，关闭页面会取消未完成工作。分叉去重、切点校验和统计口径保持一致。

新版 DSH Eval 将当前预设首页、Skill 管理、执行记录/加载项诊断和上下文窗口放在同一入口。当前工作区可以切换；后台统计保留读取进度。会话摘要有跨重启缓存，页面不再访问后暂停尚未完成的读取。加载项与执行记录的诊断共用可编辑草稿和目标对话选择，原生接口回执成功后才显示已填入。

| 宿主 | 入口 | 数据范围 |
| --- | --- | --- |
| DSH Web | 左侧栏「Eval 总览」 | 已登记工作区中的会话，略过归档会话和分叉继承的历史 |
| Pi | `/trajectory --overview` | 当前所选分支和同一会话目录中的近期会话 |
| Codex | `$trajectory-eval` 请求项目总览，或 `--host codex --overview` | App Server 当前目录的近期会话。用 `--project PATH` 或重复 `--thread ID` / `--file SNAPSHOT` 选范围 |
| Claude Code | `/trajectory-tree:trajectory-eval` 请求项目总览，或 `--host claude --overview --dir PATH` | 绑定 transcript 的同目录，或重复 `--file` 选择 transcript |

目录和项目查询默认选最近 20 段，可用 `--limit 1..100` 调整。用 `--lang en` 或 `--lang zh-CN` 固定语言。总览以有结果的工具调用为报错分母。便携端按实际输入量比较，在请求同时有窗口容量时可改按占用率分档。

Codex 项目查询遇到历史读取超时时，会保留已读会话并在总览标出未读取数量。已有的会话快照可用 `--file SNAPSHOT` 加入对照。

Codex 使用官方推荐的 skills 入口，不新增已弃用的 custom prompt slash 文件。插件包使用根 `plugin.json`，从根 `skills/` 发现 skill；本地 marketplace 指向生成后的 Codex 包，不指向含私有日志的整个工作目录。它是本地可安装包，尚未提交公共插件目录。

Codex `0.2.4` 插件还携带根 `mcp.json` 和本地 stdio MCP：四个取证工具，以及 `trajectory_view(session, view, language)`。后者直接生成轨迹树、会话 Eval 或代码执行页并返回本机链接，由浏览器或 Codex 预览面板展示。服务不绑定启动它的旧对话；列出会话时明确传工作目录。已验证工具调用与出图，未把 ChatGPT 的 MCP 内嵌 UI 支持推定为 Codex 同样支持。官方依据：[本地 MCP 插件](https://developers.openai.com/plugins/deploy/desktop-only)、[可选 UI 的宿主边界](https://developers.openai.com/plugins/build/chatgpt-ui)。

## 命令诊断

Eval 顶部「代码执行」进入独立分析区，与运行指标共用统计范围和切点。可以按执行器、失败信号及调用筛选，检查原始脚本或宿主记录的命令、反馈和记录位置，以及 PTC 父子调用关系。选择「诊断这次」或「分析这组」生成已有取证入口的草稿，沿原文调查根因与后续处理。

便携生成器加 `--code` 可直接进入这一分析区，例如 `node scripts/trajectory-view.mjs --host codex --code --serve`；Pi 和 Claude Code 使用各自原来的来源参数。它生成同一份 Eval，不另建一套统计。

DSH、Codex、Pi 和 Claude Code 的工具明细及 Eval 概览会按记录到的运行证据归因。宿主结果用于统计调用和报错，归因单独展示。组合脚本里的候选原因留在样本中。查询工具的逐次 I/O 数据也带有归因和关联记录。

PTC `run_code` 的原生运行时 kind 单独解析，区分程序异常、预算到期、中止、执行环境退出、输出契约与上限、协议和沙箱建立失败。父子调用属于同一次执行，不单凭这一关系判定传播原因。分组表示相同失败信号，具体根因与任务影响由诊断结合代码、环境和后续记录确认。

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

在会回收后台子进程的受管终端中，加 `--keep-alive` 保留当前执行会话作为预览服务。链接实际可打开后再交付，不能只以生成命令返回 URL 为准。

独立视图文件包含字体；本地服务只绑定 127.0.0.1，只暴露随机路径对应的一个生成文件，不监听历史变化。同一输出文件复用服务，闲置 15 分钟或总运行 1 小时后关闭。生成器不会调用模型或修改原会话。

报告核心一同封装。`trajectory-report` 的 query/prepare 可使用 `--host codex` 或 `--host pi --file ...`；DSH 沿用宿主连接。AI 选证据、写 Markdown、声明组件，渲染器装配 HTML。

参考：OpenAI [插件打包](https://developers.openai.com/plugins/build/plugins)、[Skills](https://learn.chatgpt.com/docs/build-skills)；Pi [扩展命令](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。DSH 使用本机 0.2.2-alpha.2 的 commandUi 与 SkillRegistry 类型定义核对。
