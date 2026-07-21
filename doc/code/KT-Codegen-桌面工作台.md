# KT Codegen 桌面工作台

> 状态：可用版已实现（配置编辑 + 控制符选择 + 源码预检 + 问题定位 + 会话恢复 + 真实源码 Apply）
>
> 最后更新：2026-07-20
>
> 人工验收：[KT-Codegen-人工点检清单.md](KT-Codegen-人工点检清单.md)

## 定位

Desk Tools 的 `kt_codegen` 页是 `@phoenix-wing/kt-codegen` 的产品宿主，不拥有参数代码生成规则。

- Phoenix Wing 0.4.3：`KtCodegenParam`、旧 v4 JSON / 17 列 CSV、17 列 Table、32 个 Block、Marker Scan、Analyze、Renderer 与安全局部 Apply 判定。
- Desk Tools Web：左侧 Block、主 View、Tab dirty、预览与用户确认。
- Desk Tools Node：工作空间路径、UTF-8/GBK、BOM/换行、文件发现、磁盘指纹、源码快照与复读验证后的原子保存。
- `kt-auto-code`：VS Code 宿主；桌面端持续对齐它已经验证的交互与安全边界。

Desk Tools 不复制 Renderer，不修改 `phoenix-wing`，也不在浏览器中直接访问本地文件。

页面属性采用首个 MVC 试点：`ktCodegenPageParam.ts` 是 UI 无关会话 Model，`ktCodegenPagePropertySchema.ts` 保存静态属性声明和纯 derive，`useKtCodegenPagePropertySheet.ts` 只桥接 Wing Host。Pinia store 是 Controller/host adapter，不把文件系统真相复制进 Vue View；该纯 Model 图由 AST 门禁禁止引入 Vue、Element、Node FS 与 Tauri。

## 可推广的 Block + View 宿主模式

`web-ui/src/layout/pageRegistry.ts` 的 `PAGE_CONTRIBUTIONS` 是 Workbench 页面贡献的唯一登记点；所有页面登记 `view + sideBlock + sideBlockLabel`，普通页面由通用 Primary 展示摘要、操作和说明，复杂页面通过 `usePagePrimaryContribution` 注入专用内容。注册表及每个贡献项都冻结，避免运行时被业务组件改写。Shell 只负责把当前页面 Primary 放到左侧，工作空间树与页面属性固定在右侧，不感知 Codegen 业务类型。Footer 的“左”按钮控制 Primary 显隐，同一桌面会话记住状态；Host 统一传入 `pageId + workbenchTabId`，多 Tab 工具可隔离状态而不再修改 Shell。后续 Wing 工具迁移按同一结构落位：

1. Wing 包拥有 Model、规则、展示 DTO、预设和可复用 View/Web Component；
2. Desk Tools Node 只实现工作空间、编码、指纹、缓存和文件事务；
3. 页面 Block 负责文档/范围/控制项，主 View 负责编辑、预览和结果；
4. 在 `PAGE_CONTRIBUTIONS` 同一条记录登记 View 与可选 Block；
5. 写盘动作先经过预检、计划/源码并发指纹、临时文件复读和最终写回复读；目标工程由 Git 提供变更审阅与恢复。

## 界面

### 左侧 Block

