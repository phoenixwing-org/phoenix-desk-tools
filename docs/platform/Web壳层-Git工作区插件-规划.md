# Git 工作区插件 — 壳层系统能力规划

> **壳层系统能力**（与 [FileWorkset-规划.md](FileWorkset-规划.md) 同级）：**当前活动工作空间根**上的轻量 Git 页 + 文件 diff Tab（不含子模块 / 父仓）；**不是**完整 Git 客户端。  
> 关联：[Phoenix平台-多应用壳层-规划讨论.md](Phoenix平台-多应用壳层-规划讨论.md) · [成员排序-变更Diff预览-待研究.md](成员排序-变更Diff预览-待研究.md) · [isomorphic-git 介绍与选型对比](Git插件-isomorphic-git-介绍与选型对比.md)  
> 状态：**G1 核心已落地**（`phoenix/shell/git` · `/api/git/*` · `GitPage` · `GitCommitPanel`）；**G1 收尾**：`GitFilePage`、删 spike — [G1续归档](Web壳层-Git工作区插件-G1续归档.md)  
> 最后更新：2026-06-22（G1 落地摘要 · changes 三区 · 列表 UX · commit 接通）

---

## 1. 问题从哪来

业务工具（成员排序、批量改名、UUID 替换等）写盘后，用户需要：

- 在 **Web 内**快速确认「相对 Git 改了什么」（与 Cursor SCM 同源）
- 点 **+** 暂存、点 **−** 取消暂存，填写说明并 **本地 commit**，不必切 IDE
- 不满意时 **Revert**（`git restore`）
- 工作空间尚未 `git init` 时，可 **一次性初始化**（Git 程序用户自装）

若每个业务页各自封装 `subprocess git`、各自 API（如 `/api/code/reorder-members/git-*`），会：

- 重复路径校验、二进制判定、错误文案
- UI 上 diff 弹层、Revert 确认各写一套 → 滑向「每个页一个小 Git 浏览器」

因此需要 **壳层 Git 插件**：统一后端 + 统一 Web 组件，业务页只传 **path 列表** 与 **场景**。

**后台原则**：Git 能力在 Python 侧 **相对独立**——单独包、可单测、**不**依赖 Code/CAD 业务模块；HTTP 只做薄封装。

---

## 2. 定位与边界

### 2.1 是什么

| 层级 | 职责 |
| --- | --- |
| **探测** | 本机是否有 `git`；**工作空间根**是否有 `.git`（不查父仓）；`git_root` 展示 |
| **只读** | 对给定 `repo_rel_path` 执行 `git diff` / `git diff --cached`（文本 unified；二进制标记不展示正文） |
| **写回（受限）** | `git add` / `restore --staged` / `restore`（工作区）；**`git commit -m`**（仅已暂存）；`git init` |
| **展示** | **Git 页**（更改 / 已暂存 分区 · 行内 **+ / −** · 提交说明 + Commit）；**Git 文件 Tab**（对比 + 工具条） |

### 2.2 不是什么（硬边界）

| 不做 | 说明 |
| --- | --- |
| **Git 浏览器 / 完整 SCM** | 无 commit **历史**浏览、无 branch 切换 UI、无全仓目录树 |
| **浏览器内 Git 引擎** | 不用 [isomorphic-git](Git插件-isomorphic-git-介绍与选型对比.md)；一律 **本机 `git` 子进程** |
| **远程** | 无 clone / fetch / push / pull |
| **提交** | **有** Git 页：**+ 暂存 → 填 log → commit**（仅本地仓）；**无** amend / rebase / 多行模板 |
| **预检 diff（默认）** | 磁盘未改时 `git diff` 无意义；预检 diff 若要做，属 **业务页 + 内存 diff**，不进本插件 MVP |
| **持久化 diff** | 不 SQLite、不写 launcher；写盘后 **Git 即真相源** |
| **子模块 / 嵌套仓** | **不**进入 submodule 独立仓；**不**对父目录 Git 仓操作；见 §2.3 |

**产品句**：*Git 插件 = **当前活动工作空间根** 上的 Git CLI 适配层 + **Git 页**（VS Code 式 **+ / −** 暂存 + commit）+ **文件 Tab**；业务页只 **跳转**。*

> **为何不采用 isomorphic-git？** 见独立说明：[Git插件-isomorphic-git-介绍与选型对比.md](Git插件-isomorphic-git-介绍与选型对比.md)（MIT 许可无冲突；否决原因为 **磁盘工作空间 vs 浏览器内存仓** 与产品边界）。

### 2.3 工作空间范围（硬约束）

