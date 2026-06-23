# Web 壳层 · 侧栏高度调节 · 方案

> 关联：[Web壳层-侧栏Block布局模式-规划.md](Web壳层-侧栏Block布局模式-规划.md)（组内 tabbed/stacked）· [Web壳层-侧栏左右Dock-规划.md](Web壳层-侧栏左右Dock-规划.md)（水平左/右 · 块 dock）· [Web壳层-Git工作区插件-G1续归档.md](Web壳层-Git工作区插件-G1续归档.md)  
> 状态：**已落地首版（2026-06-23）** · 归档：[侧栏Dock高度与Git块-归档](Web壳层-侧栏Dock高度与Git块-归档.md)  
> 代码锚点：`web-ui/src/utils/sidebarStackLayout.ts` · `web-ui/src/layout/WorkspaceTreeSidebar.vue`

---

## 1. 背景与旧问题

侧栏纵向多块（工作空间树 / 属性 / Git 提交 / 日志）曾用 **props↔log 互算 max 高度 + 比例上限**（`PROPS_MAX_RATIO`、`LOG_MAX_RATIO`），导致：

| 问题 | 表现 |
| --- | --- |
| **循环依赖** | `displayPropsHeightPx` 依赖 `log_panel_height_px`，`displayLogHeightPx` 又依赖 `properties_panel_height_px` |
| **拖不动 / 下方空白** | 比例顶死上限后，树区留白但下方块无法继续增大 |
| **分割条叠线** | `panel-resizer` 负 margin + 双层伪元素，视觉双线、热点错位 |

**结论**：换模型——**顶区弹性、下方块固定高度、单次纯函数解析**，不再双向 clamp。

---

## 2. 布局模型（定稿）

### 2.1 纵向顺序（自上而下）

```text
┌─────────────────────────────┐
│ 顶区 main（ws-body）         │  ← flex:1，高度可变
│  工作空间树 / 工作集 / 忽略 Tab │
├─ panel-resizer（属性上沿）──┤  ← 6px，仅 main+属性 时显示
│ 属性区 ws-props-wrap         │  ← 固定高度 properties_panel_height_px
│  ├ Git 提交（footer）        │  ← 固定 properties_footer_height_px
│  ├ panel-resizer（组内）     │  ← 仅 Git+属性 同时展开时
│  └ 页面属性 main             │  ← 占 wrap 剩余
├─ panel-resizer（日志上沿）──┤
│ 运行日志 ws-log-wrap         │  ← 固定高度 log_panel_height_px
└─────────────────────────────┘
```

### 2.2 角色分工

| 区域 | 高度来源 | 窗口变矮时 |
| --- | --- | --- |
| **顶区 main** | 不持久化；`总高 − 固定块 − 分割条` | **先被压缩**（最小 `SIDEBAR_MAIN_MIN_H` = 120px） |
| **属性 wrap** | `properties_panel_height_px` | main 到最小后 **等比缩小**（仅展示，不改 stored） |
| **日志** | `log_panel_height_px` | 同上 |
| **Git footer** | `properties_footer_height_px` | 在 wrap 内解析；折叠时 ≈ 40px 头高 |

### 2.3 拖动手柄语义

**拖哪条上沿，就只改该块 persisted 高度**；顶区自动让出/吸收空间。

**方向（与 VS Code 侧栏一致）**：`delta = clientY − startY`。

| 手柄位置 | 拖向上 | 公式 |
| --- | --- | --- |
| **外部分割条**（属性/日志 **上沿**，改下方块高） | 下方块变高 | `stored − delta` |
| **组内条**（Git 提交 **下沿**，改上方 Git 高） | Git 区变矮、属性变高 | `stored + delta` |

| 手柄 | 修改字段 | 上限（拖拽时） |
| --- | --- | --- |
| 属性区上沿 | `properties_panel_height_px` | `maxStoredPropsHeightPx` = 总高 − main 最小 − 日志 stored − 外部分割条 |
| 日志区上沿 | `log_panel_height_px` | `maxStoredLogHeightPx` = 总高 − main 最小 − 属性 stored − 外部分割条 |
| Git 提交 / 属性组内 | `properties_footer_height_px` | `maxStoredPropsFooterHeightPx`；**`startH + delta`**（Git 在上） |

**已删除**：`PROPS_MAX_RATIO`、`LOG_MAX_RATIO` 及 props/log 互算 max 的 computed 链。

### 2.4 窗口缩放（ResizeObserver → `resolveSidebarStackLayout`）

