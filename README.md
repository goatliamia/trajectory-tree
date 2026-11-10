<h1 align="center"><img src="docs/media/trajectory-tree-cover.png" alt="Trajectory Tree · 轨迹树"></h1>

<p align="center"><strong>从对话日志，看见 Agent 怎样工作。</strong></p>
<p align="center">轨迹树 · Eval · 点选诊断 · 可视化报告</p>

<p align="center">
  <a href="README.en.md">English</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="docs/host-entrypoints.md">宿主接入</a> ·
  <a href="LICENSE">MIT License</a>
</p>

<p align="center"><code>DSH</code> &nbsp; <code>Pi</code> &nbsp; <code>Codex</code> &nbsp; <code>Claude Code</code></p>

开发与审查：[PR 关系诊断与原生回归](docs/relation-ci.md)。

> 界面截图使用同一个公开合成会话。查看[素材说明](docs/media/README.md)。

## 轨迹树

从会话主线进入任意一轮，查看工具参数、返回、文件变化和上下文增量。

![执行路径：轮次主干、工具分支、文件变化与上下文增量](docs/media/trajectory-overview.jpg)

## Eval

Eval 和轨迹树共用轨迹数据。用真实任务里的记录对照轮次耗时与输出 token，查看哪些工具耗时多、哪些报错反复出现。可切换整段会话或某一轮；图表会标出统计覆盖范围。

![Eval：用散点图对照输出 token、轮次耗时和工具报错](docs/media/eval-overview.jpg)

## 点选诊断

在 DSH 轨迹树上长按选中对象，按住后拖动可圈选，也可单选上下文增量柱。Eval 从图表详情发起诊断，也可以查 DSH 工具声明的来源与调用。选好问题后，页面生成带会话、选区和取证入口的草稿，编辑确认后再发送。

![在 DSH 行动路径上选中一步，打开可编辑诊断草稿](docs/media/diagnosis-draft.jpg)

<details>
<summary>更多示例：上下文与诊断报告</summary>

- [上下文趋势](docs/media/context-trend.jpg)：按来源看保留量和每轮增减。
- [上下文装配动图](docs/media/context-assembly.gif)：回放追加、保留和历史改写。
- [诊断报告](docs/media/diagnostic-report.jpg)：AI 撰写判断与证据，组件将 Markdown 与图表装配成可交互 HTML。

</details>

## 快速开始

从仓库根目录操作。插件包自身声明 Node.js 18+，但 DSH 0.2.2 起的宿主需要 Node.js 24.9+；其他宿主的工具与独立视图需要 Node.js 20+。

<details>
<summary><strong>DSH · 原生插件与分析面板</strong></summary>

```sh
npm pack ./plugin/trajectory-tools
npm pack ./plugin/analysis-view
dsh plugin --profile web add ./dsh-trajectory-tools-0.6.5.tgz ./dsh-analysis-view-0.10.144.tgz
```

