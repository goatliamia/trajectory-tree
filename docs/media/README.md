# README 展示素材

封面由 imagegen 生成。左侧的原始日志接入主干，右侧展开成枝条。[查看封面](trajectory-tree-cover.png)

README 的三组截图由当前轨迹树、Eval 和 DSH 诊断界面渲染，同用一个公开合成会话。Eval 耗时取自样例的模拟起止记录。上下文趋势、装配和报告使用各自的合成示例。

运行 `node scripts/build-readme-media.mjs --serve 3099`，打开 `/path`、`/eval` 或 `/diagnosis`；在路径后加 `-en` 可打开英文页面。其余示例在 `/context`、`/assembly` 和 `/report`。

安装 `test/browser` 的 Playwright 依赖和 Chromium 后，可用 `node scripts/build-readme-media.mjs --capture` 重新截取中英文图片，输出到 `.dsh/readme-media/captures/`。

- [轨迹树](trajectory-overview.jpg) · [English](trajectory-overview-en.jpg)
- [Eval 轮次对照](eval-overview.jpg) · [English](eval-overview-en.jpg)
- [行动路径诊断草稿](diagnosis-draft.jpg) · [English](diagnosis-draft-en.jpg)
- [上下文趋势](context-trend.jpg) · [上下文装配](context-assembly.gif) · [示例诊断报告](diagnostic-report.jpg)