Git 页及全部 `/api/git/*` **仅**针对壳层 **当前活动工作空间根**（`get_workspace()`），与 FileWorkset / BOM 同一「工作空间」概念。

| 规则 | 说明 |
| --- | --- |
| **Git 根 = 工作空间根** | 仅当 **工作空间根目录** 存在 `.git` 时视为 `repo_initialized`；**不**向上遍历父目录找外层仓 |
| **所有 `git -C`** | 固定为 **工作空间根**；禁止 `-C` 到子路径或父路径 |
| **path 范围** | API 的 `repo_rel_path` 须落在工作空间根下；`paths.py` 做 `relative_to(workspace_root)` 校验 |
| **子模块** | 工作空间内若含 **git submodule**（嵌套 `.git` / gitlink）：**不**展示、**不** diff / add / restore / commit；请求命中 → 400 + 明确文案 |
| **子模块命令** | 禁止 `git submodule *`；G1 不做 submodule init / update UI |
| **父仓嵌套** | 工作空间是更大 Git 仓的子目录、但工作空间根 **无** `.git` → 按 **未初始化** 处理；提示在工作空间根 `git init` 或调整工作空间路径，**不**代操外层仓 |

```text
✓  workspace/          ← get_workspace()，git -C 仅此目录
   ├── .git/
   ├── Mod/foo.h
   └── vendor/lib/      ← 若为 submodule → 列表过滤 / API 拒绝

✗  /big-repo/          ← 父仓 .git（工作空间在其子目录内）→ 不采用
     └── workspace/
```

**实现要点**（`phoenix/shell/git/paths.py`）：

1. `git_root(workspace)` → 仅 `(workspace / ".git").exists()` 时返回 `workspace`，否则 `None`（**删除** spike 中 `find_git_root` 向上 walk）。  
2. `list_changes`：`status --porcelain` 后 **过滤** submodule 路径（`.gitmodules` + `git ls-files --stage` 模式 `160000`，或 path 下存在嵌套 `.git`）。  
3. `resolve_repo_rel(workspace, rel)`：解析后若 path 落在 submodule 根或其内部 → `ValueError`。

### 2.4 暂存交互（已定 · 参考 VS Code SCM）

**不用**行首复选框 + 「暂存选中」批量按钮。

| 分区 | 行内操作 | API |
| --- | --- | --- |
| **更改**（工作区有未暂存改动） | **`+`** 暂存该 path | `POST /api/git/stage { paths: [path] }` |
| **已暂存** | **`−`** 取消暂存 | `POST /api/git/restore { paths: [path], scope: staged }` |

- 布局对齐 VS Code 源代码管理：**更改** / **已暂存** 两个折叠区块；同一 path 若同时有 staged + unstaged（如 `MM`），可 **两区各出现一行**（与 VS Code 一致）。  
- **`+` / `−`** 为 icon 按钮（如 Element Plus `Plus` / `Minus`）；点击 **立即** 调 API 并刷新列表，**非** toggle 复选框。  
- **丢弃工作区修改**（Revert）不在 `+` / `−` 上；放在行内菜单或 **Git 文件 Tab** / 业务页快捷 Revert。

**框选多行 · 区内批量**（G1 · 2026-06-22）：

- 每个折叠 block（已暂存 / 更改 / 未跟踪）内 **独立** 选中状态；**不用**复选框。  
- **拖拽框选** 或 **Ctrl/Cmd+单击** / **Shift+单击** 多选行；选中行高亮，行内 **`+` / `−` / Revert** 始终可见。  
- 在多选状态下，点 **任一所选行** 的行内按钮 → `paths` 为 **全部选中 path**（与标题行「全部」不同：标题作用于 **当前筛选结果**）。  
- 点 **未选中行** 的行内按钮 → 仅该 path。  
- 点检清单见 [Web壳层-Git工作区插件-G1点检清单.md](Web壳层-Git工作区插件-G1点检清单.md) §5。

---

## 3. 架构

```text
┌─────────────────────────────────────────────────────────┐
│  web-ui  业务页（reorder_members / code_rename / …）      │
│    └─ useGitWorkspace → /api/git/*（仅 HTTP 客户端）      │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  phoenix/web/git_routes.py     HTTP 薄层（~数十行/路由）   │
│    get_workspace() → phoenix.shell.git.*                 │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  phoenix/shell/git/            ★ 后台核心 · 相对独立 ★     │
│    paths.py      工作空间根 git_root、submodule 过滤、repo_rel 校验   │
│    runner.py     白名单 subprocess（禁止 shell 拼接）      │
│    workspace.py  info / init / changes / diff / stage / restore / commit │
│    （无 FastAPI · 无 reorder · 无 freecad 依赖）          │
└───────────────────────────┬─────────────────────────────┘
                            │  subprocess
                     本机 git（用户安装）
```

