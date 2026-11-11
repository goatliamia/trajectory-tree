# 诊断工具与提示词

工具负责取证，模型结合任务解释，建议的实际收益用相应任务验证。当前安装和宿主入口见 [README](../README.md)；本文索引分析方法及其职责。

## 当前使用

- [Pi / Codex 适配](portable-analysis.md)：同一组四工具、原生来源、使用入口与验证边界；不改变 DSH 的既有安装。
- [安装、参数与调用](../plugin/trajectory-tools/README.md)：四个只读入口，范围/对象查询、关联阅读与正文续读。
- [诊断提示词](diagnostic-prompts.md)：过程诊断、静态剖面两个短入口、按需方法和报告规则；由包内源文件生成，不整篇注入。
- [处置与知识保留](../skill/trace-analysis/references/disposition.md)：各类分析共用的修复、恢复、补能力与保留知识的方法；同一问题可组合处置方向。
- [代码执行诊断](../skill/trace-analysis/references/code-execution.md)：从 PowerShell、命令与 PTC 的实际执行链核对失败、处理和结果；Eval 的代码执行区可直接装填相同方法。
- [报告写作](../report/WRITING.md)与[组件绑定](../report/AUTHORING.md)：主要调查完成后交付结论、依据和处理结果；流程图表达已经核实的分支、依赖与汇合。
- [静态剖面与能力保持](static-context-profile.md)：解释构成、作用、使用与保留价值，核对工具变更的受影响场景。
- [取证实现](trajectory-tools-design.md)：官方统计、切点、缓存与读取校验。

包内 `dsh-trajectory-tools/prompts` 导出入口、方法、共同规则与版本。`lib/skill.js` 是查询 skill 的维护来源；`scripts/sync-diagnostic-prompts.mjs` 生成文档和 skill 镜像，`--check` 检查漂移。

## 范围

已有过程总览、官方步骤统计、同切点范围切换、工具/文件聚焦、有限分组排序、关联阅读、完整字段续读及原文身份校验。`run_code` 等展开后的外层调用也可按真实名字追查。

静态入口使用已有构成估算、历史声明与使用背景。历史清单与实际执行时收到的能力分别核对。轨迹树和 Eval 点选复用既有查询并装填诊断草稿；代码执行区保留原生调用结果，补充可稳定识别的信号、代码位置及 PTC 父子关系。HTML 报告使用同切点 Eval 数据和选定原文，不自动执行修复或写入长期指导。

工具体积、返回规模和近期未调用只描述开销与使用；涉及加载、参数、搜索范围、返回完整性或错误恢复的改动，需说明受影响场景并保持用户需要的能力。允许有理由地建议保留配置。

## 历史与实验

[三会话再试](archive/diagnostic-experiment-v3-results.md)、[首轮试跑](archive/diagnostic-pilot-results.md)保留真实试验范围与开销，不作为后续文字修订已重跑的证明。[方法复盘](archive/diagnostic-method-and-tools.md)、[上下文适配](archive/context-evidence-interface.md)和[机制研究](injection-provenance-research.md)保留设计依据。

`diagnostic-prompts-draft.md`、`diagnostic-analysis-v2.md`、`diagnostic-analysis-v3.md` 是历史草稿/实验材料。当前使用版以包内导出和生成文档为准。

原始会话、私有报告、冻结代码、查询记录及构建数据留在 Git 忽略的 `.dsh/`，不随包或仓库提交。概念 demo 独立于生产页面。

## 历史版本 0.5.1 验证

运行插件目录的 `npm test`、`node scripts/sync-diagnostic-prompts.mjs --check`、`node scripts/sync-inspect-models.mjs --check`及上下文适配器测试；以冻结长会话核对保留预算与外层调用查询。最终 tarball 解包后重复插件检查。

独立原生工具定义的官方估算为 789 token（0.5.0 为 749）；增加部分用于调用前的参数发现。查询 skill 正文为 576 字符（0.5.0 为 942）。它们不是模型账单，也不包含 Code Mode 目录或整次分析消耗。缓存维持合计 16 MiB 的保留数据估算预算、最多四个快照、闲置 120 秒释放，预算不代表进程 RSS。
