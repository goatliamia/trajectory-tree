# 轨迹工具字段与统计口径（DSH）

本文只描述 **DSH 宿主**上这一套工具与页面的实现，以及每个数字的单位、来源与已知边界。凡标注"估算"的都不是计费数据。

> Pi、Codex 和 Claude Code 通过便携取证实现读取各自的原生记录。它们与 DSH 共用工具结果分布口径，各自的时间、用量与步骤字段见宿主说明。 [指标框架](metric-framework.md) · [宿主能力](host-compatibility.md)

- 工具实现：`plugin/trajectory-tools`（DSH 宿主，经 `ctx.tools.register`）
- 页面实现：`plugin/analysis-view`（`/trajectory` 打开的执行路径页）
- 上下文分类的原始口径：**DSH 的 `dsh-context` 插件**里的 `St(type, message)` 分类函数（不是官方统计页）

---

## 1. DSH 四个工具的分工

| 工具 | 回答什么 | 是否返回正文 |
|---|---|---|
| `trajectory_inspect` | 有多少、多久、多少次、分布如何；带指向原文的 seq | 默认带 `samples`，传 `samples:false` 只回数字 |
| `trajectory_search` | 字面命中、会话清单、目录计数 | 命中片段 |
| `trajectory_read` | 原文、某次调用的前因后果（`linked`） | 正文 |
| `trajectory_graph` | 替换链、引用、派生、会话谱系 | 结构，不含正文 |

`search view=cost` 是兼容别名，等价于 `inspect view=cost`，返回里带 `canonical: "trajectory_inspect"`。

---

## 2. `trajectory_inspect` 的返回结构（DSH）

### 2.1 `scope` / `log`

| 字段 | 含义 |
|---|---|
| `scope.session` | 会话 id |
| `scope.fromSeq` / `toSeq` | 本次计算覆盖的事件区间（闭区间） |
| `log.events` / `minSeq` / `maxSeq` | 日志身份与范围；`snapshot` 由它派生 |

### 2.2 `summary`

| 字段 | 单位 | 口径 |
|---|---|---|
| `turns` / `steps` / `calls` | 个 | 覆盖区间内实际记录的轮、步、工具调用数 |
| `toolOutcomes` | 对象 | 轮次和对象范围内筛选前的工具结果分布。含已返回、报错、未知、结果覆盖率和已知结果中的报错占比 |
| `official.wall` | ms | 官方统计的活动时长：各步 `wall` 之和，**不是**会话墙上时间（会话可能跨天） |
| `official.model` | ms | 模型处理时间，含首字延迟与解码 |
| `official.ttft` | ms | 首字延迟合计，已包含在 `model` 内，不可与 `model` 相加 |
| `official.decode` | ms | 解码时间，同样包含在 `model` 内 |
| `official.tool` | ms | 各次工具调用配对时长的总和；**可能重叠**，与 `toolWall`（并集）分开 |
| `official.toolWall` | ms | 官方逐项 `toolWall` 之和；每项是调用区间的并集（重叠只算一次），跨步调用时可能大于活动步时长，不再置空 |
| `official.retries` / `toolErrors` | 个 | 重试次数、工具报错次数 |
| `official.output` | tokens | 输出 token 合计 |
| `usage.settlements` | 条 | 原始 `assistant/message` 记录数。`unknownSettlements` 计入整条 usage 缺失的记录 |
| `usage.input` | tokens | 未缓存输入（每次请求的 prompt 中未命中缓存的部分） |
| `usage.cacheRead` | tokens | 命中缓存读入的 token（**不是**重复计费的部分） |
| `usage.cacheWrite` | tokens | 已上报的缓存写入量，未上报时为 `null` |
| `usage.output` | tokens | 输出 |
| `usage.total` | tokens | 原始 `totalTokens` 的已上报值之和 |
| `usage.cacheEfficiency` | 0–1 | 仅在同时上报 `cacheRead` 和 `input` 的记录上，计算 `sum(cacheRead) / (sum(cacheRead) + sum(input))`。缓存写入和输出另列。没有成对记录或分母为零时为 `null` |
| `usage.cacheEfficiencySample` | 对象 | `records` 是成对记录数，`input` 与 `cacheRead` 是同批记录的分母组成。各用量桶总数仍覆盖各自的已上报记录 |
| `usage.coverage` | 对象 | 各字段有记录的结算条数，用于判断缺项 |
| `tokenUsageWholeSession` | tokens | 整会话（不受 `turns` 限制）的四个用量桶 |
| `contextBreakdownAtCut` | tokens | 切点时的构成：`systemTokens` / `toolsTokens` / `messageTokens`，**估算** |
| `contextPressureAtCut` | tokens | `pressureTokens`、`projectedTokens`、`contextWindow` |
| `toolDefinitions` | 对象 | 声明数量与变更计数；尺寸是**估算**，不是计费 |

### 2.3 `items`（按 `groupBy` 分页）

按 `groupBy: "turn"` 时，每项：

| 字段 | 含义 |
|---|---|
| `turns.from` / `turns.to` | 该项覆盖的轮次（窗口分组时是区间，单轮时相同） |
| `seq` / `endSeq` | 该项起止事件序号 |
| `steps` | 该区间内的步数 |
| `official` | 同 2.2 的逐项版本，字段一致 |
| `usage` | 同 2.2 的逐项版本；`coverage` 逐项给出 |
| `samples` | 每项的原文摘录（prompt 与 following），**`samples:false` 时不返回** |
| `toolCounts` | 该区间内各工具的调用次数 |
| `markers` | 区间内的关键事件（如 `compaction/start`、`subagent/catalog`） |

