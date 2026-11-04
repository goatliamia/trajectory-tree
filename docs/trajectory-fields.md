# 轨迹工具字段与统计口径（DSH）

本文只描述 **DSH 宿主**上这一套工具与页面的实现，以及每个数字的单位、来源与已知边界。凡标注"估算"的都不是计费数据。

> Pi 与 Codex 走的是另一份实现（`plugin/portable-tools`，读各自的会话文件），字段与行模型不同；本文的字段、参数与口径**不适用于那两个宿主**。Claude Code 没有面向模型的轨迹工具，只有生成视图的斜杠命令。

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
| `official.wall` | ms | 官方统计的活动时长：各步 `wall` 之和，**不是**会话墙上时间（会话可能跨天） |
| `official.model` | ms | 模型处理时间，含首字延迟与解码 |
| `official.ttft` | ms | 首字延迟合计，已包含在 `model` 内，不可与 `model` 相加 |
| `official.decode` | ms | 解码时间，同样包含在 `model` 内 |
| `official.tool` | ms | 各次工具调用配对时长的总和；**可能重叠**，不是工具墙钟覆盖 |
| `official.toolWall` | ms 或 null | 工具墙钟覆盖；记录跨度互相矛盾时给 `null`（"withheld"），逐值仍保留在逐步数据里 |
| `official.retries` / `toolErrors` | 个 | 重试次数、工具报错次数 |
| `official.output` | tokens | 输出 token 合计 |
| `usage.settlements` | 条 | 结算条数；`unknownSettlements` 是缺字段的条数 |
| `usage.input` | tokens | 未缓存输入（每次请求的 prompt 中未命中缓存的部分） |
| `usage.cacheRead` | tokens | 命中缓存读入的 token（**不是**重复计费的部分） |
| `usage.cacheWrite` | tokens | 写缓存的 token；本会话为 0 |
| `usage.output` | tokens | 输出 |
| `usage.total` | tokens | `input + cacheRead + cacheWrite + output` |
| `usage.cacheEfficiency` | 0–1 | `cacheRead / (cacheRead + input)`；不含 output |
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
| `latency` | `waitBeforeMs`（上一步等到这一步）、`ttft`、`decode`、`wall`，按轮或按步 |
| `cost` | `requests[]`（每请求的 input/cacheRead/output）、汇总与 `coverage` |
| `repeats` | 同参数候选：`key`、`count`、`seqs` |
| `io` | 工具或文件维度：`returnedCharacters`、`count`、`errors` |
| `context` | 上下文构成的变化：`change`、`components` |

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
2. `tool` 是配对时长求和，可能互相重叠；要墙钟覆盖看 `toolWall`，它为 `null` 时不要自己相加。
3. `cacheRead` 不是重复费用，它表示命中缓存的读入量；判断缓存效果看 `cacheEfficiency`。
4. 上下文 token 是估算；与 `usage` 的实报值不同源，不要互相校验。
5. `samples:false` 只影响**返回体积**，不改变任何统计；需要原文时按 `reads` 里的 seq 调 `trajectory_read`。
6. `data` 格式保持来源顺序，与排名类 `sort` 互斥。
7. 工具统计只统计"记录了起止"的调用；跨步的调用可能被归到下一步，因此逐轮相加与整会话总数可能差一两条。