重启 `dsh web`，在会话里打开「评估」或用 `/trajectory` 打开轨迹树。选好诊断问题后，点「填入对话」把草稿追加到当前输入框。插件面向 DSH 0.2.2 系列，逐包核对见[兼容与语言说明](docs/host-compatibility.md#dsh-version)。

在路径总览中，点击目标线可查看对应目标。点击事件点可查看那次变更，并从详情进入对应轮次的行动路径或对话。

可另装 [对话搜索](plugin/conversation-search/README.md)，在右侧栏搜整段会话，按需加载更早的结果，点击可跳到对应轮次。DSH 的按需解读会调用当前模型。压缩后对账默认开启，可设 `config.reconcile: false` 关闭。

[分析面板](plugin/analysis-view/README.md) · [取证工具](plugin/trajectory-tools/README.md)

</details>

<details>
<summary><strong>Pi · 当前分支与原生命令</strong></summary>

```sh
npm ci --prefix plugin/portable-tools --ignore-scripts
pi -e ./plugin/portable-tools
```

使用 `/trajectory` 查看当前分支，或用 `/trajectory --eval` 打开 Eval。可复制 Pi 装填指令回终端；如果输入框已有草稿，可以复制提示词正文并自行合并。`trace-analysis` 分析会话过程，`context-profile` 查看当前上下文与工具配置。

[Pi 使用说明](plugin/portable-tools/README.md#pi)

</details>

<details>
<summary><strong>Codex · 插件、MCP 与独立视图</strong></summary>

```sh
npm ci --prefix plugin/portable-tools --ignore-scripts
node scripts/sync-host-skills.mjs
node scripts/package-trajectory.mjs --host codex
```

从本地插件目录安装 `dist/trajectory-tree-codex`。使用 `$trajectory-view` 打开轨迹树，`$trajectory-eval` 打开 Eval，或用 `$trace-analysis` 和 `$context-profile` 分析。Eval 草稿可复制回 Codex 输入框。

也可以直接生成当前会话视图；读取本机会话需要官方 `codex app-server`：

```sh
node scripts/trajectory-view.mjs --host codex --serve
```

从动作或文件历史打开「改动对比」，可以按文件查看记录中的增删行、原／新行号和原始补丁。

[插件入口](docs/host-entrypoints.md) · [Codex / MCP 配置](plugin/portable-tools/README.md#codex)

</details>

<details>
<summary><strong>Claude Code · 原生插件与 transcript</strong></summary>

```sh
npm ci --prefix plugin/portable-tools --ignore-scripts
node scripts/sync-host-skills.mjs
node scripts/package-trajectory.mjs --host claude
claude --plugin-dir ./dist/trajectory-tree-claude
```

使用 `/trajectory-tree:trajectory-view` 或 `/trajectory-tree:trajectory-eval` 打开视图，再把诊断草稿复制回 Claude Code。插件在会话启动、恢复等时机提供当前 transcript 路径。

[Claude Code 使用说明](plugin/claude/README.md)

</details>

### 离线生成视图

```sh
node scripts/trajectory-view.mjs --host pi --file /absolute/session.jsonl --open
node scripts/trajectory-view.mjs --host claude --file /absolute/transcript.jsonl --eval --lang zh-CN --open
```

生成过程不调用模型。命令返回独立 HTML 文件和本地预览地址；页面包含字体，可离线保存。

轨迹树、Eval 和诊断草稿默认跟随宿主或浏览器语言。可在轨迹树中切换“自动 / 中文 / English”，也可加 `--lang en` 或 `--lang zh-CN` 固定独立视图的语言。日志原文、路径和参数保持原样。各宿主的功能与证据边界见[兼容与语言说明](docs/host-compatibility.md)。

## 同一组取证工具

| 工具 | 用途 |
| --- | --- |
| `trajectory_inspect` | 查看过程、耗时、用量、反复尝试、工具文件和上下文统计 |
| `trajectory_search` | 定位会话、字面记录与统计范围 |
| `trajectory_read` | 查看原文、关联动作与反馈，分段追读完整参数和结果 |
| `trajectory_graph` | 查看记录关系与会话谱系 |

`trajectory_inspect` 可按结果筛选工具调用。下面按工具统计明确报错。将 `outcome` 改为 `abnormal` 也会纳入结果未确认的调用。

```json
{"view":"io","groupBy":"tool","outcome":"error","sort":"count"}
```

查询只读。各宿主按已有记录提供证据，不把未记录的内容补成事实。

| 宿主 | 主要数据来源 |
| --- | --- |
| DSH | 原生事件与官方统计投影、上下文构成、文件、Skill 和子代理记录 |
| Pi | 选中分支、当前 SDK 配置及采集到的工具执行时间 |
| Codex | 官方会话读取接口，以及对应线程的本地记录补充 |
| Claude Code | 明确选定的 transcript、原生工具参数与结果、已记录的消息用量 |

## 文档

- [仓库索引](docs/INDEX.md)——目录、文档导航与常用命令
- [宿主接入与命令](docs/host-entrypoints.md)
- [工具配置、查询与正文续读](plugin/portable-tools/README.md)
- [分析方法](skill/trace-analysis/SKILL.md) · [上下文与配置剖面](skill/context-profile/SKILL.md)
- [HTML 报告组件用法](report/AUTHORING.md)

<details>
<summary>开发与自检</summary>

```sh
node scripts/sync-host-skills.mjs --check
node scripts/sync-view-assets.mjs --check
npm test --prefix plugin/trajectory-tools
npm test --prefix plugin/portable-tools
node plugin/analysis-view/presentation-test.mjs
node plugin/analysis-view/perf-test.mjs
```

`plugin/` 提供宿主接入，`analyzers/` 处理原生记录，`view/` 与 `report/` 提供视图和报告组件。公开展示素材可由 `node scripts/build-readme-media.mjs --serve 3099` 重现。

</details>

## 许可证

[MIT](LICENSE) © 2026 goatliamia
