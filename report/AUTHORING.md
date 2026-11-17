# 诊断报告组件与装配指南

报告写作结构见[报告写作指南](WRITING.md)。本文说明从冻结切点准备数据、在 Markdown 中声明 `report-figure` 组件以及编译为独立离线 HTML 的完整流程。

---

## 1. 三步 CLI 流水线

报告与轨迹树、Eval 共用同一套只读取证数据源。模型只编写计划 JSON 与 Markdown，完整数据数组、样式、字体和交互由渲染器打包进单文件 HTML。

### 第一步：获取切点身份（或复用草稿中的 `snapshot / cut / logId`）

```sh
# Codex（默认当前会话，或加 --thread <ID>）
node scripts/trajectory-report.mjs query --host codex --tool trajectory_inspect --request args.json

# Pi / Claude Code（指定会话文件或草稿导出的 --evidence 快照）
node scripts/trajectory-report.mjs query --host pi --file /path/to/session.jsonl --tool trajectory_inspect --request args.json
node scripts/trajectory-report.mjs query --host claude --evidence /path/to/exported.evidence.json --tool trajectory_inspect --request args.json
```

查询返回中自带 `reportSource`（包含 `host, session, snapshot, log, cut`），直接复制到第二步的数据计划中。

### 第二步：准备冻结数据包（`prepare`）

在 `plan.json` 中声明报告所需的命名数据集（最多 12 个），一次 `prepare` 即可导出同切点的 Eval 统计表、查询明细表与选定序号的原文摘录：

```json
{
  "schema": "trajectory-report-plan/1",
  "sources": {
    "summary": {
      "evaluation": {
        "source": {"host": "codex", "session": "...", "snapshot": "...", "log": "...", "cut": 120},
        "table": "summary"
      }
    },
    "findings": {"evaluation": {"from": "summary", "table": "findings"}},
    "tools": {"evaluation": {"from": "summary", "table": "tools"}},
    "rounds": {"evaluation": {"from": "summary", "table": "turns"}},
    "windows": {"evaluation": {"from": "summary", "table": "window-bands"}},
    "quotes": {"records": {"from": "summary", "seqs": [18, 21, 24, 29]}}
  }
}
```

执行 `prepare` 生成 `bundle.json` 并查看返回的字段目录与样本预览：

```sh
node scripts/trajectory-report.mjs prepare --host codex --plan plan.json --bundle bundle.json
```

### 第三步：渲染独立 HTML（`render`）

```sh
node scripts/trajectory-report.mjs render --markdown report.md --bundle bundle.json --output report.html --template diagnostic
```

- 绑定错误会精确返回 Markdown 块序号、行号和原因；只改文字或图表配置时无需重跑 `prepare`，直接重新 `render` 即可。

---

## 2. 同切点 Eval 数据表字典（`evaluation.table`）

通过 `evaluation` 导出的 11 张表与单会话 Eval、全局总览共用同一计算内核（可加 `"turns": {"from": 2, "to": 6}` 限定轮次范围）：

| 表名 (`table`) | 行 ID 格式 | 核心字段与适用场景 |
| :--- | :--- | :--- |
| `summary` | `scope` | `turns, wallMs, calls, returned, errors, unknown, errorRate, durationSumMs, durationP50Ms, durationP95Ms, longCalls, outputTokens, modelMs, ttftMs, matched, files, repeatGroups` — **用于开篇 `metrics` 总览卡** |
| `findings` | `finding:<idx>` | `name, code, layer, focus, certainty, errors, turns, matched, repair, recover, capability, knowledge, rule` — **与 Eval 四类处置矩阵同源，用于展示程序归纳的诊断线索与处置方向** |
| `code-execution` | `exec:<seq>` | `turn, step, name, executor, phase, code, seq, resultSeq, exitCode, matched` — **与 Eval 代码执行面板同源，按执行器（PowerShell / Bash / PTC / Shell）与阶段定位脚本错误** |
| `tools` | `tool:<name>` | `name, calls, errors, errorRate, durationSumMs, durationP50Ms, durationP95Ms, longCalls, confirmed, candidate, matched, matchedShare` — **用于 `table` 或 `bar` 对比各工具调用量、报错率与耗时** |
| `turns` | `turn:<n>` | `name, turn` + 与 `summary` 相同的全套指标 — **用于 `trend` 或 `bar` 观察哪几轮集中报错或耗时激增** |
| `errors` | `error:<seq>` | `turn, name, seq, resultSeq, code, causeCode, category, cause, layer, controlState, certainty, matched, recoveryMs` — **逐条错误明细、发生层、控制拦截状态与同参恢复间隔** |
| `error-types` | `cause:<code>/<cert>` | `name, code, category, certainty, errors, matched` — **按归因类别汇总报错次数与同参恢复数** |
| `calls` | `call:<seq>` | `turn, step, name, seq, resultSeq, status, start, end, durationMs, nativeDurationMs` — **用于 `timeline`（并发泳道）或 `histogram`（耗时分布）** |
| `requests` | `request:<t>:<s>` | `turn, step, seq, model, inputTokens, outputTokens, windowTokens, occupancy, ttftMs, modelMs, calls, errors, errorRate` — **逐次模型请求的窗口占用与耗时** |
| `models` | `model:<name>` | `name, requests, inputTokens, outputTokens, inputP50, outputP50, calls, known, errors, errorRate` — **按模型路由汇总表现** |
| `window-bands` | `window:<0..5>` | `name, requests, inputTokens, outputTokens, inputP50, outputP50, calls, known, errors, errorRate` — **按请求窗口占用分档（0–25% 至 ≥100%）统计构成与错误率** |