1. 用 **stored** 固定块高度算 `mainSpace = 总高 − 固定块 − 分割条`。
2. 若 `mainSpace ≥ MAIN_MIN`：按 stored 展示，`scaled = false`。
3. 若不足：钉死 `main = MAIN_MIN`，剩余预算给固定块 **按 stored 比例等比缩小**（不低于各自 min）。
4. 若总高 `< SIDEBAR_TIGHT_THRESHOLD_H`（280px）且预算仍不够：固定块 **压到各自最小高度**（「极矮合上」首版：不自动关 `log_panel_open`，仅展示压扁）。

**重要**：缩放只影响 **当前展示**；除非用户拖分割条，**不写回** launcher（避免窗口一闪就改用户偏好）。

---

## 3. 无顶区时的退化

| 组合 | 行为 |
| --- | --- |
| 仅日志 | 日志 `flex:1` 占满（`log-only`） |
| 仅属性 | 属性 wrap `flex:1`（`props-only`） |
| 属性 + 日志、无树 | 上属性 flex，下日志固定（与旧「无树双块」一致） |

---

## 4. 持久化字段（`shell_layout`）

| 字段 | 默认（约） | 说明 |
| --- | --- | --- |
| `properties_panel_height_px` | 220 | 整个 `ws-props-wrap` 外高 |
| `properties_footer_height_px` | 见 launcher | Git 提交区（footer） |
| `log_panel_height_px` | 180 | 日志区 |
| `right_panel_open` / `properties_panel_open` / `log_panel_open` | — | 块显隐，与高度键正交 |

块 **左/右停靠** 与 **显隐** 见 **[侧栏左右Dock-规划](Web壳层-侧栏左右Dock-规划.md)**（与本文 **高度** 正交）。

---

## 5. 常量一览（改阈值只改一处）

定义于 `sidebarStackLayout.ts`：

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `SIDEBAR_RESIZER_H` | 6 | 分割条占位（无负 margin） |
| `SIDEBAR_MAIN_MIN_H` | 120 | 顶区最小高 |
| `SIDEBAR_PROPS_MIN_H` | 100 | 属性 wrap 最小 |
| `SIDEBAR_LOG_MIN_H` | 80 | 日志最小 |
| `SIDEBAR_PROPS_FOOTER_MIN_H` | 100 | Git footer 最小 |
| `SIDEBAR_PROPS_MAIN_MIN_H` | 80 | 属性 sheet 最小 |
| `SIDEBAR_TIGHT_THRESHOLD_H` | 280 | 极矮侧栏策略 |
| `SIDEBAR_FOOTER_COLLAPSED_H` | 40 | Git 块折叠头高 |

单测：`web-ui/src/utils/sidebarStackLayout.test.ts`。

---

## 6. 与「Block 组布局模式」的关系

| 文档 | 管什么 |
| --- | --- |
| **本文** | 侧栏 **整体纵向** 几块谁弹性、谁固定、外部分割条拖谁 |
| [侧栏Block布局模式-规划](Web壳层-侧栏Block布局模式-规划.md) | **组内** tabbed / stacked（树 vs 工作集、Git vs 属性） |

`SidebarBlockStack` 立项后，组内 resize 应 **复用** `resolveSidebarStackLayout` 或抽共享 `scaleFixedHeights()`，避免再写第二套互算。

---

## 7. 已知余量 / 后续可改

| # | 项 | 说明 |
| --- | --- | --- |
| 1 | 极矮 **自动合上** | 现仅压到 min；可改为 `log_panel_open=false` 或只留 block 头 |
| 2 | 拖属性时 log 用 **resolved** 还是 **stored** 算上界 | 现用 stored，与「只改本块」一致 |
| 3 | `scaled=true` 时 UI 提示 | 可选细线或 tooltip「侧栏过矮，已临时压缩」 |
| 4 | 块组 tabbed 后外部分割条 | 隐藏组内条、组占固定高或 flex，见 Block 布局 §4.3 |
| 5 | 点检 | [G1点检清单](Web壳层-Git工作区插件-G1点检清单.md) §6 分割条方向 · 标题不随内容滚 |

---

## 8. 验收（回归）

- [x] 树 + 属性 + 日志：拖日志上沿 **只长高日志**，树区变矮
- [x] 拖属性/日志上沿：向上拖增大下方块（`startH − delta`）
- [x] 窗口拉高：树区先变高，固定块保持 stored
- [x] 窗口压矮：树到 120px 后，属性/日志等比缩（展示）
- [x] 分割条单线 6px，无叠线
- [ ] 人工：Git 页 footer 组内条 + 外部分割条组合
- [ ] 人工：仅右栏属性 / 仅日志 / 无树双块

---

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-06-23 | 组内 Git 下沿 `startH + delta`；外沿 `startH − delta` — [归档](Web壳层-侧栏Dock高度与Git块-归档.md) |
| 2026-06-23 | 初稿：顶区弹性 + 下方固定块模型 · 纯函数 `sidebarStackLayout` · 去掉比例上限与循环依赖 |