按 `groupBy: "tool"` / `"file"` 时，`items` 是调用/文件维度：`name` 或 `path`、`count`、`time`、`returned`、`first`/`last` 等。

### 2.4 其他视图

| 视图 | 主要字段 |
|---|---|
| `latency` | 官方时长与 `recordedToolTiming` 分列，支持按轮或按步 |
| `cost` | `requests[]`（每请求的 input/cacheRead/output）、汇总与 `coverage` |
| `repeats` | 同参数候选：`key`、`count`、`seqs` |
| `io` | 工具或文件维度：`returnedCharacters`、`count`、`errors` |
| `context` | 上下文构成的变化：`change`、`components` |

#### DSH 实录步内工具时长

`view: "latency"` 以原生步骤起止事件为边界，将所属步骤内有起止事件的调用裁剪到该区间。Code Mode 子调用需要原生的 dispatch start 和返回。聚焦文件或工具时，统计范围仍是包含它的完整步骤。

| 字段 | 口径 |
|---|---|
| `stepSpanMs` | 实录步骤边界之差 |
| `calls` / `pairedCalls` | 该步记录的调用数和有起止时间的调用数 |
| `crossStepCalls` | 有起止时间且越出所属步骤边界的调用数 |
| `cumulativeMs` | 裁剪后各调用区间的长度之和 |
| `coveredMs` | 裁剪后区间的并集长度，重叠只计一次 |

缺少步骤边界，或有调用却缺少任何起止配对时，步内时长为 `null`。有实录边界且没有记录到调用的步骤记为 0。部分调用缺失时，时长只代表可配对的子集。`summary.recordedToolTiming` 与按轮结果提供 `measuredSteps` 和逐步求和后的 `sumStepCumulativeMs`、`sumStepCoveredMs`。这些量描述所属步骤内可观测的区间。判断模型或宿主在等待什么，需要另外的依赖或调度证据。

`format: "data"` 将读数放在 `recordedStepSpanMs`、`calls`、`pairedToolCalls`、`crossStepToolCalls`、`clippedToolMs`、`clippedToolCoveredMs`，并引用步骤起止记录。官方 `toolMs` 和 `toolCoveredMs` 仍可用于复核官方投影。

### 2.5 参数

| 参数 | 说明 |
|---|---|
| `view` | `overview`（默认）/`latency`/`cost`/`repeats`/`io`/`context` |
| `format` | `summary`（默认）或 `data`；`data` 保持来源顺序，**不能排序** |
| `groupBy` | `turn`/`tool`/`file`（视图决定可用值） |
| `sort` | `time`/`wall`/`input`/`output`/`returned`/`count`/`change` |
| `limit` | `summary` 每页 1–10；`data` 每页 1–500 |
| `samples` | 布尔，默认 `true`；`false` 时不返回原文摘录与证据正文 |
| `turns` | 闭区间 `{from,to}` |
| `focus` | `{tool}` 或 `{file}` 二选一 |
| `snapshot` / `cursor` | 切点与续页 |

---

## 3. 上下文七类的口径（DSH 路径页）

分类函数（`dsh-context`）：

```js
if (type === 'assistant/message') return 'assistant'
if (type === 'tool/result')      return 'tool'
if (type === 'developer/message') return 'inject'
const kind = msg?.source?.kind
if (kind === 'skill-invocation' || kind === 'skill-catalog') return 'skill'
if (source && (source.kind !== '' && source.kind !== 'user') || source?.form) return 'inject'
return 'user'   // 兜底
```

| 显示名 | key | 装的是 |
|---|---|---|
| 系统提示 | `system` | `system/message` 累积的系统文本 |
| 工具定义 | `tools` | 工具 schema 的估算占用 |
| 用户输入 | `user` | 无来源标记的用户文本，以及未归类消息（兜底桶） |
| 运行时注入 | `inject` | `developer/message`，以及带来源标记的内容：附件、环境说明、状态与通知 |
| 技能内容 | `skill` | `skill-invocation`（加载进来的正文）**和** `skill-catalog`（常驻目录说明） |
| 模型输出（含思考） | `assistant` | `assistant/message`：思考、回复、工具调用请求 |
| 工具输出 | `tool` | `tool/result`，仍留在上下文中的部分 |

注意：

- 附件归**运行时注入**，不归用户输入；
- `system/message` 只计入系统提示，不进后两类；
- 每项 token 都是**估算**，按内容长度折算，不是计费值；
- 页面里的增量是"相邻两次请求逐类相减"，负值代表被压缩或裁掉。

---

## 4. 已知边界（DSH）

1. `wall`、`tool`、`ttft`、`decode` 都是官方记录的**活动步**之和，不与墙上时间对齐；会话跨天时差距会很大。
2. `tool` 是官方配对时长求和，可能互相重叠。`toolWall` 汇总官方逐步并集。要比较同一实录步内的工具占用区间，使用 `recordedToolTiming`。
3. `cacheRead` 表示上报的缓存读取量。比较 `cacheEfficiency` 时同时核对配对样本和输入桶定义。
4. 上下文 token 是估算；与 `usage` 的实报值不同源，不要互相校验。
5. `samples:false` 只影响**返回体积**，不改变任何统计；需要原文时按 `reads` 里的 seq 调 `trajectory_read`。
6. `data` 格式保持来源顺序，与排名类 `sort` 互斥。
7. 工具统计只统计"记录了起止"的调用；跨步的调用可能被归到下一步，因此逐轮相加与整会话总数可能差一两条。
