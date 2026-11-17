# Eval 首次上下文装填 · 交互草案

当前试验 **连续缩放**：以留白矩阵为基础，使用固定空间布局与轻量 Canvas 视图，滚轮围绕鼠标位置缩放、拖动画布、双击平滑聚焦。放大后在原来的矩形中逐步显示真实声明和消息正文，搜索可直接定位小项；面包屑、缩略图与复位保留方向感。页面没有方案导航或分类 Tab。

默认打开 `.dsh/context-light-demos/zoom.html` 或 `/light/zoom.html`。源码为 `light-zoom.js`、`light-zoom.css`，内容索引与完整原文阅读沿用 `light.js`。正文使用原始片段排版，按可见区域绘制，封装项展示计量说明；缩放只改变视野，不模拟内容入队或注入。

上一版 **留白矩阵** 仍在 `matrix.html`：只保留范围、搜索、装填回放和内容索引，通过双击矩形或摘要入口放大分组，放大与返回保留位置过渡。

入场动效按冻结请求的真实事件时间和 seq 排列：seq 15–22 共 8 次写入，时间跨度 5ms，播放放慢约一秒。同一条消息的内部片段整组进入，49 项工具声明随一次 `request/header` 记录整体进入；不推断系统提示内部时刻或工具注册顺序。矩阵位置和面积保持最终请求的估算比例。开始操作会结束回放；系统偏好减少动态效果时直接展示完整矩阵。

正式 Eval 首页使用当前配置的静态计量，`runtimeObserved:false`；动态生成的内容保留为待组装，不能据此断言每一项每轮都会进入请求。本 Demo 使用真实冻结请求，二者口径不混用。

此前的三版 **极简明亮 HTML Demo** 仍共用同一份样本与内容入口，阅读版和总览版保留用于对照：

- **留白矩阵**：整幅矩阵比较占用，按类别放大；点选后在图下查看摘要，进一步打开正文。
- **分层阅读**：按原生 `messages[]`、`tools[]` 层级浏览，直接阅读消息、工具用途与参数；可切换完整原文。
- **内容总览**：工具矩阵、系统与指令、本轮信息、Skill 目录各有入口；各面板服务于阅读，只有工具矩阵内部编码面积。

三版均支持名称、字段、原文搜索与完整索引，保留实际 seq 和请求字段位置。冻结样本为 2026-10-26 的 DSH 会话，不代表当前本机上下文。合计 13,085 tokens 为固定文本密度估算，非供应商实报用量；不推断系统提示内部装配时刻或工具注册时间。

```sh
node scripts/build-context-light-demos.mjs
node scripts/serve-context-loading-demo.mjs
```

默认入口为 `/light/zoom.html`。无需服务时，直接打开 `.dsh/context-light-demos/zoom.html`；此前的矩阵为 `matrix.html`，旧对照版为 `reader.html`、`overview.html`。每份 HTML 内嵌样式、脚本、字体与真实记录。含会话正文的生成文件仅写入忽略目录，不进入文档源码。

源码为 `light.html`、`light.css`、`light.js`；复用 `preset-context/treemap.js`。这是独立交互草案，尚未替换正式 Eval。

以下保留已停止的矩形组装方案与更早草案，供设计对照。

**旧矩形树图工作台**：`matrix.html`、`matrix.css`、`matrix.js` 是页面源码，`scripts/build-context-loading-matrix.mjs` 生成 `.dsh/context-loading-matrix/index.html`。

页面的结构与操作：

- 先按真实请求字段分成 `messages[]` 与 `tools[]`，再拆到消息段落、环境分节、Skill 目录条目和每项工具声明。复用现有 `preset-context/treemap.js` 的面积排布，不放大小项伪造占比。
- 上方事件索引保持真实写入顺序，与矩阵选区和右侧内容联动。小消息可从索引进入，不依赖极窄矩形。工具数组位置不冒充插件注册时序。
- 点击字段或“放大分区”进行层级查看，面包屑返回。搜索同时检查名称、原文与字段地址，保留未匹配内容作参照；内容索引提供全部片段的可读入口。
- 小工具块使用原始 `tools[]` 索引，例如图中 `[41]` 对应详情的 `tools[41]`。右侧查看实际正文、声明、装入记录和计量依据，可展开完整原文；支持方向键选择、Escape 返回及本地保存选择状态。
- 矩阵面积表达估算体积，局部蚀刻纹理区分内容形态；静态索引承担时序，不加入自动回放。固定密度估算与引导／封装项独立保留，不伪装成供应商 token 实报。

