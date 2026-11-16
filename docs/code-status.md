# 代码状态

<!-- 由 scripts/code-status.mjs 生成，请勿手改。 -->

快照：2026-11-16 · 提交 `c55ab07`

源码面：392 个文件 · 48,009 行 · 11,372 个函数或方法

依赖：670 对文件级值依赖 · 37 组跨模块方向 · 12 组模块内部方向

复杂度：圈复杂度合计 40,717，其中手写部分 27,257 · 中位数 1 · 最高 190

## 模块

| 模块 | 文件 | 行 | 函数 | 圈复杂度 | 单文件最高 | 扇入 | 扇出 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `plugin/analysis-view` | 132 | 22,275 | 5,452 | 19,548 | 4,217 | 106 | 70 |
| `docs/demo/layout-review` | 44 | 5,539 | 1,518 | 4,850 | 349 | 4 | 7 |
| `scripts` | 67 | 4,092 | 807 | 2,069 | 153 | 12 | 46 |
| `plugin/trajectory-tools` | 20 | 3,790 | 608 | 2,901 | 613 | 19 | 7 |
| `analyzers` | 34 | 3,428 | 779 | 3,445 | 462 | 29 | 19 |
| `lib` | 18 | 2,212 | 161 | 666 | 200 | 18 | 5 |
| `docs/demo/preset-context` | 24 | 1,890 | 829 | 3,012 | 407 | 22 | 12 |
| `view` | 14 | 1,619 | 343 | 1,078 | 242 | 7 | 6 |
| `report` | 16 | 1,609 | 520 | 1,820 | 350 | 14 | 13 |
| `plugin/portable-tools` | 11 | 1,018 | 290 | 1,109 | 308 | 10 | 10 |
| `experiments` | 7 | 443 | 54 | 181 | 91 | 2 | 3 |
| `design` | 1 | 45 | 5 | 19 | 19 | 1 | 0 |
| `plugin/codex` | 2 | 32 | 6 | 19 | 14 | 1 | 2 |
| `plugin/claude` | 1 | 11 | 0 | 0 | 0 | 0 | 0 |
| `skill` | 1 | 6 | 0 | 0 | 0 | 1 | 0 |
| **合计** | **392** | **48,009** | **11,372** | **40,717** | | | |

扇入、扇出按文件计：模块内至少有一个文件被别的文件依赖，或被依赖，就计一次。

轨迹页及模型/共享资源、Eval workspace 与当前上下文安装资源是生成副本，计入发行体量，但不进手写函数与文件排名。正式 UI 的 `docs/demo/layout-review/` 与 `docs/demo/preset-context/` 源码参与排名。

## 模块依赖

```mermaid
graph LR
  m_plugin_analysis_view["plugin/analysis-view<br/>132 文件"]
  m_docs_demo_layout_review["docs/demo/layout-review<br/>44 文件"]
  m_scripts["scripts<br/>67 文件"]
  m_plugin_trajectory_tools["plugin/trajectory-tools<br/>20 文件"]
  m_analyzers["analyzers<br/>34 文件"]
  m_lib["lib<br/>18 文件"]
  m_docs_demo_preset_context["docs/demo/preset-context<br/>24 文件"]
  m_view["view<br/>14 文件"]
  m_report["report<br/>16 文件"]
  m_plugin_portable_tools["plugin/portable-tools<br/>11 文件"]
  m_experiments["experiments<br/>7 文件"]
  m_design["design<br/>1 文件"]
  m_plugin_codex["plugin/codex<br/>2 文件"]
  m_plugin_claude["plugin/claude<br/>1 文件"]
  m_skill["skill<br/>1 文件"]
  m_scripts -->|53| m_plugin_analysis_view
  m_scripts -->|30| m_analyzers
  m_scripts -->|14| m_report
  m_scripts -->|13| m_lib
  m_scripts -->|12| m_view
  m_view -->|11| m_plugin_analysis_view
  m_analyzers -->|10| m_lib
  m_plugin_portable_tools -->|10| m_analyzers
  m_plugin_portable_tools -->|10| m_plugin_trajectory_tools
  m_scripts -->|9| m_plugin_trajectory_tools
  m_view -->|9| m_plugin_portable_tools
  m_analyzers -->|8| m_plugin_analysis_view
  m_scripts -->|7| m_plugin_portable_tools
  m_scripts -->|7| m_design
  m_report -->|6| m_lib
  m_view -->|6| m_lib
  m_lib -->|6| m_analyzers
  m_view -->|6| m_analyzers
  m_docs_demo_layout_review -->|6| m_lib
  m_scripts -->|5| m_docs_demo_layout_review
  m_scripts -->|5| m_experiments
  m_plugin_portable_tools -->|5| m_view
  m_analyzers -->|4| m_plugin_trajectory_tools
  m_report -->|4| m_design
  m_report -->|4| m_plugin_trajectory_tools
  m_plugin_codex -->|4| m_plugin_portable_tools
  m_plugin_codex -->|4| m_view
  m_report -->|3| m_plugin_analysis_view
  m_plugin_portable_tools -->|2| m_lib
  m_plugin_portable_tools -->|2| m_plugin_analysis_view
  m_experiments -->|2| m_plugin_trajectory_tools
  m_lib -->|2| m_scripts
  m_scripts -->|2| m_skill
```

