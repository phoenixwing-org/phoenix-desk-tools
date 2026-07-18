# CAA 当前架构与契约

状态：current

Owner：Desk Tools CAA maintainers

适用版本：0.2.x

最后核验：2026-07-17

## 当前数据流

```text
VS Code / Tauri launch args
  -> Node/Hono local API
  -> catdlg-core parse/normalize/patch
  -> web-ui CAA editor
  -> explicit save route
```

- `packages/catdlg-core` 拥有无 Vue/Hono 的 CATDlg/NLS 解析、IR 与 patch 规则。
- `server` 拥有工作空间校验、本地 API、文件读写和 VS Code handoff adapter。
- `web-ui` 拥有多 Tab、画布、属性编辑、Undo/Redo 和显式保存交互，不直接写文件。
- 当前生产后端是 Node/Hono；旧 Python/P0 说明只作为历史证据。

## 写入边界

- 所有保存必须经过 server 路由和工作空间路径校验。
- Grid-only ROWRES/COLRES patch 可以不要求完整 IR；其它写回必须携带可验证的对话框上下文。
- Wizard `.cpp` 构造段与 MultiList 签名在真实 CAA fixture/编译确认前保持保守生成和 warning，不猜测复杂业务表达式。
- VS Code 只发送版本化 handoff 请求，不复制 CATDlg parser 或 Web 编辑器状态。

## NLS 会话边界

- `caaDialogNlsSessionViewModel.ts` 负责从 IR/草稿构建六项 NLS 普通值、PageSession current overlay、dirty 与 key 数量差异投影；它不拥有 Vue ref、locale UI、History 或 Host API。
- `CaaDialogEditorPage.vue` 继续拥有六个响应式真值、active locale 与 canvas 翻译，并调用 locale 创建/保存 API；写盘和 IR sources/parseMeta 更新没有下沉到 ViewModel。
- 兼容行为与验收证据见 [NLS 会话 ViewModel 验收](CAA对话框-NLS会话ViewModel验收.md)。

## Canvas 命令边界

- `useCaaDialogCanvasController.ts` 拥有 Canvas 选择、右键/Drop 临时状态、ROWRES/COLRES、直接删除、Builder add/remove/insert/setChildren 和 `CAA_CONTROL_KEY` 组装。
- Controller 只接收 Page-local `ir/selectedId/editMode/locale` refs，以及 history、dirty、sidebar、selection mirror、NLS cleanup 和 NLS commit ports；它不导入 Pinia、PageSession、Shell、消息组件或 API。
- `CaaDialogEditorPage.vue` 继续拥有 Pinia 实例、active Tab、键盘监听、PageSession、parse/draft/save/write、Shell 日志和 locale UI；`CaaDialogGrid.vue` 继续拥有 DOM 手势与 window/pointer listener。
- 直接 Delete/Backspace 当前不清理 NLS，而 Builder add/remove 会清理；本次提炼保持该 characterization，不把架构迁移混成产品修复。责任图和点检见 [Canvas 命令责任与提炼点检](CAA对话框-画布命令责任与提炼点检.md)。

## 当前验证入口

- [多后端测试规则](CAA单元测试-多后端规则.md)
- [VS Code 交接人工点检](CAA-VSCode交接-人工点检清单.md)
- [NLS 会话 ViewModel 验收](CAA对话框-NLS会话ViewModel验收.md)
- [Canvas 命令责任与提炼点检](CAA对话框-画布命令责任与提炼点检.md)
- [总待办中的 CAA 汇总](../TODO.md#caa)

旧 `CAA模块-概览.md`、P0 原型与完成态规划由文档清单标记为 superseded/archived。
