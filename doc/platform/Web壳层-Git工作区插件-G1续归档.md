# Web 壳层 · Git 工作区插件 · G1 续 · 会话归档

> 前置：[Web壳层-Git工作区插件-规划.md](Web壳层-Git工作区插件-规划.md) · [G1点检清单](Web壳层-Git工作区插件-G1点检清单.md)  
> 待办：[TODO-GIT.md](../TODO-GIT.md)  
> 最后更新：2026-06-23

---

## 验收总览

| 项 | 状态 |
| --- | --- |
| `GET /api/git/diff`（`scope=worktree` / `staged`）+ 单测 | ✅ |
| 成员排序 · 表内预览 / Revert / init / info 改调 **`/api/git/*`** | ✅ |
| `GitDiffPreviewDialog` 挂载（**过渡**弹层 · diff2html 并排） | ✅ |
| 侧栏 **`SidebarBlock`** 折叠与外层高度联动 | ✅ |
| 属性区 / 日志区 **外部分割条**拖拽方向修正 | ✅ |
| 成员排序 · 变更表路径 **`文件名 @ 目录/`** | ✅ |
| 成员排序 · 条目表类型列 **Folder / Document 图标** | ✅ |
| **`GitFilePage`** + `openGitFileTab` | ⏳ G1 收尾 |
| 删除 spike **`git_workspace.py`** / **`/api/code/reorder-members/git-*`** | ⏳ 迁完 Tab 后删 |

---

## 1. Diff API 与成员排序消费方

### 后端

| 路径 | 说明 |
| --- | --- |
| `phoenix/shell/git/workspace.py` · `git_diff()` | `git diff` / `git diff --cached`；二进制 `is_binary`；大文件截断 |
| `phoenix/web/git_routes.py` | `GET /api/git/diff?path=&scope=` |
| `tests/test_shell_git_workspace.py` | `test_git_diff_worktree_and_staged` |

### 前端

| 路径 | 说明 |
| --- | --- |
| `web-ui/src/api.ts` · `fetchGitDiff` | 壳层 diff 客户端 |
| `web-ui/src/components/GitDiffPreviewDialog.vue` | diff2html 并排预览（**非 G1 主路径**；Tab 落地前过渡） |
| `web-ui/src/pages/ReorderMembersPage.vue` | `fetchGitInfo` / `initGitRepo` / `fetchGitDiff` / `restoreGitPaths`；弹层 `@close` |

**现象**：点 👁 后网络 `200` 但无 UI — 根因是 `GitDiffPreviewDialog` 已 import **未写入模板**。

---

## 2. 侧栏多 block 伸缩

侧栏目标模型：**树 / Git 提交 / 属性 / 日志** 纵向堆叠；块标题可折叠；块间 `panel-resizer` 分配高度（`shell_layout` 持久化）。

| 修复 | 说明 |
| --- | --- |
| `SidebarBlock.vue` | 去掉 `innerExpanded` 双状态，单一 `defineModel('expanded')` |
| `GitCommitPanel` / `WorkspaceTreeSidebar` | 折叠时 `ws-props-stack-head` 不再占 `properties_footer_height_px` 空白 |
| `onPropsResizeStart` / `onLogResizeStart` | 外沿：`startH − delta`（向上拖增大下方块） |
| `onPropsFooterResizeStart` | 组内 Git 下沿：`startH + delta`（向上拖缩小 Git） |
| Git 异侧 / 同侧模板 | `showGitCommitStandalone` vs `gitCommitStackedWithProps` — 见 [侧栏Dock高度与Git块-归档](Web壳层-侧栏Dock高度与Git块-归档.md) |

**未做**：通用 `SidebarBlockStack`（块注册表 + 统一 resize）；块组 **标签页 / 分割堆叠** 可配置 — [侧栏Block布局模式-规划](Web壳层-侧栏Block布局模式-规划.md)

**2026-06-23 续**：侧栏 **整体高度模型** 重写 — [侧栏高度调节-规划](Web壳层-侧栏高度调节-规划.md) · Git 页 **分区批量 diff 预览** 规划 — [Git变更分区批量预览-规划](Web壳层-Git变更分区批量预览-规划.md) · **Dock/高度/Git 块合一归档** — [侧栏Dock高度与Git块-归档](Web壳层-侧栏Dock高度与Git块-归档.md)

---

## 3. 成员排序 · 变更表 UX

| 项 | 实现 |
| --- | --- |
| 路径列 | `formatFileAtRepoDir` → `PNXFoo.h @ Wsp/Frm/.../`；`:title` 保留完整 path |
| 条目「类型」 | `Folder` / `Document` 图标 + tooltip（替代「目录」「文件」标签） |

工具：`web-ui/src/utils/workspaceFileQuery.ts` · `formatFileAtRepoDir`。

---

## 4. 仍待 G1 收尾

1. **`GitFilePage`** + **`openGitFileTab`** — 预览主路径改为 Tab，弹层可删或仅 dev 保留  
2. **删 spike**：`phoenix/code/git_workspace.py` · `app.py` 内 `reorder-members/git-*` · `api.ts` 中对应函数  
3. **人工点检**：[G1点检清单](Web壳层-Git工作区插件-G1点检清单.md) §1–7、§6 分割条  
4. **可选演进**：`SidebarBlockStack` 抽象（见规划 §5.3）

---

## 5. 关键路径（本批）

```text
phoenix/shell/git/workspace.py     git_diff
phoenix/web/git_routes.py          GET /api/git/diff
web-ui/src/components/GitDiffPreviewDialog.vue
web-ui/src/components/shell/SidebarBlock.vue
web-ui/src/layout/WorkspaceTreeSidebar.vue
web-ui/src/pages/ReorderMembersPage.vue
web-ui/src/utils/workspaceFileQuery.ts
tests/test_shell_git_workspace.py
```

---

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-06-23 | 侧栏 Dock/高度/Git 块合一归档 · 组内/外部分割条方向 · 异侧模板 |
| 2026-06-23 | 初版：diff API · 成员排序迁壳层 API · 侧栏 block/分割条 · 变更表路径格式 |
