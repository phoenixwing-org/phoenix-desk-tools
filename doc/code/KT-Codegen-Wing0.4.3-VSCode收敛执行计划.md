# KT Codegen：Wing 0.4.3 与 VS Code 工作台收敛执行计划

状态：已被三端共用计划替代

> 2026-07-21 架构更正：本文件记录 0.4.3 首轮收敛历史；“不新增 Wing Web Component”和“预检位于下方面板”不再是当前方向。当前权威计划为 [Code 工具三端共用算法与 UI 内核执行计划](Code三端共用算法与UI内核-执行计划.md)：VS Code、Desk Web、Desk Tauri 共用 Wing 算法、ViewModel 与 Web Components，预检位于中央 View。

执行状态：首轮收敛已完成（2026-07-20）

Owner：Desk Tools / KT Codegen maintainers

适用版本：Desk Tools 0.2.x、Phoenix Wing 0.4.3 起

最后核验：2026-07-20

## 1. 目标

本轮将 Desk Tools 的 KT Codegen 从“可以消费 Wing”推进到“共享规则只由 Wing 决定、Desk 只做宿主适配”，并把界面稳定在 VS Code 工作台的四区模型：左侧 Primary、中央 View、右侧 Properties、下方 Problems / Output / Preflight。

完成后应满足：

- Desk 精确消费 Phoenix Wing 0.4.3，不保留 0.4.2 的行为分叉；
- 缺失或孤立 END 等局部 Marker 损坏，不再阻止其他完整区域安全 Apply；
- Wing 的 Table、Block metadata、结构化诊断和 Apply 判定直接成为 Desk 真源；
- Desk 只拥有工作空间、编码、缓存、文件指纹、原子事务、HTTP 与工作台交互；
- 不因向 VS Code 靠拢而复制 `kt-auto-code` 的 Extension Host 或 Webview 宿主代码；
- 本轮不新增 Wing Web Component，先用好已有组件，待出现第二个稳定消费者后再抽取。

## 2. 已确认基线

### 2.1 版本与能力差距

- Desk 的 Server、Web 与锁文件仍精确锁定 Wing 0.4.2；并列 `phoenix-wing` 和 Auto Code CAD 消费端已进入 0.4.3。
- Wing 0.4.3 已提供 `ktCodegenCanApplyValidRegions(plan)`、结构化 `diagnostic.marker`、Marker 恢复扫描，以及支持 `layout="page"` / `collapsible` 的 `<kt-codegen-table>`。
- Desk 当前仍以 `plan.canApply` 计算 `safe_to_apply`，因此宿主覆盖了 Wing 0.4.3 的安全局部 Apply 语义。
- Desk 已有 Primary、Properties 和唯一全局下方面板，结构不需要推倒重做；中央 Table 尚未使用 Wing 的 page/collapsible 模式，Problems 也尚未充分展示结构化 Marker 上下文。

### 2.2 当前责任边界

| 层 | 唯一职责 | 本轮处理方式 |
| --- | --- | --- |
| Phoenix Wing | Param、Reader/Adapter、Block metadata/preset、Marker、Analyze、Renderer、Apply 投影、Table Web Component | 直接消费，不在 Desk 复制判断 |
| Desk Node | 工作空间、Ignore、编码、快照、指纹、缓存、原子写入和回滚、HTTP | 保留为薄宿主 Port |
| Desk Web | Workbench contribution、会话状态、命令、导航和用户确认 | 采用 VS Code 四区模型 |
| Auto Code | 已验证的 VS Code 消费行为和交互参考 | 借用契约与测试思路，不复制宿主 UI |
| CAD TypeScript 服务 | FCStd ZIP/XML、SQLite 与外部引擎适配 | 与 Codegen 分层独立，共享 Wing pure core 原则 |

