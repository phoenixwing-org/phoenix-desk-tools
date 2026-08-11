# Code 工具三端共用算法与 UI 内核执行计划

状态：执行中

建立日期：2026-07-21

适用宿主：VS Code 插件、Desk Web、Desk Tauri
只读参考库：`kt-auto-code`（禁止修改）

## 1. 目标与结论

Code 工具不建设三套“看起来相同”的界面。目标是把可复用算法、状态投影和 Web Components 放入 Phoenix Wing，由三个宿主直接消费同一实现：

```text
Phoenix Wing
  pure core + ViewModel + Web Components
          │
          ├── VS Code adapter：workspaceState、commands、Problems、Webview 消息
          └── Desk adapter：HTTP/Node、Workbench、文件导航
                           ├── Browser Web
                           └── Tauri（运行同一份 Desk Web bundle）
```

因此实际只有两个宿主适配器，不是三套前端：Web 与 Tauri 必须使用同一 Vue 页面和 Wing 组件。任何 Tauri 专属业务页面或视觉分支都视为架构回退。

## 2. 强制边界

### Wing 拥有

- 跨宿主算法、规则、诊断结构与稳定 DTO；
- Primary、中央业务 View 的稳定叶子/组合 Web Components；
- 组件内部交互状态，例如过滤、选择、折叠、分栏和键盘行为；
- VS Code token 与 Desk token 的样式映射；
- 组件事件契约和无宿主依赖的测试。

### 宿主适配器拥有

- VS Code 的命令、工作区、持久化、Problems API、Webview 消息和文件打开；
- Desk 的 HTTP/Node 调用、Workbench Tab、全局 Problems/Output 和文件导航；
- 权限、取消、文件事务、工作区边界及运行日志；
- 将宿主状态一次性投影为 Wing ViewModel，并消费 Wing 事件。

### 禁止进入 Wing UI

- `vscode`、`acquireVsCodeApi`、Vue、Electron、Tauri IPC、HTTP/`fetch`；
- Node `fs`、SQLite、工作区扫描和文件写入；
- 仅为某一个宿主存在的布局壳、标题栏或底部面板。

## 3. Codegen 首批共用成果

| 区域 | 共享真源 | Desk 状态 | VS Code 接入状态 |
| --- | --- | --- | --- |
| 参数表 View | Wing `<kt-codegen-table>` | 已直接消费 | 既有消费者 |
| Primary | Wing `<kt-codegen-primary-panel>` | 已改为薄适配器 | 待按第 5 节替换私有 HTML |
| View 内预检 | Wing `<kt-codegen-control-panel>` | 已直接消费 | 待按第 5 节替换私有 HTML |
| Block/预设/诊断投影 | Wing TypeScript ViewModel | 已直接消费 | 待切换到同一契约 |
| Problems / Output | 宿主壳能力 | Desk 下方面板 | VS Code 原生面板 |

布局以 `kt-auto-code/extension/src/tools/codegen/primaryPanel.ts`、`controlPanel.ts`、`controlCatalog.ts`、`editorHtml.ts` 的行为为验收真源，不以截图推测。

已落实的关键布局规则：

- Primary 顺序为当前配置、JSON 配置、应用报告、控制符目录、工作区候选；顶部五个操作保持 sticky；
- Prefix/Middle/Namespace/Append 为紧凑两列；配置和候选列表各自滚动并保留折叠/滚动状态；
- 中央 View 为 sticky 操作栏、Wing 参数表、紧随其后的“预检结果”Block；
- 下方面板只放 Problems 与 Output，预检不再作为下方页签；
- 预检保留命中/问题/全部、路径切换、主从详情、20%～75% 分栏、打开源码和复制 END；
- Apply 后结果保留为 `applied`，参数或源码变化后保留为 `stale`，但二者都不能绕过重新预检门禁。

## 4. 当前差距与处理顺序

### C1：Codegen 共用层硬化（当前节点）

- [x] Wing 建立 Primary、预检 ViewModel、事件和 Web Components；
- [x] Desk 删除两块主要私有 Vue 展示代码，改为薄适配；
- [x] 预检从下方面板迁入中央 View；
- [x] Wing 增加宿主独立性门禁；
- [ ] 为 Primary/预检补浏览器 DOM 行为测试和 VS Code 视觉回归样例；
- [ ] 补齐 Desk Host 尚缺能力：打开 JSON、导入 CSV、全部应用、显式扫描候选、报告目录；
- [ ] 后端候选 DTO 提供真实 Marker 数，不再用 `1` 作为临时投影；
- [ ] 报告改为持久化列表，而不是只展示当前会话最后一次 Apply；
- [ ] 分栏比例由宿主按文档/工作区持久化。

