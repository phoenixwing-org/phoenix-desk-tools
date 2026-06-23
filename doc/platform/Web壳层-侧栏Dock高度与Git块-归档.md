# Web 壳层 · 侧栏 Dock / 高度 / Git 块 · 会话归档

> **规划（仍有效）**：[侧栏左右Dock-规划](Web壳层-侧栏左右Dock-规划.md) · [侧栏高度调节-规划](Web壳层-侧栏高度调节-规划.md) · [侧栏Block布局模式-规划](Web壳层-侧栏Block布局模式-规划.md)  
> **Git 插件交叉**：[Git工作区插件-G1续归档](Web壳层-Git工作区插件-G1续归档.md) · [TODO-GIT.md](../TODO-GIT.md)  
> 最后更新：2026-06-23

---

## 1. 验收总览

| 项 | 状态 |
| --- | --- |
| 每块独立左/右 + 显隐 · `SideDockPrefsPanel` | ✅ |
| 双栏可同时存在 · `sideDockVisibility` 驱动双 `WorkspaceTreeSidebar` | ✅ |
| 顶区弹性 + 下方固定块 · `sidebarStackLayout` + 单测 5 项 | ✅ |
| 外部分割条方向（属性/日志上沿 · `startH − delta`） | ✅ |
| 组内分割条（Git 下沿 · `startH + delta`） | ✅ |
| Git 提交独立 `git_commit_panel_dock` · 异侧独立渲染 | ✅ |
| Git 块标题折叠 vs 页脚「显示」语义分离（`gitCommitBodyExpanded`） | ✅ |
| `GitCommitPanel` 提交说明 textarea 横向/纵向撑满 | ✅ |
| `git_commit_panel_dock` PATCH 持久化（需 API 进程含新字段） | ✅ 代码已接 |
| Git 侧栏分侧 / 停靠切换后显示仍偶发问题 | [~] 待后续修 |
| 页脚整栏 **左/右** 钮（`PanelSideIcon`） | ⏳ |
| 侧栏 block 组 **tabbed / stacked** 可配置 | ⏳ 未立项 |

---

## 2. 三份规划的分工（勿混读）

| 维度 | 文档 | 持久化字段（示例） |
| --- | --- | --- |
| **水平** | [左右Dock-规划](Web壳层-侧栏左右Dock-规划.md) | `workspace_tree_dock` · `properties_panel_dock` · `shell_log_dock` · `git_commit_panel_dock` |
| **垂直** | [高度调节-规划](Web壳层-侧栏高度调节-规划.md) | `properties_panel_height_px` · `log_panel_height_px` · `properties_footer_height_px` |
| **组内** | [Block布局模式-规划](Web壳层-侧栏Block布局模式-规划.md) | （未立项）`props_stack_layout` 等 |

三者 **正交**：先定 dock 侧与显隐，再在栏内分高度，组内 tab/stack 为后续能力。

---

## 3. 实现要点

### 3.1 左右 Dock

| 路径 | 说明 |
| --- | --- |
| `web-ui/src/utils/sideDockLayout.ts` | `sideDockVisibility(layout, { onGitPage })` · `gitCommitPanelDock()` |
| `web-ui/src/composables/useSideDockPrefs.ts` | 每块 `setTreeDock` / `setPropsDock` / `setLogDock` / `setGitCommitDock` |
| `web-ui/src/components/SideDockPrefsPanel.vue` | Git 页第四行：Git 提交左/右 + 显示 |
| `web-ui/src/layout/AppShell.vue` | `:show-git-commit="dockVis.*ShowGitCommit"` |
| `phoenix/config/user_prefs.py` | `git_commit_panel_dock` 归一化；缺省跟 `properties_panel_dock` |

### 3.2 纵向高度

| 路径 | 说明 |
| --- | --- |
| `web-ui/src/utils/sidebarStackLayout.ts` | `resolveSidebarStackLayout` · 常量与 `maxStored*` 拖拽上限 |
| `web-ui/src/utils/sidebarStackLayout.test.ts` | 5 项单测 |
| `web-ui/src/layout/WorkspaceTreeSidebar.vue` | 外/组内 `panel-resizer` · `ResizeObserver` |

**分割条方向**（易错）：

```text
外部分割条（属性/日志块的上沿）：next = startH − (clientY − startY)  → 向上拖增大下方块
组内条（Git 提交块的下沿）：      next = startH + (clientY − startY)  → 向上拖缩小 Git、增大属性
```

### 3.3 Git 提交块

| 路径 | 说明 |
| --- | --- |
| `GitCommitPanel.vue` | `SidebarBlock` strip · 提交说明 + Commit 底栏 |
| `WorkspaceTreeSidebar.vue` | **同侧** `gitCommitStackedWithProps` 堆叠；**异侧** `showGitCommitStandalone` 独立 `ws-props-wrap` |
| `git_commit_panel_open` | 仅页脚/Popover「显示」；**不再**绑定标题折叠 |
| `gitCommitBodyExpanded` | 块内标题折叠（本地 ref，不写 launcher） |

**曾出故障**：

1. Git 与属性 **异侧** 时走堆叠模板 → wrap 内空 → 块消失 → 已改为 standalone 模板优先。  
2. 改 `git_commit_panel_dock` 时 API 400「无有效字段」→ 多为 **Python 后端未重启**；前端已 `try/catch` 失败回滚。  
3. 标题折叠误写 `git_commit_panel_open=false` → 整块从 dock 逻辑消失 → 已分离。

---

## 4. 验证

- `web-ui`：`npm run build` 通过  
- `npx vitest run src/utils/sidebarStackLayout.test.ts`：5 passed  
- 人工：树 + 属性 + 日志同侧/分侧；Git 页组内条 + 外部分割条组合 — **部分通过，Git 显示仍待跟测**

---

## 5. 明确未做 / 下一批

| 项 | 跟踪 |
| --- | --- |
| Git 侧栏停靠切换后布局/显示收尾 | [TODO-GIT.md](../TODO-GIT.md) §侧栏 |
| 页脚 `toggleLeftSidebar` / `toggleRightSidebar` + `PanelSideIcon` | [左右Dock-规划](Web壳层-侧栏左右Dock-规划.md) §9 |
| 工作集 / 忽略独立 dock | [TODO.md](../TODO.md) · [Block布局](Web壳层-侧栏Block布局模式-规划.md) §9 |
| Git 分区批量预览 | [Git变更分区批量预览-规划](Web壳层-Git变更分区批量预览-规划.md) |
| `GitFilePage` · 删 spike | [G1续归档](Web壳层-Git工作区插件-G1续归档.md) |
| 成员排序 · 变更列表 Pinia 持久化 | 用户后续单独立项 |

---

## 6. 关键路径（检索）

```text
web-ui/src/utils/sideDockLayout.ts
web-ui/src/utils/sidebarStackLayout.ts
web-ui/src/layout/WorkspaceTreeSidebar.vue
web-ui/src/layout/AppShell.vue
web-ui/src/components/SideDockPrefsPanel.vue
web-ui/src/components/shell/GitCommitPanel.vue
web-ui/src/components/shell/SidebarBlock.vue
phoenix/config/user_prefs.py          # shell_layout 归一化
phoenix/web/app.py                    # ShellLayoutBody
```

---

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-06-23 | 归档：Dock 独立规划落地 · 高度模型 · Git 块分侧/分割条/折叠语义 · 已知余量 |
