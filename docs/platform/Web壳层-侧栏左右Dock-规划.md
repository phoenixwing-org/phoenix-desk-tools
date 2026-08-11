# Web 壳层 · 侧栏左右 Dock · 规划

> **壳层系统能力**（与 [FileWorkset-规划](FileWorkset-规划.md)、[Git工作区插件-规划](Web壳层-Git工作区插件-规划.md) 同级）：主内容区两侧的 **左栏 / 右栏** 停靠列，以及块级 **停靠侧 + 显隐** 配置。  
> 关联：[侧栏高度调节-规划](Web壳层-侧栏高度调节-规划.md)（纵向）· [侧栏Block布局模式-规划](Web壳层-侧栏Block布局模式-规划.md)（组内 tab/stack）  
> 状态：**G1 已落地**（2026-06-23）· 页脚整栏左/右钮待接 · Git 分侧显示待收尾  
> 归档：[侧栏Dock高度与Git块-归档](Web壳层-侧栏Dock高度与Git块-归档.md)  
> 用户说明：[Web壳层-使用说明.md](../user/Web壳层-使用说明.md) §页脚面板  
> 用户说明：[Web壳层-使用说明.md](../user/Web壳层-使用说明.md) §页脚面板

---

## 1. 定位

| 是什么 | 不是什么 |
| --- | --- |
| 主区两侧的 **物理栏位**（`left` / `right`） | 不是 Ribbon Tab、不是页面属性 schema |
| 每块独立配置 **靠左还是靠右** + **是否显示** | 不是「整壳统一左侧或右侧」单开关（已废弃） |
| `launcher.json` → `shell_layout` 持久化 | 不写进仓库 `app_config`（除导航项） |

**三块 + 特例**：

| 块 ID | 用户文案 | 停靠字段 | 显隐字段 | 默认侧 |
| --- | --- | --- | --- | --- |
| `workspace_tree` | 工作空间树 | `workspace_tree_dock` | `right_panel_open` | **右** |
| `properties` | 页面属性 | `properties_panel_dock` | `properties_panel_open` | **左** |
| `shell_log` | 运行日志 | `shell_log_dock` | `log_panel_open` | **左** |
| `git_commit` | Git 提交 | `git_commit_panel_dock` | `git_commit_panel_open` | **左**（与属性默认同侧，可独立改） |

> 历史字段名 `right_panel_open` 表示「工作空间树是否展开」，与树默认靠右并存，**勿**改名（launcher 兼容）。

Git 提交仅在 **Git 页** 出现；与页面属性 **同侧** 时仍在 `ws-props-wrap` 内堆叠，**异侧** 时作为独立块渲染到另一侧栏。

---

## 2. 布局模型

```text
┌─────────────────────────────────────────────────────────────┐
│ Ribbon · Tab · 主内容区                                        │
├──────────┬────────────────────────────────────┬──────────────┤
│ 左栏      │         shell-main                  │ 右栏          │
│ (可选)    │                                     │ (可选)        │
│          │                                     │              │
│ 属性↑    │                                     │ 工作空间树↑   │
│ 日志↓    │                                     │              │
│ 或三块    │                                     │ 或任意组合    │
│ 任意组合  │                                     │              │
└──────────┴────────────────────────────────────┴──────────────┘
│ 页脚：树 / 属性 / 日志 / 侧栏停靠 …                            │
└─────────────────────────────────────────────────────────────┘
```

- **同一物理栏**内多块 **上下堆叠**（顺序固定：树 Tab 区 → 属性 wrap → 日志）；纵向高度见 [侧栏高度调节-规划](Web壳层-侧栏高度调节-规划.md)。
- **左、右可同时各有一栏**（例如默认：左=属性+日志，右=树）。
- 某侧 **无任何块** `dock=该侧 && open` → `AppShell` **不渲染**该侧 `WorkspaceTreeSidebar` 与宽度分割条。

---

