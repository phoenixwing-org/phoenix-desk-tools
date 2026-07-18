# Phoenix Desk Tools 当前待办

状态：current

Owner：Desk Tools maintainers

适用版本：0.2.x / 联合成熟度 84.75 → 92.00（本轮已接受）

最后核验：2026-07-18

本文件是唯一维护的产品/技术债入口。旧总清单、Git 与 CAA 的逐项完成记录分别保存在 [`archive/TODO-2026-07-17.md`](archive/TODO-2026-07-17.md)、`TODO-GIT.md`、`TODO-CAA.md`，只读不再更新。

## P0：联合治理

- [x] 删除 Desk Codegen Apply 的纯投影副本，统一调用 Wing 公共入口；Desk 只保留权限、原子写、文件模式、备份与 rollback adapter。
- [x] 用 AST/import graph 固化 pure core、server host、Vue view 的依赖方向，并为例外记录 owner 和到期条件。
- [x] 文档首轮治理：全量分类、current 断链检查、TODO 单一真源和过时入口处理。
- [x] 与 Wing/Auto 建立 Analyze/Apply/Schema golden fixtures；Desk 直接消费 Registry 0.4.2，未知未来版本 fail-closed。

## P1：MVC 与复用

- [x] 在 KT Codegen 页实现 Page Param + UI-neutral PropertySchema + derive 试点，明确 Model、ViewModel、Controller、Host adapter 数据所有权。
- [x] 提炼 UUID/GUID 与 workspace path 两项无 UI 纯能力；扫描/格式/计划与相对路径规范/包含关系由 Wing 唯一实现，Desk 只保留编码、I/O、SQLite 和 UI adapter。
- [ ] 所有新公共算法必须进入 Wing 或有不晋升 ADR，不得继续写入超大 Vue 页面。

## Git

- [ ] 完成分区批量预览、`GitFilePage` 和点文件开 Diff Tab。
- [ ] 删除成员排序 spike Git 路由，统一走壳层 `/api/git/*`。
- [ ] 完成分侧停靠/分割条人工点检，并评估 `diff2html` 与 `status-paths`。
- [ ] 其它写盘工具通过共享 HTTP adapter 接入，不各自启动 subprocess。

## CAA

- [ ] 用真实 CAA fixture/编译确认 Widget construction、MultiList `SetColumnTitles` 与字段绑定签名。
- [ ] 完成 left/top drop、span resize、ROWRES/COLRES 和 Group/MultiList/Button 的实机 UI 复测。
- [ ] 推进对话框索引与多 Tab；复杂表达式和无控件 ID 线索继续保守只读。
- [ ] `catdlg-core` 对外迁移只在第二个消费者出现且契约稳定后实施；Electron 壳不进入当前承诺。

## CAD 与运行可靠性

- [x] 用 release profile Wing Rust 二进制和真实 `Document.xml` 构造 FCStd archive，自动验收协议读、XLink 修改、修改后复读与精确字节回滚。
- [x] 从当前 0.2.0 源码构建 macOS arm64 Tauri `.app`，自动验收真实启动、隔离用户数据、Codegen Apply、FCStd 读取和 sidecar 正常回收。
- [x] `fcstd_map` 已通过分页 API 与页码/页大小状态避免全表加载；大型 UI 目标进一步把查询、分页和 session 规则移入纯 ViewModel。
- [ ] 统一长任务进度、取消与运行日志，不让页面各自维护第二套任务状态。
- [ ] 将剩余 Python 兼容入口逐项判定为外部引擎 adapter 或退役路径；Node/Hono 是当前 HTTP 真源。
- [ ] **用户手工验收**：在自有 Windows 机器执行已入库的 0.2.0 NSIS 构建/安装/Codegen/FCStd/退出/卸载门禁，回传脚本生成的 JSON 回执与最终成功日志；Codex 不连接远程 Windows、不创建 GitHub 镜像。FreeCAD/SolidWorks 外部进程 E/F 档仍需独立环境；历史 0.1.0 Windows 产物不计入当前版本。

## 后期：大型 UI 拆分

用户已于 2026-07-18 接受联合成熟度 **92.00** 作为本轮停止线，并决定另立大型 UI 拆分目标。优先 `UnitTestsPage.vue`、`CaaDialogEditorPage.vue`、`AssemblyTreeTable.vue`、`FcstdMapPage.vue`；拆分前继续禁止向这些文件加入新的领域算法或数据库真相。

