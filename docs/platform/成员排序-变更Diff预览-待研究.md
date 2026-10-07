# 成员排序 · Git 预览 / Revert — 消费方说明

> 已被替代（2026-10-04）：Desk 成员排序专属入口/API 已删除。通用 Git 页面保留，见 [Code 退役边界](../code/Desk-Code功能退役.md)。下文保留历史。

> **壳层能力**见 **[Web壳层-Git工作区插件-规划.md](Web壳层-Git工作区插件-规划.md)**（**Git 页** + **Git 文件 Tab**）。  
> **实现归档**：[Web壳层-Git工作区插件-G1续归档.md](Web壳层-Git工作区插件-G1续归档.md)  
> 关联：[成员函数排序-reorder_members.md](../code/成员函数排序-reorder_members.md) · `ReorderMembersPage.vue`  
> 状态：**G1 消费方已接壳层 API** · Tab 预览待 `GitFilePage`  
> 最后更新：2026-06-23

---

## 1. 本页在插件中的角色

成员排序是 Git 插件的 **首个消费方**：变更表上 **跳转** 壳层 Git，不维护 Git API。

| 项 | 本页行为 |
| --- | --- |
| **Git 后端** | **不实现**；只调壳层 **`/api/git/*`** |
| **预览** | 写盘后 → 表内 👁 → **`GET /api/git/diff`** + **`GitDiffPreviewDialog`**（**过渡**）；目标仍为 **`openGitFileTab(path)`** |
| **在 Git 中查看** | 写盘后 → **`openGitPage()`**（可选 payload 高亮 path） |
| **Revert（快捷）** | 表内 → **`POST /api/git/restore`**（`scope=worktree`） |
| **暂存 / commit** | **不在本页**；用户在 **Git 页** 点 **+** 暂存 → 填 log → Commit |
| **预检** | 仅路径列表；无 Git 操作 |
| **Git init** | 无 `.git` 时 banner → **`POST /api/git/init`**（**仅工作空间根**） |

**范围**：与壳层一致 — **仅当前工作空间根 Git 仓**；子模块路径不在 Git 页展示、不可通过本页 API 操作。

---

## 2. 交互摘要

```text
执行排序（写盘）→ changed_files（展示：文件名 @ 目录/）
  → [在 Git 中查看] → GitPage
       更改区 [+] 暂存 → 已暂存区 [-] 可取消 → 提交说明 → Commit
  → [预览 👁] → GET /api/git/diff → 过渡弹层（diff2html）
  → [Revert] → restore worktree（表内快捷）
```

典型收尾：成员排序写盘 → **Git 页** → 对改动文件点 **+** → 填写说明（如 `reorder: Mod/foo.h`）→ **提交**。

---

## 3. 本页不做

- 页内 **+ / −** / commit UI  
- 预检内存 diff  
- 长期保留 spike **`/api/code/reorder-members/git-*`**（壳层 API 已替代，路由待删）

---

## 4. 验收（G1 消费方）

- [ ] 写盘后「在 Git 中查看」→ Git 页 **更改** 区列出本次 path  
- [ ] 点 **+** 暂存 → **−** 取消 → commit 后文件从列表消失  
- [x] 表内预览 → 壳层 diff + 弹层（2026-06-23）  
- [ ] 预览 → `git_file` Tab（G1 收尾）  
- [ ] 预检行无 Git 按钮  

---

## 历史

- 2026-06-22：独立调研稿  
- 2026-06-23：并入壳层 Git 插件；Tab 预览  
- 2026-06-23：Git 页 + commit  
- 2026-06-23：暂存改为 VS Code 式 **+ / −**（不用复选框批量）  
- 2026-06-23：消费方迁 `/api/git/*`；弹层挂载修复 — [G1续归档](Web壳层-Git工作区插件-G1续归档.md)