## 3. 持久化（`shell_layout`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `workspace_tree_dock` | `left` \| `right` | 树停靠侧 |
| `shell_log_dock` | `left` \| `right` | 日志停靠侧 |
| `properties_panel_dock` | `left` \| `right` | 属性停靠侧 |
| `right_panel_open` | bool | 工作空间树显隐 |
| `log_panel_open` | bool | 运行日志显隐 |
| `properties_panel_open` | bool | 页面属性显隐 |
| `git_commit_panel_open` | bool | Git 提交区显隐（Git 页） |
| `git_commit_panel_dock` | `left` \| `right` | Git 提交停靠侧（缺省与 `properties_panel_dock` 一致） |
| `left_panel_width_px` | int 160–560 | 左栏宽 |
| `right_panel_width_px` | int 160–560 | 右栏宽 |

高度相关字段（`properties_panel_height_px`、`log_panel_height_px` 等）归 **高度调节** 文档，与此处 **正交**。

**写入路径**：`PATCH /api/launcher/shell-layout` · `useAppShell.persistShellLayout` · `phoenix/config/user_prefs.py` `_normalized_shell_layout`。

---

## 4. 运行时管线

```text
shell_layout (launcher)
       │
       ▼
sideDockVisibility()          ← web-ui/src/utils/sideDockLayout.ts
       │
       ├── leftVisible / rightVisible
       ├── leftShowTree / leftShowLog / leftShowProps
       └── rightShowTree / rightShowLog / rightShowProps
       │
       ▼
AppShell.vue                ← 0~2 个 WorkspaceTreeSidebar + 宽度 resizer
       │
       ▼
WorkspaceTreeSidebar        ← dock-side + showTree/showLog/showProps
```

**整栏收起/展开**（VS Code 式「收起左侧全部」）：

| 函数 | 文件 | 行为 |
| --- | --- | --- |
| `snapshotPanelsOnSide` | `sidebarSideToggle.ts` | 收起前记住该侧各块 open 状态 |
| `buildCollapseSidePatch` | 同上 | 将该侧已停靠块 `*_open` → false |
| `buildExpandSidePatch` | 同上 | 按快照恢复；无快照则展开该侧第一块 |
| `isSideVisible` | 同上 | 该侧是否有任意块可见 |

`useShellPanelToggles.toggleSide('left'|'right')` 已封装；**页脚 / Ribbon 尚未挂 `PanelSideIcon` 左/右钮**（文案已在 `shellPanelToggles.ts`）。

---

## 5. 用户界面

### 5.1 侧栏停靠弹层 · `SideDockPrefsPanel`

入口：

- 页脚 **侧栏**（`Operation` 图标）Popover · 标题「侧栏停靠」
- Ribbon 壳层区同名 Popover
- 配置 Modal · **界面** 区（`ConfigPage`）

每块 **一行**（grid：名称 | 左/右 | 显示）：

| 块 | 左/右 | 显示 |
| --- | --- | --- |
| 工作空间树 | `el-radio-button` | `el-switch` |
| 页面属性 | 同上 | 同上 |
| Git 提交 | **同属性·左/右**（只读） | `el-switch`（仅 Git 页显示该行） |
| 运行日志 | `el-radio-button` | `el-switch` |

逻辑：`useSideDockPrefs.ts`。

### 5.2 按块快捷开关 · `ShellPanelToggleBar`

页脚 / Ribbon：**树 / 属性 / 日志** 图标切换对应 `*_panel_open`（**不**改停靠侧）。

与 5.1 关系：**块开关** = 显隐；**侧栏 Popover** = 停靠侧 + 显隐汇总配置。

### 5.3 栏宽

`AppShell` 左/右 `shell-resizer-*` 拖拽 → `left_panel_width_px` / `right_panel_width_px`。

---

## 6. 与其它侧栏文档的分工

