# Web 壳层 · Git 变更分区批量预览 · 规划

> 关联：[Web壳层-Git工作区插件-规划.md](Web壳层-Git工作区插件-规划.md) · [Web壳层-Git工作区插件-G1续归档.md](Web壳层-Git工作区插件-G1续归档.md) · [成员排序-变更Diff预览-待研究.md](成员排序-变更Diff预览-待研究.md)  
> 状态：**讨论定稿 · 未实现**（先文档后代码）  
> 最后更新：2026-06-23

---

## 1. 要解决的问题

Git 页三区（**已暂存 / 更改 / 未跟踪**）每区标题行右侧已有 **放弃 / + / −** 等批量操作；行内已有 **预览 diff**（`GitDiffPreviewButton` · 单文件弹层）。

用户还需要（对齐 VS Code SCM）：

| 需求 | 说明 |
| --- | --- |
| **分区级「一起查看」** | 每个 block 标题行 **左侧** 增加统一的 **查看修改** 按钮，一次浏览本区全部变更 |
| **与行内预览一致** | 复用 `useGitDiffPreview` / diff2html 能力，不另做一套渲染 |
| **大量文件** | 列表很长时 **不要** 一进区就 N 路 `git diff`；对 **未进入视口** 的文件 **延时 / 按需加载** |

当前 `GitSectionHead` 仅右侧 `section-head-actions`（`RefreshLeft` / `Plus` / `Minus`），**无**左侧批量预览入口。

---

## 2. UI 定稿（分区标题行）

```text
┌─ GitSectionHead ─────────────────────────────────────────────┐
│ [▶] 更改 (12)     [📄 查看修改]          [↺] [+]             │
│  ↑ 折叠+标题        ↑ 新增·靠标题右侧       ↑ 现有批量操作·最右 │
└──────────────────────────────────────────────────────────────┘
```

| 位置 | 控件 | 图标 / 文案 | 行为 |
| --- | --- | --- | --- |
| 左 | 折叠 + 标题 | `ExpandCaret` + `更改 (n)` | 现有 |
| **左中** | **查看修改** | `DocumentCopy` · tooltip **「预览 diff」**（与行内统一） | 打开本区 **多文件预览**（§4） |
| 右 | 放弃 / + / − | 现有 | 不变 |

**布局**：`section-head-leading-actions`（预览）在 `section-head-toggle` 与 `section-head-actions` 之间，或紧贴标题后；**批量 git 操作仍靠最右**（与行内 `git-row-tail` 右对齐语义一致）。

**禁用**：

- 本区 `count === 0` 或筛选后无行 → 按钮 `disabled`
- 本区折叠且未展开 → 仍可点（预览不依赖列表是否展开）；或折叠时隐藏——**倾向：始终可点**，与 VS Code 一致

---

## 3. 分区与 diff scope

| 分区 | `GitChangeEntry.section` | diff `scope` | 备注 |
| --- | --- | --- | --- |
| **已暂存** | `staged` | `staged` | `git diff --cached` |
| **更改** | `changes` | `worktree` | 已跟踪未暂存 |
| **未跟踪** | `untracked` | `worktree` 或专用 | 无 index 条目；`git diff` 可能无输出 → 见 §5.3 |

路径集合 = 当前 **筛选后** 列表（`filteredStaged` / `filteredChanges` / `filteredUntracked`），与批量 `+` / Revert 同源，**尊重 `GitPathFilterChips`**。

---

## 4. 多文件预览形态（分阶段）

### 4.1 P1 · 分区批量弹层（推荐首期）

新组件 **`GitDiffBatchPreviewDialog`**（或扩展 `GitDiffPreviewDialog` 为多文件模式）：

```text
┌─ 更改 · 12 个文件 ───────────────────────────── [×] ─┐
│ ┌ 文件列表 ─────┐ ┌ diff 区（diff2html）──────────┐ │
│ │ ● foo.h       │ │                                 │ │
│ │   bar.cpp     │ │   （当前选中文件）               │ │
│ │   …           │ │                                 │ │
│ └───────────────┘ └─────────────────────────────────┘ │
│                    [上一个] [下一个]  3 / 12          │
└──────────────────────────────────────────────────────┘
```

| 项 | 约定 |
| --- | --- |
| 入口 | `useGitDiffPreview().openBatch({ paths, scope, title })` |
| 默认选中 | 列表第一项；记住上次索引（可选，仅会话内） |
| 切换 | 左侧列表点击 / 上一条下一条；键盘 `↑` `↓`（二期） |
| 渲染 | 与单文件弹层相同字段：`unified_diff` · `is_binary` · `truncated` |
| 关闭 | Esc / 关闭按钮；不持久化 |

**不做首期**：单屏拼接全部文件的 mega-diff（难读、易超 512KB 截断）。

### 4.2 P2 · `GitFilePage` Tab 链

[Git 插件规划 §5.2](Web壳层-Git工作区插件-规划.md) 的 **`git_file` Tab** 落地后，分区「查看修改」可改为：

- 打开第一个文件的 `git_file` Tab，工具条 **下一份 / 上一份** 在本区 path 列表内导航；或
- `openGitFileTab(paths[0], { batch: paths, index: 0 })`

弹层与 Tab **共用** path 列表与 lazy 策略（§5）。

### 4.3 与行内单文件预览关系

| 能力 | 单文件（现有） | 分区批量（本规划） |
| --- | --- | --- |
| 触发 | 行内 `GitDiffPreviewButton` | 区头「查看修改」 |
| API | `GET /api/git/diff?path=` | 同左，多次或 batch |
| 宿主 | `GitDiffPreviewHost` | 同宿主或 batch Dialog |
| 文案 | tooltip **预览 diff** | 同左 |

