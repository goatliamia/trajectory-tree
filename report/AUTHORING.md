# 诊断报告写作

正文按[报告写作](WRITING.md)组织。这里说明组件、数据绑定与 HTML 装配；图表数量由问题决定，文字和表格足够清楚时直接使用它们。

普通 Markdown 中插入 `report-figure` JSON 围栏。模型选择数据别名、字段、记录 ID、标题与重点，宿主管理完整数据。数字、单位、来源与证据来自取证结果；颜色、字号、间距及交互由渲染器统一提供。

## 选择组件

| 类型 | 用途 |
|---|---|
| metrics | 从数据行引用少量关键读数，自动显示单位 |
| bar | 比较对象的数量大小，可对已声明可加的指标按标签分组 |
| histogram | 看常见区间及长尾 |
| scatter | 在两项实际配对测量间找代表点或异常点 |
| timeline | 看有真实起止位置的调用怎样重叠或串行 |
| sequence | 将已读原文中的行动、反馈与转折连起来 |
| flow | 用已核实的关系说明分支、依赖和汇合，节点与连线均可回查依据 |
| context | 看来源构成的保留量及增减 |
| comparison | 看两个明确时点的前值、后值及变化 |
| donut | 看同一统计范围内互斥类别的数量和比例 |
| stacked | 比较多个时点的数量或比例结构 |
| assembly | 按片段身份与逻辑顺序重放保留、追加及历史变化 |
| table | 在同一行核对样本数、报错占比、耗时分位数和归因 |
| trend | 沿轮次或实际位置观察同口径指标的变化，缺值保留断点 |

需要某个组件的绑定例子和专用参数时，执行 `node scripts/trajectory-report.mjs components --type <类型>`。图前交代比较对象，图后解释对任务的意义和行动；不用不同图重复同一份信息。每张图应帮助解释一个具体判断或选择下一步；若图只是在正文末尾补一份无关统计，重新选择表达方式。

**看同一整体中少量、互斥分项的占比，用 donut；比较对象大小用 bar；观察随时间变化用趋势图。**

例如窗口分档先用 donut 显示各档请求占整体的比例和样本数；需要比较各档的输出 P50 时再用 bar。表格用于核对精确读数，不作为构成分布的默认表达。

分类行可直接绑定现有表，每行一个互斥类别，同一数值列构成整体。最多 12 类，空值保持未知，零值保留在图例中。引用同一行的多列分项时仍使用 `rows` 和 `series`，两种绑定择一。

```json
{"id":"window-share","type":"donut","data":"windows","fields":{"label":"name","value":"requests"},"title":"各窗口占用档位的请求构成"}
```

## 准备数据

CLI 可直接连接本机 Codex：加 `--host codex`，默认当前会话，或加 `--thread ID`。Pi 离线加 `--host pi --file <session.jsonl>`；Claude Code 使用 `--host claude --file <transcript_path>`。DSH 使用宿主提供的连接文件与 case。后续 query / prepare 使用相同来源参数，查询与读取沿用原工具的 snapshot 和指针。命令中的脚本路径按所在宿主 skill 给出的安装位置解析。

```sh
node scripts/trajectory-report.mjs query --connection <host.json> --case <key> --tool schema
node scripts/trajectory-report.mjs query --connection <host.json> --case <key> --tool trajectory_inspect --request <args.json>
node scripts/trajectory-report.mjs query --host codex --tool trajectory_inspect --request <args.json>
```

把选定的查询写入计划，引用已经返回的 snapshot：

```json
{"schema":"trajectory-report-plan/1","sources":{"steps":{"query":{"tool":"trajectory_inspect","args":{"snapshot":"已取证的 snapshot","view":"latency","turns":{"from":1,"to":10}}}},"quotes":{"records":{"from":"steps","seqs":[123,456]}}}}
```