- 发现当前工作空间内可由 Wing Reader 完整读取的 JSON / CSV；普通 JSON / CSV 自动跳过。
- 识别结果按文件签名缓存 6000 项，包括“不是 Codegen 文档”的普通 JSON/CSV；重复刷新不再反复读取和解析未变化文件，并显示命中/读取数量。每轮冷解析正文受 64 MiB 预算约束，按稳定文件描述符快照的真实 `raw.length` 计费而不是读取前可能过期的 `stat.size`；热缓存项不占本轮预算，因此大工作空间可由后续刷新逐步补齐且不会单轮解析数 GiB 普通 JSON/CSV。
- Block 存活期间每 15 秒低频刷新配置列表；热缓存路径只做目录遍历与文件签名检查。手动刷新可再次点击取消，离开页面或隐藏 Block 后定时器自动释放。用户预检会替换正在进行的旧 discovery；预检期间到来的自动刷新只合并排队一次，完成后再执行，避免两个工作区级扫描并发争用磁盘。
- 文档与控制符都支持就地过滤；读取兼容诊断在文档行和主 View 中可见。
- 页面与 Block 同时请求发现时复用同一个进行中请求；切换工作空间后，旧请求不能覆盖新状态。
- 当前打开、dirty 或冲突会话即使因文件删除、Ignore 或本轮发现预算未命中，也继续保留在 Block 文档列表；后台刷新不会覆盖“文件已删除”等更重要的会话状态。
- 文档切换或重新打开当前文档前检查未保存修改与恢复冲突；Store 要求调用方显式传入“已确认放弃草稿”，避免从树、Block 或未来入口旁路清稿。
- Prefix、Middle、Namespace、Append 归左侧 Block 管理，直接修改活动文档的共享 Wing Param；右侧 View 不保留第二份属性表单。
- 展示并选择 Wing `KT_CODEGEN_BLOCK_PRESENTATIONS` 提供的 32 个旧 Kevin 控制符。
- “全选 / 清空 / C++ / Field”直接调用 Wing 的 `ktCodegenBlockKeysForPreset`，Desk Tools 不保留第二份 legacyId 规则；“单选”行为与插件一致，deprecated 标签直接来自 Wing block metadata。
- Marker 配对由 Wing 按 `START/END + classId + block discriminator` 解析；32 项之外但正确成对的旧辅助块（例如 `IID_INTERFACE_CPP`）保持原样且不产生 `marker.unknown-block` 伪诊断，只有目标生成块进入 Plan。
- Block 修改 Prefix/Middle 或主 View 修改表格行时，活动文档的类名、行数和 dirty 标记立即同步，不必等保存。
- 预检后展示工作区级候选源码摘要（路径、首个 Marker 行、编码、换行）；点击候选在主 View 只读预览标记附近文本。为控制 Block DOM/响应体，摘要最多返回 500 项，预检本身仍覆盖最多 5000 个源码文件。
- 预检后列出命中区域；点击区域会联动主 View 的 Artifact 预览。

### 主 View

