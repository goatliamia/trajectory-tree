# README 展示素材

封面由 imagegen 生成。左侧的原始日志接入主干，右侧展开成枝条。[查看封面](trajectory-tree-cover.png)

README 截图使用当前界面和公开合成案例，不读取用户的 DSH profile、会话或私人报告。轨迹与选区草稿来自 Pi 样例；新版总览、窗口占用、代码执行、诊断线索和报告来自两项目、四会话、64 轮的固定事件序列。Model A / B 是演示路由，不代表任何模型的实测排名。

运行 `node scripts/build-readme-media.mjs --serve 3099`，打开 `/path`、`/eval`、`/global-eval`、`/diagnosis` 或 `/report`；在路径后加 `-en` 可打开英文页面。上下文示例在 `/context`、`/assembly`。

安装 `test/browser` 的 Playwright 依赖和 Chromium 后，可用 `node scripts/build-readme-media.mjs --capture` 截取 16 张中英文图片，输出到 `.dsh/readme-media/captures/`。加 `--publish-captures` 会将本次生成的图片复制到这里；不会复制其他本地素材。案例源文件在 [readme-fixtures.mjs](../../scripts/readme-fixtures.mjs)。

- [轨迹树](trajectory-overview.jpg) · [English](trajectory-overview-en.jpg)
- [Eval 轮次对照](eval-overview.jpg) · [English](eval-overview-en.jpg)
- [项目总览](global-eval.jpg) · [English](global-eval-en.jpg)
- [窗口占用交叉对照](window-comparison.jpg) · [English](window-comparison-en.jpg)
- [代码执行](code-execution.jpg) · [English](code-execution-en.jpg)
- [程序诊断线索](diagnosis-signals.jpg) · [English](diagnosis-signals-en.jpg)
- [行动路径诊断草稿](diagnosis-draft.jpg) · [English](diagnosis-draft-en.jpg)
- [最终报告](diagnostic-report.jpg) · [English](diagnostic-report-en.jpg)
- [上下文趋势](context-trend.jpg) · [上下文装配](context-assembly.gif)

The screenshots are generated from public synthetic fixtures. The two-project, four-session Eval example includes 64 turns, explicit usage/capacity pairs, PowerShell feedback, read guards, PTC child calls and later test results. The report uses the same captured Eval cut and evidence-bound flow component. All counts and timings are illustrative.