`query` 直接复用 `trajectory_inspect` 参数；prepare 自动设置 data 格式并取完分页，支持 overview/latency、cost、io、context 的数据输出。io 可按 tool/file 分组，cost 这里是原始 usage 结算。其他分析摘要仍可用于正文或 Markdown 表格。`records` 从同一已准备数据的来源读取明确选定的原文；需要真实拼装结构时使用 `{"assembly":{"from":"steps","cuts":[123,456]}}`。如果只需要原文或结构，可把 query 返回的 `reportSource` 直接放在 records/assembly 的 `source` 字段里，替代 `from`，不用为身份再准备一张数值表。

DSH 官方已有的范围合计和分组也可直接绑定：在同一个 query 中加 `"table":"summary"` 导出一行 `scope` 合计，或 `"table":"groups"` 导出原 inspect 的窗口/轮次/工具/文件分组。它复用原查询与汇总值，无需先抓逐步明细再求和。分组种类仍由原 args 控制；不指定 groupBy 的 overview 是时间窗口。组件只看字段和单位，数据无需来自对话摘录或某个固定主题。

```sh
node scripts/trajectory-report.mjs prepare --connection <host.json> --case <key> --plan <sources.json> --bundle <bundle.json>
```

prepare 返回列名、单位、覆盖和少量位置示例；选中原文额外提供有界摘录与续读参数，完整数组保存在 bundle。重要判断仍应沿关联原文核对行动、反馈及后续，再写成解释；保存原文与读过原文分别记录。重复 prepare 会复用同一计划的冻结数据；修改范围或 snapshot 则重新读取。需要更多具体行 ID 时，可用原 inspect 的 data 格式缩小范围读取。序列图的行 ID 为 `record:<seq>`；其节点标题与说明由已经读过原文的作者归纳。

## 使用 Eval 指标

先用现有查询取得 `reportSource`，把它放进第一项 `evaluation.source`。其余表通过 `from` 复用这份来源。CLI 使用与 Eval 页面相同的统计代码，保留会话、日志身份和切点。需要多轮范围时在 `evaluation` 里给 `turns`，范围合计会重新计算。

```json
{"schema":"trajectory-report-plan/1","sources":{"summary":{"evaluation":{"source":{"host":"codex","session":"从查询复制","snapshot":"从查询复制","log":"从查询复制","cut":123},"table":"summary"}},"tools":{"evaluation":{"from":"summary","table":"tools"}},"rounds":{"evaluation":{"from":"summary","table":"turns"}},"causes":{"evaluation":{"from":"summary","table":"error-types"}},"windows":{"evaluation":{"from":"summary","table":"window-bands"}}}}
```

| 表 | 内容和适合回答的问题 |
| --- | --- |
| summary | 调用结果、归因覆盖、计时覆盖、用量和模型计时，先交代任务的规模与主要投入 |
| turns | 逐轮相同指标，找集中报错、等待或输出较多的阶段 |
| tools | 调用量、报错占比、累计耗时、P50/P95 和归因覆盖，区分频繁工具与单次慢调用 |
| calls | 与 Eval 相同起止规则的逐次调用和耗时，可画耗时分布或选定调用的时间线 |
| errors | 逐次错误的原因、确认程度、同参返回和间隔，核对反馈怎样被处理 |
| error-types | 按原因和确认程度归并，点选可回查代表记录 |
| requests | 实报输入和输出、请求窗口占用、模型及已配对工具结果，适合做指标交叉 |
| models | 已记录模型的请求样本、输入输出分布及配对工具结果，结合任务与窗口范围比较 |
| window-bands | 按有容量记录的请求窗口占用分档，同时保留请求数和已知工具结果数 |

`models` 和 `window-bands` 的报错占比以明确关联到请求的已知工具结果为分母。无配对结果保留空值。窗口容量来自同一请求的记录，缺少容量的请求仍在请求表中。比较分档时同时展示请求样本与工具结果样本。

`longCalls` 和 `longDurationShare` 统计 ≥30 秒的调用及其累计耗时占比；累计耗时会分别计入重叠调用。同参非报错返回表示同一轮内后续出现了相同参数的非报错返回，完成情况继续沿原文与产物核对。

