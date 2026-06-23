# Git 工作区插件 — 待办（TODO-GIT）

> **总索引**：[TODO.md](TODO.md)  
> **规划**：[Web壳层-Git工作区插件-规划.md](platform/Web壳层-Git工作区插件-规划.md)  
> **G1 人工点检**：[Web壳层-Git工作区插件-G1点检清单.md](platform/Web壳层-Git工作区插件-G1点检清单.md)  
> **消费方**：[成员排序-变更Diff预览-待研究.md](platform/成员排序-变更Diff预览-待研究.md)  
> 状态：`[ ]` 未做 · `[~]` 进行中 · `[x]` 已完成

最后更新：2026-06-23（侧栏归档见 [侧栏Dock高度与Git块-归档](platform/Web壳层-侧栏Dock高度与Git块-归档.md)）

---

## 里程碑概览

| 阶段 | 目标 | 状态 |
| --- | --- | --- |
| **G1 · 核心** | Git 页 + 暂存/提交 + 侧栏 · 本机 `git` CLI | [x] 已落地 |
| **G1 · 收尾** | `GitFilePage` · 删 spike | [~] diff + 成员排序壳层 API 已接 |
| **G1 · 点检** | [G1点检清单](platform/Web壳层-Git工作区插件-G1点检清单.md) 人工验收 | [ ] |
| **G2** | diff2html · `status-paths` 脏文件过滤 | [ ] |
| **G3** | 其它业务页跳转 Git Tab / 统一 `useGitWorkspace` | [ ] |

---

## G1 · 壳层 API / 后端

- [x] **`phoenix/shell/git/`**：`paths.py` · `runner.py` · `workspace.py`（独立包，无 Code/CAD 依赖）
- [x] **HTTP**：`GET /api/git/info` · `init` · `changes` · `POST stage` · `restore` · `commit`
- [x] **changes 三区**：`staged` / `changes` / `untracked` + 计数
- [x] **restore scope**：`worktree` · `staged` · `untracked`（未跟踪 → `git clean -fd`）
- [x] **路径安全**：工作空间根 `git -C`；submodule 过滤；`repo_rel` 校验
- [x] **回归单测**：`tests/test_shell_git_workspace.py`（dotfile unstage · quoted path · untracked delete 等）
- [x] **`GET /api/git/diff`**：`path` · `scope=worktree|staged` · unified text · `is_binary` · 截断 — 见 [G1续归档](platform/Web壳层-Git工作区插件-G1续归档.md)

---

## G1 · Git 页（`GitPage`）

- [x] 三区折叠块：**已暂存** → **更改** → **未跟踪**；空区隐藏；全干净 empty
- [x] 固定页头 · 区内滚动 · 文件/树列表（属性 sheet 切换）
- [x] **路径筛选**：`GitPathFilterChips` · 回车标签 · 多条件 AND — **UI / 功能点检通过（2026-06-23）**
- [x] **行状态徽章**：`GitChangeStatusBadge`（M/A/D/R/C/T/! · tooltip 含分区）— 状态对照点检 [x] 2026-06-23
- [x] **VS Code 式行内操作**：悬停 **预览 diff / + / − / Revert**；标题行批量 **+/−** / 放弃全部
- [ ] **分区批量预览**：区头左侧 **查看修改** · 多文件弹层 · 按需加载 — [规划](platform/Web壳层-Git变更分区批量预览-规划.md)
- [x] **框选多行批量**：每 block 独立 · 拖拽 / Ctrl / Shift · 行内按钮对所选 `paths[]`
- [ ] **点文件开 Tab**：依赖 §G1 收尾 `GitFilePage` + diff API
- [ ] **人工点检**：见 [G1点检清单 §1–7](platform/Web壳层-Git工作区插件-G1点检清单.md)

---

## G1 · 侧栏 · 提交与属性

