# 本轮 UI 改动评审：DSH 专用 vs 通用

范围：2026-11-01 至 11-05 这一段（`0.10.53`–`0.10.77`）。
目标：把"只属于 DSH 宿主"的改动与"所有宿主共用的页面模板"分开，避免下次同步时改错层。

---

## 一、分层结论

| 层 | 位置 | 谁在用 | 本轮改了哪些 |
|---|---|---|---|
| **DSH 宿主插件** | `plugin/analysis-view/lib/index.js`、`lib/client.js` | 仅 DSH | 路由与静态资源、客户端补丁（上下文明细 + 官方统计摊平） |
| **DSH 工具插件** | `plugin/trajectory-tools/lib/*` | 仅 DSH | `samples` 开关、`toolWall` 不再置空、`cost` 别名、read/graph 边界文案 |
| **共享页面模板** | `docs/demo/layout-review/*` + `view/assets/*` → 生成 `plugin/analysis-view/lib/trace/page.{html,js}` | DSH / Pi / Codex / Claude 共用 | 命名、图例、状态环与徽标、耗时构成条、抽屉、支线过滤、几何修正 |
| **宿主包** | `dist/trajectory-tree-{codex,pi,claude}` | 各宿主 | 仅重建，无源码差异 |

判断标准：**改完需要哪些宿主重新打包**。只有页面模板一类需要四个宿主全部重建；插件类只影响 DSH。

---

## 二、DSH 专用改动

| 文件 | 改动 | 原因 |
|---|---|---|
| `lib/index.js` | 去掉 `context-trend-study` 类注入 | 那套样式把 `#graph-scroll` 钉死在 386/466px |
| `lib/index.js` | 页面资产清单加入 `shared/*` | 七类构成的共享资源 |
| `lib/client.js` | 补丁摊平 `officialStats.turns` | 页面按轮/步查耗时，之前补丁只有 snapshot |
| `lib/client.js` | 补丁携带 `context.requests` | 七类明细只在 DSH 的同源接口里有 |
| `trajectory-tools` | `samples:false` | 按轮排名时强制带原文，约 7K tokens |
| `trajectory-tools` | `toolWall` 不再置空 | 官方本来就是并集，跨步也照算 |
| `trajectory-tools` | `search.cost` 标为别名、read/graph 互指 | 语义重叠 |

---

## 三、通用改动（共用页面模板）

### 3.1 命名（七类上下文）

| 旧 | 新 |
|---|---|
| 用户消息 | 用户输入 |
| 补充内容 | 运行时注入 |
| 助手消息 | 模型输出（含思考） |
| 工具结果 | 工具输出 |
| 技能内容 | 保持（同时包含目录与加载正文） |

位置：`docs/demo/layout-review/context-model.mjs`、`geist-context-overview.js`、`review-navigation.js`、`plugin/trajectory-tools/lib/report-data.js`。

### 3.2 行动路径

- 步标题单行：`第 N 步 · 12.3 秒`；
- 标题下的耗时为**构成条**（工具青 / 模型蓝 / 其它灰），取代等宽引导线；
- 步状态：**环**表示最严重结局（红报错 / 橙超时 / 灰拦截），**徽标**给数量（× ◷ ⊣ ↻，最多两个）；
- 普通工具结果支线不再绘制，只留子代理这类协作支线；
- 顶部安全区：柱顶钳在 `base - 150`，不越进标题区；
- 基线按文件行反推：`base = min(rawBase, height - 20 - fileRow - 78)`；
- 高度跟实高：`height = min(620, graphScroll.clientHeight - 6)`。

### 3.3 总览

- 上下文层打开时基线 282、高度 430（与总趋势开启时一致）；
- 总趋势只在总览可用；进入行动路径时隐藏开关；
- 取消勾选的构成项压暗到 45%；
- 去掉右下角「行动路径 ↗」（入口保留在每轮耗时）；
- 去掉增量柱详情里的"来源说明"按钮。

### 3.4 耗时

- 底部栏：`首字 / 解码 / 工具 / 其它`，各带圆点；
- 抽屉：同样四项 + 总时长，覆盖与累计只在两者不同时并列；
- 颜色统一收在 `--time-wait / --time-model / --time-tool / --time-rest`，条、圆点、抽屉共用；
- 褐色 `geist-tool-time` 时段标记在总览与路径都已停画。

---

## 四、共享模板的生成方式

改动只写这两处，**不要手改产物**：

```
docs/demo/layout-review/      # 页面渲染器源码（含 base/ 与 geist*.js）
view/assets/                  # CSS 与宿主适配（geist.css、context-observation.*）
        │
        ├─ node scripts/build-preserved-demo.mjs
        ├─ node scripts/build-geist-demo.mjs
        ├─ node scripts/port-geist-page.mjs       # → lib/trace/page.html + page.js + models/
        ├─ node scripts/sync-view-assets.mjs      # view/assets → lib/trace/shared/
        ├─ node scripts/check-trace-page.mjs      # 语法与装配自检
        └─ node scripts/package-trajectory.mjs --host codex|pi|claude
```

产物：`plugin/analysis-view/lib/trace/page.html`、`page.js`、`models/*`、`shared/*`。
四个宿主共用这一份；`dist/*` 只是把同一份再打一次包。

---

## 五、口径文档

| 文档 | 内容 |
|---|---|
| [trajectory-fields.md](trajectory-fields.md) | 工具字段、统计口径、上下文七类定义、已知边界（已更新到最新命名与 `toolWall` 语义） |
| [INDEX.md](INDEX.md) | 仓库索引与文档导航 |
| [host-entrypoints.md](host-entrypoints.md) | 各宿主入口与构建 |

---

## 六、遗留

1. 行动路径的「左侧栏」（左侧步骤列表）尚未按耗时构成重排；
2. 图例里可能仍留着「上下文总趋势」一项（生成文本分散在多处，未清干净）；
3. Pi / Codex 那份 `portable-tools` 还没有 `samples` 开关与这套命名；
4. 官方统计的 `toolWall` 会因跨天调用被放大（如 subagent 跨日返回），目前原样展示，未做标注。

---

## 七、发布清单（改通用页面后必须全跑）

只改 DSH 专用插件时，第 1–3 步可以跳过。

```sh
node scripts/build-preserved-demo.mjs
node scripts/build-geist-demo.mjs
node scripts/port-geist-page.mjs
node scripts/sync-view-assets.mjs
node scripts/check-trace-page.mjs

# 通用改动必须重建三个宿主包,否则它们仍是旧页面
node scripts/package-trajectory.mjs --host codex
node scripts/package-trajectory.mjs --host pi
node scripts/package-trajectory.mjs --host claude

# DSH 本地生效:打包并安装到 profile
cd plugin/analysis-view && pnpm pack && cd ../..
# 更新 profile/package.json 的 tgz 名 → pnpm install
```

自检：三个 `dist/*/plugin/analysis-view/lib/trace/page.js` 与
`plugin/analysis-view/lib/trace/page.js` 的 SHA-256 必须一致。

```sh
node -e "const{createHash}=require('crypto'),{readFileSync}=require('fs');const h=p=>createHash('sha256').update(readFileSync(p)).digest('hex');const s=h('plugin/analysis-view/lib/trace/page.js');for(const d of ['codex','pi','claude'])console.log(d,h('dist/trajectory-tree-'+d+'/plugin/analysis-view/lib/trace/page.js')===s?'一致':'不同')"
```

本次核对结果：三个宿主包均为「一致」。