`kt-auto-code` 在整个目标期间是只读参考库：可以核对已验证行为、契约和测试思路，但不得修改、格式化、暂存或提交其中任何文件。Phoenix Wing 允许修改；执行顺序仍是先消费 0.4.3 已有接口，只有确认问题属于跨宿主共享规则或公共组件缺口时，才在 Wing 上游修复并补测试。此类修改必须独立提交、按新精确版本发布，再由 Desk 消费；不得靠 Desk 私有复制、本地源码特例或修改 `node_modules` 交付。

## 3. 变更边界与并行任务隔离

端口统一任务 `019f7f94-45f6-7481-9d40-6a1e74674359` 与本轮并行执行，期间占用 Server 启动、Tauri runtime bridge、Vite 和配置页；该任务现已完成。本轮没有修改、格式化或暂存其占用文件，包括：

- `server/src/server.ts`、`server/src/routes/dialog.ts`；
- 根 `package.json`、`scripts/run-dev-services.mjs`、`server/scripts/smoke-tauri-release-app.mjs`；
- `src-tauri/src/lib.rs`、`src-tauri/tauri.conf.json`；
- `web-ui/src/main.ts`、`web-ui/src/pages/ConfigPage.vue`、`web-ui/vite.config.ts`；
- `web-ui/src/constants/caaService.ts`、`web-ui/src/utils/runtimeBridge.ts` 及其测试；
- `server/src/lib/deskToolsRegistration.ts` 及其测试。

本轮允许触及的范围限定为：

- `server/src/lib/ktCodegenService.ts` 及 KT Codegen 定向测试；
- `web-ui/src/pages/KtCodegenPage.vue`、`web-ui/src/components/codegen/`、KT Codegen store/utility 及定向测试；
- `server/package.json`、`web-ui/package.json`、`pnpm-lock.yaml`；
- 本计划、KT Codegen 当前说明和人工点检文档。

允许按上述上游原则修改并列 `phoenix-wing`；并列 `kt-auto-code` 明确不在可写范围内。

若验证命令因并行任务的未完成代码失败，先用定向测试证明本轮，再等待或与端口任务协调；不得顺手修它的文件。

## 4. 分阶段实施

### K0：冻结基线与验收样例

- 记录工作树与端口任务占用文件；后续每次暂存前再次核对。
- 运行 Wing 依赖边界检查、Local Wing 可用性检查和现有 KT Codegen 定向测试。
- 固定至少三类 Marker 用例：全部完整、一个缺失 END 且另一区域完整、孤立 END 且另一区域完整。

退出条件：能区分已有失败、并行任务影响和本轮回归。

### K1：升级并直接消费 Wing 0.4.3

1. 将 Server 六个 TS 小包、`cad-rust-source`、Web `kt-codegen` 和 aggregate 全部精确升级到 Registry 0.4.3，并由 pnpm 生成锁文件。
2. 保持本地 Wing 只通过既有 Vite alias、Node loader 和 build resolver 切换；不得使用 `pnpm link`、`file:`、`workspace:`、override 或修改 `node_modules`。
3. `preflightKtCodegen` 使用 `ktCodegenCanApplyValidRegions(plan)` 形成唯一 Apply 语义，再叠加 Desk 自己负责的“源码扫描必须完整”门禁。
4. Apply 仍强制重预检、计划指纹、源码指纹、原子提交和回滚；安全局部 Apply 只放行 Wing 已生成的完整 Region/Artifact，不修补损坏区，也不扩大写入范围。

退出条件：完整区域可在同计划存在可恢复 Marker 诊断时 Apply；普通错误、扫描截断和指纹冲突仍被服务端拒绝。

### K2：收敛为 VS Code 四区工作台

#### Primary（左侧）

- 继续承载 Codegen 文档、Block/preset、源码候选与命中 Region；
- Block 标题、分类、deprecated 等展示只读 Wing presentation metadata；
- 选择候选、Region 或问题时只改变中央 View 的上下文，不在 Primary 创建第二份编辑状态。