图上画 33 组至少两对文件的跨模块依赖；下表按文件对列出前 12 组。

另有 4 组只有一对文件，未画入图：`lib → plugin/trajectory-tools`、`plugin/analysis-view → lib`、`lib → plugin/analysis-view`、`analyzers → experiments`。

| 依赖 | 文件对 | 见证 | 例子 |
| --- | ---: | ---: | --- |
| `scripts` → `plugin/analysis-view` | 53 | 334 | `scripts/build-readme-media.mjs → plugin/analysis-view/lib/index.js`；`scripts/build-readme-media.mjs → plugin/analysis-view/lib/trace/fonts.mjs` |
| `scripts` → `analyzers` | 30 | 320 | `scripts/build-readme-media.mjs → analyzers/pi-sample.mjs`；`scripts/dsh-management-config.mjs → analyzers/preset-current.mjs` |
| `scripts` → `report` | 14 | 64 | `scripts/build-readme-media.mjs → report/compile.mjs`；`scripts/build-readme-media.mjs → report/render.mjs` |
| `scripts` → `lib` | 13 | 54 | `scripts/dsh-management.mjs → lib/dsh-skill-catalog.mjs`；`scripts/dsh-management.mjs → lib/lifecycle-observation.mjs` |
| `scripts` → `view` | 12 | 44 | `scripts/build-readme-media.mjs → view/render.mjs`；`scripts/trajectory-report.mjs → view/eval.mjs` |
| `view` → `plugin/analysis-view` | 11 | 58 | `view/render.mjs → plugin/analysis-view/lib/eval/render.mjs`；`view/render.mjs → plugin/analysis-view/lib/trace/fonts.mjs` |
| `analyzers` → `lib` | 10 | 58 | `analyzers/claude-reader.mjs → lib/bounded-file.mjs`；`analyzers/codex-adapter.mjs → lib/tool-behavior.mjs` |
| `plugin/portable-tools` → `analyzers` | 10 | 112 | `plugin/portable-tools/sources.mjs → analyzers/claude-adapter.mjs`；`plugin/portable-tools/sources.mjs → analyzers/claude-reader.mjs` |
| `plugin/portable-tools` → `plugin/trajectory-tools` | 10 | 64 | `plugin/portable-tools/sources.mjs → plugin/trajectory-tools/lib/tool-attribution.js`；`plugin/portable-tools/analysis.mjs → plugin/trajectory-tools/lib/io-outcome.js` |
| `scripts` → `plugin/trajectory-tools` | 9 | 34 | `scripts/report-fixture-source.mjs → plugin/trajectory-tools/lib/index.js`；`scripts/sync-diagnostic-prompts.mjs → plugin/trajectory-tools/lib/diagnostic-prompts.js` |
| `view` → `plugin/portable-tools` | 9 | 48 | `view/eval.mjs → plugin/portable-tools/sources.mjs`；`view/eval.mjs → plugin/portable-tools/usage.mjs` |
| `analyzers` → `plugin/analysis-view` | 8 | 144 | `analyzers/cr-pwsh.mjs → plugin/analysis-view/lib/trace/shared/pwsh-observer.mjs`；`analyzers/eval-insights.mjs → plugin/analysis-view/lib/eval/diagnostic-rules.mjs` |

