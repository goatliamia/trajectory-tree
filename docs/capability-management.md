# 加载项停用与生命周期核对

当前入口是 DSH 左侧 Eval 的右侧 Skill 抽屉、工具与插件详情，以及「管理加载项」抽屉；[独立预览](demo/preset-context/README.md)保留同一套页面。已核对 DSH `0.2.2-rc.3`，使用原生配置与 Skill provider 生命周期。

## 交互与作用域

Skill 抽屉以 Skill 为主体，汇总全部预设的现有使用记录；按 session/seq/kind 去重，不把进入抽屉时左侧选中的预设当作全部范围。统计保留在上方，下面逐行显示各预设的开关、读取次数与未提供状态。点击开关后在该行原位确认，不再出现「停用设置 ↗」或第二层确认弹窗。已停用项目的使用记录仍保留。

工具与插件操作也使用原位开关，确认只显示实际范围、连带能力及必要的缓存提示。技术路径与清理研究留在本文；日常界面不再要求用户阅读一整块实现说明。

| 对象 | 路径 | 范围与限制 |
| --- | --- | --- |
| 插件包 | 官方 `PluginManager.readBundles` 清单与保护信息；`dsh-plugin-manager/operations.saveManifest` 写原生 bundle 选择 | `web` profile 全局。保留依赖、安装包和用户数据；拒绝停用官方 `management-required` 包。重新启用执行官方平台与版本兼容检查，按官方规则追加选择顺序。 |
| 有独立开关的工具 | 官方工具 Config：文件工具 `read/readImage/write/edit/applyPatch`，网页工具 `search/fetch` | 通过 DSH 的 `cordis.patch.yml` 配置所选 provider。预设内工具只改该预设；宿主工具影响所有预设。 |
| 无独立开关的工具 | 提供插件的原生 `disabled` 字段 | 确认页列出同 provider 的工具，明确也会影响 provider 的其他能力。不会伪造单工具开关。 |
| 本地与安装包内 Skill | 所选预设内挂载 [skill-policy.js](../plugin/analysis-view/lib/skill-policy.js)，通过官方 `skills.registerProvider()` 提供同名的不可调用覆盖 | 同时关闭模型和用户调用；只影响所选预设。Skill 原文件、个人目录及其他预设不变。恢复时移除此名称的覆盖；列表为空时移除整个策略 entry。 |

独立 Demo 没有 DSH 原生 `ctx.pluginManager` 的运行时连接，使用原生配置格式和官方文件操作。**它报告「配置已保存，运行状态待核对」**。DSH 可能通过 HMR 自动应用；无 HMR 或旧预设 generation 仍被会话持有时，需要重启或新建相关会话。不能以文件写入成功推断已经停用运行时能力。

正式入口在配置锁释放后调用宿主的 `pluginManager.setBundleEnabled` 或 `hmr.reconcileProfile`，按官方返回区分已应用、需要重启和应用失败。没有 HMR 时明确显示重启后生效。它不把官方运行应用成功当作所有外部副作用已清理的证明。轨迹树自身的停用留在 DSH 官方插件管理，避免由正在处理确认的页面撤销自己的服务。

工具确认处保留已有会话缓存复用的提示。Skill 使用原生 preset generation：新会话采用更新后的预设；已经绑定旧 generation 的会话与其中的正文不被伪装成已撤回。抽屉开关表示预设配置，保存反馈明确说明新会话生效。

## 可撤回覆盖与原生清理

独立研究提出过「构造式撤销记录」这一档，而不只建议三态展示。本轮对 Skill 采用可直接实现的方式：**停用增加预设内覆盖，恢复撤回覆盖**。注册与撤回由原生 SkillRegistry / ScopedLayers / Cordis 托管，不另设一个依赖插件自报的删除表，也不通过改共享文件实现预设开关。

覆盖提供者属于所选预设 scope；同 scope 的不可调用项覆盖原目录项，其他 scope 不受影响。调用开关使用官方 `modelInvocable` / `userInvocable` 策略。该 entry 被移除时，原生 registry 撤掉 provider、取消其生命周期并失效目录缓存，原 Skill 自然重新可见。

**修正上一轮推断范围**：下面的 `lying-disposer` 夹具使用外部工具桩表，不是 DSH 的 ToolsService。它证明任意副作用不能由回调成功推出已恢复，不能证明官方 `tools.register()` 也会留下工具。本轮直接用已安装 rc.2 的原生服务验证：

- `tools.register()` 创建的真实登记，即使插件自己的 disposer 为空，卸载后仍由原生 effect 移除。
- Skill provider 在单一 scope 屏蔽两种调用入口，另一个 scope 继续读取原正文；撤掉策略 provider 后，原正文与调用策略恢复。即使插件额外返回空 disposer，这一撤回仍成立。