#### View（中央）

- `<kt-codegen-table>` 启用 `layout="page"` 和 `collapsible`，采用自然页面高度与宿主滚动；
- 保留保存、还原、预检、Apply 和冲突草稿操作；
- 不复制 Wing Table 内部行、列、折叠状态或快捷行为。

#### Properties（右侧）

- 保持当前 Page Param / PropertySchema 纯派生模型；
- 展示活动文档、编码、行数、Block 数、Plan 状态和 Apply 状态；
- 不增加另一套可编辑 Param 表单。

#### Panel（下方）

- Problems：统一显示 Reader、Preflight、Apply 与宿主诊断；优先使用 `diagnostic.marker` 展示 Block/边界上下文，带路径与行列时可导航；
- Preflight：展示源码片段、Artifact、扫描完整性和安全局部 Apply 状态；
- Output：仅保留时间序列运行日志和写入清单；
- 全应用仍只有一个 `WorkbenchBottomPanel`，页面只贡献内容，禁止新增页内下方面板。

退出条件：用户能按“Primary 选对象 → View 编辑/预览 → Properties 看上下文 → Problems 定位问题”的路径完成一次预检和 Apply。

### K3：Desk 去重复与薄适配

- 删除或收敛 Desk 中对 `plan.canApply`、可恢复 Marker 诊断和 Block 文案的二次解释；UI 只读取服务端 `safe_to_apply` 与 Wing 结构化数据。
- 对必须保留的宿主判断明确命名：扫描完整性、工作空间边界、编码、文件大小、指纹和事务状态。
- 不把 Wing DTO 再映射为同构的 Desk DTO；只有 HTTP snake_case、页面会话或视图展示确有差异时才保留适配层。
- 参考 Auto Code 的行为与 fixture，但不复制 Webview HTML、VS Code command、Problems API 或 Extension Host 生命周期。
- 如果去重复需要 Wing 尚未提供的纯函数、诊断投影或稳定叶子组件，先记录两个真实消费者和公共输入输出，在 Wing 实现并测试；Desk 只在新版本发布后接入。

退出条件：同一 Codegen 规则修改只需改 Wing；Desk 测试验证宿主 Port，而不是重新测试 Renderer/Marker 算法。

### K4：验证、文档和人工点检

按风险从小到大执行：

1. Server KT Codegen 定向测试；
2. Web KT Codegen store、utility、property schema 测试；
3. Web 类型检查与生产构建；
4. Server 类型检查与 bundle；
5. `pnpm test:local-wing`、`pnpm build:local-wing`；
6. `pnpm verify:wing-dependencies`；
7. Registry 0.4.3 定向测试/构建，证明发布依赖不是只在并列源码下成立；
8. 更新人工点检：完整计划、局部安全 Apply、不可恢复错误、扫描截断、问题导航、表格折叠和窄窗口。

退出条件：Local/Registry 两种真源都通过，日志明确显示 `[Wing][LOCAL]` 或 `[Wing][REGISTRY]`，且没有触碰端口任务文件。

## 5. 明确非目标

- 不在本轮新建 Wing Web Component，也不把完整 Desk 页面搬入 Wing；
- 不修改 `kt-auto-code`；必要改进只写入本计划、交接建议或 Wing 公共实现；
- 不重构 AppShell、端口、runtime bridge、Tauri 启动或服务发现；
- 不改变 Codegen Renderer 输出、Marker 语法或旧 JSON/CSV 格式；
- Codegen 阶段不夹带 CAD runtime 改动；CAD Rust 收缩已在后续独立节点完成；
- 不以手工改锁文件、临时 override 或源码 link 代替 Registry 0.4.3 验证。

## 6. CAD / Rust 收缩完成记录

Codegen 收敛完成后按独立节点执行，2026-07-20 已完成：