在仓库根运行：

```sh
node scripts/build-context-loading-matrix.mjs
node scripts/serve-context-loading-demo.mjs
```

旧矩阵通过 `/matrix.html` 查看。无需服务时，直接打开生成的 `.dsh/context-loading-matrix/index.html`；不直接打开尚未绑定数据的源模板 `matrix.html`。本页绑定冻结会话的首次请求切点，不代表当前本机上下文，也没有替换正式 Eval。

`circuit.html` 保留上一轮视觉参考：浅色走线、局部蚀刻纹理与静态接合。每种来源的纹理在接入请求后保留，接口按真实逻辑消息顺序排列；点选来源可高亮对应走线、消息位置和原始事件说明。

直接用浏览器打开 `circuit.html`，无需构建或启动服务。它是完整独立页面；可编辑源片段保留于 `circuit-source.html`，对话内预览仍保留原文件。页面没有自动回放。图中的事件编号、7 段消息和 49 项工具声明摘自已有冻结会话，不代表当前本机上下文；纹理不是 tokens 或耗时编码，也不推断系统提示内部各节的装配时刻。

也可在仓库根运行本机预览：

```sh
node scripts/serve-context-loading-demo.mjs
```

访问 `/circuit.html` 可对照上一轮视觉参考。

`native.html` 保留上一轮真实事件回放方向：先显示入队、取出，再把内容移动到官方 SurfaceManager 给出的消息位置；每个切点显示原始 seq 和时间，消息可点选原文。

`scripts/build-context-loading-native.mjs` 绑定本机已有冻结日志 `.dsh/diagnostic-pilot/repair/events.jsonl`，截取首条模型消息之前的准备阶段。含会话正文的生成数据与可独立打开的页面只写入忽略目录 `.dsh/context-loading-native/`，不纳入文档源码。这个历史会话不代表本机当前配置。

如需查看旧的 `native.html`，先生成它绑定的本机数据：

```sh
node scripts/build-context-loading-native.mjs
node scripts/serve-context-loading-demo.mjs
```

访问 `/native.html` 可查看该回放草案，可随时暂停与逐事件查看；减少动态效果偏好下直接展示最终切点。也可直接打开生成的 `.dsh/context-loading-native/index.html`。回放时间经压缩，消息尺寸仅用于阅读；最后的 `request/context` 是配置元数据，不代表记录到了实际发送事件。图中结构为供应商适配前的逻辑消息位置。

`constellation.html` 保留来源环绕与分支汇合的草案。该方案使用示例数据，阶段为人为编排，不能说明实际的装配时序。

`assembly.html` 保留刻度与分栏的请求结构草案：概览以 tokens 为长度，局部放大所选内容层。图幅 10k 是示例的显示范围，不代表模型窗口。

`flow.html` 保留上一轮报告流程图方向：浅色节点、折线箭头与分支汇合。首次装填、Skill 按需展开、条件补充共用这一视觉语言。布局与避让直接调用 `report/flow.mjs`，不构造虚假的记录或证据序号。

更改旧流程图草案的结构后，运行 `node scripts/build-context-loading-flow.mjs` 更新 `flow-layouts.js`。旧草案支持本地直接打开。

上一轮草案保留在 `index.html`：

- `index.html?view=sequence`：来源按阶段加入请求；条长表示 tokens。
- `index.html?view=flow`：提供方 → 内容类型 → 请求，区分来源归属与加载形式。
- `index.html?view=layers`：拆开与合拢请求各层，保留内容身份。

三案共用示例数据、阶段控制和详情。支持暂停、逐步前后、进度拖动、选择具体项、浅深色和减少动态效果偏好。

除三版明亮 Demo、旧矩阵、`native.html` 与 `circuit.html` 外，旧草案的内容与顺序均为设计示例，不是宿主请求实录。Skill 目录与正文分开；条件注入未触发时保留未计量状态。配置快照只能支撑来源与静态计量，不能反推装填时序。

这是独立的前端研究页，不替换正式 Eval，也不修改插件注册或配置策略。