用 table 把数量、占比和分位数放在同一行，或用 trend 找阶段变化，再下钻原文。两个组件都引用现有行和字段。

```json
{"id":"tool-profile","type":"table","data":"tools","fields":{"label":"name","value":"calls"},"series":["calls","errorRate","durationSumMs","durationP50Ms","durationP95Ms"],"sort":"descending","limit":10}
```

```json
{"id":"error-trend","type":"trend","data":"rounds","fields":{"x":"turn"},"series":["errors"],"title":"报错集中在哪些轮次"}
```

报告中的点和表格行会展示关联记录。记录按钮可复制对应宿主的取证查询，已选入报告的原文摘录会在详情中显示。来源和完整读数可继续展开。

## 写 Markdown 并渲染

````markdown
# 直接说明主要判断

先解释发现和比较对象。

```report-figure
{"id":"duration","type":"histogram","data":"steps","fields":{"value":"wallMs"},"title":"活动步骤耗时分布"}
```

解释这项发现对任务意味着什么，下一次先改哪一步，怎样检查改法。
````

```sh
node scripts/trajectory-report.mjs render --markdown <report.md> --bundle <bundle.json> --output <report.html>
```

绑定错误返回 Markdown 块、行号和原因。修正相关声明即可；改文字或版式不需要重新取数。输出是自包含 HTML。原事件身份和正文指针随图保存，宿主尚未提供完整正文打开桥时可查看保存的证据位置。

### 使用诊断模板

渲染时加 `--template diagnostic`，统一提供标题、可展开章节导航、编号、字体和留白。普通 H2 保持正文顺序；`## [pair] 标题` 组织图前解释与后面的图文，只有正文宽度足够时才并排；`## [actions] 标题` 将有序列表排成行动区，`## [sources] 标题` 折叠详细口径。标题始终独占一行，窄屏顺排。开头可放一句判断的引用块和一张 metrics；不必填满所有区域。模型只选择内容与位置，不写 CSS，也不用把每一节强行配图。

snapshot 失效时先重新 inspect，核对日志身份和切点再续读；同批读取共享身份失效后停止该批，避免重复使用旧 ID。写 Markdown/JSON 时使用文件写入工具或正确的字面量，避免 shell 再解释反引号；渲染结果会返回实际装配的图表清单。

来源构成是估算；与实报 usage 分别解释。比例用互斥且同单位的分项，不把合计再加进分项；token 比例不是费用比例。两个切点的净差包含其间新增和移除，比较单次转折时优先选择相邻记录。图形不能从数值比例补造结构。

## 画有依据的流程图

当分支、不同对象的依赖或处理后的汇合影响结论时，使用 `flow`。先读原文，确认边所表达的关系，再给节点和连线。时间相邻、相似错误或相同工具名本身不足以产生一条边；两项修改来自同一次调用时，分支只可表达已经核实的对象或依赖关系。图形不默认表示并行，也不把最后一个节点标成成功。

| 问题 | 优先组件 |
| --- | --- |
| 哪些分支、前提或依赖最终汇合到同一结果 | flow |
| 一条行动、反馈和后续结果的先后链 | sequence |
| 实际区间是否重叠，等待发生在哪里 | timeline |
| 上下文片段如何保留、追加和替换 | assembly |

一张图聚焦一个过程，通常 4–8 个节点最清楚。全量轨迹继续用轨迹树；需要比较多个指标时使用统计图；只有错误字符串、尚未核实后续或关系时，先补足分析再写最终报告。循环按实际发生的尝试展开，避免用一条回边暗示没有观测到的重试。

