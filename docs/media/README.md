# README 展示素材

封面由 imagegen 生成。左侧的原始日志接入主干，右侧展开成枝条。[查看封面](trajectory-tree-cover.png)

DSH 首页截自独立的 DSH Web rc4 profile 中实际加载的轨迹树插件。轨迹、选区、Eval 和报告使用两项目、四会话、64 轮的公开合成事件。轨迹样例中的 16 轮、60 次请求经过 DSH 的消息投影和 Token 估算，截图前会检查可见的上下文增量。Antigravity 总览使用四个虚构对话，复用插件的统计函数和界面。图中的 Model A、B、C 均为示例名称。

运行 `node scripts/build-readme-media.mjs --serve 3099`，打开 `/path`、`/eval`、`/global-eval`、`/diagnosis` 或 `/report`；在路径后加 `-en` 可打开英文页面。上下文示例在 `/context`、`/assembly`。

复现使用 Node.js 24、DSH 0.2.2-rc.4 及其 SDK、`test/browser` 的 Playwright 和 Chromium。用 `--dsh` 启动隔离的原生 Web profile，用 `--animation` 通过 FFmpeg 将 13 个实际装配切点导出为 GIF。素材先写入 `.dsh/readme-media/captures/`，`--publish-captures` 将本次生成的图复制到本目录。[公开事件样例](../../scripts/readme-fixtures.mjs) · [原生面板截图](../../scripts/capture-readme-hosts.mjs)

```sh
node scripts/build-readme-media.mjs --capture --dsh --animation --publish-captures
```

- [轨迹树](trajectory-overview.jpg) · [English](trajectory-overview-en.jpg)
- [DSH Eval 预设首页](dsh-preset.jpg) · [English](dsh-preset-en.jpg)
- [Antigravity 跨对话用量](antigravity-usage.jpg)
- [Eval 轮次对照](eval-overview.jpg) · [English](eval-overview-en.jpg)
- [项目总览](global-eval.jpg) · [English](global-eval-en.jpg)
- [窗口占用交叉对照](window-comparison.jpg) · [English](window-comparison-en.jpg)
- [代码执行](code-execution.jpg) · [English](code-execution-en.jpg)
- [程序诊断线索](diagnosis-signals.jpg) · [English](diagnosis-signals-en.jpg)
- [行动路径诊断草稿](diagnosis-draft.jpg) · [English](diagnosis-draft-en.jpg)
- [最终报告](diagnostic-report.jpg) · [English](diagnostic-report-en.jpg)
- [上下文趋势](context-trend.jpg) · [上下文装配](context-assembly.gif)

The screenshots are generated from public synthetic fixtures. The two-project, four-session Eval example includes 64 turns, explicit usage/capacity pairs, PowerShell feedback, read guards, PTC child calls and later test results. The report uses the same captured Eval cut and evidence-bound flow component. All counts and timings are illustrative.