- 参数表直接注册并使用 Wing 的 `<kt-codegen-table layout="page" collapsible>` Web Component；中央 View 负责页面滚动，Table 自然增高并保留横向滚动与 Header 折叠。列宽“自适应”、变更事件、选择前景色与 ARIA 行列信息均随 Wing 更新直接生效，Desk 不复制表格动作或折叠状态机。
- 保存 JSON / CSV、从磁盘还原、执行预检并真实 Apply 源码。
- 预检运行时按钮切换为“取消预检”；重复预检、配置/Block 变化和工作空间切换会通过 `AbortSignal` 中止旧浏览器请求。
- `AppShell` 只创建一个全局 `WorkbenchBottomPanel`，以“预检 / 问题 / 运行日志”三个可收缩标签展示当前贡献和全局日志；切换 View 不新开或并列第二个面板，运行日志也不会回到右栏。
- 预检标签并排展示命中的当前源码片段与 Wing 生成 Artifact；源码指纹变化时标记为过期并要求重新预检。
- 配置 Reader、预检和 Apply 的结构化诊断统一进入“问题”；Marker 问题直接读取 Wing `diagnostic.marker` 的 Block、START/END、类身份与恢复边界，不解析本地化 message。带 Wing `path.file/row/column` 的源码问题可点击定位，当前行使用黄色背景和左侧标识。
- 未保存 Param/Table 随 Workbench 会话保存。恢复时仅在磁盘指纹仍一致时自动载入；指纹冲突时保留磁盘版本和旧草稿，主编辑区会冻结，必须复制或明确放弃旧草稿。
- 页面打开期间发生外部修改时，过期保存返回 `409`；宿主立即重读磁盘版本，同时把本地 Param/Table 作为冲突草稿保留，避免用户只看到错误后误操作丢稿。
- 激活的 View 每 5 秒做一次轻量文件签名检查；签名未变只需 `stat`，签名变化才重新计算 SHA-256。clean View 自动载入外部修改；dirty View 或文件删除则保留当前草稿并显示警告，可先复制草稿再显式重载。
- 同一文档/同一 Plan 的重叠心跳复用一个在途请求，避免服务慢于 5 秒时新请求持续把旧响应判为过期；状态检查与源码预览有 15 秒 deadline，文档、Plan、预览目标或工作空间切换会通过 `AbortSignal` 真正取消旧浏览器请求。
- 文档、Block 或工作空间变化会使未返回的旧预检/预览请求失效，避免慢请求覆盖新状态。
- 保存进行中禁止从 Block/树切换文档；文档切换请求未返回时冻结旧 Block/View，并由 Store 拒绝对旧文档发起保存或预检。Store 同时以请求身份保护响应，工作空间 reset 后到达的旧保存结果不能复活旧 View。
- 预检存在时同一轮 5 秒心跳用单请求批量检查 Plan 全部命中源码的文件签名；任一源码修改/删除都会立即清除 Plan。签名未变不读取正文，`Apply 源码` 前仍强制重预检；没有手工预检时 Apply 自动执行预检。
- Wing Table 的 `kt-codegen-table-change` 每次编辑都更新行数、保存会话并使旧预检失效；不只依赖首次 clean→dirty 跃迁事件。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/code/codegen/documents` | 发现 Wing 兼容配置 |
| `POST` | `/api/code/codegen/open` | 读取配置并返回 Param + Table DTO |
| `POST` | `/api/code/codegen/document-state` | 轻量检查打开文档的文件签名与内容指纹 |
| `PUT` | `/api/code/codegen/document` | 通过 Wing Adapter 写出；磁盘指纹冲突返回 `409` |
| `POST` | `/api/code/codegen/preflight` | 扫描源码标记、返回限量候选摘要并调用 Wing Analyze |
| `POST` | `/api/code/codegen/apply` | 复核刚展示的 Plan 并真实写回全部 Artifact |
| `POST` | `/api/code/codegen/source-preview` | 按预检区域读取 C/C++ 片段并复核源码指纹 |
| `POST` | `/api/code/codegen/source-states` | 单请求批量检查 Plan 的全部命中源码 |

配置发现最多遍历 5000 个 JSON/CSV，并以 `config_snapshot_bytes` / `config_scan_byte_limit_reached` 报告本轮 64 MiB 冷解析预算；HTTP 请求体统一限制为 16 MiB。源码预检遵守 Code 模块共用忽略规则，最多索引 5000 个 C/C++ 文件，单次交给 Wing Analyze 的源码正文总量最多 64 MiB。宿主单次读取文件，先用 ASCII Marker 快筛，再只把包含 `KEVIN CAA WIZARD SECTION` 的 UTF-8 / GBK 文本交给 Wing。达到文件数或字节预算时 API 分别返回 `source_scan_truncated` / `source_scan_byte_limit_reached`，Block 与主 View 会明确提示扫描不完整的原因。配置和源码需要计算正文指纹时采用不跟随符号链接的文件描述符快照，并核对读前、读后及当前路径的设备/inode/大小/时间签名；扫描缓存命中前也用 `lstat` 再次确认仍是普通文件。读取中被替换会自动重试，避免组合出“旧 fingerprint + 新 signature”或把路径竞态指向工作区外文件。

源码预检缓存分两层：文件层以 `dev/inode/size/mtime/ctime` 签名保存解码结果，同时受 6000 项与 64 MiB 正文双上限约束；Plan 层以工作空间、规范化 Param、Block 顺序以及每个候选源码的内容指纹为键，同时受 24 项与 64 MiB 序列化计划双上限约束。API 返回 `source_cache_hits`、`source_files_read` 和 `reused`，便于 UI/日志观察。任一配置值、Block 或源码签名变化都会重新读取，源码内容指纹变化会生成新计划。

扫描消费者通过临时 SQLite 快照读取工作空间偏好：复制前后同时核对数据库身份签名与 SHA-256，复制中变化会重试，且拒绝伪装成数据库的符号链接。已有数据库的自定义 Ignore 仍然生效，但扫描不会初始化 Schema、创建数据库或在工作区留下锁文件；没有数据库时读取旧 JSON/`.phoenix/code.ignore` 与内置规则。稳定快照按数据库 `dev/inode/size/mtime/ctime` 做最多 32 个工作区的内存 LRU，命中返回深克隆，不会每 15 秒重复复制大型工作区数据库，也不会被调用方改写缓存。快照失败（例如数据库损坏）时只退回内置规则与 `.phoenix/code.ignore`，Codegen 发现/预检仍可只读工作。偏好配置 API 本身不吞掉数据库错误。

## 源码 Apply 安全边界

点击 `Apply 源码` 会先基于当前 Table/Block 强制重跑预检；本次预检取消/失败时不会回退使用旧 Plan。预检返回的 `plan_fingerprint` 同时覆盖规范化 Param、Block 顺序和全部候选源码内容指纹，Apply API 会再次 Analyze，只有身份与刚展示的计划完全一致才继续。

宿主额外返回 `safe_to_apply`：它直接消费 Wing `ktCodegenCanApplyValidRegions(plan)`，再叠加 Desk 自己负责的“源码文件数与 64 MiB 快照扫描必须完整”门禁。完整计划显示“可 Apply”；只有 `marker.missing-end` / `marker.orphan-end` 等已被 Wing 隔离、且仍存在完整 Region/Artifact 时显示“可安全局部 Apply”，只写回完整区域，损坏区保持原样并继续出现在 Problems。Renderer、模型、Artifact 等其他 error 仍保持 fail-closed。超过扫描上限仍可查看部分预览和诊断，但 Primary、View、Properties 与状态日志都会标明“扫描不完整 / Apply 已关闭”，并提示通过 Code Ignore 缩小范围；服务端 Apply 再次强制此门禁，不信任前端按钮状态。文件数扫描采用“上限 + 1”探测，刚好 5000 个文件不会误报截断。

真实 Apply 按以下事务边界执行：

1. 每个 Artifact 必须唯一关联一个 Wing Marker Region；偏移必须有效且同文件区域不重叠；
2. 同文件多个区域按 `replaceStartOffset` 倒序替换，避免前一处改变后一处偏移；
3. 写入前重新稳定读取全部目标，逐文件核对预检 `sourceFingerprint`；
4. 生成文本按原文件 LF/CRLF 归一，继续保留 UTF-8、UTF-8 BOM 或 GBK 与原权限；
5. 全部目标先写同目录独占临时文件，`fsync` 后解码复读并核对字节指纹；
6. 已与生成结果逐字节一致的文件直接记为 no-op，不创建临时文件或改变 inode/mtime；
7. 在任何目标替换前统一再次检查文件身份签名和内容指纹，每个文件紧邻 `rename` 前再即时核对；随后原子替换、同步目录并复读最终文件；
8. 多文件提交中若后续文件失败，仅当已提交文件仍是本次生成内容时，才使用内存中的原始字节原子回滚；检测到提交后的外部修改则拒绝覆盖并明确列出路径；
9. 返回每个实际变更文件的前后指纹、字节数、编码、换行和区域数；中央“输出”记录写入清单，目标工程通过 Git 审阅或恢复。

配置保存使用临时文件、Wing 复读和原子替换。临时文件通过独占文件描述符写入并 `fsync`，复读内容指纹必须与待写字节一致；POSIX 替换后尽力同步父目录。除请求开始时的乐观 fingerprint 外，替换前还会再次读取目标 checkpoint，同时比较内容指纹与文件身份签名；即使外部进程以相同正文替换文件或修改权限，也不会被静默覆盖。冲突返回 `409`。保存入口再次验证普通文件、扩展名、原文件与编码后输出的 4 MiB 上限。

当前尚未内置源码 diff 对话框；依赖目标 Git 工作区查看/恢复差异。Desk 与 `kt-auto-code` 已采用同一 Wing Plan/Region/Artifact 契约，后续应把两端纯文本投影 fixture 收敛到 `@phoenix-wing/code-core`，但本任务不修改另一个 agent 正在维护的 Wing。

## 验证

- `server/src/lib/ktCodegenService.test.ts`：发现、稳定快照读取、冷解析预算、配置保存、未知辅助 Marker、缺失/孤立 END 的安全局部 Apply、GBK/CRLF 真实 Apply、no-op 幂等、最终/即时 checkpoint 竞态、多文件失败回滚、扫描不完整门禁与批量边界。
- `server/src/routes/shell-codegen.test.ts`：八个 HTTP 路径、16 MiB 请求上限、配置保存、真实源码 Apply、初始 stale 与保存/Apply 竞态均返回 `409`。
- `web-ui/src/stores/ktCodegen.test.ts`：Wing 预设、预检取消/失效、问题行定位、真实 Apply、保存/切换门禁、发现合并、草稿摘要和竞态隔离。
- `web-ui/src/utils/ktCodegenSession.test.ts`：安全热恢复、磁盘指纹冲突与非法快照拒绝。
- `web-ui`：page registry、Block 显隐/Tab 上下文、VS Code 四区贡献、Wing Table page/collapsible、结构化 Marker Problems、多 Block 极窄窗口等分退让、单选状态机、Ribbon contract、`vue-tsc` 与 Vite production build。
- 2026-07-17 全量回归：Web `24 files / 212 tests`、Server `62 files / 237 tests`；Web production build 通过，Server sidecar bundle 与 bundle health/shutdown smoke 在最终收口再次验证。
- `pnpm -C server measure:kt-codegen [--] <workspace>`：可重复执行配置发现与单 Block 冷/热只读基准，输出版本化 JSON，不保存配置或源码。
- PNXCaaStudy 实测：发现 11 个配置（冷解析约 21 KiB）；单个 `PARAM DECLARATION` 预检索引 217 个 C/C++ 文件、筛出并返回 46 个候选源码摘要（约 293 KiB），生成 1 个 `safe_to_apply=true` Artifact。2026-07-17 对原本 Git-clean 的 `PNXBomAnalysisCoreData.h` 做真实 Apply：只改 1 个 Marker 区域，UTF-8/LF 保持，1995→1996 bytes，最终指纹复读通过且无临时文件残留；Git diff 只包含该区域的空行和 3 个参数 id 更新。本机同进程配置发现冷/热约 `63ms/8ms`（热路径 11 命中、0 读取），预检冷/热约 `73ms/9ms`（热路径 `217/217` 文件命中且 Plan 复用）。