```json
{"id":"repair-flow","type":"flow","data":"records","title":"两项处理汇合到同一次验收","nodes":[{"id":"feedback","row":"record:10","label":"检查给出两项反馈"},{"id":"first","row":"record:12","label":"修正第一项"},{"id":"second","row":"record:14","label":"修正第二项"},{"id":"verified","row":"record:18","label":"共同验收结果","kind":"result"}],"edges":[{"from":"feedback","to":"first","label":"反馈指向此处","evidence":["record:10","record:12"]},{"from":"feedback","to":"second","label":"另一项反馈","evidence":["record:10","record:14"]},{"from":"first","to":"verified","label":"纳入同次验收","evidence":["record:12","record:18"]},{"from":"second","to":"verified","label":"纳入同次验收","evidence":["record:14","record:18"]}]}
```

这是字段绑定示例，行 ID 替换为已经取证的数据。节点用 `id` 标识、`row` 绑定一项有原文位置的数据、`label` 写短标题，可加 `detail`。`kind` 为 `action`、`decision` 或 `result`，只改变形状；条件节点的说明保留在点选读数中。多个节点可引用同一条实际调用，例如一次补丁分别修改两个有不同后续依赖的文件。

节点可用 `outcome:error|returned|unknown` 明确标注原记录中的调用结果，不根据标题、退出码之外的猜测或末尾位置自动着色。`returned` 表示此次调用返回未报错，任务是否完成仍由实际产物和验收确认。报告作者对多条记录形成的判断用 `basis:"analysis"`，显示为带文字标识的蓝色虚线框，与 `outcome` 互斥；其绑定数据行的 `evidence` 应包含支撑结论的原始记录位置。未给 `outcome` 和 `basis` 的旧节点保持中性。原文仍逐条读取，不将分析结论伪装为原生事件。

| 边的 kind | 视觉 | 需要核实的关系 |
| --- | --- | --- |
| sequence | 灰色点线 | 记录中的行动、反馈或结果先后，不声称因果 |
| dependency | 蓝色实线 | 明确的文件生成、工作前提，或结论对证据的依赖；label 说明具体是哪一种 |
| recovery | 青色虚线 | 针对此次失败已经发生的恢复处理；是否恢复成功由后续结果另行标明 |
| alternative | 琥珀色点划线 | 记录中实际采取的替代路径，不画尚未发生的建议路线 |
| propagation | 红色实线 | 原文确认某处错误被另一执行层抛出、转换或返回；需核对具体异常或错误传递机制 |

关系类型控制线型和颜色，不能代替关系短句与证据。只有父子调用 ID、同类错误或时间邻接，不足以标 `propagation`。不提供 `kind` 的旧边仍为中性关系；渲染器不根据节点的报错状态补出传播边。四种处置方向属于通用诊断方法，不是图里的错误类型，也不生成自动修复按钮。

每条边明确给 `from`、`to`、关系短句 `label` 和 1–6 个 `evidence` 行 ID。点节点展示本项依据，点连线展示支撑关系的原文。渲染器比较横向与纵向布局，分散端口，为跨层边保留通道，并避让卡片与标签；也可给 `orientation:"horizontal"|"vertical"` 固定方向。短链通常横向，分支较多时优先减小横向跨度，不缩小文字。最多 18 个节点、28 条连线；不接受不存在的端点、未绑定依据的边或循环。关系是否成立由作者沿原文核实。复杂图仍应按问题拆开，布局不是任意网络的排版引擎。窄屏只在图内横向浏览，完整指针在点选面板保留；超过三项的节点引用显示首项、末项与省略标记。

实际例子：PowerShell 在 #4564 使用花括号路径，#4565 返回参数列表语法错误；#4566 改成逐个完整路径，#4567 已返回目标文件命中。可把失败、改参和返回标成记录层，把“本例已恢复”标成分析层，结论同时引用前后记录。#3593 的活动日志读取冲突，则在 #3596 采用共享读取后由 #3597 返回成功；这里能确认读取端调整后完成调用，不能画成写入进程已停止或文件占用已消失。两例均来自本地冻结会话 `01a1bbb7-9440-7951-9716-2ed762a7e1fa`，切点 #4835，演示位于 `.dsh/flowchart-states-20261111/`。