此外，`sources` 还支持：
- **`query`**：直接传入 `trajectory_inspect` 参数（如 `view: "context"` 或 `view: "cost"`），导出上下文七类构成或请求结算表；
- **`records`**：传入 `seqs: [12, 15, ...]`（最多 30 条），抓取绑定切点的原文摘录，供 `flow`、`sequence` 及图表点击抽屉直接展示原文；
- **`assembly`**：在支持结构快照的宿主中传入 `cuts: [...]`，用 `assembly` 组件回放上下文片段的追加、保留与压缩替换。

---

## 3. 版式模板（`--template diagnostic`）

在 Markdown 中使用标准标题与段落，渲染器根据 H2 前缀自动组织响应式版式：

````markdown
# 标题：直接写出核心诊断结论

一句话交代会话范围与任务背景。

> **核心判断与出口**：用引用块概括根因，并指明本次诊断落到哪一类出口（如：已同轮自愈无需处置 / 修复脚本参数并验证 / 阐述工具职责后建议配置级关闭 / 更新 AGENTS.md）。

```report-figure
{"id":"hero-metrics","type":"metrics","data":"summary","items":[{"row":"scope","field":"wallMs"},{"row":"scope","field":"calls"},{"row":"scope","field":"errors"},{"row":"scope","field":"errorRate"},{"row":"scope","field":"outputTokens"}]}
```

## [pair] 窗口占用与信号拆解

在 `[pair]` 章节中，正文说明通栏排在顶部（避免左文右图造成左侧大片空白），下方的多个紧凑图表自动成对并排为双栏卡片，落单的宽表或流程图自动通栏展开。

```report-figure
{"id":"recovery-flow","type":"flow","data":"quotes","title":"从未读拦截到补读验收的完整链路","nodes":[...],"edges":[...]}
```

## [actions] 处置出口与验证步骤

1. **修复脚本参数绑定（`scripts/export.ps1:L14`）**：将含空格路径改为数组 `@paths` 独立传参，在原目录下运行 `pwsh -File scripts/export.ps1` 验证退出码为 0。
2. **评估关闭低频扩展工具（配置级启停）**：说明该工具的职责与当前任务无交集，经用户确认后在当前配置中停用，不修改官方工具定义。

## [sources] 数据口径与证据位置

此处放置需要折叠备查的切点说明、未记录项说明或补充表格。
````

---

## 4. 组件选择与 JSON 配方（Recipes）

需要查询某个组件的字段说明时，也可运行 `node scripts/trajectory-report.mjs components --type <类型>`。

### 4.1 证据绑定流程图（`flow`）— 分支、依赖、错误传播与汇合

当多条尝试分支、前置文件依赖或恢复动作汇合到同一验收结果时使用 `flow`（4–8 个节点最佳，上限 18 节点 / 28 连线）：

