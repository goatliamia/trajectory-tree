# 当前上下文侧栏

DSH 会话输入 `/context-map`，直接在右侧栏打开当前保留上下文。沿用轨迹图的七类分类，不增加独立分类规则。

## 数据与交互

- 内容来自原生保留面、消息投影和最后有效的工具声明。压缩后的摘要与仍保留的消息显示在当前构成中；被替换或裁剪的历史内容不混入。
- 面积表示内置 token meter 的估算，不代表提供商返回的输入量。读取不到原生保留面时明确显示不可用。
- 分类开头有细线、色标和名称。滚轮连续缩放、拖动平移，双击进入或返回；单击打开原文，搜索后 Enter 定位。全图与刷新保留为文字操作。
- 正文按点击读取，每次最多追加 64 Ki 字符。内容发生变化时旧快照正文不会串入新视图。

## 开销与释放

侧栏只接收片段元数据和短预览。隐藏时取消请求、销毁画布观察器并停止绘制；活动时按保留面变化合并刷新，没有逐帧轮询。

服务端保留最多两份正文快照，总计不超过 16 MiB，闲置 90 秒过期。超出上限仍返回元数据并标明正文不可用。同一版本的并发请求进入既有队列后再次检查缓存，避免重复投影。

此前 800k 合成 token 权重、320 万字符的渲染压力回放，800 块的首图约 30ms、绘制 p95 1.9ms；5,000 块约 67ms、p95 1.0ms，停止后额外空闲绘制为零。这些是轮次布局阶段的渲染器测量，不能当作最终分类侧栏的端到端耗时或常驻内存数据。最终分类侧栏已在真实会话核对 477 个片段及空闲停止绘制。

## 字体与语言

侧栏和 Eval 使用包内 Geist / GeistMono 可变字体，保留系统中文字体回退；画布读取同一套 CSS 字体变量。字体加载完成只请求一次必要重绘。

界面跟随宿主语言，显式 URL 或已保存偏好沿用既有优先级。构建时仅转换作者写的界面字面量，插值中的工具反馈、文件名与正文保持原文；原生侧栏不会遍历或翻译 DSH 的会话 DOM。首页、侧栏、诊断常用文案使用整句/短语翻译。

## 源码与检查

| 层 | 入口 |
| --- | --- |
| 保留面与分类 | [request-context.js](../plugin/trajectory-tools/lib/request-context.js) |
| 快照与原文接口 | [current-context-service.js](../plugin/analysis-view/lib/current-context-service.js) · [原生路由](../plugin/analysis-view/lib/index.js) |
| 侧栏注册 | [client.js](../plugin/analysis-view/lib/client.js) |
| 视图源码 | [model.js](../view/current-context/model.js) · [panel.js](../view/current-context/panel.js) · [panel.css](../view/current-context/panel.css) |
| 共用缩放 | [zoom-treemap.js](demo/preset-context/zoom-treemap.js) |
| 语言与资源生成 | [ui-locale.js](../view/assets/ui-locale.js) · [字面量编译](../scripts/ui-literals.mjs) · [资源同步](../scripts/sync-view-assets.mjs) |
| 定向回归 | [保留面与异步释放](../plugin/analysis-view/current-context-test.mjs) · [宿主语言](../view/assets/ui-locale-test.mjs) · [浏览器交互](../test/browser/eval-host-test.mjs) |

CR 的四文件定向扫描未报告编译器诊断、闲置局部绑定或文件环。缓存发布顺序目标有覆盖；异步读取/释放的两项目标仍为 pending，以失败读取及销毁竞争的实际回归补查。CR `compare-trial` 对 1/2/4/12 个同版本请求比较响应，元数据、正文与释放结果不变，投影次数分别为 1→1、2→1、4→1、12→1。此结论只覆盖所声明的输入与成本。
