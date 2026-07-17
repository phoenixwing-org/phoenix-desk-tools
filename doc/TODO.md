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
- [ ] 为 `fcstd_map` 实现分页，避免全表加载。
- [ ] 统一长任务进度、取消与运行日志，不让页面各自维护第二套任务状态。
- [ ] 将剩余 Python 兼容入口逐项判定为外部引擎 adapter 或退役路径；Node/Hono 是当前 HTTP 真源。
- [ ] **用户手工验收**：在自有 Windows 机器执行已入库的 0.2.0 NSIS 构建/安装/Codegen/FCStd/退出/卸载门禁，回传脚本生成的 JSON 回执与最终成功日志；Codex 不连接远程 Windows、不创建 GitHub 镜像。FreeCAD/SolidWorks 外部进程 E/F 档仍需独立环境；历史 0.1.0 Windows 产物不计入当前版本。

## 后期：大型 UI 拆分

用户已于 2026-07-18 接受联合成熟度 **92.00** 作为本轮停止线，并决定另立大型 UI 拆分目标。优先 `UnitTestsPage.vue`、`CaaDialogEditorPage.vue`、`AssemblyTreeTable.vue`、`FcstdMapPage.vue`；拆分前继续禁止向这些文件加入新的领域算法或数据库真相。