### 3.1 后台分层与独立约束

| 层 | 目录 | 职责 | 依赖 |
| --- | --- | --- | --- |
| **核心** | `phoenix/shell/git/` | Git CLI 适配、路径安全、diff/restore 语义 | `pathlib`、`subprocess`；可复用 `user_prefs.format_resolved_under_workspace` **仅作展示** |
| **HTTP** | `phoenix/web/git_routes.py` 或 `register_git_routes(app)` | 解析 query/body、`get_workspace()`、转 HTTP 状态码 | **仅** `shell.git` + `get_workspace` |
| **业务** | `phoenix/code/*`、`services/reorder_*` | 排序、改名等 | **禁止** `import phoenix.shell.git` 以外再包一层 Git；**禁止**业务 service 内嵌 `subprocess git` |

**硬性规则**

1. **`phoenix/shell/git` 不 import** `phoenix.code`、`phoenix.freecad`、`reorder_members`、任何业务 `*_service`。  
2. **业务模块不 import** `phoenix.shell.git` 做「顺便 diff」——只通过 **`/api/git`** 或（CLI 未来）直接调 `shell.git` 公共 API。  
3. **单测**放在 `tests/test_shell_git_workspace.py`（或 `tests/shell/git/`），**不**起 FastAPI、**不**跑成员排序 fixture。  
4. 实验 spike `phoenix/code/git_workspace.py` **立项时删除**；不得长期留在 `code/` 下冒充业务代码。

**可选薄 service**（若路由文件过长）：`phoenix/services/shell_git_service.py` 仅一行转发 `shell.git`，**不得**含业务逻辑；倾向 G1 直接 `git_routes → shell.git` 保持更独立。

```text
允许：  web → shell.git
        tests → shell.git
禁止：  reorder_members_service → shell.git
        shell.git → reorder_members
        shell.git → FastAPI
```

与 [FileWorkset](FileWorkset-规划.md) 对比：

| | FileWorkset | Git 插件 |
| --- | --- | --- |
| 存储 | SQLite `phoenix_workset*` | **无**（只读 Git 状态） |
| API 前缀 | `/api/file-worksets` | **`/api/git`** |
| 侧栏 | 工作集 Tab | **Git 页**（`git`）+ **文件 Tab**（`git_file`） |
| 消费方 | 扫描 scope | 变更 path → **Git 页** / **开文件 Tab** |

---

## 4. API（统一前缀）

> **范围**：所有接口仅服务 **当前活动工作空间根** 上的 Git 仓（§2.3）；不含子模块、不含父仓。

> 现状：存在 **实验性** 实现挂在 `/api/code/reorder-members/git-*` 与 `phoenix/code/git_workspace.py`（含向上 `find_git_root`）；**立项时迁移并改为工作空间根限定**。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/git/info` | `{ git_installed, repo_initialized, git_root, git_root_display }`；`git_root` 恒等于工作空间根或 `null` |
| POST | `/api/git/init` | **工作空间根** `git init`；已有 `.git` → 400 |
| GET | `/api/git/changes` | 当前修改列表（`git status --porcelain` 解析）；见 §4.3 |
| GET | `/api/git/diff?path=&scope=` | 见 §4.1；`scope=worktree`（默认）或 `staged` |
| POST | `/api/git/restore` | body `{ paths, scope? }` → 工作区 `git restore --`；`scope=staged` → `restore --staged` |
| POST | `/api/git/stage` | body `{ paths: string[] }` → `git add --` |
| POST | `/api/git/commit` | body `{ message: string }` → `git commit -m`（**仅已暂存**）；见 §4.4 |
| GET | `/api/git/file-status?path=` | 单文件状态（供 **Git 文件 Tab** 工具条 disabled） |

可选 **G2**（仍非 Git 浏览器）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/git/diff-batch` | 多 path 一次 diff（**可选 G2**；分区批量预览量大时再上 — [分区批量预览规划](Web壳层-Git变更分区批量预览-规划.md) §5.4） |
| GET | `/api/git/status-paths?paths=` | 给定 path 是否 modified / untracked（脏文件过滤） |

### 4.1 `GET /api/git/diff` 响应

```json
{
  "path": "Mod/foo.h",
  "has_diff": true,
  "is_binary": false,
  "unified_diff": "diff --git a/…",
  "truncated": false,
  "message": null
}
```