### C2：VS Code 改用 Wing 共用 UI

本仓库不修改 `kt-auto-code`，只给出迁移建议：

1. 在插件构建中加入 `@phoenix-wing/kt-codegen/ui` 浏览器入口；
2. `primaryViewModel.ts`、`controlViewModel.ts` 适配为 Wing 的 `KtCodegenPrimaryUiModel` 与 `KtCodegenControlUiModel`；
3. `primaryPanel.ts`、`controlPanel.ts`、`controlCatalog.ts` 只保留 Webview Host 桥，DOM 改由两个 Wing 组件渲染；
4. `editorHtml.ts` 在参数表后挂载共用预检组件，不再维护一套相同 HTML/CSS；
5. Wing 事件映射到既有 command/message router；`workspaceState` 继续保存折叠、过滤和分栏；
6. 使用插件现有 characterisation tests 对比迁移前后消息、顺序、文案和状态；全部通过后再删除私有构建产物。

在 Wing 公共版本发布前，`kt-auto-code` 不应依赖 Desk 源码、Desk `node_modules` 或本地 `file:`/`link:`。

### C3：其他 Code 工具逐项迁移

顺序按“算法已在 Wing + 两端确有相同交互”排序：

| 工具 | 算法方向 | 首个共用 UI 候选 | 注意事项 |
| --- | --- | --- | --- |
| C++ 成员排序 | Wing `code-core` 为唯一排序真源 | Primary 配置、文件结果表、Diff/确认 View | 锁定段、编码和写盘留宿主；先对齐 `reorderMembers` 行为 |
| Code 批量改名 | 纯改名/引用投影进入 Wing | 规则 Primary、冲突表、变更预览 | VS Code QuickPick 只做 Host adapter，不进入组件 |
| Code UUID 替换 | 提取扫描/替换 pure core | 范围 Primary、匹配/替换预览 | 事务和文件写回留宿主 |
| Code Ignore | 规则解析与匹配进入 Wing | 规则编辑和命中解释 | VS Code settings 与 Desk 配置存储各自适配 |
| Code 索引 | 查询 DTO、过滤/分页可共享 | 查询 Primary、结果表 | SQLite/文件监控留 Desk；不存在真实插件消费者时不强行抽空组件 |

每个工具使用同一节奏：冻结插件行为 → 确认 Wing pure core → 定义序列化 ViewModel/事件 → 在 Wing 实现组件 → Desk 接入 → 为插件写只读迁移建议 → 两端验收后删除重复。禁止先在 Desk 复刻一份 Vue 页面再“以后抽取”。

## 5. 成本控制原则

- 新功能先判断能否进入 Wing core/组件；跨端能力不得先落成某一宿主私有实现；
- Tauri 只承担窗口、Node 生命周期、系统能力和发行，不承担第二套 UI 设计；
- VS Code 原生壳能力继续原生使用，不为了形式统一而复制 Problems、Output、命令面板；
- 共用的是业务组件和行为，不是强行统一整个宿主 Workbench；
- 一个修复如果仍需同时修改插件 HTML、Desk Vue 和 Tauri 页面，说明边界尚未完成；
- Registry 依赖保持精确版本，本地联调只使用既有 Local Wing resolver。

## 6. 节点与提交策略

1. Wing：Codegen UI contracts/components/tests 独立提交；
2. Desk：Codegen 薄适配、View 内预检、底部 Problems/Output 独立提交；
3. 文档与人工点检可与 Desk 节点提交；
4. 其他 Code 工具每个工具至少一个独立节点；
5. 只暂存本节点文件，不带入 TypeScript 版本、锁文件或其他任务的工作区修改。

## 7. 验收门禁

自动验证：

```bash
pnpm --filter @phoenix-wing/kt-codegen typecheck
pnpm --filter @phoenix-wing/kt-codegen test
pnpm --filter @phoenix-wing/kt-codegen build

pnpm test:local-wing
pnpm build:local-wing
pnpm verify:wing-dependencies
```

架构验收：

- Wing UI 源码不依赖三个 Host；
- Desk Primary 与预检文件只做 model/event 适配，不再出现业务列表模板；
- Web 与 Tauri 的 Codegen DOM 来自同一产物；
- VS Code 接入后，同样的 ViewModel fixture 在三个运行形态得到相同业务 DOM 和事件；
- Host 特有的文件打开、Problems、日志和持久化可不同，但业务状态和交互不得分叉。

人工步骤见 [KT-Codegen-人工点检清单.md](KT-Codegen-人工点检清单.md)。