模块内部依赖 385 对，占全部文件对的 57%。

## 复杂度

分布与排名只看手写单元。

| 圈复杂度 | 函数 |
| --- | ---: |
| 1–5 | 6,767 |
| 6–10 | 523 |
| 11–20 | 311 |
| 21–40 | 114 |
| 41+ | 60 |

最高的函数或方法：

| 单元 | 位置 | 圈复杂度 | 行 |
| --- | --- | ---: | ---: |
| `projectPresetContext` | `analyzers/preset-context.mjs:20` | 190 | 148 |
| `adaptPiSession` | `analyzers/pi-adapter.mjs:77` | 182 | 96 |
| `<匿名>` | `analyzers/codex-adapter.mjs:202` | 160 | 116 |
| `bindFigure` | `report/contract.mjs:40` | 130 | 86 |
| `describeCall` | `docs/demo/layout-review/step-insight.mjs:43` | 127 | 110 |
| `renderOverview` | `docs/demo/layout-review/base/branches.js:37` | 111 | 153 |
| `call` | `plugin/portable-tools/service.mjs:53` | 96 | 98 |
| `describeOperation` | `docs/demo/layout-review/tool-operation-model.mjs:68` | 94 | 57 |
| `projectFindingCalls` | `plugin/analysis-view/lib/eval/findings.mjs:7` | 94 | 40 |
| `handler` | `plugin/analysis-view/lib/index.js:609` | 94 | 225 |
| `buildInjectionIndex` | `analyzers/context-evidence.mjs:54` | 92 | 106 |
| `datasetFromNative` | `plugin/portable-tools/sources.mjs:70` | 85 | 113 |

复杂度合计最高的文件：

| 文件 | 函数 | 合计 | 行 |
| --- | ---: | ---: | ---: |
| `plugin/analysis-view/lib/client.js` | 299 | 944 | 1,923 |
| `plugin/analysis-view/lib/eval/overview/app.js` | 382 | 931 | 1,301 |
| `plugin/trajectory-tools/lib/index.js` | 100 | 613 | 1,334 |
| `plugin/analysis-view/lib/index.js` | 87 | 486 | 835 |
| `analyzers/codex-adapter.mjs` | 66 | 462 | 339 |
| `plugin/trajectory-tools/lib/inspect.js` | 125 | 444 | 408 |
| `docs/demo/preset-context/controller.js` | 99 | 407 | 242 |
| `plugin/analysis-view/lib/trace-context.js` | 74 | 369 | 295 |
| `report/components.mjs` | 142 | 350 | 231 |
| `docs/demo/layout-review/geist-tools.js` | 120 | 349 | 381 |

## 口径与边界

- 源码面是 git 跟踪的 `analyzers/`、`design/`、`experiments/`、`lib/`、`plugin/`、`report/`、`scripts/`、`skill/`、`view/`、`docs/demo/layout-review/`、`docs/demo/preset-context/` 下的 `.js` 与 `.mjs`，排除测试、fixtures、dist、node_modules 与 `tmp-*`。
- 依赖取 `ts_file_value_dependencies`：值引用经声明落到文件，见证数表示支撑该文件对的引用条数。模块请求与投影路径另计，不并入这里。
- 圈复杂度按 ESLint classic 口径：每个函数以 1 为基线，显式判定、逻辑运算、可选链和带初值的参数各加一。嵌套函数单独计算。
- 「手写部分」指排除生成副本后的圈复杂度合计，与函数排名使用同一批单元。
- 本次生成前用引擎基线核对了 10 个单元，口径一致才写出本页。
- 另有 375 条静态模块请求指向外部或未纳入的来源（`partial-interpretation`），包括 Node 内建库与宿主 SDK；不是 375 个缺陷，也不表示不存在依赖。
- CR 按每个消费者的完整所选静态 import/export 闭包分批观察；动态分派和浏览器拼装脚本的运行时全局关系未供给。未读绑定只是复核线索，不直接判定可删除。
- 分析只读源码，不执行项目代码。

复跑：

```sh
node scripts/code-status.mjs --engine ../code-relations
```

本页是显式运行脚本得到的固定快照，不在 Eval 打开或宿主启动时扫描。