- [x] `FcstdMapPage.vue` 第一切口：资产行投影、查询/分页规则和 v2–v4 session 迁移进入 UI-neutral `fcstdMapViewModel.ts`，页面从 1,208 行降到 1,161 行；纯测试与页面边界测试已建立。
- [x] `FcstdMapPage.vue` 第二切口：entries 加载、loading/error、filter/pager 与单一 debounce 已进入可注入 fetch port 的 `useFcstdMapEntries`；扫描任务、purge、export、Shell 和 localStorage 未进入列表 controller。页面现为 1,111 行。
- [x] `FcstdMapPage.vue` 第三切口 A：其余三个 Desk 大页面均已建立首条边界；索引 pane 的搜索/筛选、12 列、行身份/动作、三类空状态、分页和 Page Host/session 真源已由 4 项 characterization 冻结。
- [x] `FcstdMapPage.vue` 第三切口 B：单消费者 `FcstdMapIndexPane.vue` 已拥有索引列表 DOM、12 列 UI 定义、展示投影和 scoped style；三组筛选由受控 `v-model` 回到 Page，分页与打开动作只发语义事件。Controller、扫描/purge/export、Shell、localStorage、session 和导航安全复核继续留在 Page；Page 从 1,111 行降到 851 行，Pane 为 290 行；滚动、筛选、空状态和窄宽度按 [CAD 索引面板人工点检](cad/CAD索引面板-人工点检清单.md) 留证。
- [x] `UnitTestsPage.vue` 第一切口：确认既有 Pinia store 继续作为 session 真源；运行范围勾选迁移、结果过滤/分组、通过率/摘要和 run options 组装已进入 UI-neutral `unitTestsViewModel.ts`，并由边界测试锁住 plan/stream/cancel API 仍归 Page Host 层。页面从 2,214 行降到 2,152 行。
- [x] `UnitTestsPage.vue` 流式 Controller 拆分前基线：启动状态、stream/cancel 端口、start/case_done 副作用、成功结果同步、watchlist 分支、无结果/终止/异常与 finally 解锁已由 5 项 characterization 冻结；下一提交只迁移编排责任。
- [x] `UnitTestsPage.vue` 流式 run controller：stream/cancel、AsyncProgress、Host 运行日志、唯一 `running/result` 与终止/异常收口进入可注入 `useUnitTestRunController`；Page 保留 Pinia/session、范围门禁、request 组装、watchlist/history 和结果筛选。Controller 同时拒绝重叠运行并把重复终止收敛为一次；页面从 2,152 行降到 2,101 行。
- [x] `UnitTestsPage.vue` plan controller：计划 transport、`plan/loading/error` 与 request epoch 进入可注入 `useUnitTestPlanController`；只允许最新请求提交 success/error/finally，关闭范围会使在途响应失效。计划发现只发送 suite、关注排除和 case detail，不再携带旧计划的 `include_modules`；Page 保留模块勾选同步与 catalog。
- [x] `UnitTestsPage.vue` RunScope page shell：单消费者 `UnitTestRunScopePane.vue` 已拥有运行范围 DOM、局部折叠、列定义、纵横滚动和 scoped style；行投影进入纯 ViewModel，所有持久状态、Controller、Host、Primary contribution 与 request 组装仍归 Page。Page 从 2,131 行降到 1,810 行，实测记录见 [Unit Tests 运行范围页面壳验收](platform/UnitTests-运行范围页面壳验收.md)。
- [ ] `UnitTestsPage.vue` 后续切口：Watchlist 与 Result pane 仍在 Page；分别先建 characterization，再做单消费者拆分，不复制 store、watchlist utility 或 module-history utility。AsyncProgress 的终态 cancel 注销另列基础设施 TODO，不在页面壳拆分中顺手改写。
- [x] `CaaDialogEditorPage.vue` 第一切口：IR/session 校验、NLS map 清洗、历史栈裁剪、source text 脱敏和草稿/dirty snapshot 组装已进入 UI-neutral `caaDialogSessionViewModel.ts`；`usePageSession`、解析、草稿 API 与写回继续由 Page Host 层负责。页面从 1,898 行降到 1,795 行。
- [x] `CaaDialogEditorPage.vue` history controller：先用 characterization 冻结按钮、快捷键、10 个编辑调用点、PageSession 与 Host/API 契约，再把 snapshot/record/restore、undo/redo/reset 和两个栈迁入可注入 Page-local refs 的 `useCaaDialogHistoryController`。Page 继续持有 local session、dirty/clean、Pinia/sidebar 镜像、解析/草稿/写回与 active-tab 路由；页面降到 1,757 行。
- [x] `CaaDialogEditorPage.vue` NLS session ViewModel：IR/草稿构建、snapshot current overlay、六项 NLS dirty 与 key 数量差异投影进入 UI-neutral `caaDialogNlsSessionViewModel.ts`；Page 继续持有六个 refs、active locale/canvas 翻译、History 与 locale API/IR side effect。页面从 1,757 行降到 1,731 行，兼容契约见 [NLS 会话 ViewModel 验收](caa/CAA对话框-NLS会话ViewModel验收.md)。
- [ ] `CaaDialogEditorPage.vue` 后续切口：先冻结 canvas 选中/拖放/删除/resize 与 Page Host 交互，再拆单消费者 canvas/page shell；写回、草稿持久化和 API 保持 Host adapter，不把 locale UI 或 API 混入 history controller。
- [x] `AssemblyTreeTable.vue` 第一切口：递归树行/多实例投影、角色与状态语义、展开视觉状态、标签编辑比较、规则预览和写盘 patch 投影已进入 UI-neutral `assemblyTreeViewModel.ts`；组件保留懒加载、弹窗与宿主动作，从 1,213 行降到 1,030 行。
- [x] `AssemblyTreeTable.vue` 第二切口：单消费者 `AssemblyTreeRowGroup.vue` 已拥有主行/多实例附加行 DOM、五列单元格与行级 scoped style，只接受受控投影并上抛五类语义事件；Page shell 继续唯一拥有 API、Shell、替换弹窗、展开/懒加载/编辑 Map、公开 props/events/`defineExpose`。父组件从 1,030 行降到 517 行，RowGroup 为 618 行；Browser 真实 DOM、360px 双向滚动和交互证据见 [装配树行组件页面壳验收](cad/装配树行组件-页面壳验收.md)。
- [ ] `AssemblyTreeTable.vue` 后续切口：先冻结 `ensureSubtree`、全部展开、失败回退与并发请求语义，再判断是否提炼可注入的树 Controller；API、Shell、XLink 替换弹窗和写盘责任不得下沉到 RowGroup，也不在视觉拆分提交中改变真实 FreeCAD 行为。
