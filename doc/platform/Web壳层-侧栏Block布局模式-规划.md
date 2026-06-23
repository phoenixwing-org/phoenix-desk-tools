# Web 壳层 · 侧栏 Block 布局模式 · 规划

> 关联：[Web壳层-Git工作区插件-G1续归档.md](Web壳层-Git工作区插件-G1续归档.md) · [Web壳层-侧栏左右Dock-规划.md](Web壳层-侧栏左右Dock-规划.md) · [Web壳层-侧栏高度调节-规划.md](Web壳层-侧栏高度调节-规划.md) · `SidebarBlock` · `WorkspaceTreeSidebar.vue`  
> 状态：**讨论定稿 · 未立项实现**  
> 最后更新：2026-06-23

---

## 1. 要解决的问题

侧栏同一区域内可能有多块内容（如 **Git 提交 + 属性**、**工作空间树 + 工作集**）。用户需要选择：

| 模式 | 体验 |
| --- | --- |
| 一次只看一块，省纵向空间 | **标签页** |
| 多块同时可见，拖拽分配高度 | **分割堆叠** |

设置入口：**block 标题栏右键**；可选在标题行 **`⋮` 下拉** 复用同一菜单（便于发现与触屏）。

---

## 2. 模式命名（推荐）

对用户文案与持久化字段分开命名。

| 用户可见（中文） | 英文 / 代码 | 说明 |
| --- | --- | --- |
| **标签页** | `tabbed` | 同组内 **互斥显示**；标题行或子 Tab 切换（现 `ws-tab-bar` 行为） |
| **分割堆叠** | `stacked` | 同组内 **同时显示**；块间 `panel-resizer` 调高度 |

**不推荐**用「上下模式」作正式名——易与「侧栏 dock 左/右」混淆。  
**副标题**（菜单项 description，可选）：

- 标签页 — *一次只显示一块*
- 分割堆叠 — *多块上下排列，可拖拽分隔*

内部类型名：`SidebarBlockGroupLayout = 'tabbed' | 'stacked'`。

---

## 3. 作用范围：Block 组，不是单个叶子块

配置挂在 **侧栏 block 组**（`SidebarBlockGroup`）上，组内 ≥2 个子块时才显示布局菜单。

| 组 ID（示例） | 子块 | 默认模式 | 现实现 |
| --- | --- | --- | --- |
| `workspace_primary` | 工作空间树 · 工作集 · 忽略设定 | `tabbed` | `ws-tab-bar` |
| `props_stack` | Git 提交 · 页面属性 | `stacked` | `ws-props-wrap` + 内部分割条 |
| `shell_log` | 运行日志 | — | 单块，无布局切换 |

**侧栏停靠弹层**（`SideDockPrefsPanel`）：详见 **[侧栏左右Dock-规划](Web壳层-侧栏左右Dock-规划.md) §5.1** — 树 / 属性 / 日志各一行（左/右 + 显示）；Git 页追加 **Git 提交**行（独立左/右 + 显示）。

单块组（仅运行日志）**不显示**布局子菜单。

**右键对象**：组内 **任一** 子块标题栏 → 改的是 **整组** 布局（与改的是「邻居关系」一致）。菜单标题写清：`布局方式（本区）`。

---

## 4. 交互

### 4.1 右键菜单（主入口）

```text
布局方式（本区） ▸
  ● 标签页
  ○ 分割堆叠
──────────────
折叠 / 展开          （现有 SidebarBlock）
```

- 左键标题：仍 **折叠 / 展开**（`SidebarBlock` 现有行为）
- 右键：仅弹出布局菜单（`@contextmenu.prevent`）；避免与左键折叠冲突

### 4.2 标题行 `⋮`（可选，与右键同菜单）

在 `SidebarBlockHead` 的 `#actions` 插槽放 `el-dropdown` trigger `⋮`，与运行日志「清空 / 收起」并列。  
**右键与 `⋮` 共用** `useSidebarBlockGroupLayoutMenu(groupId)`，避免两套逻辑。

### 4.3 模式切换时