| 字段 | 规则 |
| --- | --- |
| `is_binary` | Git 判定 binary → `true`，**不**填可读 `unified_diff` |
| `has_diff` | 无差异 → `false`，`message` 说明（未跟踪 / 已 restore） |
| `truncated` | 超过 512KB 截断 |
| 执行 | `scope=worktree` → `git diff -U3 --`；`scope=staged` → `git diff --cached -U3 --` |

路径：相对 **工作空间根** 的 `repo_rel_path`；禁止 `..`；文件须存在。

### 4.2 `GET /api/git/file-status`（G1）

```json
{
  "path": "Mod/foo.h",
  "untracked": false,
  "modified": true,
  "staged": false,
  "has_worktree_diff": true,
  "has_staged_diff": false
}
```

供 **Git 文件 Tab** 工具条：无工作区改动时禁用「对比（工作区）」；未暂存时禁用「取消暂存」等。

### 4.3 `GET /api/git/changes`（G1 · Git 页）

```json
{
  "staged": [
    {
      "path": "Mod/bar.cpp",
      "index_status": "M",
      "worktree_status": " ",
      "staged": true,
      "modified": false,
      "untracked": false,
      "section": "staged"
    }
  ],
  "changes": [
    {
      "path": "Mod/foo.h",
      "index_status": " ",
      "worktree_status": "M",
      "staged": false,
      "modified": true,
      "untracked": false,
      "section": "changes"
    }
  ],
  "untracked": [
    {
      "path": "Mod/new.cpp",
      "index_status": "?",
      "worktree_status": "?",
      "staged": false,
      "modified": false,
      "untracked": true,
      "section": "untracked"
    }
  ],
  "staged_count": 1,
  "unstaged_count": 2,
  "untracked_count": 1
}
```

| 字段 | 规则 |
| --- | --- |
| 来源 | `git -C <workspace_root> status --porcelain -u`（**不** `--ignore-submodules`，由后端过滤） |
| 范围 | **仅**工作空间根仓内、**非 submodule** 的有改动 path |
| 过滤 | 剔除 gitlink / 嵌套 `.git` 子仓路径；UI 不展示 submodule 行 |
| 分区 | **`staged`** / **`changes`**（已跟踪、工作区有改动）/ **`untracked`**（`??`）；`changes[]` **不含**未跟踪行 |
| 计数 | `staged_count`、`unstaged_count`（`changes` + `untracked`）、`untracked_count` |
| 排序 | 各区内路径字典序；同 path 不重复 |

### 4.4 `POST /api/git/commit`（G1）

```json
// request
{ "message": "reorder: Mod/foo.h members" }

// response
{ "commit_sha": "a1b2c3d", "committed_paths": ["Mod/foo.h"], "message": "…" }
```

| 规则 | 说明 |
| --- | --- |
| 执行 | `git -C <workspace_root> commit -m <message>`；**只提交 index 中已暂存** |
| `message` | 必填；trim 后非空；最大 4096 字符；经 `subprocess` 传参，**禁止** shell 拼接 |
| 无暂存 | 400，`detail` 提示先点 **+** 暂存 |
| 未配置 user | Git 返回非 0 → 503 + 中文提示配置 `user.name` / `user.email`（本地 `git config`） |
| 成功后 | 前端 `loadChanges()` 刷新列表；已 commit 的 path 从列表消失 |

---

## 5. Web 前端（壳层）

### 5.1 Git 页（G1 核心 · `git`）

**工作台单 Tab**（`max_tabs: 1`）。**主区** = 已暂存 / 更改 / 未跟踪三区列表；**右侧停靠** = 属性（状态摘要）+ **提交区**（见 §5.3）。

```text
主区（GitPage · 固定页头 + 下方滚动体）     右侧停靠（Git 页时）
├─ 已暂存  [−] …（可折叠 · 区内 max-height 滚动）   ├─ 属性：Git 程序 / 仓库 / 统计 / 列表模式 …
├─ 更改    [+] …                                   └─ 提交：说明 + Commit（Ctrl/Cmd+Enter）
└─ 未跟踪  [+] …
```

> **不采用**：左侧与工作集并列 Tab（Git 仅单页相关）；Ribbon 独立 Git 操作栏（与 VS Code SCM 面板语义重复）。