| 文档 | 维度 | 典型问题 |
| --- | --- | --- |
| **本文** | **水平**：左栏 / 右栏、块 dock、显隐、栏宽、整栏收起 | 树改到左边？左栏全收起？ |
| [侧栏高度调节-规划](Web壳层-侧栏高度调节-规划.md) | **垂直**：顶区弹性、下方固定高度、分割条 | 日志区拖多高？ |
| [侧栏Block布局模式-规划](Web壳层-侧栏Block布局模式-规划.md) | **组内**：tabbed / stacked（树 vs 工作集、Git vs 属性） | 属性与 Git 改标签页？ |

三者 **可组合**；改 dock 字段时 **不必**改高度算法。

---

## 7. 默认布局（新用户 / launcher 缺省）

```text
左栏：页面属性（上） + 运行日志（下）
右栏：工作空间树（工作集 / 忽略为树内 Tab）
```

对应默认值见 `useAppShell.ts` `DEFAULT_SHELL` 与 `user_prefs.py` `_LAUNCHER_SHELL_LAYOUT_DEFAULT`。

---

## 8. 代码锚点

```text
web-ui/src/utils/sideDockLayout.ts       # 左右可见性推导
web-ui/src/utils/sidebarSideToggle.ts    # 整栏收起/展开 patch
web-ui/src/composables/useSideDockPrefs.ts
web-ui/src/composables/useShellPanelToggles.ts
web-ui/src/components/SideDockPrefsPanel.vue
web-ui/src/components/ShellPanelToggleBar.vue
web-ui/src/components/PanelSideIcon.vue  # 左/右栏图标（待接入页脚）
web-ui/src/content/shellPanelToggles.ts
web-ui/src/layout/AppShell.vue
web-ui/src/layout/WorkspaceTreeSidebar.vue
phoenix/config/user_prefs.py             # shell_layout 归一化与保存
```

---

## 9. 验收与待办

### 已落地

- [x] 每块独立 `*_dock` + `*_open`（非统一侧栏位置单选）
- [x] `SideDockPrefsPanel` 每块一行（Git 提交：独立左/右 + 显示）
- [x] 双栏可同时存在；`sideDockVisibility` 驱动双 `WorkspaceTreeSidebar`
- [x] 左右独立栏宽与持久化
- [x] `sidebarSideToggle` 整栏收起逻辑（composable）
- [x] 页脚按块开关 + 侧栏 Popover

### 待办

- [ ] **Git 侧栏显示收尾**：分侧停靠后布局 — [归档](Web壳层-侧栏Dock高度与Git块-归档.md) §5
- [ ] **页脚 / Ribbon**：`PanelSideIcon` + `toggleLeftSidebar` / `toggleRightSidebar`（文案已备）
- [ ] **工作集 / 忽略** 独立 dock 与显隐（见 [TODO.md](../TODO.md) · [侧栏Block布局模式](Web壳层-侧栏Block布局模式-规划.md) §9）
- [ ] **块拖拽排序** / 跨侧拖放 — **不在范围**
- [ ] 配置页「界面」与 Popover 文案统一复审

---

## 10. 开放问题

| # | 问题 | 倾向 |
| --- | --- | --- |
| 1 | Git 提交是否要有独立 `git_commit_panel_dock` | **是**（2026-06-23）；同侧仍可与属性堆叠 |
| 2 | 非 Git 页是否显示 Git 提交行（灰显） | **否**；仅 `onGitPage` 显示 |
| 3 | 左/右钮放页脚还是仅 Ribbon | **页脚 + Ribbon 都要有**（与块开关并列） |
| 4 | `dockMixed` 统一侧 API 是否删除 | 保留于 `useSideDockPrefs` 供迁移；UI 已不用 |

---

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-06-23 | Git 分侧显示列入待办 · 链合一归档 |
| 2026-06-23 | Git 提交独立 `git_commit_panel_dock` · 弹层左/右钮 |
| 2026-06-23 | 初稿：左右 Dock 独立规划 · 字段表 · 管线 · 与高度/Block 文档分工 · TODO |
