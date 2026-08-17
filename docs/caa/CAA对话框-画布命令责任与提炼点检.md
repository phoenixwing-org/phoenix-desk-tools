# CAA 对话框画布命令责任与提炼点检

状态：current

Owner：Desk Tools CAA maintainers

适用版本：0.2.x

最后核验：2026-07-18

## 本轮目标

本轮在 baseline 提交之后提炼 Canvas Controller，不调整用户交互，也不修正已有行为差异。

`CaaDialogEditorPage.vue` 从 1,731 行降到 1,489 行；新增的 `useCaaDialogCanvasController.ts` 为 327 行。Page 通过 refs/ports 接线，Controller 负责原 Canvas 命令编排。

## 当前责任图

```text
CaaDialogGrid / Control / Primary Tree
  │ DOM 手势、菜单动作、树选择
  ▼
useCaaDialogCanvasController
  ├─ 临时 UI：drop indicator、context menu、edit mode
  ├─ IR 命令：select、delete、add、move、insert、resize、setChildren
  ├─ History port：修改前 recordHistory
  ├─ dirty：Grid flag 为 patch，其余结构修改为 full
  ├─ NLS：Builder 增删后的 key 清理
  └─ CAA_CONTROL_KEY：稳定的 Canvas 命令接口
       │
       │ refs / ports
       ▼
Page Host
  ├─ Pinia / PageSession / active Tab / keyboard
  ├─ parse / draft / save / write API
  ├─ Shell 日志与 Element Plus 消息
  └─ locale API 与 IR sources/parseMeta 更新
```

`CaaDialogGrid.vue` 继续负责 DOM hit-test、拖放、span resize、pointer/window listener 等手势状态。解析、草稿、写盘和 Shell 继续由 Page Host 负责；两者都不在 Canvas Controller 提炼时顺手改造。

## Baseline 冻结项

| 编号 | 当前契约 |
| --- | --- |
| C1 | Canvas 选择同时写 Page-local selection 与当前 editor 的 Pinia 镜像；Primary Tree 选择经 store watch 回到 Page。 |
| C2 | 直接删除拒绝根节点、空选择、无父容器和不存在节点；成功时记录一次 history、重排、回选父容器并标记 `full` dirty。 |
| C3 | ROWRES/COLRES toggle 记录一次 history，索引保持升序并标记 `patch` dirty。 |
| C4 | ROWRES/COLRES setter 对相同值 no-op；header 拖动可用 `recordHistory:false` 合并为一次 history。 |
| C5 | add/insert/setChildren 保持 `full` dirty；Drop/Span 在真正改树前由 Grid 记录 history。 |
| C6 | Builder add/remove 当前会调用 `syncNlsFromModel()`；键盘直接删除链路当前不会。该差异只作 characterization，是否统一须另立产品修复。 |
| C7 | Delete/Backspace 避开 input、textarea 与 contenteditable，且只作用于 active Tab。 |
| C8 | Canvas 命令区不直接调用 parse、draft、save、write、Shell 或消息 API。 |

自动契约位于 `web-ui/src/pages/CaaDialogEditorPage.canvas.contract.test.ts`。它按函数区段冻结语义，不重复依赖全文件调用次数，以减少无关排版造成的脆弱失败。

## 已完成的提炼边界

`useCaaDialogCanvasController.ts` 只迁移 Canvas 命令区：

- 注入 `localIr`、`selectedId`、`editMode` 等 Page-local refs；
- 注入 `recordHistory`、`markDirty`、`syncSidebar`、`mirrorSelection`、`syncNls` 回调；
- 返回 `CaaControlContext`、`deleteSelectedControl()` 和 Canvas 临时状态；
- Controller 不导入 API、`useAppShell`、`usePageSession`、Pinia store、`ElMessage` 或 `.vue` 组件；
- Page 继续拥有解析、草稿、写回、active Tab、PageSession、键盘监听与 Host 日志。

本切口不拆 1,011 行的 `CaaDialogGrid.vue`，不调整 `CAA_CONTROL_KEY` 的公开能力，也不改变 `patch/full` 判定。

## 提炼点检表

### 自动点检

- [x] Canvas baseline 定向测试覆盖 C1–C8。
- [x] Controller 单元测试使用注入 refs/ports，覆盖无 IR no-op、history 次数、dirty 模式和回调顺序。
- [x] Page contract 证明 `CAA_CONTROL_KEY` 改由 Controller 提供，Host API 仍留在 Page。
- [x] Controller/Page/History/architecture 定向测试与 `pnpm -C web-ui typecheck` 通过。
- [x] `pnpm -C web-ui test` 全量通过。
- [x] `pnpm verify:architecture`、`pnpm docs:check`、Wing 依赖与 `git diff --check` 通过。

### 人工点检（Controller 提炼提交执行）

- [ ] Canvas 与 Primary Tree 双向选择一致。
- [ ] Delete/Backspace 不影响正在输入的 NLS/属性字段。
- [ ] ROWRES/COLRES 单击和拖动批量设置各只产生一条可撤销操作。
- [ ] 新增、移动、复制、删除、插入行列和 span resize 后可正常撤销/重做。
- [ ] Drop indicator 与右键菜单打开、定位、关闭行为不变。
- [ ] 保存仍根据修改类型走 `patch` 或 `full`，解析/草稿/写回协议不变。

## 本轮验证命令

```bash
pnpm -C web-ui test -- CaaDialogEditorPage.canvas.contract.test.ts
pnpm -C web-ui test -- useCaaDialogCanvasController.test.ts
pnpm -C web-ui typecheck
pnpm docs:check
pnpm verify:architecture
```

Controller 提炼当前结果：

| 门禁 | 结果 |
| --- | --- |
| Controller + Page/History/architecture 定向契约 | 4 files / 23 tests 通过 |
| Web typecheck | 通过 |
| Web 全量 | 59 个测试文件、365 项测试通过 |
| Web Registry 构建 | 2,337 个模块转换并完成生产 bundle |
| 架构边界 | 334 个源文件、9 个纯依赖图和 1 个 View root 通过 |
| 文档治理 | 136 份 Markdown 已分类，current 链接有效 |
| Wing 正式依赖 | 9 个 manifest 引用均为 Registry 0.4.2，无本地 override |
| Diff 格式 | `git diff --check` 通过 |

本轮没有改变模板、CSS 或公开 Context 能力；真实 Canvas 交互仍按上表保留人工点检。
