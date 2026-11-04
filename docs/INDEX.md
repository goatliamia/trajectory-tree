# 仓库索引

一句话：**把各宿主（DSH / Pi / Codex / Claude Code）的会话记录，变成可查、可诊断、可复现的轨迹视图与报告**的仓库。

四条主线：`plugin/` 提供宿主接入，`view/` + `report/` 提供视图与报告组件，`skill/` 提供诊断方法，`scripts/` 负责构建与打包。

---

## 顶层目录

| 目录 | 作用 | 关键入口 | 是否生成 |
|---|---|---|---|
| `plugin/` | 宿主侧插件与工具 | `plugin/trajectory-tools`（DSH 工具）、`plugin/analysis-view`（DSH 路径页）、`plugin/portable-tools`（Pi/Codex 共用实现）、`plugin/claude` | 部分生成 |
| `view/` | 跨宿主的视图源码与资源 | `view/render.mjs`（页面装配）、`view/assets/`（CSS / 宿主适配 / 观察层） | 否 |
| `report/` | HTML 报告组件与写作规范 | `report/AUTHORING.md`（组件绑定）、`report/WRITING.md`（写作）、`report/out/`（产出） | `out/` 是产物 |
| `skill/` | 诊断方法源文件 | `skill/trace-analysis`、`skill/context-profile` | 否；由 `scripts/sync-host-skills.mjs` 分发到各宿主 |
| `scripts/` | 构建、打包、取证 | `trajectory-view.mjs`、`package-trajectory.mjs`、`build-readme-media.mjs`、`sync-view-assets.mjs` | 否 |
| `analyzers/` | 各宿主原生记录的读取与适配 | `pi-reader/adapter`、`codex-reader/adapter`、`incidents.mjs`、`retry.mjs` | 否 |
| `docs/` | 设计与口径文档 | 见下节 | 否 |
| `dist/` | 各宿主可分发包 | `trajectory-tree-{codex,pi,claude}` | **是**，由打包脚本重建；已被 `.gitignore` 忽略 |
| `experiments/` / `logs/` | 实验与本地日志 | — | 否 |
| `.agents/` | 通用方法 skill（项目自身） | `skills/trace-analysis` 等 | 否 |

---

## 文档导航（`docs/`）

**总体与接入**
- [宿主接入与命令](host-entrypoints.md) — 四个宿主各自的入口、构建与分发
- [宿主接入文件清单](host-integration-files.md) — hook、插件清单、打包内容
- [轨迹工具字段与统计口径（DSH）](trajectory-fields.md) — 字段、单位、上下文七类定义、已知边界
- [轨迹工具设计](trajectory-tools-design.md) — 四个工具的取舍

**视图**
- [分析视图设计](analysis-view-design.md) — 路径页的结构与数据流
- [上下文证据接口](context-evidence-interface.md) — 七类构成的数据来源
- [静态上下文剖面](static-context-profile.md)

**诊断方法**
- [诊断方法（定稿）](diagnostic-method-and-tools.md) · [诊断草稿](diagnostic-methods-draft.md)
- [诊断 v3](diagnostic-analysis-v3.md) · [v3 实验结果](diagnostic-experiment-v3-results.md) · [试点结果](diagnostic-pilot-results.md)
- [提示词（定稿）](diagnostic-prompts.md) · [提示词草稿](diagnostic-prompts-draft.md)

**报告**
- [报告写作](report/WRITING.md) · [组件绑定](report/AUTHORING.md)
- [报告装配](report-assembly.md) · [报告模板](report-templates.md) · [编写流程](report-authoring-workflow.md)

**其他**
- [可移植分析](portable-analysis.md) · [Assembly 组件](assembly-component.md)
- [Skill 工具评审](skill-tool-review.md) · [注入来源研究](injection-provenance-research.md)

---

## 常用命令

```sh
# 生成某个宿主的视图
node scripts/trajectory-view.mjs --host codex --serve
node scripts/trajectory-view.mjs --host pi --file session.jsonl --open

# 打包宿主插件
node scripts/sync-host-skills.mjs
node scripts/package-trajectory.mjs --host codex|pi|claude

# DSH 共享视图资源（打包前自动执行）
node scripts/sync-view-assets.mjs
```

---

## 不要手改的生成物

| 文件 | 由谁生成 | 改哪里 |
|---|---|---|
| `plugin/analysis-view/lib/trace/page.html`、`page.js` | `scripts/port-geist-page.mjs` | `docs/demo/layout-review/` + `view/assets/` |
| `plugin/analysis-view/lib/trace/models/*.mjs` | 同上（脚本头有注释） | 同上 |
| `plugin/analysis-view/lib/trace/shared/*` | `scripts/sync-view-assets.mjs` | `view/assets/` |
| `dist/trajectory-tree-*` | `scripts/package-trajectory.mjs` | 对应的 `plugin/` 与 `view/` 源码 |
| `README` 中的图片与动图 | `scripts/build-readme-media.mjs` | `demo/` 与视图组件 |

---

## 未纳入版本控制、需要留意的目录

| 路径 | 状态 | 说明 |
|---|---|---|
| `dist/` | `.gitignore` 忽略 | 可分发包，随时可重建 |
| `docs/demo/` | 仓库内，但页面数据来自 `.dsh/` | 演示用中间产物，部分文件带真实会话数据，**不要随意提交** |
| `a2ui-research/` | 未跟踪 | 与轨迹主线无关的资料，索引暂不收录 |
| `build-client.mjs` | 未跟踪，0 字节 | 疑似遗留空文件，确认后可删 |
| `lib/`（2 个文件） | 未跟踪 | `client.source.js` 等，来源待确认 |
| `.dsh/` | 本地产物 | 构建中间文件、检查页、截图 |