见 [原生运行时测试](../scripts/dsh-native-policy-test.mjs)。这部分有直接可执行的恢复机制；任意插件绕过托管写出的外部文件、外发消息等仍不能根据名称或时间差盲目删除。

## 研究来源与 rc.2 复测

研究在独立仓库，**CR 是理论对应的代码底座，不是研究记录的出处**：

- [math-to-engineering 的插件生命周期记录](../../math-to-engineering/notes/plugin-lifecycle.md)。
- [独立 reversibility-standalone 证明与方案](../../math-to-engineering/proof/reversibility-standalone/README.md)及[对应边界](../../math-to-engineering/proof/reversibility-standalone/CORRESPONDENCE.md)。
- 本次使用 CR checkout `C:/Users/14100/Documents/ChatGPT/cr/worktrees/python-rust-code-mapping` 的 `code_relations.change_goals.compare` 比较同一观察目标的前后结果，保留覆盖状态。

2026-11-13 以已安装的 rc.2 Cordis 运行三个隔离夹具，观察者独立读取工具桩表的名称与身份，以及专用夹具目录的文件内容摘要。没有加载用户插件，没有改真实 profile：

| 夹具 | disposer 返回 | 卸载后独立观察 | CR 比较 |
| --- | --- | --- | --- |
| 正常 `ctx.effect` 登记与撤回 | 成功 | 回到观察基线 | `unchanged` |
| disposer 声称撤回，但没有删除注册项 | 成功 | 工具桩注册仍存在 | `changed` |
| 通过文件系统写入 Cordis 之外的文件 | 成功 | 文件仍存在 | `changed` |

结论限于**任意或绕过托管的副作用缺少通用逆审计**。rc.2 官方管理器已有 bundle 保护、先停用再移除、HMR、失败与重启结果，官方 registry 自身也持有登记的撤销；不把外部桩表的反例扩大成原生注册表清理失效。

复测脚本：[probe-dsh-teardown.mjs](../scripts/probe-dsh-teardown.mjs)。本机收据位于 `.dsh/teardown-review/report.json`，保留独立快照、disposer 报告、三个核对项和 CR 完整结果。专用目录中的残留是有意保留的复现实验材料。

## 判定与处理

[lifecycle-observation.mjs](../lib/lifecycle-observation.mjs)核对三件事：

1. 观察到的加载增量是否等于登记项。
2. 观察到的撤回增量是否等于 disposer 的撤回报告。
3. 卸载后的观察是否回到加载前基线。

只有独立、完整且具名的观察面全部通过，才给 `verified-reversible`，且结论只适用于该观察面。明确披露保留效果、且其余核对成立时为 `declared-irreversible`；无观察、无基线或不匹配为 `unknown`。单纯收到 disposer 成功返回、读取一个空数组或仅知道服务名，均不能当作清理证明。

现有真实插件缺少加载前基线，Demo 也没有连接其运行时观察者。因此真实操作收据的运行状态为 `not-observed`，副作用清理为 `unknown`。保存前后只核对原生配置，保留变更及原文备份。发现残留需要按插件的资源责任补 disposer 或增加专门观察者，不能靠扫描并删除用户文件、终止未知进程“修复”。

## 实现与验证

- [配置适配](../scripts/dsh-management-config.mjs)：使用本机 SDK 的 composer、清单、兼容检查和原子写入；不运行被管理插件。带 `!!js` 的配置保持惰性标记。
- [操作服务](../scripts/dsh-management.mjs)：服务器按预设枚举目标、五分钟单次确认票据、同一 profile 的官方文件锁、源配置及目标文件前像校验、备份与操作收据。Skill 不再写共享 frontmatter 或项目副本。
- [HTTP 边界](../scripts/dsh-management-http.mjs)：绑定 loopback、核对 Host/Origin、随机管理凭据、限制请求字段与体积。客户端不能提交任意文件路径或命令。
- [界面](demo/preset-context/capability-management.js)：右侧抽屉、按预设开关、原位确认与保存反馈。
- [隔离测试](../scripts/dsh-management-test.mjs)：确认前不写入、预设隔离、表达式与注释保留、成组影响、并发变更拒绝、Skill 覆盖恢复且原文件不变、插件包保留与重新启用、请求权限边界、观察判定。

独立配置适配对预设使用完整原生 `config` 覆盖，这是 composer 的替换语义；这份覆盖会固定其中的配置，后续 DSH 升级需复核官方默认值变化。动态配置、无法完整读取的清单、原生管理所需条目及更高优先级覆盖接管的条目，不冒充可安全变更的对象。原生运行时接入后应直接调用 `ctx.pluginManager` / 配置编辑器，并补同源观察；当前不能对外标记这一步已经实现。