1. `fcstd-query` 无业务 route 消费，native provider、状态 API、构建和打包链已删除；数据库继续走 Wing schema/db-node + Node TypeScript。
2. ZIP 只提取 `Document.xml`；BOM 读取/写回和 XLink/Label 修改使用 Wing pure XML core + Desk Node adapter。
3. 工作空间文件发现、索引、缓存、SQLite 分页与汇总保持 TypeScript，不逐文件启动进程。
4. Tauri 不再携带三个 CAD Rust sidecar；保留的 Rust 只有 Tauri 窗口和 Node 生命周期薄壳。
5. 真实 FreeCAD 打开/保存复杂样本继续作为人工兼容性门禁，不用“保留 Rust”代替验证。

每次 Rust 删除必须同时减少构建、provider、Tauri resources、自检和文档中的能力声明；不能只让业务代码“不调用”。

## 7. 共享 Web Components 的触发条件

新的 Wing Web Component 延后到满足以下全部条件后再做：

- Desk 与 Auto Code 已各自出现真实消费者；
- 输入输出 DTO 已稳定，不依赖 Vue、Element Plus 或 VS Code API；
- 组件是可复用叶子视图，而不是 Primary/View/Properties/Panel 宿主布局；
- 两端现有实现确有重复维护成本，并有共同交互 fixture；
- 抽取后能删除两端代码，而不是再增加第三份包装。

优先候选是诊断列表、只读源码/Artifact 对照和 CAD 结果叶子视图。工作台布局、命令注册、文件事务和宿主状态继续留在 Desk/VS Code 各自实现。

## 8. 完成定义

- Wing 0.4.3 是 Desk Codegen 唯一规则真源；
- 安全局部 Apply 的服务端门禁、UI 状态和测试语义一致；
- 四区工作台联动清晰且没有第二套属性编辑或下方面板；
- Desk 重复判断减少，宿主边界在代码和文档中可辨认；
- Local Wing 与 Registry 0.4.3 均通过定向测试、类型检查和构建；
- 端口统一任务的文件和未提交更改保持原样；
- CAD/Rust 收缩和新 Web Components 被保留为后续独立目标，不混入本轮提交。

## 9. 2026-07-20 首轮验收记录

- Server、Web 和锁文件的九处 Wing 依赖均为 Registry 精确版本 0.4.3；依赖检查确认没有 `link:`、`file:`、`workspace:`、override 或 `node_modules` 本地替换。
- Server 直接使用 Wing `ktCodegenCanApplyValidRegions(plan)`；缺失 END、孤立 END 与后续完整区域并存时，完整区域可安全局部 Apply，损坏区保持原样；扫描截断、指纹冲突和普通不可恢复错误仍关闭 Apply。
- 中央 Wing Table 已采用 `layout="page"` / `collapsible`；左侧 Primary、右侧 Properties 和唯一全局 Problems / Output / Preflight 面板保持宿主贡献关系。
- Problems 直接读取 `diagnostic.marker`、路径和行列，并使用 Wing Block presentation metadata；没有通过诊断消息文本反推 Marker 或 Block。
- Local Wing 全量回归通过：Server 65 个测试文件 / 250 项，CAA Core 11 / 67，Web 62 / 373。
- Registry 0.4.3 全量回归通过：Server 65 个测试文件 / 250 项，CAA Core 11 / 67，Web 62 / 373。
- `pnpm build:local-wing`、`pnpm build:registry`、Server/Web 类型检查、`pnpm verify:wing-dependencies` 与文档门禁均通过。
- Wing 0.4.3 已具备本轮需要的公共能力，因此未新增 Wing 源码改动；`kt-auto-code` 仅作只读参考，本轮没有修改其文件。
- CAD ZIP/XML、文件查询和 SQLite 已统一 TypeScript，三个 CAD Rust sidecar 已从运行、构建和打包链删除；共享 Web Components 继续遵守“双真实消费者”触发条件。