```json
{
  "id": "repair-flow",
  "type": "flow",
  "data": "quotes",
  "title": "两项修复汇合至同一次测试验收",
  "nodes": [
    {"id": "err", "row": "record:18", "label": "检查暴露两处错误", "outcome": "error"},
    {"id": "fix1", "row": "record:21", "label": "修正参数展开", "outcome": "returned"},
    {"id": "fix2", "row": "record:24", "label": "补齐导出表头", "outcome": "returned"},
    {"id": "pass", "row": "record:29", "label": "8 项测试全部通过", "kind": "result", "outcome": "returned"},
    {"id": "conclusion", "row": "record:29", "label": "本轮阻塞已闭环，无需追加常驻规则", "basis": "analysis"}
  ],
  "edges": [
    {"from": "err", "to": "fix1", "kind": "recovery", "label": "定位路径参数断开", "evidence": ["record:18", "record:21"]},
    {"from": "err", "to": "fix2", "kind": "recovery", "label": "定位 CSV 缺少表头", "evidence": ["record:18", "record:24"]},
    {"from": "fix1", "to": "pass", "kind": "dependency", "label": "纳入同次回归", "evidence": ["record:21", "record:29"]},
    {"from": "fix2", "to": "pass", "kind": "dependency", "label": "纳入同次回归", "evidence": ["record:24", "record:29"]},
    {"from": "pass", "to": "conclusion", "kind": "dependency", "label": "验收通过支撑结案", "evidence": ["record:29"]}
  ]
}
```

- **节点属性**：`id`、`row`（绑定数据行 ID）、`label`、可选 `detail`；形状 `kind` 可选 `action`（默认圆角矩形）、`decision`（六边形）、`result`（双侧强调框）；状态 `outcome` 可选 `error | returned | unknown`（反映原记录真实状态），或用 `basis: "analysis"` 标识作者综合多条证据得出的分析结论（蓝色虚线框，与 `outcome` 互斥）。
- **连线 `kind`**：
  - `sequence`（灰色点线）：单纯先后发生顺序；
  - `dependency`（蓝色实线）：明确的文件产出、前置条件或证据支撑；
  - `recovery`（青色虚线）：针对失败采取的恢复动作；
  - `alternative`（琥珀点划线）：原路线受阻后改走的替代方案；
  - `propagation`（红色粗实线）：原文确认的跨层异常/错误传递。

### 4.2 多维指标矩阵表（`table`）— 工具表现与处置线索

自动为比率列（`errorRate`、`matchedShare`、`occupancy` 等）渲染内联微比例条，为 `certainty` 和 `status` 渲染状态胶囊：

```json
{"id": "tool-matrix", "type": "table", "data": "tools", "title": "各工具调用量、报错率与耗时分位数", "fields": {"label": "name", "value": "calls"}, "series": ["calls", "errors", "errorRate", "durationP50Ms", "durationP95Ms", "matched"], "sort": "descending", "limit": 10}
```

### 4.3 构成环形图（`donut`）与堆叠结构（`stacked`）

- **分类行构成（`fields` 模式）**：每行代表一个互斥类别（如窗口占用分档、工具调用分布）：
  ```json
  {"id": "window-share", "type": "donut", "data": "windows", "title": "各窗口占用区间的请求构成", "fields": {"label": "name", "value": "requests"}}
  ```
- **单行/多行多列构成（`rows` + `series` 模式）**：比较同一切点或多个切点的同单位分项（如七类上下文估算或输入缓存构成）：
  ```json
  {"id": "ctx-stack", "type": "stacked", "data": "ctx", "title": "关键轮次的上下文来源构成对比", "rows": ["req:1", "req:5", "req:10"], "series": ["system", "tools", "user", "assistant", "tool"], "mode": "absolute"}
  ```

### 4.4 双切点前后对照（`comparison`）

对比两个明确记录位置（如压缩前后、修复前后）在同单位指标上的增减与相对变化：

```json
{"id": "before-after", "type": "comparison", "data": "ctx", "title": "第 3 轮与第 8 轮的上下文构成变化", "rows": ["req:3", "req:8"], "rowLabels": ["第 3 轮（探索期）", "第 8 轮（压缩后）"], "series": ["system", "tools", "user", "assistant", "tool"]}
```

### 4.5 排行榜/条形图（`bar`）、趋势图（`trend`）与区间泳道（`timeline`）

```json
{"id": "finding-bars", "type": "bar", "data": "findings", "title": "诊断信号组与出现频次", "fields": {"label": "name", "value": "errors", "detail": "matched"}, "sort": "descending"}
```

```json
{"id": "turn-errors", "type": "trend", "data": "rounds", "title": "逐轮报错次数变化", "fields": {"x": "turn"}, "series": ["errors"]}
```

```json
{"id": "call-lanes", "type": "timeline", "data": "calls", "title": "第 2 轮工具调用的并发与等待区间", "select": {"where": {"turn": 2}}, "fields": {"label": "name", "start": "start", "end": "end"}}
```
