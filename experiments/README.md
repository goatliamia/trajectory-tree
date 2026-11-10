# experiments(流水线约定)

流程:`语料 → 探针 → 运行 → 盲评 → 报告`

| 目录 | 内容 |
|---|---|
| `corpus/` | 语料说明与生成脚本(burner 会话 / 合成体制) |
| `probes/` | `probes.json`(问题集)+ `keys.json`(答案键;**作答者不得打开**) |
| `raw/` | 运行原始记录(作答输出、工具调用日志、token 计数) |
| `reports/` | 评分后报告(`tier0-results.md` 等) |

红线:

1. **双盲**:准备键与作答分离;评分子代理不知臂别。
2. **verbatim 自动校验**:引文字符串逐字查日志;指针 decode 后查事件。
3. **指标**:正确率 / 幻觉率 / 引用有效性 / verbatim 命中 / 每探针 token / find 使用率。

## 任务验收 Eval

使用 Node 24 和本地 `.dsh/diagnostic-pilot` 冻结语料。以下命令在仓库根目录运行。第二组案例为 `long-session-browser`，每组都可选 `full` 或 `withheld`。

```powershell
node experiments/corpus/acceptance-eval.mjs prepare client-self-test full > .dsh/acceptance-packet.json
node experiments/corpus/acceptance-eval.mjs score client-self-test full .dsh/acceptance-verdicts.json
node --test experiments/corpus/acceptance-eval-test.mjs
```

评估者只接收第一步输出的证据包，按其中的 `rubric` 返回判定 JSON，并保存为第二步读取的文件。证据包和作答保存在本地。评分时按冻结源哈希重建证据包，检查切点、引用、三态判定与参考锚点。判定和参考锚点分别计数，证据不足却给出确定结论另计。参考答案只在评分时读取，理由是否准确仍由复核者核对。 [判据与案例](../docs/runtime-analysis-research.md#首项判据-验收达成)
