# Antigravity · 上下文与用量

Antigravity 的独立前端插件。在会话顶部的 `+` 菜单打开「上下文与用量」，查看最近请求的上下文来源、实报 Token、缓存及压缩切点。沿用轨迹树的七类内容和连续缩放矩阵，支持搜索、拖动、双击聚焦及按需读取正文。

此接入只提供侧栏页面，不注册模型工具、MCP、skill 或 `/ctx` 命令。完整轨迹树、Eval 和诊断工具仍由 [DSH、Pi、Codex 与 Claude Code 接入](../../docs/host-entrypoints.md)提供。

「趋势与对照」按用户发言划分轮次。虚线和向内的双箭头标记压缩，点选一轮即可在图下对照压缩前后输入，展开本轮请求。「工具 Eval」可按整段对话或单轮查看各工具的调用次数、宿主结果和执行耗时。

「用量总览」默认显示最近七个本地日历日，可筛选项目、时间与模式。子代理和派生会话的独立请求归入主对话。Token 圆环和模型生成速度在上方，下方热力图按主对话标题分页，每格显示该模型在所选时段占本对话的 Token 比例。点选格子可看模型内的模式占比及响应模型标识，勾选「细分模式」可跨对话对照。上方筛选模式时，热力图仍以本对话该时段的全部 Token 为分母。点选标题可查看主对话自身的轮次。

![各对话的模型用量热力图、Token 构成与输出速度](../../docs/media/antigravity-usage.jpg)

## 安装

本机需要 Node.js 24+，`sidecar_sdk` 由 Antigravity 提供。将 ZIP 中的 `trajectory-tree` 目录解压到 `~/.gemini/config/plugins/`，然后刷新插件。[下载 Antigravity 1.2.3 安装包](https://github.com/goatliamia/trajectory-tree/releases/download/v0.2.8/trajectory-tree-antigravity-1.2.3.zip)

也可以从仓库根目录运行安装脚本。

```sh
node scripts/install-antigravity.mjs
```

默认安装到 `~/.gemini/config/plugins/trajectory-tree`，在宿主刷新插件或重启后启用。也可以用 `--dest <plugin-directory>` 指定插件目录。安装器只复制前端运行文件；不写宿主配置或会话记录，不另外安装同名全局 sidecar。

旧开发版若曾单独复制到 `~/.gemini/config/sidecars/context_board` 或 `~/.gemini/config/skills/ctx`，这些是独立安装项。迁移时移除确认属于旧原型的副本，避免显示两个面板或继续加载旧 `/ctx`；安装器只清理目标插件目录内能确认来自本项目的旧 skill。

## 数据口径

| 显示 | 来源与含义 |
| --- | --- |
| 上下文矩阵 | `conversations/<id>.db` 的 `gen_metadata`：最近请求中的 `system_prompt`、`prompt_sections`、`tools` 与 `message_prompts` |
| 七类划分 | 沿用轨迹树分类；系统分段去重，Skill catalog 与实际读取的 Skill 正文有不同名称，工具结果按精确调用 ID 关联 |
| 面积与占比 | 可见来源文本的 Token 估算；不分摊实报输入，不计思考、签名、媒体和服务商封装 |
| 请求输入 | 宿主记录的 `input_tokens + cache_read_tokens + cache_write_tokens`，与来源文本估算分开显示；不表示窗口容量或占用率 |
| 窗口占用 | 同次请求的 `estimated_tokens_used / max_context_tokens`。缺少用量估算时采用该次实报请求输入，并标注口径。上限未记录时显示「—」 |
| 累计缓存命中 | 各请求的缓存读取量 / 累计请求输入；未记录时显示未知 |
| 跨对话累计 Token | 实报新增输入、缓存读取、缓存写入和输出之和；每个请求的已记录分项各计一次。优先使用原生请求库，缺少可读请求库时使用该对话的 transcript |
| 分叉与副本 | 有宿主响应标识的请求跨对话去重，优先归入父对话。缺少标识的旧记录按各自对话统计 |
| 输出速度 | 同时有实报输出和正数 `streaming_duration` 的请求，其输出 Token 之和除以流式生成秒数之和。页面显示计时样本数 |
| 首 Token 等待 | 对宿主记录的 `time_to_first_token` 取算术平均。各指标独立显示样本数，缺少计时时显示「—」 |
| 轮次趋势 | 每轮取最后一次请求的实报输入，峰值取全轮所有有用量的请求。净变化按相邻两个用户轮次的轮末输入计算，保留负值和缺失。无法归属到用户输入的请求单列为「未分轮」 |
| 运行模式 | High、Medium 和 Low 分别归入高、中、低强度。Orchestrator 请求统一归入协作模式，用实际响应模型标记调度或执行。其余显示名按原文保留，缺失值单列 |
| 工具 Eval | 原生执行步骤提供调用名、完成、报错和中止状态，耗时由同一步的开始和完成时间计算。只有 transcript 时显示声明的调用次数 |
| 原文 | 读取矩阵同版本、同会话的精确片段；快照更新后返回过期状态，不用另一个会话或截断预览冒充正文 |

当前宿主会裁掉旧请求的完整提示，保留最近请求的完整内容和历史请求用量。矩阵据此显示「最近请求」，不把最后一次响应和后续工具结果提前加入请求来源。完整提示缺失时，矩阵显示不可用；仍可显示 transcript 中已有的用量。宿主绑定会话时默认打开该会话；没有绑定时默认打开「用量总览」，可以点选对话进入详情。

单对话视图每 1.5 秒检查更新。用量总览首次打开时读取本机历史，之后每 15 秒检查一次文件版本，复用未变化对话的统计。页面隐藏后暂停。总览缓存只含请求标识、模型、计数和时长。单对话的正文快照最多保留四个，按需读取。

## 维护

```sh
node scripts/sync-antigravity.mjs
node scripts/sync-antigravity.mjs --check
node --test scripts/antigravity-test.mjs
```

`app.src.js` 与 `styles.base.css` 是侧栏源码。同步脚本从 `view/current-context/`、共用缩放组件及轨迹分类生成 `app.js`、`styles.css`、分类和字体；共享面板的运输适配有明确匹配校验，源代码变化时不会静默生成失效页面。`--build-only`（旧名 `--stage-only`）只构建，不写入用户插件目录。

本机验证结果与真实会话快照保存在忽略的 `.dsh/` 中，不随插件发布。字体使用 [SIL OFL 1.1](sidecars/context_board/fonts/LICENSE.txt)。