| 交互 | 行为 |
| --- | --- |
| **页头固定** | `AppShell` 对 `.page.git-page` 设 `overflow: hidden`；`git-page-head` + `git-page-body` 分栏滚动 |
| **区块折叠** | 三区标题可点击折叠（`ExpandCaret`）；`.section-body` 设 `max-height: min(400px, calc(50vh - 120px))` |
| **列表模式** | 属性面板可选 **文件** / **树**；持久化 `phoenix-git-list-view-v1`（`gitChangeView.ts`） |
| **文件模式路径** | 行内仅 basename；悬停 tooltip 完整路径（`GitChangePathLabel.vue`，450ms 延时） |
| **`+`（更改 / 未跟踪区）** | 单行暂存 → `POST /api/git/stage { paths: [path] }` → 刷新 |
| **`−`（已暂存区）** | 单行取消暂存 → `POST /api/git/restore { scope: staged }` → 刷新 |
| **预览** | 行内 **预览 diff**（`GitDiffPreviewButton` · 单文件弹层）；**分区批量预览**（区头左侧 · 多文件按需加载）— [规划](Web壳层-Git变更分区批量预览-规划.md) · 终局 `openGitFileTab(path)` |
| **提交说明** | 侧栏 **`GitCommitPanel`**；`useGitPageState` 共享；**不**持久化 |
| **提交 Commit** | **`POST /api/git/commit { message }`** → 刷新列表（503 提示配置 `user.name` / `user.email`） |
| **路径筛选** | 页头 **`GitPathFilterChips`**：回车添加标签 · 多条件 AND · 不区分大小写 |
| **行状态徽章** | **`GitChangeStatusBadge`** · `resolveGitStatusDisplay`；悬停 tooltip 含 **已暂存/更改/未跟踪** 分区 |

**不用**：行首复选框、「暂存选中 / 取消暂存选中」批量条。详见 §2.4。

#### 5.1.1 行状态对照（`git status --porcelain`）

| 字母 | 含义 | 颜色 | 典型场景 |
| --- | --- | --- | --- |
| **M** | 修改 | 橙黄 | 已跟踪文件内容变更 |
| **A** | 新增 | 绿 | 已暂存新文件 |
| **A** | 未跟踪 · 新文件 | 浅绿 | **未跟踪** 分区（尚未 `git add`） |
| **D** | 删除 | 红 | 工作区或暂存区删除 |
| **R** | 重命名 | 蓝 | porcelain `R` |
| **C** | 复制 | 蓝 | porcelain `C` |
| **T** | 类型变更 | 黄 | 如文件↔symlink |
| **!** | 冲突 / 未合并 | 红 | porcelain `U` |

> **验收**：人工点检状态字母与 tooltip 分区说明 — **已通过（2026-06-23）**。实现：`web-ui/src/utils/gitChangeView.ts` · `GitChangeStatusBadge.vue`。

### 5.3 侧栏布局（已定）

```text
ws-props-wrap（Git 页）
├─ Git 提交（GitCommitPanel · 置顶 · 可调高度）
├─ ── 拖拽分隔 ──
└─ 页面属性（PagePropertiesPanel）
```

| 区域 | 组件 | 何时显示 |
| --- | --- | --- |
| **Git 提交** | `GitCommitPanel` | Git 页且属性面板展开（**堆叠在属性区上方**） |
| **属性** | `PagePropertiesPanel` + `useGitPropertySheet` | 同上 |

进入 Git 页时 **自动展开属性面板**（`setPropertiesOpen(true)`），与 FileWorkset 的「工作集 Tab」**不合并**——工作集仍是跨模块 path 集合；Git 提交仅 `git` 页出现。

水平停靠（属性靠左/右）见 **[侧栏左右Dock-规划](Web壳层-侧栏左右Dock-规划.md)**；本节仅描述 **props_stack 组内纵向** 顺序。

共享状态：`useGitPageState`（`stagedCount` / `commitMessage` / refresh 回调）。

### 5.2 Git 文件 Tab（`git_file`）

与 `file_detail` 同类：**一个 path = 一个 Tab**，深链 `?page=git_file&rel=Mod/foo.h`。

```text
业务页
  ├─ [在 Git 中查看] → openGitPage()
  └─ 变更表 · [预览] → openGitFileTab(path)

Git 文件 Tab
  ├─ 对比区：工作区 / 暂存 diff
  └─ 工具条：[+] 暂存  [-] 取消暂存  [Revert 工作区]（与 Git 页同一 API）
```

| 资产 | 说明 |
| --- | --- |
| `pages/GitPage.vue` | **G1**：主区更改 / 已暂存 + **+ / −** |
| `components/shell/GitCommitPanel.vue` | **G1**：侧栏提交区 |
| `composables/useGitPageState.ts` | Git 页 ↔ 侧栏提交区共享状态 |
| `pages/GitFilePage.vue` | **G1**：单文件 diff + 工具条 |
| `composables/useGitWorkspace.ts` | `loadChanges`、`stage`、`commit`、`fetchDiff`、`restore`、`openGitPage`、`openGitFileTab` |
| `composables/useAppShell` | `openGitPage()`、`openGitFileTab(rel)` |
| `types/gitWorkspace.ts` | 与 API 对齐 |

