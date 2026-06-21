# 成员排序 · 变更 Diff 预览 — 待研究

> [文档索引](../文档索引.md) · 状态：**待研究** · 触发场景：Web「变更文件」表点击路径（如 `PNXBomAnalysisParam.h`）  
> 关联：[成员函数排序-reorder_members.md](../code/成员函数排序-reorder_members.md) · `ReorderMembersPage.vue`

## 需求

预检 / 写盘后「变更文件」列表仅显示路径，用户希望：

- 点击一行 → **弹窗或新窗口** 查看 **before/after**（最好与 Git 一致的双栏 diff）
- 预检（dry-run）也应能看 diff，而不必先写盘

## 方案对照（插件 / 组件 / 集成）

| 方向 | 代表 | 优点 | 缺点 | 适配度 |
| --- | --- | --- | --- | --- |
| **A. 后端内存 diff（推荐优先 POC）** | 自研：`difflib.unified_diff` / `diff-match-patch` | 预检即可返回；不依赖 Git；路径即 workspace 相对路径 | 需 API 增字段或单独 `GET …/diff?path=`；大文件要限流 | ★★★★★ |
| **B. Git 工作区 diff** | `git diff -- path`（subprocess） | 写盘后与 IDE 一致；实现简单 | 预检无 HEAD 差异；非 Git 工作空间不可用 | ★★★★ |
| **C. Web Diff 组件** | [Monaco Diff Editor](https://github.com/microsoft/monaco-editor)（`monaco-editor` / `@monaco-editor/loader`） | VS Code 同款双栏；可嵌 `AppModalOverlay` 或 `window.open` | 包体积大（~数 MB）；需 Vite 分包配置 | ★★★★ |
| **D. HTML 渲染 unified diff** | [diff2html](https://github.com/rtfpessoa/diff2html) + `diff2html-ui` | 轻量、只读、样式接近 GitHub | 非可编辑；需先有 unified diff 文本 | ★★★★ |
| **E. CodeMirror Merge** | [@codemirror/merge](https://codemirror.net/docs/ref/#merge) | 与现有 TS 栈接近；可定制 | 需自行接 diff 数据源；文档少于 Monaco | ★★★ |
| **F. 外链 IDE** | Cursor / VS Code：`vscode://file/…`、命令行 `cursor --diff a b` | 零 Web 实现；用户习惯 | **无法仅凭 URL 打开 Git diff**；需本地 CLI 或扩展配合；浏览器安全限制 | ★★ |
| **G. 桌面壳（若将来 Electron）** | `child_process` 调 `git difftool` / `code --diff` | 原生体验 | 当前为浏览器 + Python API，非桌面壳 | ★★ |

**结论（建议路线）**

1. **POC**：预检时在 Python 侧保留「旧文本 / 新文本」，API 返回 `unified_diff` 或分页；前端用 **diff2html** 或 **Monaco Diff** 弹层（`AppModalOverlay`，与忽略规则弹窗同模式）。
2. **写盘后**：同一弹层可切换数据源为 `git diff HEAD -- path`（工作空间为 Git 仓时）。
3. **「新窗口」**：`window.open` + 仅 diff 的轻量路由 `/diff?path=…`，或 Monaco 全屏 Dialog；不必真开 OS 级窗口。
4. **IDE 跳转（可选）**：侧栏按钮「在 Cursor 中打开文件」用 MCP / 本地 helper，与 diff 预览分开。

## 与现有 TODO / 代码的衔接

- `ReorderMembersRunResult.changed_files` — 仅有路径列表；可扩展 `diffs: Record<path, string>` 或 `GET /api/code/reorder-members/diff?path=&rev=working|last_dry_run`。
- `reorder_header_file(dry_run=True)` 已在内存中生成 `new_text`，对比 `payload.text` 即可产出 diff（无需 Git）。
- 变更表：`ReorderMembersPage.vue` `changed-card` → 路径列加 link / 按钮 `@click="openDiff(row)"`。

## 不推荐作为「插件」直接引入

- 通用 **Vue diff 插件**（如早期 `vue-diff`）维护参差；优先 **Monaco** 或 **diff2html** 二选一。
- 纯 **GitHub 式** iframe 无法访问本地文件路径。

## 验收（研究完成后）

- [ ] 预检后点击 `PNXBomAnalysisParam.h` → 弹层双栏或 unified diff，内容与磁盘未改前一致
- [ ] 写盘后同一入口可显示 `git diff`（Git 仓）
- [ ] 非 Git 工作空间：预检 diff 仍可用；Git 项灰显或隐藏
- [ ] 大文件（>512KB）提示「仅显示前 N 行」或拒绝

## 参考

- Monaco diff Vite：[官方 worker 配置说明](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md)
- diff2html：输入 unified diff 字符串即可
- 同类 UX：GitHub Desktop / VS Code SCM 文件列表 → 点击打开 diff