| 切换 | 行为 |
| --- | --- |
| `stacked` → `tabbed` | 记住各块 `expanded`；组内仅 **活动 Tab** 占满组高度；内部分割条隐藏 |
| `tabbed` → `stacked` | 恢复上次 `*_height_px`；无记录则按 **均分** 或现有默认（Git 提交 `properties_footer_height_px`） |

切换后 **`persistShellLayout`** 写入 launcher。

---

## 5. 持久化（`shell_layout`）

```ts
/** 侧栏 block 组布局；缺省见各组 default */
sidebar_block_groups?: Partial<Record<
  'workspace_primary' | 'props_stack',
  'tabbed' | 'stacked'
>>;
```

- 不拆 `properties_panel_height_px` / `properties_footer_height_px` 字段名（向后兼容）；`stacked` 时继续用现有高度键。外部分割条与顶区弹性语义见 **[侧栏高度调节-规划](Web壳层-侧栏高度调节-规划.md)**。
- `tabbed` 时增加可选 `sidebar_group_active_tab?: Record<string, string>`（如 `props_stack: 'git_commit' | 'properties'`）。

后端 `sanitizeShellLayoutPatch` 白名单增补上述键。

---

## 6. 组件演进（实现顺序）

| 阶段 | 内容 |
| --- | --- |
| **A · 抽象** | `SidebarBlockGroup`：注册子块、`layoutMode`、`activeTabId`、统一 resize |
| **B · 菜单** | `SidebarBlockHead` 右键 + 可选 `⋮`；`SidebarBlockGroupLayoutMenu.vue` |
| **C · 迁移** | `props_stack` 从硬编码 `ws-props-wrap` 迁入 Group；`workspace_primary` 树/工作集/忽略 |
| **D · 扩展** | 日志与属性同侧时的第三组；Ribbon / 配置页只读展示当前模式 |

**不在首期**：块拖拽排序、跨组拖放、用户自定义增删块。

---

## 7. 与 Git / 属性的关系

- Git 页进入时仍 **自动展开属性侧栏**；`props_stack` 默认 **`stacked`**（提交说明 + 属性同屏）。
- 用户若改为 **标签页**：Git 提交与属性 **二选一** 显示，标题行出现子 Tab（或复用组内 Tab 条），Commit 区不再强制置顶分割。
- 文档 [Git插件规划 §5.3](Web壳层-Git工作区插件-规划.md) 中「Git 提交堆叠在属性上方」为 **默认**，非强制。

---

## 8. 验收（立项后）

- [ ] `props_stack` 右键可在标签页 / 分割堆叠间切换，刷新后保持
- [ ] `stacked` 时组内分割条方向 — 外沿 `−delta`、Git 下沿 `+delta`（见 [侧栏高度调节-规划](Web壳层-侧栏高度调节-规划.md) §2.3 · [归档](Web壳层-侧栏Dock高度与Git块-归档.md)）
- [ ] `tabbed` 时无「折叠了仍占 160px」类空白
- [ ] 单块组（运行日志）无布局菜单
- [ ] `⋮` 与右键菜单项一致（若实现 B）

---

## 9. 开放问题

| # | 问题 | 倾向 |
| --- | --- | --- |
| 1 | 标签页模式下子块是否保留独立折叠？ | **保留**；折叠 = 该 Tab 内容区收起，Tab 标签仍在 |
| 2 | `workspace_primary` 是否首期一起改？ | **第二期**；首期只做 `props_stack` 验证抽象 |
| 3 | 配置页是否暴露？ | 二期；首期仅侧栏右键 / `⋮` |
| 4 | **工作集 / 忽略设定**是否从 `workspace_primary` 拆出独立 block？ | **待研讨** — 用户可单独开关与布局；见 [TODO.md §侧栏 block](../TODO.md) |

---

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-06-23 | 初稿：模式命名 · 组级配置 · 右键 / 下拉 · 持久化草案 |
| 2026-06-23 | §9：工作集 / 忽略设定独立配置 → [TODO.md](../TODO.md) |