**`GitDiffPreviewDialog`**：成员排序 **过渡弹层**（diff2html）；G1 主路径仍为 **`git_file` Tab** — Tab 落地后可删弹层。

**展示策略**

| 阶段 | UI |
| --- | --- |
| **G1** | Git 页 **已暂存 / 更改 / 未跟踪** 三区 + **+ / −** + 列表模式；文件 Tab `<pre>` diff（**Tab 待做**） |
| **G2** | 文件 Tab **diff2html** |
| **二进制** | 文件 Tab alert；列表行可标 `binary`（可选 `git diff --numstat`） |

**入口**

| 入口 | 说明 |
| --- | --- |
| 导航 / Ribbon · **Git** | `openGitPage()` |
| 业务页 · **在 Git 中查看** | 写盘后跳转 Git 页（可 `payload` 预选 path） |
| 业务页变更表 · **预览** | `openGitFileTab(path)` |
| 无 `.git` | Git 页 banner · **初始化 Git** |

`app_config.workbench.pages`：`git`（`max_tabs: 1`）、`git_file`（多 Tab，对齐 `file_detail`）。

---

## 6. 业务页接入约定

1. 写盘 / 产生 `changed_files` 后，调用 `loadGitInfo()`。
2. 表操作列：`status === 'written'` 且 `gitReady` → **预览**（开 Tab）、可选 **Revert**；预检行不显示。
3. **预览**：`shell.openGitFileTab(row.path)` — **不**在业务页内嵌 diff 弹层。
4. **Revert（快捷）**：表内 `promptChoice` → `restore({ paths, scope: 'worktree' })` → 从 `changedFileRows` 移除；与 Tab 内 Revert 共用 API。
5. **暂存 / commit**：仅在 **Git 页**（**+ / −** + 提交说明）；文件 Tab 可单行 **+ / −**；业务页 **不**复制。
6. `!repo_initialized`：Git 页或业务页 banner · **初始化 Git**。

### 6.1 已规划消费方

| 消费方 | 优先级 | 说明 |
| --- | --- | --- |
| [C++ 成员排序](成员排序-变更Diff预览-待研究.md) | **P1** | 变更文件表；首个落地页 |
| Code 批量改名 | P2 | 写盘后变更列表（若有） |
| Code UUID 替换 | P2 | 同上 |
| 成员排序 · Git 脏文件过滤 | P2 | `status-paths` 或 `git diff --name-only` 过滤排序范围 |

---

## 7. 分期实施

| 阶段 | 后端 | 前端 | 消费方 |
| --- | --- | --- | --- |
| **G0 · 规划** | API/目录约定 | 组件清单 | 本文档 + 消费方附录 | **已完成** |
| **G1 · 核心** | `shell/git` + `/api/git/*`（含 changes / commit）；迁移 spike | **`GitPage`** + `GitFilePage` + `openGitPage` | 成员排序 · 预览 / 进 Git 页 | **← 进行中** |
| **G2 · 体验** | `status-paths` | diff2html；Git 页 payload 预选 path | 脏文件过滤 |
| **G3 · 推广** | — | — | 改名 / UUID 等页按需接 |

### 7.1 G1 落地摘要（2026-06-22）

| 区域 | 已落地 | 待 G1 收尾 |
| --- | --- | --- |
| **后端** | `phoenix/shell/git/workspace.py` · `GET info/changes/diff` · `POST init/stage/restore/commit` · `tests/test_shell_git_workspace.py` | `GET /api/git/file-status`（可选） |
| **前端 · Git 页** | `GitPage` · 三区列表 · +/- · 固定页头 · 折叠 · 区内滚动 · 文件/树模式 · `useGitPropertySheet` | `openGitFileTab` · `GitFilePage` |
| **前端 · 侧栏** | `GitCommitPanel` · `SidebarBlock` · 多 block 分割条（2026-06-23 方向修正） | 通用 `SidebarBlockStack`（可选） |
| **导航** | Ribbon · **Git** · `pageId: git` | — |
| **消费方** | 成员排序 · `/api/git/*`（info/diff/restore/init）· 过渡弹层预览 | 删 spike · Tab 预览 |

**G1 不做**：commit **历史** UI、branch、remote、全仓目录树、**submodule**、父仓 Git、预检内存 diff。

---

## 8. 安全与运维

