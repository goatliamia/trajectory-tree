# PR 关系诊断

`relations-ci.json` 声明需要保留的源码关系。CI 比较同一个实际合并提交的第一父节点与合并结果，显示保证保持、保证丢失、候选消除或观察待补。

当前目标包括资源先登记再裁剪、释放 viewer 后释放资源、规范化查询后准备数据、打开目标事件读取器后关闭、载入后构造检查，以及目标事件的两个标识符调用保有源码词法绑定。匿名回调沿所选操作的调用归属取得，不保存跨版本失效的 AST 偏移。普通改行或重排文件不会自动改变逻辑询问。

配置来自基线，候选不能在同一次检查中删除自己的要求。只有首次接入才显式采用候选配置。已答关系与源码覆盖分别报告；两侧同样未知仍不能通过。源码绕过路径是诊断候选，不能直接表述成已执行的错误；绑定存在也不等于外部实现或动态分派已被证明。

## 两项互相补充的检查

`Relation diagnostics` 复用关系引擎的已有诊断、观察运输与目标比较。每侧共享一次源码提取，不执行项目函数。完整 JSON 保留两侧响应、操作位置、检查点、绕过路径和缺失观察；Actions summary 给出简洁结论。`relations/diagnostics` 状态附在候选提交上。

`Native regression` 独立运行合成事件下的实际轨迹阶段、目标阶段更新、来源隔离、读取失败、旧异步结果竞争、资源释放，以及 npm 实际打包文件的加载。它负责验证当前静态目标尚未表达的缓存版本一致性，不访问真实会话或模型服务。

```sh
node --test plugin/analysis-view/goal-events-test.mjs plugin/analysis-view/stages-test.mjs plugin/analysis-view/resources-test.mjs
```

## 私有引擎的接入

分析引擎固定到工作流中的提交 SHA，编译器按该提交的锁文件安装。公开仓库不包含引擎源码。`RELATIONS_ENGINE_READ_KEY` 是仅对引擎仓库有效的只读 deploy key，作为本仓库 Actions secret 保存。

凭据作业使用 GitHub 的 [pull_request_target](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target) 执行可信基线工作流。它只检出可信基线和固定引擎；候选通过 Git blob 导出为封闭源码快照，不执行 PR 脚本、不安装 PR 依赖、不上传引擎文件。合并引用的第二父节点必须对应当前事件的 head，过期事件保留待补。普通 PR 的原生测试另用无私有凭据的作业。

维护者轮换凭据时，在引擎仓库创建只读 deploy key，并替换本仓库同名 secret；不要开启写权限或改变引擎的可见性。升级引擎时显式更新 SHA，并审查目标响应及其覆盖变化。
