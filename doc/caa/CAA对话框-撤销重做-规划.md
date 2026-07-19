# CAA 对话框 Builder — 撤销/重做实现与边界

> 状态：已实现；2026-07-18 完成 history controller 分层治理。
> 范围：CAA 对话框 IR、选择、写回模式及默认/多语言 NLS map 的快照历史。
> 原则：Page-local session 是状态真源；Controller 只管理历史快照与栈迁移。

## 当前结构

| 层 | 文件 | 责任 |
|---|---|---|
| Session ViewModel | `web-ui/src/models/caaDialogSessionViewModel.ts` | 历史 entry/page snapshot 类型、会话校验、50 条运行时与 12 条持久化裁剪、source text 脱敏 |
| History Controller | `web-ui/src/composables/useCaaDialogHistoryController.ts` | snapshot/record/restore、undo/redo/reset、从 page snapshot 恢复栈 |
| Canvas Controller | `web-ui/src/composables/useCaaDialogCanvasController.ts` | 八个 Canvas 编辑入口的命令编排，通过 port 调用统一 history 命令 |
| Page/Host | `web-ui/src/pages/CaaDialogEditorPage.vue` | `localIr` 等状态真源、两个 NLS 编辑入口、PageSession、快捷键、按钮、Pinia/sidebar 镜像、dirty/clean、解析/草稿/写回 API |

Controller 通过显式 `state` refs 消费 Page-local 状态，通过 `onRestored` 通知 Page 更新 Pinia/sidebar 与 tab dirty；它不访问 Shell、Pinia、PageSession、浏览器存储或 API。

## 快照模型

每次受管编辑发生前调用 `recordHistorySnapshot()`。单条 `CaaIrHistoryEntry` 包含：

- 深克隆后的 IR；
- 当前选中控件；
- `none | patch | full` 写回模式；
- 默认语言 NLS flat map；
- 各 locale NLS flat maps。

运行时 undo/redo 栈各最多 50 条。PageSession 序列化时只保留最近 12 条，并删除 IR `parseMeta` 中重复的大段 NLS source text。旧会话条目缺少 NLS maps 时，恢复 IR/选择/写回模式，但保留 Page 当前 maps。

## 核心命令

| 命令 | 行为 |
|---|---|
| `recordHistorySnapshot()` | 保存编辑前状态并清空 redo |
| `undoIrChange()` | 当前状态进入 redo，恢复 undo 栈顶 |
| `redoIrChange()` | 当前状态进入 undo，恢复 redo 栈顶 |
| `resetHistory()` | 清空两个运行时栈 |
| `restoreHistoryFromSnapshot()` | 复用 session codec 校验并恢复两个栈 |
| `canUndo` / `canRedo` | 驱动既有按钮禁用态 |

恢复时若 entry 没有 `selectedId`，回退到 IR 根节点；`irWriteMode=none` 对应 clean，其他模式对应 dirty。没有当前 IR 时 record/undo/redo 都是无副作用操作。

## 用户交互契约

| 入口 | 操作 |
|---|---|
| 页头「撤销」 | `undoIrChange()` |
| 页头「重做」 | `redoIrChange()` |
| `Ctrl/Cmd+Z` | 撤销 |
| `Ctrl/Cmd+Shift+Z`、`Ctrl/Cmd+Y` | 重做 |

快捷键仍由 Page 监听，只在当前 CAA Tab 激活且焦点不在 input/textarea/contenteditable 时生效。

已纳管的编辑入口包括控件新增/移动/删除、插入行列、Grid 行列伸缩、画布原子替换，以及 property sheet、树编辑器中的 NLS 文案修改。八个 Canvas 调用点经 Canvas Controller 的 `recordHistory` port 接入，两个 NLS 调用点继续留在 Page；编辑/预览模式和单纯的 locale 显示切换不产生历史。

## 会话与 Host 边界

- Page 使用 `buildCaaDialogPageSnapshot()` 序列化 controller 暴露的两个栈。
- 草稿恢复、磁盘会话恢复均由 Page 调用 `restoreHistoryFromSnapshot()`。
- 解析、草稿保存、正式写回和 active-tab 路由不进入 controller。
- undo/redo 只恢复本地状态；既有 PageSession flush/保存路径继续负责持久化。

## 验证

- `useCaaDialogHistoryController.contract.test.ts` 冻结按钮、快捷键、Page 两个加 Canvas Controller 八个既有记录调用点、PageSession 与 Host/API 边界。
- `useCaaDialogHistoryController.test.ts` 覆盖快照隔离、50 条裁剪、redo 清空、undo/redo 往返、根节点回退、clean/dirty、旧 NLS map 兼容、snapshot 校验和无 IR no-op。
- `CaaDialogEditorPage.architecture.test.ts` 继续约束 session codec 与 Page Host 的既有边界。

## 后续

- NLS session ViewModel 与 history controller 分开治理，禁止把 NLS API 或 locale UI 状态塞入 history controller。
- 操作描述和命令模式可另立需求；不得在 Page shell 拆分时顺手改变快照语义。