- 所有 path 相对于当前 **活动工作空间根**；与现有 BOM / 索引 API 同一套校验。
- **Git 操作边界**：`git -C` 仅工作空间根；**不**向上匹配父仓、**不**进入 submodule 子仓（§2.3）。
- 仅允许白名单子命令：`init`、`status`、`diff`、`diff --cached`、`add`、`restore`、`restore --staged`、`commit`；**禁止** `submodule` 及任意 shell。
- Git 未安装：HTTP 500/503 + 明确中文 `detail`；前端统一文案。
- 大 diff 截断；错误不泄露本机绝对路径（展示用 `git_root_display` 即可）。

---

## 9. 与实验代码的关系

壳层 **`phoenix/shell/git/`** 与 **`/api/git/*`** 已落地（2026-06-22）。仓库中 **仍保留** 成员排序 spike：

| 路径 | 状态 |
| --- | --- |
| `phoenix/shell/git/` · `/api/git/*` | **已落地**（G1 核心） |
| `phoenix/code/git_workspace.py` · `/api/code/reorder-members/git-*` | **待删** — 消费方已改壳层 API；路由与模块待清理 |
| `GitDiffPreviewDialog.vue` · 成员排序表 · 预览 | **过渡** — 已接 `/api/git/diff`；主路径仍为 `GitFilePage` Tab |

**G1 收尾时**：

1. ~~补 `GET /api/git/diff`~~（已完成，见 [G1续归档](Web壳层-Git工作区插件-G1续归档.md)）  
2. 落地 `GitFilePage` / `openGitFileTab`，删除 `phoenix/code/git_workspace.py` 与重复路由  
3. **不**再扩展 spike 新能力  

---

## 10. 验收（G1）

- [x] `/api/git/info`：`git_root` 仅在工作空间根有 `.git` 时为该根；父仓场景为未初始化  
- [x] `/api/git/changes` 与子模块 path 的 diff/add/commit **均拒绝或过滤**；`untracked` 独立分区  
- [x] `/api/git/init` 在工作空间根创建 `.git`  
- [x] `/api/git/diff` 文本文件与 CLI 一致；二进制 `is_binary` 且无正文（单测 + 成员排序弹层点检待 Tab）  
- [x] `/api/git/restore` 恢复已跟踪文件  
- [x] **`GitPage`**：`/api/git/changes` 列表与 CLI `status --porcelain` 一致（已暂存 / 更改 / 未跟踪）  
- [x] **`+` / `−`** 单行暂存 / 取消暂存与 CLI 一致；三区与折叠 / 列表模式 UX  
- [x] **行状态徽章**（M/A/D/R/…）与 tooltip 分区 — **人工点检通过（2026-06-23）**  
- [x] 填 log → **`/api/git/commit`** 成功并刷新列表（侧栏 `GitCommitPanel`）  
- [~] 成员排序 · 预览 → **过渡弹层**（壳层 diff）；**在 Git 中查看** → `git` 页 — `git_file` Tab 待做  
- [x] `/api/git/stage` / `restore --staged` / 工作区 Revert 与 CLI 一致  
- [x] 无 commit **历史** / branch / remote UI  

---

## 11. 开放问题

| # | 问题 | 倾向 |
| --- | --- | --- |
| 1 | `git init` 放壳层还是只文档要求用户手动 init？ | **壳层提供一次 init**（已讨论）；可配置关闭 |
| 2 | diff2html 默认开还是 `<pre>` 默认？ | G1 Tab 内 `<pre>`，G2 diff2html |
| 3 | 预检 diff 是否永远不做？ | 默认不做；若做则 **业务页内存 diff**，不扩展 Git 插件 |
| 4 | 目录名 `phoenix/shell/git` vs `phoenix/git` | **`phoenix/shell/git`**（与壳层分包一致；与 `code/` 物理隔离） |
| 5 | 是否要 `services/shell_git_service` 中间层？ | G1 **不要**；路由直调 `shell.git`，保持后台独立 |
| 6 | 预览用 Tab 还是弹层？ | **Tab 为主**（`git_file`）；弹层不作为 G1 主路径 |
| 7 | 业务页是否保留表内 Revert？ | **保留快捷 Revert**；暂存 / commit 只在 Git 页 |
| 8 | Git 列表页是否 G1 必做？ | **是**（`GitPage` = G1 核心） |
| 9 | 暂存交互：复选框还是即时操作？ | **已定**：参考 **VS Code SCM** — **更改** 区 `[+]`、`已暂存` 区 `[−]`；无复选框批量 |
| 10 | commit 默认 message | 空；业务页跳转可 **建议** 前缀（如 `reorder:`），不自动提交 |
| 11 | 首次 commit 前是否 `git add -A`？ | **否**；用户逐行点 **+** 暂存 |
| 12 | 工作空间在父 Git 仓内、根无 `.git` | **不**操父仓；提示 init 或换工作空间路径 |
| 13 | submodule 内文件改了怎么办 | **不**在 Git 页展示；提示去 IDE / 子仓目录自行处理 |