---

## 5. 延时 / 按需加载（大量文件）

### 5.1 原则

1. **打开弹层时**：只拉 **当前选中** 1 个文件的 diff（立即显示 loading）。
2. **预取**：当前索引 **±1**（可选 ±2）后台请求，写入内存 cache `Map<path, GitFileDiff>`。
3. **列表滚动**：文件列表 `overflow-y: auto` 时，对行绑 **`IntersectionObserver`**（或 `vueuse` `useIntersectionObserver`）：
   - 进入视口 → 若 cache 无且未 in-flight → 入队 fetch
   - 离开视口 → **不取消** 已发出请求；可从 cache 淘汰 LRU（可选，默认保留本会话全部）
4. **并发上限**：同时 in-flight **≤ 3**（可配置），其余排队，避免 50 文件同时 `git diff` 打满后端。

### 5.2 阈值与提示

| 条件 | UX |
| --- | --- |
| `paths.length ≤ 20` | 打开后可后台预取全部（仍受并发上限） |
| `paths.length > 20` | 打开时 toast / 副标题：**「共 N 个文件，将按需加载 diff」** |
| `paths.length > 100` | 确认框：**「文件较多，是否继续？」**（可选） |
| 二进制 / 无 diff | 列表项旁标 **B** / 灰显；选中时仍显示 `el-alert`（与单文件弹层一致） |

### 5.3 未跟踪文件

| 情况 | 处理 |
| --- | --- |
| `git diff path` 无输出 | 展示 **「新文件」** 占位；P2 可读工作区文件全文或 `git diff --no-index`（需后端扩展，**非 G1**） |
| 首期 | 列表包含未跟踪路径；diff 区显示 `has_diff: false` + 文案「未跟踪文件，暂无 Git diff」 |

### 5.4 后端选项

| 方案 | 说明 |
| --- | --- |
| **A · 维持现状** | 前端 `fetchGitDiff` × N，并发队列 + cache（**P1 推荐**） |
| **B · G2 batch** | `POST /api/git/diff-batch { paths, scope }` — 见 [Git插件规划 §4](Web壳层-Git工作区插件-规划.md)；单次响应体需限流 / 分页 |
| **C · 区級 aggregate** | `GET /api/git/diff?path=&scope=section:changes` — **不推荐**（难与筛选、截断策略对齐） |

---

## 6. 组件与状态（实现清单）

| 项 | 路径 / 说明 |
| --- | --- |
| 区头按钮 | `GitSectionHead.vue`：`showPreview` · `@preview` · `GitDiffPreviewButton` 或薄包装 |
| 页面接线 | `GitPage.vue`：三区各传 `filtered*` paths + `scope` |
| 批量状态 | `useGitDiffPreview.ts` 扩展 `openBatch` / `batchPaths` / `batchIndex` / `diffCache` |
| 弹层 | `GitDiffBatchPreviewDialog.vue` 或单 Dialog 双模式 |
| 列表懒加载 | `GitDiffBatchFileList.vue` + IntersectionObserver |
| 样式 | 复用 `git-row-actions.css` · `git-icon-btn`；区头按钮 **22px**（与现区头一致，非行内 16px） |

**`GitSectionHead` props 草案**：

```ts
showPreview?: boolean;
previewDisabled?: boolean;
previewTooltip?: string; // default: '预览 diff'
```

---

## 7. 验收（立项后）

- [ ] 三区标题 **左侧** 均有「查看修改」，文案 / 图标与行内一致
- [ ] 点击后打开批量预览，默认显示第一项 diff
- [ ] 切换文件时未缓存项显示 loading，不阻塞 UI
- [ ] 20+ 文件：未滚动到的项 **不会** 在打开瞬间全部请求
- [ ] 筛选 chips 生效：批量预览仅含筛选后路径
- [ ] 已暂存区 `scope=staged`；更改区 `scope=worktree`
- [ ] 二进制 / 截断 / 无 diff 与单文件弹层行为一致
- [ ] 区折叠 / 展开不影响按钮可用性（按 §2 倾向）

---

## 8. 开放问题

| # | 问题 | 倾向 |
| --- | --- | --- |
| 1 | 弹层 vs 全屏 Drawer | **弹层** 首期；宽屏可考虑 95% Dialog |
| 2 | 侧栏 vs 文件列表左右 | **左列表右 diff**（与 VS Code Open Changes 接近） |
| 3 | 未跟踪是否首期支持正文 | **仅占位**；正文跟 `git_file` Tab |
| 4 | `diff-batch` 何时做 | 单区常 &lt;30 文件时 **A 方案足够**；&gt;50 再评估 B |
| 5 | 成员排序变更表是否复用 batch | **二期**；表级可用同一 `openBatch` |

---

## 9. 实现顺序

| 阶段 | 内容 |
| --- | --- |
| **1** | `GitSectionHead` 左侧按钮 + `GitPage` 事件接线（点击仅 `console` / 单文件 fallback 可接受） |
| **2** | `useGitDiffPreview.openBatch` + 双栏 Dialog + 手动切换 + 单文件 fetch |
| **3** | 预取 ±1 + 并发队列 3 |
| **4** | 列表 IntersectionObserver 按需加载 + &gt;20 提示 |
| **5** | 未跟踪占位文案 · 100+ 确认 · 与 `GitFilePage` 导航合并（P2） |

---

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-06-23 | 初稿：区头批量预览 · 左按钮右 bulk · lazy load · 分阶段与 API 选型 |
