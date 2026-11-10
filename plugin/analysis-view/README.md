# 轨迹树 · Trajectory Tree

A DSH Web GUI plugin for browsing the current conversation's trajectory and evaluation metrics.
DSH Web GUI 插件提供当前会话的轨迹树与评估指标。

0.10.31 起，Web 端可用 `/trajectory` 直接打开当前会话的路径与上下文页；这是客户端动作，不发送分析提示词或调用模型。

0.10.32 合入来源多选与总趋势图层。总趋势默认关闭；共享资源与独立宿主视图同步，保留已做的缓存、可见区域裁剪和折线压缩。

English | [中文](#中文)

---

## English

### What it is

A DSH Web GUI plugin providing two views for the current conversation.

- **Trajectory Tree** shows the execution path, turn details and evidence layers.
- **Eval** shows output against elapsed time, tool comparisons, and recorded errors. Scope the charts to the session or one of the latest 120 turns. In the scatter plot, select either comparison card and click a point to replace that turn. Open **Detailed metrics** for the underlying metrics and records.
- In the tree, hold to select an item or hold and drag to select a region. In Eval, start a diagnosis from the chart details. **Fill conversation** appends the editable draft to the current composer, where you can review and send it.

### Runtime evidence in Eval

Open **Detailed metrics** for the session overview and the optional interpretation.

- **KPI strip** — turns · tool calls · failures · cache hit · events, one number per cell.
- **Turn map** — one proportional band per turn (width by duration, colour by that turn's failure
  count); a turn with failures jumps to the Trajectory tab (`openView("trajectory", callId)`).
  The legend is printed; no unlabeled colours.
- **Spend** — per turn, two bars: the reused prefix (cache hit) beside what was actually processed
  fresh (miss), with output on its own bar; each turn's hit rate sits on the right and turns amber
  below 90%. The list scrolls and starts at the newest turn. When every request came from the official
  DeepSeek API (`deepseek-flash` / `deepseek-v4-pro`), the right side of the summary shows the official
  unit prices for miss / hit / output plus a total, with the peak/off-peak schedule already applied;
  anything else shows no price at all.
- **Tools** — three rings show categories, tools and calls per turn. Selecting a category or tool updates the related rings.
- **Incident cards** — only *evidence-backed* incidents. Each card is a causal chain:
  `Cause / Runtime knew / Model received / Harness response / Impact`, with evidence `seq` chips
  that jump to the Trajectory tab.
- **Interpretation** — click to request an explanation from the current default model.
  It consumes tokens and includes evidence citations. It is not run until requested.

### Install

Install into your DSH Web profile and restart DSH Web.

```sh
npm pack ./plugin/analysis-view
dsh plugin --profile web add ./dsh-analysis-view-0.10.146.tgz
```

### Plugin settings

Open **Plugins → Trajectory Tree** in DSH. Conversation search starts enabled and can be hidden from here. Open **Conversation search** from the right sidebar to search the entire session, load older matches, and jump to a turn. Search accepts space-separated keywords and quoted phrases. **Include tools** also searches tool calls and results.

Set the default visibility of the context and file layers and choose an Eval tool sort by total duration, errors, or calls. Defaults apply when you reopen the view. Trajectory Tree keeps layer choices already saved for that session.

When upgrading from the standalone `dsh-conversation-search` bundle, disable that bundle in the web profile to give Trajectory Tree control of the search entry.

### Path view

Open the **Trajectory Tree** tab to browse the session overview and individual turns.
Context composition, file history, tool results, subagent branches and Skill records are available
from the page. Tool parameters and results open in the detail drawer.

The page appears in stages: the real trunk appears first, followed by details and other layers.
Selecting a turn gives its details priority. Viewport, zoom and selection remain while data arrives.
Context increments cover the available log cut. Select a turn or step to see the estimated composition and the reported request input.

The standalone `GET /analysis-view/trace?session=<id>` URL returns a self-contained snapshot.



### Verify

- Refresh the GUI and open **Trajectory Tree** and **Eval** in a conversation.
- If it is blank, check the browser console for the first error.
- Panel render: `node plugin/analysis-view/self-test.mjs` (must print `ALL PASS`); it
  executes the real component tree against a React shim, so no browser is needed.
- Analyzer semantics: `node analyzers/self-test.mjs` (must print `ALL PASS`).
- Shape contract: `node analyzers/shape-law.mjs` and `node analyzers/shape-law.mjs --mutate`
  (both must print `ALL PASS`; the second one prints `CAUGHT` per mutation).

### Limitations

- Missing official statistics or context data is shown as unavailable; other available content remains accessible.
- Earlier context may require an explicit history load.
- Model interpretation is optional and consumes tokens.
- Price display is limited to the supported official API models.

---

<a id="中文"></a>
## 中文

### 这是什么

为 DSH Web GUI 的当前会话提供两个视图。

- **轨迹树**浏览执行路径、逐轮详情和证据图层。
- **评估**展示输出量与轮次耗时、工具对照和报错分布。可选整段会话或最近 120 轮中的一轮。点一张对照卡，再点散点可更换这一侧的轮次。原有指标与证据可在「统计明细」查看。
- 在轨迹图上长按可选中对象，长按后拖动可圈选。在 Eval 图表详情中直接提问。选择关注点并编辑草稿后，点「填入对话」会把草稿追加到当前会话的输入框，等你检查后发送。

### 评估里的运行证据

展开「运行证据」可查看整段会话概览和原有的可选解读。

- **KPI 条**:轮次 · 工具调用 · 失败 · 缓存命中 · 事件,一个数字一格。
- **轮次地图**:一条按时长分宽的比例带(颜色按该轮失败数);有失败的轮次点击切到「轨迹」
  (`openView("trajectory", callId)`);图例直接写在界面上。
- **花费**:每轮两条——命中(复用的前缀)与未命中(真正新处理)并排画,输出单独一条;右侧是这一轮的
  命中率,低于 90% 标警示色;列表可滚动,默认停在最新。走官方 API(deepseek-flash / deepseek-v4-pro)时,右边按官方价目给未命中 / 命中 / 输出的单价与总价,峰谷已计入;不是官方 API 就不显示价格。
- **工具**:三个环并排——类别 → 该类工具 → 这个工具用在哪些轮;三张默认都在(取最大类别与它的第一名工具),
  点类别或工具只切换后两张;类别色不用红,红只留给错误。
- **Incident 卡片**:只列**有证据**的 incident,每张是一条因果链
  `Cause / Runtime 知道 / Model 收到 / Harness 反应 / 影响`,并带证据 `seq` 徽章。
- **解读**：点击后由当前默认模型解释，消耗 token，并附证据引用。默认不调用；输出达到上限时显示「已截断」。

### 安装

安装到 DSH 的 Web profile 后重启 `dsh web`。

```sh
npm pack ./plugin/analysis-view
dsh plugin --profile web add ./dsh-analysis-view-0.10.146.tgz
```

### 插件设置

在 DSH 的「插件」中打开「轨迹树」。右侧栏的「对话搜索」默认开启，可在这里隐藏。搜索覆盖整段会话，可以加载更早的结果并跳回对应轮次。关键词用空格分隔，短语用引号括起。「含工具」可同时查调用和结果。

可设置轨迹树的上下文变化和文件图层默认是否显示，以及 Eval 默认按累计耗时、报错数或调用量排序。重新打开视图时应用默认值。轨迹树保留已为该会话保存的图层选择。

从独立版 `dsh-conversation-search` 升级时，在 Web profile 中停用旧版后，右栏入口由轨迹树设置控制。

### 路径页

打开「轨迹树」标签，可浏览全景与逐轮行动路径，并查看上下文构成、文件历史、工具结果、
子代理和 Skill 记录。点击工具即可在详情中查看参数和结果。

页面分阶段显示：先出现真实主干，再补齐正文和其他图层；选中某轮会优先加载其详情。
补齐数据时保留位置、缩放和选中项。上下文增量覆盖本次读取的日志，点击轮次或步骤可看七类估算与宿主上报的请求输入。

`GET /analysis-view/trace?session=<id>` 可单独打开自包含快照。



### 验证

- 刷新 GUI → 「分析」标签按当前会话渲染工作路径。
- 若空白:看浏览器控制台第一条报错。
- 面板渲染:`node plugin/analysis-view/self-test.mjs`(必须输出 `ALL PASS (21 checks)`);
  它用一个 React 垫片真的执行组件树,不需要开浏览器。
- 路径加载与资源边界:`node plugin/analysis-view/stages-test.mjs`、`node plugin/analysis-view/resources-test.mjs` 与 `node plugin/analysis-view/perf-test.mjs`。
- 分析器语义:`node analyzers/self-test.mjs`(必须输出 `ALL PASS`)。
- 形状契约:`node analyzers/shape-law.mjs` 与 `node analyzers/shape-law.mjs --mutate`
  (都要 `ALL PASS`;后者对每种变异打印 `CAUGHT`)。

### 局限

- 官方统计或上下文数据缺失时会明确显示不可用，已有内容仍可查看。
- 更早的上下文可能需要手动回补。
- 模型解读为可选功能，会消耗 token。
- 费用显示仅适用于已支持的官方 API 模型。

开发文档：[分析面板与路径页](https://github.com/goatliamia/trajectory-tree/blob/main/docs/analysis-view-design.md)。