---

## 12. 第三方组件与许可

> **本仓库许可**：根目录 [`LICENSE`](../../LICENSE) 为 **GNU AGPL v3**。下表为工程侧兼容性结论，**非法律意见**；对外发布前宜由法务复核。

Git 插件直接或间接涉及的第三方如下（含规划 **未采用** 的备选，便于对照）。

| 组件 | 在 Git 插件中的角色 | 许可（ SPDX / 常见名） | 引入方式 | 与 AGPL-3.0 | 备注 / 义务 |
| --- | --- | --- | --- | --- | --- |
| **Git**（git-scm） | 后端 `subprocess`：`status` / `diff` / `add` / `commit` / `restore` / `init` | **GPL-2.0**（用户本机安装的 Git 发行版） | **不捆绑**；运行时 `PATH` 调用 | **不冲突** | 独立进程调用，**非**链接进 Python/前端；用户自行安装 Git。GPL-2 不「传染」至调用方程序（与 IDE/CI 调 git 同类）。 |
| **diff2html** | G2 · 文件 Tab 将 unified diff 渲染为 HTML | **MIT** | `web-ui` npm 依赖（G2；G1 `<pre>` 可不加载） | **不冲突** | 仓库 spike 已声明 `^3.4.56`。MIT 允许并入 AGPL 作品；**须保留**版权与 MIT 许可全文（建议 `web-ui` NOTICES 或文档节）。 |
| **diff**（`jsdiff`） | diff2html **传递依赖** | **BSD-3-Clause**（npm `diff@8`） | 随 diff2html 安装 | **不冲突** | 保留 BSD 声明即可。 |
| **@profoundlogic/hogan** | diff2html **传递依赖**（模板） | **Apache-2.0** | 随 diff2html 安装 | **不冲突** | 保留 NOTICE / 许可副本；与 AGPL 组合常见。 |
| **highlight.js** | diff2html **可选依赖**（语法高亮） | **BSD-3-Clause** | 仅启用 diff2html 高亮时 | **不冲突** | 当前 spike 未显式 import；若 G2 打开高亮则随 bundle 分发并保留声明。 |
| **isomorphic-git** | 规划 **明确不用** — 见 [选型对比](Git插件-isomorphic-git-介绍与选型对比.md) | **MIT** | **未引入** | **不适用** | 否决理由为架构域，非许可。 |
| **Element Plus** | Git 页 / Tab 的 `el-*` 组件（与壳层共用） | **MIT** | 壳层已有 npm 依赖 | **不冲突** | 非 Git 专用；全站 UI 基座，见 `web-ui/package.json`。 |

**G1 与许可**：G1 仅用 **Git CLI** + 原生 `<pre>`，**无新增** npm 前端依赖；许可负担主要是确认用户环境 Git 为合法安装。

**G2 立项时建议**：

1. 在 `web-ui` 增加 **`THIRD_PARTY_NOTICES.md`**（或扩展现有说明），列出 diff2html 及其传递依赖的版权与许可全文。  
2. `pnpm build` 产物若打包 diff2html CSS/JS，与 AGPL 源码一并对外提供时，NOTICES 随仓库或「关于 / 源码」入口可见（符合 AGPL §13 网络交互精神）。  
3. **仍不**引入 [isomorphic-git](Git插件-isomorphic-git-介绍与选型对比.md) 等 **前端嵌入 Git 引擎** 方案，与「本机 `git` subprocess + 磁盘工作空间」策略一致。

**明确不纳入本表**：用户工作空间内的 **submodule 第三方代码**（§2.3 不操作）；其许可由用户工程自行管理。

---

## 参考

- [FileWorkset-规划.md](FileWorkset-规划.md) — 壳层系统能力范例  
- [成员排序-变更Diff预览-待研究.md](成员排序-变更Diff预览-待研究.md) — 消费方场景  
- [Git插件-isomorphic-git-介绍与选型对比.md](Git插件-isomorphic-git-介绍与选型对比.md) — **未采用** isomorphic-git 的技术说明  
- 本仓库 [`LICENSE`](../../LICENSE)（AGPL-3.0）  
- diff2html：https://github.com/rtfpessoa/diff2html（MIT）  
- Git：https://git-scm.com/（GPL-2.0）