- [x] **`GitCommitPanel`**：侧栏置顶 · **`POST /api/git/commit`**
- [x] **`SidebarBlock`**：侧栏系统 block（`strip` / `card`）· Git / 日志 / 属性统一
- [x] **`properties_footer_height_px`**：Git 与属性组内高度 · `shell_layout` 持久化
- [x] Git 提交独立 `git_commit_panel_dock` · 异侧/同侧模板 · 折叠与「显示」分离 — [侧栏归档](platform/Web壳层-侧栏Dock高度与Git块-归档.md)
- [~] **Git 侧栏显示**：分侧停靠切换后布局仍待收尾 — 同上 §5
- [x] 属性区 / 日志区外部分割条 · 组内 Git 下沿分割条方向 — 同上 §3.2
- [x] 提交说明 textarea 撑满 block
- [ ] **点检**：分割条拖拽保存 · 标题不随内容滚动 — [G1点检清单 §6](platform/Web壳层-Git工作区插件-G1点检清单.md)

---

## G1 · 导航与属性 sheet

- [x] Ribbon · **Git** 入口
- [x] `useGitPropertySheet` · 进入 Git 页自动展开属性侧栏
- [x] 属性 sheet：环境 / 仓库 / 变更统计 / 列表模式 等只读组

---

## G1 · 收尾

- [ ] **`GitFilePage`** + **`openGitFileTab`**：文件 diff Tab · 工具条 Revert / stage
- [~] **成员排序消费方**：`ReorderMembersPage` 已用 **`/api/git/info|init|diff|restore`**；spike 路由与 `git_workspace.py` **待删**
- [ ] **删除 spike**：`phoenix/code/git_workspace.py` · reorder-members git 路由（`GitFilePage` 落地后删）
- [x] 成员排序表内 diff **过渡弹层**（`GitDiffPreviewDialog` + diff2html）；主路径仍为 Tab

---

## G2 · 增强（规划内 · 未立项细节）

- [ ] **diff2html**：Git 文件 Tab / 业务页预览统一渲染（见 [成员排序-变更Diff预览-待研究.md](platform/成员排序-变更Diff预览-待研究.md)）
- [ ] **`GET /api/git/status-paths`**：给定 `paths[]` 返回 dirty / staged 子集（成员排序脏文件过滤等）
- [ ] **成员排序 · 脏文件过滤**：接 G2 `status-paths`（[TODO.md §Code](TODO.md#p3--code-工具已起步) 交叉项）

---

## G3 · 推广与其它消费方

- [ ] **Code 批量改名 / UUID 替换**：写盘后跳转 Git 页或 Git Tab（规划 P2）
- [ ] **`useGitWorkspace`** composable：业务页仅 HTTP 客户端，不各自 subprocess
- [ ] **XLink / 其它写盘工具**：变更列表快捷入口（按需）

---

## 技术债 / 清理

- [ ] spike **`/api/code/reorder-members/git-*`** 与 **`git_workspace.py`** 删除清单（依赖 G1 收尾迁移）
- [ ] 文档：规划 §10 验收与 [G1点检清单](platform/Web壳层-Git工作区插件-G1点检清单.md) 同步打勾
- [ ] **侧栏 block 组布局**：标签页 / 分割堆叠 · 标题右键或 `⋮` — [规划](platform/Web壳层-侧栏Block布局模式-规划.md)

---

## 关键路径（便于检索）

```text
phoenix/shell/git/          workspace.py · paths.py · runner.py
phoenix/web/git_routes.py
web-ui/src/pages/GitPage.vue
web-ui/src/components/git/*   GitChangeList · GitSectionHead · …
web-ui/src/components/shell/  GitCommitPanel · SidebarBlock
web-ui/src/composables/       useGitPageState · useGitPropertySheet · useGitListSelection
web-ui/src/components/GitDiffPreviewDialog.vue   # 过渡弹层 · G1 Tab 后可选删
tests/test_shell_git_workspace.py
```

---

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-06-23 | 侧栏 Dock/高度/Git 块归档 · Git 分侧与分割条修正 |
| 2026-06-23 | diff API · 成员排序迁壳层 · 侧栏 block/分割条 · [G1续归档](platform/Web壳层-Git工作区插件-G1续归档.md) |
| 2026-06-23 | §2.5 路径筛选标签（UI + 功能）点检通过 |
| 2026-06-23 | 从 [TODO.md](TODO.md) 拆出独立 TODO-GIT；含框选批量 · SidebarBlock · 侧栏 persist 修复 |
| 2026-06-22 | G1 核心落地摘要写入规划 |

