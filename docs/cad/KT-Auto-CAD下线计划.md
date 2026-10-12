# KT Auto CAD 下线计划

状态：current（计划已确认，离线交付、手动恢复、隔离宿主与普通构建点检已接通；接收契约、正式安装和停用仍未完成）

Owner：Desk Tools / KT Auto CAD maintainers

最后核验：2026-10-12（本地归档复核；先实施 M1，后续依退出门禁推进）

目标是将 KT Auto CAD 的产品能力全部收敛到 Phoenix Desk Tools 的 CAD 模块，完成替代验收后退役旧扩展。已有能力合并，不重建一套索引或界面；缺失能力补迁，不因旧入口停用而默默丢失功能。当前最大的缺口是 Phoenix BOM 交付链路，其次是深度对象信息与旧宿主接点的收口。

用户于 2026-10-11 确认本计划并授权开始执行。先实施 M1 的检索、静态对象信息、引用计数/新鲜度和只读诊断；验证使用独立构造样本，不改个人工程。后续按退出门禁推进，旧扩展停用、正式发布和生产数据切换仍需最终验收与授权；进度统一从 [当前 TODO](../TODO.md) 跟踪。

## 基线与切换节点

| 仓库 | 固定输入 | 用途与保护边界 |
| --- | --- | --- |
| Desk Tools | `438c62d567e228414f2ac3bfcd63228ff6f8a610`，`develop`，0.5.0 | 初次盘点时的 clean HEAD；仅作历史迁移起点与比较基线，不直接作为实施/切换的回退目标，不代表退役已经完成 |
| KT Auto CAD | `96b6a846b49fc0f29fc1f3da017cb055cedafafc`，`v0.2.0`，0.2.0 | 只读业务金样本，clean；不升级冻结的 Registry 依赖，不删除源码和旧测试 |
| Phoenix Wing | `ee5c042aa39d97fc655222ae7e252fddb106c10b`，`develop`，0.8.0 | 本次计划核验时的共享层，clean；CAD Core/Contracts 0.7.0，Rust source 已退役 |
| Phoenix BOM | `ff19610aa0d16c6643281d6ddf0419df19f009b7`，`v0.2.0` | 只读接收契约基线，clean；新 producer 的兼容变更另列实施批次 |
| KT Auto Code | `34a0c8761201c96fcea6af9ee6ad6f3c9fb2aa42`，`develop` | 只读检查 CAD 安装/联调入口，clean；不连带迁移 Code 或改变其四区域 Shell |

复用现有主目录完成盘点，不创建新 worktree。Auto CAD 和 Desk 各仅有主检出；Wing、BOM、Auto Code 的其他活动 worktree 不参与本轮，也不清理或覆盖。若实施时工作树出现重叠修改，先确认归属。初次盘点仅编辑 Desk 的计划文档；当前实施授权覆盖本计划中的业务迁移批次。保留既有未提交修改，仅暂存本任务文件，不自动 push。

上一轮本地消费门禁绑定 **Desk `438c62d567` + Wing `ac1773bc3428d93985e2a296d7b28139b7b74032`**：Server 488、CAA 核心 67、Web 750，共 1305 项测试通过，类型和 Web/Server 构建通过。Wing 后续的 `ee5c042` 不冒用这份证据。最终切换必须另记录当时的 Desk/Wing/BOM 精确提交、Registry 版本、安装制品 SHA 和验收结果；已识别的旧 VSIX 候选恢复包见下节，尚未完成安装恢复演练。

本轮复核时，Desk 的 `develop` 与本地远端跟踪引用 `origin/develop` 均指向 `438c62d567`；未联网 fetch，不能据此证明服务器此刻无更新。它是迁移起点，不是公开发布或退役完成证明。Registry 清理/发布期间不提前改 Desk 的精确依赖和 lockfile。

Auto CAD `96b6a846` 是已接共享索引的源码基线，正式依赖仍锁 0.6.2，不能据此假定同一源码已通过当前 Registry 打包。M0 需分别冻结本地共享 Wing 输入与最后实际通过发布门禁的 VSIX；两者如有差异，记录差异，不伪造依赖版本或把源码 HEAD 当作已发布扩展。

### Wing 发布期间的消费端复验

2026-10-07 的追加验证仍使用 Desk `438c62d567`（仅本计划等四份文档有未提交修改）、Node 22.23.1。`pnpm wing:check-local`、`pnpm verify:wing-dependencies` 与 `pnpm verify:architecture` 通过，Registry 精确依赖和 lockfile 未改。

首次 `pnpm test:local-wing` 的类型检查和 1305 项测试通过，但运行期间 Wing 主库从 `ee5c042` 提升并整理为 `e97157e2dc1b222ef12dcc3768cda29ba23cc06d`，因此不作为任一固定 Wing 提交的完整验收。随后 Web/Server 本地构建通过；针对新提交的测试复跑在 Web 类型检查处失败，错误关联到缺失的 `dist/types/PnwWorkspace.d.ts`，之后又观察到构建声明文件被刷新移除。发布协调同时反馈共享构建目录发生竞争。本次没有固定、隔离的制品输入，不能据此认定新版本业务回归，也不能宣称当前消费端门禁已通过。

本任务的构建/测试进程均已结束；Wing 发布窗口内不再启动重建或 pack，不修改其主库、依赖或版本。待发布侧提供精确版本与完整回执，再以稳定制品完成本地/Registry 消费端复验。迁移计划实施确认仍独立待办，不能用基线测试替代迁移验收。

### 旧扩展候选恢复包核验

2026-10-07 在 Auto CAD 主目录只读执行 `pnpm verify:artifact`，通过。候选包为 `dist/vsix/kt-auto-cad-0.2.0.vsix`：9 个条目、56,632 字节，SHA-256 为 `794fccc6528563427a59abbccedb1381a62cb79d385a4b73816419f57a584b0f`，与旁边的 `.sha256` 一致。核验覆盖扩展身份、依赖、必要文件与包体边界；未安装扩展、未重新构建、未修改旧仓库。

旧仓库的 `docs/0.2.0发布准备.md` 明确区分共享索引迁移前的 VSIX 与迁移后的源码候选：阶段二依赖尚未发布的公共 API，Registry 门禁当时失败且未重打包。该文档更早的包体大小和 SHA 是历史记录，不能覆盖本轮实测值，也不能用当前 VSIX 证明 `96b6a846` 已发行。M0/M4 仍需核对候选包对应的确切源码/构建输入，并完成隔离安装、数据恢复和最终隐私审查；当前仅确认制品存在且内容门禁通过。

2026-10-11 追加只读核验：`pnpm verify:artifact` 再次通过，包 SHA/条目数/大小与上文一致。已定位源码恢复候选 `5b1c8a33d7ee39a75ae1e2b7aaa730033bf868aa`：包内 `package.json` 和 CHANGELOG 与该提交逐字节一致（manifest SHA-256 `41abfa9c00cb2a698d129c25b9bdf79e389ee4742d1a70d69afd17ec1f76c7e1`）；bundle 仍包含 Registry Wing 0.6.2 和共享索引迁移前的本地 planner。它不是当前 `96b6a846` 的发行证明。包内缺少构建 commit/dirty/toolchain/lockfile 来源记录，且 ZIP 时间早于候选提交，故不能把内容对应推断升级成精确 clean 构建证明。

M4 恢复演练分别保留原 VSIX、固定 `5b1c8a33` 重建的独立候选和实际安装结果：在隔离目录绑定该提交、其 lockfile（SHA-256 `d6fdba98291c95082daffdfe0c2ccd216c878fd5f727e22cdd3b5510f0935a89`）、Node >=22 / pnpm 10.15.1 / vsce 3.9.2 / esbuild 0.28.1，记录实际工具版本、clean 状态、新包 SHA 和条目比较。先核实配套 Auto Code VSIX，再以隔离 Extension Host 验证 Shell API v2、索引/查询及 outbox/终态回执恢复；只在合成工作空间或备份副本执行，并保持唯一索引写入方。原包不覆盖，不把重建候选称为历史原包，不从旧 SecretStorage 搬运凭据。

### 2026-10-11 当前状态复核

- Desk 当前 `develop` HEAD 为 `07b89911c425113a78b3cb105c191024334e2306`。`438c62d567` 继续作为原始迁移起点，不再描述为当前最新 HEAD。
- Wing 0.8.0 的正式 Registry 消费适配已随该提交完成；精确依赖、锁文件及当时的 1,316 项测试/构建回执见 [Wing 并列仓库联调](../platform/Wing并列仓库联调.md#2026-10-07-registry-080-消费升级)。上文“等待发布回执”的段落是历史过程，不再是当前阻断。本轮只复核提交内容并重跑依赖边界检查，未把历史测试计作本轮重新执行，也未重建相邻 Wing。
- Auto CAD 主检出仍为 `96b6a846b49fc0f29fc1f3da017cb055cedafafc`，工作树 clean，只有主 worktree；只读金样本未变化。已追加核对旧 VSIX 内容与源码候选，尚未证明精确 clean 构建来源或安装恢复，也未联网核对旧仓库远端状态。
- Dirty 保护清单：本计划、TODO、产品归属矩阵、文档索引为既有已暂存计划材料；另有用户单独要求的单件缩略图重生成代码/测试，尚未提交。计划修订只编辑前两份文档，不修改暂存区，不混入缩略图或跨仓源码。
- 单件缩略图已增加原色/浅灰、轴测图和 Fit；显式生成会持久化当前 FreeCAD 的 SaveThumbnail 偏好，备份后仅替换 FCStd 内嵌 PNG，并更新网页缓存。图册「更新」仍为只读提取。这是 Desk 的独立增量，不是 A08 完整对象 DTO 的替代，也不计入本计划已验收项。图片与模型原始属性、放置变换保持分离。
- 随后的独立 Wing 适配已将并列检出切到 `fix` / `933dfab800ce58c89b7cdc3ed63d3674941e2d2b`；Desk 工作空间适配、启动发现及联调文档仍为未提交修改。双端 typecheck、本地 1,332 项测试、Web/Server bundle 与隔离启动/页面点检通过，详见联调文档的 2026-10-11 回执。这消除了当前本地消费基线的不确定性，但不是 A01–A14 等价或 M1 实施证明。
- 用户随后明确“计划OK，开始执行”，已开始 M1。A09–A12 缺口、旧包恢复输入、真实接管/发行验收和 M5 切换授权仍保留；本次批准不等于退役或发布完成。

## 迁移方式与责任边界

采用业务行为保真优先：冻结旧输入输出和安全语义，复用 Desk 现有页面，仅为缺失能力新增入口。用户要求收敛到 Desk，因而不复制 VS Code Webview 的布局、Commands、SecretStorage 或 Shell API v2。

| 层 | 保留责任 |
| --- | --- |
| Wing | 已共享的 CAD 命名、XML 投影、引用解析、索引计划与事务、workspace schema；稳定且有真实多端需求的交换 DTO/校验再评估提炼 |
| Desk CAD | 文件与 SQLite IO、任务、确认/预览/应用、进度与底部日志、页面、outbox、HTTP 交付与宿主凭据端口 |
| Phoenix BOM | envelope 接收规则、服务端数据权限、审核、冲突裁决、原子提交与幂等回执；不迁入本地 CAD 模块 |
| Auto CAD | 迁移期间的只读金样本和最后可恢复扩展；验收后停止承担 CAD 产品入口 |
| Auto Code | 通用扩展宿主和 Code 功能；最后只清理 CAD 专属目录依赖/安装建议，不改通用可选模块协议 |

本任务不是把 Desk 改造成 Admin 插件：不新建 Pah manifest、COOL 菜单或 PostgreSQL 表，也不迁移登录平台。借用迁移流程中的精确基线、能力台账、安全边界和分层验收；Admin 专属装配门禁不机械套入 Desk。

## 能力迁移台账

“已有”表示目标实现存在，不等于与旧扩展完整等价已验收；“需合并”必须比较双方的具体默认值、字段和错误语义；“未迁移”必须补实现后才能停用旧能力。

| 单元 | Auto CAD 真源 | Desk 现状与目标入口 | 判定及下一步 |
| --- | --- | --- | --- |
| A01 文件名语义 | `cadFilename.ts` | 文件详情/属性推荐/名称统一，消费 Wing 命名规则 | **已有**；以独立样本对齐类型、编号、版本、名称、后缀，不复制解析器 |
| A02 FCStd 扫描与索引 | `workspaceScan.ts`、`workspaceIndex.ts` | `cad_index`、`cadIndexScanService.ts`，同用 Wing plan/writer | **已有**；对照完整/失败/取消、5000 文件上限、排除目录、竞争扫描、人工字段保留 |
| A03 索引检索 | `searchCadWorkspaceIndex`、QuickPick | CAD 索引新增文件资产检索；原树筛选/零件目录保留 | **M1 已实现，验收见下文**；六字段单关键词 OR、路径排序、200 上限；缺索引明确拒绝，不隐式扫描或伪造内存回退 |
| A04 TS 轻量读取 | `fcstdTsReader.ts` | 文件详情独立轻量摘要、`cad-light-info`、32 MiB 只读索引 XML 分析 | **有界只读入口已接通**；原始字节、对象数、去重源 XLink、内嵌字段和即时文件诊断分别展示；完整/写入仍保留 16 MiB，外部单文件许可未承接，见后续 carry 回执 |
| A05 基础 BOM/引用 | `workspaceDatabaseQuery.ts`，Wing `pnwQueryCadWorkspaceSummaryV1` | 文件详情“引用/装配结构”、`pnwBomXrefService.ts` | **M1 已修计数与快照边界**；实例、目标文件和 BOM 行不再混用；精确入向修复、重复数量与局部 stale 有独立回归。不是完整交付门禁或几何数组数量支持 |
| A06 XLink 诊断 | `xlinkDiagnostics.ts` | `xlink_fix` 及详情引用页，已有分析与写回 | **已有且更完整**；迁诊断分类/拒绝规则，不退回旧扩展的只读小界面 |
| A07 CAD/Schema 诊断 | `cadDiagnostics`、`nativeProtocol.ts` | CAD 索引诊断、健康状态、底部运行日志 | **M1 已补只读诊断与提示**；缺失/旧 Schema/读失败/未完成扫描提供准确动作；不自动创建、升级、重建数据库，不要求旧 Shell/provider |
| A08 深度对象信息 | `nativeRead.ts`，native v1 document DTO | 文件详情新增只读“对象信息”页，静态 Document.xml 输出共享 document DTO | **M1 已实现静态字段契约，验收见下文**；不恢复 Rust provider，不宣称所有 FreeCAD 格式/几何运行态等价 |
| A09 BOM 确定性交付包 | `bomTransfer.ts` | Desk envelope/source/snapshot/export 与 `bom_delivery` 页面、预览/导出/释放 API 已接入 | **离线阶段已接通，整体未完成**；页面最终回执见 M2.3，接收端 producer 兼容尚缺；质量门禁、一致快照、新鲜度、排序/hash、scanId、8 MiB 限制与原子 no-replace 见 M2.2 |
| A10 BOM 推送与审核 | `phoenixBomClient.ts`、`bomDelivery.ts` | 尚无 prepare/status/commit 和审核跳转 | **未迁移**；先兼容 Desk producer，再接服务端预检/审核/提交；不自动裁决差异 |
| A11 离线重试与回执 | `bomDelivery.ts` | 尚无 BOM outbox 管理 | **未迁移**；接管不可变包、待重试/待审核/已提交/已作废状态及终态回执；保持幂等 |
| A12 账号与凭据 | `phoenixBomClient.ts`、VS Code SecretStorage | 无 Phoenix BOM 专用凭据端口 | **需宿主适配**；非秘密连接设置与秘密分离，旧秘密不自动搬运，Desk 重新登录 |
| A13 当前文件/模块可见性/进度 | `extension.ts`、Shell API v2 | Desk 工作空间树、预览 Tab、模块开关、Primary 进度和底部日志 | **用 Desk 宿主替代**；保留能打开文件、取消、查看结果和错误的操作结果，不复制 VS Code 外壳 |
| A14 native provider 选择/握手 | `nativeProtocol.ts`、`selectDeskToolsProvider` | Desk 当前不发布旧 native provider；Wing 最新也已移除 Rust source | **旧机制随退役收口**；先确保 A08 的业务字段有去向。若 TS 确有缺口，单列受控 FreeCAD adapter，不因机制退役删除功能 |

Desk 已有的单个/批量属性、名称统一、图纸命名同步、装配标签、关联文档同步、改名任务、图册/缩略图、零件查重、STEP→FCStd 和 SolidWorks→STEP 保持原入口与测试。这些不是 Auto CAD 的遗漏迁移项，不重做，也不以它们数量多来抵消 A09–A12 的缺口。

A03 的旧查询是单一关键词跨六字段 OR、按相对路径排序、最多 200 行。Desk 已有的多词 AND 路径筛选继续保留；合并时明确区分字段范围与词间关系，端到端测试每个字段单独命中、组合条件、零结果与上限。使用一次参数化索引查询，不以前端并发多次搜索后合并分页掩盖差异。

旧数据库搜索的 `%` / `_` 使用 SQLite LIKE 通配语义，内存回退却按字面包含匹配；回退只在没有数据库查询成功、且有查询错误和可用扫描结果时启用，字段与排序也不完全等价。M1 单列这些差异，保留结果来源提示；不能把回退描述成完整六字段数据库检索。是否统一字面搜索属于显式规则变更，不在迁移时静默改变。

已核实的具体差异：旧查询对 `phoenix_cad_file_asset` 的 present 资产逐文件返回；Desk `PartCatalogPage.vue` 加载 PartKey 后按零件字段在前端筛选，服务端 `loadPartKeysPayload` 的可选检索也不覆盖文件名/路径。多个文件关联一个 PartKey 时，零件目录的一行不能代表全部文件命中。M1 应在 CAD 索引中补有界、只读的文件资产检索，不通过逐行读 FCStd 或递归装配来补齐。

初次盘点的 A05 计数不等价：旧 `pnwQueryCadWorkspaceSummaryV1` 的 `outgoing` 是 `COUNT(DISTINCT target_repo_rel_path)`，`flat_lines` 来自 `phoenix_cad_bom_line`；Desk 当时把 xref 的 `COUNT(*)` 同时映射成 `outgoing_count`、`outgoing` 和 `flat_lines`。本轮已分别保留边行条数、目标文件数和 BOM 行数，并对未知/未完成/陈旧索引返回显式状态，实际范围见 M1 回执。这不是完整 BOM 交付已迁移的证明。

初次盘点还发现局部刷新不重建 `phoenix_cad_bom_line`，且按文件去重会丢失实例 quantity。本轮完整扫描和局部刷新均保留支持布局中的序列化链接对象；局部事务新增 `stale/xref-partial-refresh` revision，保留旧递归 BOM 并要求完整扫描。独立真实扫描用例得到直接数量 2/3、递归数量 2/6。M2 不能凭 xref 已刷新或文件详情 `ready` 放行；Link-array、多目标和未知数量布局显式拒绝，不默认 1。

旧查询的 incoming 后缀 LIKE 可能误中另一目录，missing/ambiguous 空目标会被旧严格 DTO guard 拒绝。本轮改为精确路径/asset ID 匹配并保留缺失目标状态；不把读取错误转成成功的 0。`/api/cad/health` 初次盘点会触发 PartKey 投影同步，本轮改用只读索引诊断；缺库、坏库、旧 Schema 和外部数据库链接均有拒绝/不变性回归。

### A08 对象信息字段验收范围

2026-10-11 对照旧 `nativeRead.ts` 消费的 `PnwCadNativeV1FcstdDocument` 与当前 Registry 契约。旧仓库和 Desk 已安装的 `nativeV1.ts` 原始字节 SHA-256 均为 `402f1b8b633262b79e13598556179cbb532107210a882e9b23023956bc5fb578`，因此本次字段清单没有把新版同名类型误当成旧类型；这只证明类型定义一致，不证明旧二进制或目标读取结果等价。

| 冻结字段 | Desk 当前可复用部分 | M1 需要补齐或证明的行为 |
| --- | --- | --- |
| `objects[].name / label / type_id` | `fcstdLinkIdentity.ts` 的对象解析，详情 BOM 根对象与装配链接投影 | 展示全部对象身份；区分内部 name、显示 Label、FreeCAD 类型，不只返回选中的 BOM 根对象 |
| `objects[].children`、`root_names` | `assemblyLabelPreview.ts` 读取 Group 并构建链接树 | 不把仅保留引用节点、合并重复实例或省略根包装后的 UI 树冒充原对象树；保留旧顺序与根/子节点语义，明确循环与缺失对象行为 |
| `objects[].properties` | 现有 BOM 编辑表只投影固定属性；XML helper 保留原始属性块 | 对齐旧 `string \| number` 属性集合；覆盖空值、字符串/数值差异和有限数值校验，不把所有属性强转字符串或把未知值填零 |
| `objects[].material` | 尚无完整文档级材料输出契约 | 区分字符串材料与 `null`；不从缩略图颜色反推材质 |
| `objects[].placement` | 现有装配显示不是完整放置变换输出 | 保留 `x/y/z/q0/q1/q2/q3` 或 `null`；用独立平移/旋转样本冻结单位、四元数顺序及坐标系，不以轴测视角、相机或 Fit 结果替代 |
| `objects[].is_valid_bom_item`、`level` | 根 BOM 选择和装配 UI 深度各有现有逻辑 | 核对旧有效性规则和非负整数 level；不能直接用可写根对象、界面缩进层数替换旧业务判断 |
| `xlinks[].file / label` | Wing XLink 提取和 Desk 引用解析/诊断 | 保留源文件属性、空标签与 `null` 差异；源引用和解析后目标分开呈现，不将多个实例合成文件级一条后视为等价 |

以上字段现由文件详情的只读“对象信息”区承载，不新增写模型入口。独立合成样本核对多根、嵌套、重复实例、空属性、数值、材料、局部变换和错误归类；旧真实工程摘要夹具未复制。具体资源边界、正常兼容与批准差异见 M1 回执，不仅迁成功 JSON。

历史 Wing `4aa2a439bce89ca2827d991c650393eae54d85ac` 的 reader 只做 ZIP → `Document.xml` 静态解析，不依赖几何运行时。因此这些旧 DTO 字段原则上可由 TS 补齐，M1.2 不预设 FreeCAD adapter 为依赖，也不恢复/编译历史 Rust。该历史源码尚未与旧 native 二进制构建来源绑定，只能证明实现可行性，不能作为二进制等价验收结果。

正常输入兼容规则与旧缺陷分别冻结：Group 生成 children；roots 是有效 BOM 类型、无 Group 父且非 App::Link；level 为从 roots 广度优先首次到达的深度，未到达节点为 0；Placement 是保存的局部变换，不是世界坐标。Label 缺失回退内部 name，空 Label 不当作缺失；Material 只读字符串，其余为 null。旧解析的实体未解码、错误数值填默认值、未知 Property 吞掉现代 XLink、部分坏 XML 中断后返回等缺陷不照搬；独立回归覆盖完整 XML、有限数值、实体和现代 LinkedObject/XLink，并记录批准的差异。

### 旧入口覆盖清单

旧 `package.json` 冻结 **5 个可见工具、15 个 contributed commands、21 个 command activation 入口**。6 个 block 命令包含 provider 别名，不是另外 6 个业务页面。以下全部命令省略 `ktAutoCad.` 前缀。

| 旧命令或工具 | 目标处理 |
| --- | --- |
| `open`、`block.filename`；`cadFilename` | 文件详情的命名信息，必要时提供选择文件入口 |
| `block.scan`、`scanWorkspace`、`searchWorkspaceIndex`；`cadScan` | CAD 索引、目录检索；A02/A03 |
| `block.read`、`block.provider`、`readFcstdLight`、`readFcstd`、`selectDeskToolsProvider`；`cadRead` | 文件详情，必要时新增只读对象信息区；A04/A08/A14 |
| `block.query`、`queryWorkspaceDatabase`；`cadQuery` | 文件详情引用/装配与 BOM 交付入口；A05/A09 |
| `exportBomTransfer`、`pushBomTransfer`、`retryBomTransfer` | 新 BOM 交付页；A09–A11 |
| `configurePhoenixBom`、`clearPhoenixBomCredentials` | BOM 连接设置/退出登录；A12 |
| `block.diagnostics`、`diagnostics`；`cadDiagnostics` | CAD 诊断与底部日志；A07 |
| `module.show`、`module.hide` | Desk 模块显隐；旧扩展停用时不保留第二套可见性真源 |

## BOM 交付的关键兼容点

1. **producer 身份**：旧生成器/重试解析器和 Phoenix BOM 的 TypeScript/JSON Schema 均硬编码 `kt-auto-cad`。先让接收端允许新的 `phoenix-desk-tools` 身份，同时继续接收旧 v1 包；新包不能冒充旧扩展，旧包重试不能修改 producer、transferId、payloadHash 或重新生成字节。是否增加 schema 版本由接收契约兼容测试决定，不能仅改一个字符串。
2. **确定性与快照**：旧 `transferId` 来自完成扫描的 `scanId`，payload 只按规定字段 canonicalize/hash。先保持整工作空间交付语义；按选中产品导出属于后续扩展，不能改变同一 transferId 的载荷。最新扫描未完成、引用缺失/歧义、循环、资产解析失败或 size/mtime 缺失/变化必须阻断。
3. **Desk 写后状态**：当前属性写入/改名会维护部分索引投影，但不伪造完整扫描的新鲜度。交付预检发现 stale 时提示用户更新索引；不能因为列表看起来正确就提交。预览到写包之间再检查快照，覆盖并发属性写入/改名/重新索引。
4. **审核边界**：prepare/status/commit 继续调用 Phoenix BOM 权威服务。update/restore/conflict 等差异必须使用 Web 审核，409 后查询权威状态；过期计划、已作废、已提交分别处理，不用“重试成功”掩盖待审核。
5. **不可覆盖文件**：继续使用同目录排他临时文件与原子 no-replace 发布。竞争目标、同 ID 不同内容、伪造回执均拒绝，已有内容不变；包先落盘再联网，断网后仍可重试。不能改成先 exists 检查再 rename。
6. **安全连接**：只允许 HTTPS 或本机回环 HTTP；推送/重试前显示工作空间、目标和账号并确认。保留超时、refresh/401、撤销、响应校验与日志脱敏。不能沿用旧扩展仅面向本机测试的登录便利模式去绕过正式认证/验证码。

接收端 producer 兼容必须同步修改 `bom-transfer.ts` 的类型、运行时 guard、归一化返回值和 JSON Schema，使用明确的新旧双值 allowlist，并同步记录显示名；不移除 guard 或开放任意字符串。旧包的版本也不能照搬旧客户端严格等于 0.2.0 的 parser 限制，应按冻结 v1 契约验证并保留原字节。现有 payload hash 只涵盖 parts/boms/attachments，不包含 producer 或工作空间；单独增加 producer 不要求改变 hash 算法。

**已发现的幂等冲突**：接收端 `data-import.ts` 在相同 payloadHash 时返回既有记录，数据库唯一索引也按 hash 全局去重；旧 `bomDelivery.ts` 却要求返回的 transferId 与本地包完全一致。同内容重扫的新 scanId、或新旧 producer 的相同载荷，可在 prepare 后因 ID 不同而失败。M2/M3 必须先补“同 ID 异载荷 / 同载荷异 ID / 跨 producer 相同载荷”回归，再定义本地不可变包与权威记录的明确关联、审核与回执规则；不能直接放松 ID 校验、重写旧包，或把相同 hash 当作另一个目标/账号的授权证明。当前尚未选择修复协议，未改变接收端索引或生产数据。

接收端目前只把 `DataImportInputError` 映射为 HTTP 400，而 envelope 校验抛出独立的 `BomTransferInputError`；真实 HTTP 错误状态尚需验证。M3/M4 固定实际 Admin Host 提交和装配输入，覆盖坏 envelope/未知 producer 的 400、未登录 401、无能力 403、授权 actor 与审核事务。domain 测试、manifest 权限声明或 mock repository 不能替代真实 Host 权限与 PostgreSQL 原子性验收。

## 数据与配置接管

| 数据 | 接管规则 |
| --- | --- |
| `.phoenix/phoenix-workspace.sqlite` | 已共享 Schema v13，不新建第二套 CAD 库。先备份并验证可恢复，再对照扫描、资产、xref/BOM 和人工 PartKey/关联；不自动 reset/升级不兼容库 |
| 索引写入 | 迁移验证阶段保留现状；真实切换窗口明确唯一写入方。不能让旧扩展和 Desk 同时重建同一工作空间索引 |
| `.phoenix/outbox/phoenix-bom-*.json` | 默认原位发现，预览后接管；`.receipt.json`、`.cancelled.json` 原样保留。自选目录导出的包通过用户选择导入，不全盘搜索 |
| 旧包/回执 | 保留旧 schema/producer/hash 和来源，不覆盖同名文件，不把未知/损坏格式当成可提交任务；重试应绑定明确服务器，不能静默转投另一个目标 |
| serverUrl/webUrl/username | 展示候选非秘密设置，由用户确认后写入 Desk 配置；机器路径/地址不进入公开样本或工程 Git |
| 密码、access/refresh token | 不读取或批量导出 VS Code SecretStorage；Desk 重新认证。Tauri/Node 采用宿主安全存储端口；未具备安全存储时只允许会话内使用或保持推送不可用，不退化为 SQLite/localStorage 明文 |
| 扫描、过滤、展开等 UI 状态 | 复用 Desk 的工作空间偏好/Pinia；不是完整搬运 VS Code workspaceState |
| 旧 provider 配置 | 展示不再适用的原因，不尝试执行陈旧机器路径；完成 A08 后不迁移旧二进制选择器 |

Desk SQLite 和 Phoenix BOM 服务端数据库保持分离，只交换版本化领域数据，不把服务端表搬入本地库。切换不删除 CAD 文件、备份、历史改名记录、缩略图或人工资料。

## 目标页面与代码落点

- `cad_index`：继续负责扫描、索引搜索入口和状态，不新建第二个扫描页。
- `file_detail`：继续负责属性、引用、装配和命名；A08 缺失的对象信息以只读区/子页补入，不替换现有编辑表单。
- 新 `bom_delivery`：建议显示名 **BOM 交付**，挂在 CAD 模块。三个可折叠 block 为“预检与导出”“推送与审核”“历史与重试”，header right 提供对应动作；Primary 放目标、范围、进度，错误输出到 bottom block。已有包可直接进入重试，不强制重新扫描或重新生成包。
- 服务建议落在 `server/src/features/cad-bom-delivery/`，UI 落在 `web-ui/src/features/cad-bom-delivery/`，API 预留 `/api/cad/bom-delivery/*`。这是计划名，当前没有占位成功接口。
- 纯导出/校验规则和宿主 IO 分离。先保持可测试的 feature domain；仅有明确公共消费者和版本契约的部分进入 Wing，不为旧扩展即将退役而新增长期共享 UI。
- Phoenix BOM 的 producer guard/schema/contract tests 同批修改；Auto Code 的安装建议、联合启动和 smoke 清理最后执行。跨仓只走公共 API/包，不运行时 import 相邻仓库源码。

上述是允许的 UI 差异：使用 Desk 的导航、Primary/底部日志、文件选择和页面；保留业务字段、默认值、排序、数量、错误分类、确认和取消含义。未核实差异不以“适配新界面”一笔带过。

## 分阶段实施

| 阶段 | 工作与依赖 | 退出条件 |
| --- | --- | --- |
| M0 范围与基线 | 当前计划；冻结 5 个工具/21 个命令、A01–A14、精确提交，列出数据和回滚边界 | 本计划确认；源码金样本固定、候选恢复包保留、构建来源缺口有明确验证路径；实际恢复演练在 M4，不执行停用 |
| M1 已有能力对照 | A01–A08/A13/A14；统一独立样本，比较字段/查询/索引，补检索与对象信息缺口 | 每一项有对应目标测试与业务结果；不靠“有按钮”或总测试数量判完成 |
| M2 本地 BOM 导出 | A09；迁领域规则、快照读取、质量门禁、no-replace、UI 预检；与 BOM 接收端一起兼容 producer | 同输入得到约定 canonical payload/hash；旧新 producer 接收与拒绝分支通过；可离线导出，不要求先登录 |
| M3 联网交付 | A10–A12；安全凭据、目标确认、prepare/status/commit、Web 审核、outbox/回执/重试 | 成功、差异审核、计划过期、断网/重启、重复提交、撤销凭据全链路验证 |
| M4 旧数据接管与发行验收 | 原位 outbox/旧配置、Schema/扫描新鲜度、备份恢复；最终 Registry 依赖和真实安装态 | 历史包与人工数据不丢；真实浏览器/安装态通过；隐私/制品门禁通过 |
| M5 切换与退役 | 清理 Auto Code CAD 专属安装/联调/smoke；停用旧扩展和发布流程；保留恢复入口 | 用户确认切换窗口；Desk 为唯一 CAD 入口/索引写入方；Code 无 CAD 仍正常；观察期后再确认仓库归档 |

优先顺序是 **M1 对照与缺口修补 → M2 可离线导出 → M3 完整交付 → M4 接管与发行 → M5 停用**。M1 的索引安全验收是 M2 的前置；BOM 身份兼容和安全凭据未就绪前不开放推送。不能先卸载旧扩展再补缺失能力。

### M1 可执行批次与验收输入

以下批次是确认后的实施与验收顺序；实际进展和门禁回执另列，不能只凭接口存在报告迁移完成。

| 批次 | 代码与页面落点 | 验收输入与通过条件 |
| --- | --- | --- |
| M1.1 文件资产检索（A03） | `cad_index` / `CadIndexPage.vue`；已新增 `server/src/features/cad-index-search/`，只读查询共享 asset 表 | 六字段分别单独命中；present/missing；同 PartKey 的多个文件；空查询、0 命中、超过 200 条、路径排序、`./` 路径；保持旧单关键词跨字段 OR。读取不创建/升级 DB，不逐行读取模型；工作空间切换后的旧请求不回填新页面 |
| M1.2 完整对象读取（A04/A08） | `file_detail` 的只读对象区；已新增 `server/src/features/cad-object-info/`，复用安全 ZIP/XML 边界和 Wing 公共契约 | 独立样本覆盖全部冻结字段、多根/嵌套/重复实例、空/缺失值、数值和局部变换、现代 XLink、实体、错误/超限/取消；TS 静态解析承载旧业务字段，不把基础 BOM、过滤后的链接树或截图当作完整文档；正常兼容和旧缺陷修复分别记录 |
| M1.3 索引/引用对照（A01/A02/A05/A06） | 现有 `cadIndexScanService`、`pnwBomXrefService`、命名/诊断测试；不重复搭建扫描器 | 同一独立样本的完整扫描、重复数量、入/出向、缺失/歧义/循环、自引用与旧路径格式；验证失败、取消、竞争事务后旧数据和人工关联不变。区分现有“链接行数量”与直接 BOM 数量，逐项记录差异 |
| M1.4 诊断与宿主接点（A07/A13/A14） | `cadIndexStatusService.ts`、`pageHelp.ts`、主页/新手指引、详情/引用提示 | 缺库、Schema 不兼容、损坏、未完成扫描均指向准确可用动作。已由 Desk 承担的索引更新不再要求打开旧扩展；BOM 推送在 M3 完成前保留明确未迁状态。旧 provider 的机制收口必须依赖 A08 字段验收 |

2026-10-11 已按实际能力修正 `pageHelp.ts`、`fcstdBatchAttributes.ts`、`XlinkFixPage.vue`、`PartKeyDetailPage.vue`、`XrefQuerySection.vue`、`FileXrefPanel.vue` 和 `AppShell.vue` 的遗留扫描提示。索引操作指向 Desk 的 CAD 索引；正式 BOM 交付仍明确未迁、旧入口暂时保留，不作全局名称替换后误称可交付。

M1 不以清空数据库来取得对照成功。旧库重建涉及索引、关联和历史，保留独立确认，并在 M4 做备份恢复和现有用户资料保留验收；Schema 不兼容时的说明不能建议无备份覆盖。M1 的局部通过不触发扩展卸载或旧数据删除。

### M1 本轮实现与分层回执（2026-10-11）

实施输入为 Desk `07b89911c425113a78b3cb105c191024334e2306` 加当前未提交工作树；本地 Wing 为 `fix` / `933dfab800ce58c89b7cdc3ed63d3674941e2d2b`，源码 clean。Registry 保持 manifest/lockfile 的精确版本；没有 link、override 或覆盖 node_modules。以下是 dirty 快照的开发证据，不是已提交、已发行或已退役证据。此前缩略图与 Wing 工作空间适配修改保持原归属，没有自动暂存、提交或 push。

本轮新增或修正的能力：

- 文件资产检索：单次参数化 SQLite 六字段 OR，present 文件逐项返回、路径排序、200 项上限；缺库/旧 Schema/读失败明确拒绝，不自动扫描或造内存回退。诊断加载中的空状态不清结果，真实索引版本变化使旧结果失效。
- 只读对象信息：完整对象身份、根/子对象、标量属性、材料、保存的局部 Placement、有效 BOM 标记、level 与源 XLink。每页 50 对象，展开可查看全部字段；切文件/工作空间、取消、失活或晚响应不覆盖当前结果。
- 引用快照：区分边行数、目标文件数、入向宿主与实际 BOM 行；完整扫描保留支持布局的链接实例；2×3 独立样本直接数量 2/3、递归数量 2/6。局部刷新保留旧递归行并新增 stale revision，Primary 与引用提示使用同一返回版本。
- 只读诊断：缺库、旧 Schema、损坏、未完成与局部陈旧状态不触发建库/DDL/重建或 PartKey 投影；帮助入口指向 Desk 索引。真实跨进程缓存溢写曾复现引用查询吞读取错误、返回零引用，现移除错误吞掉的分支；锁/恢复错误上浮，真实缺表仍保留缺失状态。

对象入口的生产边界为 archive 64 MiB、Document.xml 16 MiB、声明解压总量 256 MiB、ZIP 条目/对象各 10,000、XML 节点 150,000、深度 128、完整 JSON 响应 64 MiB、实际请求流 64 KiB。30 秒是协作检查期限，不是同步解压/序列化的硬抢占。未知复杂属性只报告警告；多目标/数组数量布局拒绝，不猜制造数量。已知局部平移和 Z90° 四元数原值有合成回归，但不证明真实几何、单位运行态、世界坐标或旧二进制行为等价。

carry 回执分别落在 `cadLegacyCarry.test.ts`（4 项：过滤/后缀/排序/描述、Windows 引用分类与候选/标签、公开 writer 索引五态读取、不安全宿主无外部读取）、`cadIndexScanCarry.test.ts`（6 项：active/ignored 人工资料与关联、五类排除目录旧资产、4999/5000/5001 边界）、`cadIndexInterop.test.ts`（3 项：真实 child/WASM 写端与 native 读端的提交、回滚和有效 rollback journal 溢写）。后三种互操作是 IPC barrier 控制，不用 sleep 推进事务；验证模型/人工备注不变，读取期间数据库和 journal 字节不变。它们不是统一跨驱动锁协议或崩溃恢复证明。

明确的消费者差异：旧扫描发现恰好 5000 个文件便拒绝，Desk 的既有上限允许 5000、拒绝 5001；旧多根批次与 Desk 单空间事务不作全等价。真实 XML 扫描只投影 FCStd，五态用例单独验证公开 writer→索引→Desk reader，未伪造 ZIP 扫描输出。完整扫描不持久化 candidates，候选顺序在局部引用分析中验证。不安全查询返回显式 missing、刷新拒绝，旧冻结 DTO/错误文案不照搬；查询证明限定只读模式，局部分析保存偏好不能冒充零写入。

隔离浏览器仅使用独立构造的元数据样本和配置：六字段独立命中、零命中、多词保持单一短语、200 上限、从结果打开详情、同版本刷新诊断保留结果；51 对象的第二页、材料/属性/局部变换；局部刷新后 Primary 与引用区显示递归 BOM 待更新。原始截图、数据库和运行日志留在仓库外，不纳入文档或发布包。测试目录同步曾因参数化标题重复失败，已给每个 case 稳定唯一标题并重新同步；没有删除测试或清数据库来绕过约束。

随后页面集成复验发现搜索仅监听最后成功扫描时间，局部刷新后的真实 stale revision 未清结果。已改为诊断返回实际 `latestScan.id`，页面由确认状态、Schema、计数和扫描 ID/状态/元数据生成稳定版本；loading 不发明新版本。同版本保留、局部更新/完整扫描/显式清理清旧结果及晚响应拒绝，新增 Server 1 项、Web 6 项回归。旧 Server 无 ID 时仅按元数据兼容，不能证明同时间同元数据的不同写入。

最终受控重启使用公共 `pnpm wing`，独立端口和仓库外合成工作空间；已核对 Web/Server PID、PGID、cwd、LOCAL 日志、Wing clean/commit、源码 SHA 与实际 Vite 模块、API 返回，未沿用中途重建/HMR 的旧版本证据。测试目录重新同步为 223 模块/1,538 用例；页面完整扫描 203 个合成文件至 100% 后清旧结果，重新搜索后同版诊断刷新保留；文件详情局部刷新后实际新 scan ID 为 stale，回到索引刷新诊断清旧结果且显示陈旧提示。稳定启动后的页面日志未记录 warn/error。扫描期间的已完成卡片描述最近一次完整扫描，不冒充随后局部陈旧状态已解除。临时页面和自建服务在点检结束后关闭，原始证明留在仓库外。

本轮完整消费端门禁（本节固定 HEAD＋dirty 输入，不计作发布证明）：

| 命令 | 结果 |
| --- | --- |
| `pnpm test:local-wing` | 通过；Server 92 文件/655 项、CAA 11 文件/67 项、Web 120 文件/816 项，共 1,538 项；双端类型检查通过 |
| `pnpm test:registry && pnpm typecheck` | 通过；同样 1,538 项，Registry 双端类型检查通过 |
| `pnpm build:local-wing && pnpm build:registry` | 通过；两种真源的 Web 与 Server bundle 均构建成功 |
| `pnpm verify:wing-dependencies` | 通过；7 个 Wing 包保持精确 Registry 版本，无本地 override |
| `pnpm verify:architecture` | 通过；435 个源码文件、5 个 pure graph、1 个 view root |
| `pnpm docs:check`、`git diff --check` | 通过；159 个文档分类及当前链接有效，无空白错误 |

现有 Node SQLite experimental、Registry 包 source map 源文件缺失和 Web 大 chunk 警告仍存在，不宣称零警告。本轮未新增依赖、未升级包版本；构建通过不代表发行包、安装态或退役门禁已完成。

隐私回执只覆盖本轮新增源码/独立夹具及计划、TODO 增量：没有以个人工程清单、装配结构或几何为公开样本，没有个人绝对路径、原始截图/日志或凭据进入这组源码。运行失败日志可能含本机或临时路径；最终压缩提交、Git 历史、实际发布包、source map 和隐藏缓存仍须在 M4 重新审查，不能把本条当作最终可发布证明。

完整 M1 仍未勾选：原轻量读取 `documentXmlBytes` 没有同形展示，旧轻量 XML 32 MiB 与新对象 16 MiB 的边界不同；没有证明真实 HTTP 断连取消、跨操作系统安装态、native/WASM 提交穿插于多语句读取、WAL/崩溃/多写端安全，也未完成模块显隐→树选文件→详情→取消/切空间的完整挂载 E2E。字段承接、目标回归与宿主差异分别记录，不能用总测试数替代这些退出条件。

以上是 2026-10-11 的未通过清单；后续已补项与明确拒绝范围见下方 2026-10-12 继续实施回执，不能继续把已验项列为当前缺口，也不能将拒绝不支持布局说成支持了该布局。

### 2026-10-12 本地归档复核

用户要求整理本地未归档内容并检查隐私，同时确认图册尺寸与排版已完成。归档输入为 Desk `07b89911c425113a78b3cb105c191024334e2306` 加本轮已确认归属的工作树，Wing 固定为 clean 的 `fix` / `933dfab800ce58c89b7cdc3ed63d3674941e2d2b`。本轮不升级版本或精确 Registry 依赖，不修改旧扩展或 BOM 接收仓，不推送、发布、卸载或操作生产数据。

归档同时保留独立完成的名称推荐/原生 Assembly 写入、Wing 工作空间兼容、单件缩略图与图册尺寸增量；它们不计为 A09–A12 已迁。索引增加明确的部分可用模式：单文件解析失败不阻塞正常资产和图册，失败资产保留人工资料并标记 error，BOM 仍不完整；目录完整性、源变化、取消、Schema 或竞争问题仍中止事务。TechDraw 多目标源引用只承担依赖关系，不猜物理实例数量；真正未支持的 Link-array 数量仍拒绝。

归档检查发现并修正单件缩略图 native-open 依赖预检遗漏：与尺寸读取共用严格 XLink 解析，不静默过滤非 FCStd 或含 `>` 的依赖，歧义结构拒绝；15 个独立合成回归证明拒绝时不调用 MCP、不渲染、不写 CAD。普通图册发现与已验收排版未改变。这不是恶意 CAD/插件执行沙箱或断电级耐久保证。

隐私检查覆盖待归档文本、夹具语义与当前跟踪树，并辅助扫描 Web/Server 构建输出：新增样本为最小 XML/SQLite/事务图、不透明合成字节和一像素 PNG，没有采用私人工程清单、几何、截图、映射表或个人绝对路径。原始日志与合成点检产物留在仓库外，内部运行缓存、构建和报告不入提交。最终压缩历史、实际发行包、安装态与旧凭据撤销/轮换仍按 M4 和产品 TODO 复核；本条不表示全历史可公开或可发布。

LOCAL 全量测试与构建通过原有 resolver 环境运行 `test:local-wing-consumers` / `build:local-wing-consumers`，消费本轮 `pnpm wing` 的固定 Wing 输入，不在该全量命令中再次重建共享制品。专项包装命令曾重建同一 clean Wing 源码并触发 Server watch 重启，随后重新核对 LOCAL 启动日志与 Web/API 就绪状态，未沿用重启前的进程证明。Registry 消费仍使用公开包装命令；最终两种构建按顺序复验，避免混写公共输出目录。

| 本轮最终门禁 | 结果 |
| --- | --- |
| Registry 全量消费测试、双端 typecheck | Server 101 文件 / 886 项、CAA 11 / 67、Web 125 / 861，共 1,814 项通过；初次复验发现旧布局断言未同步，保留首个 Primary 进度契约并加入 partial warning 后重跑全过 |
| LOCAL 全量消费测试、双端 typecheck | 同样 1,814 项通过；使用上文固定 resolver 输入，不将旧回执计作本轮执行 |
| Registry / LOCAL 顺序构建 | Web 与 Server bundle 全部通过；SQLite experimental、sourcemap 和 chunk 等既有警告保留，不称零警告 |
| 缩略图与尺寸专项 | 两种真源各 6 文件 / 140 项通过；15 个新依赖预检用例已包含在全量数量内 |
| Python 保存偏好 / Node API 发现 | 14 / 4 项通过，单独计数，不重复计入消费端总量 |
| 文档、架构、依赖和空白 | 159 份文档、444 个源码文件 / 5 个 pure graph / 1 个 view root、7 个精确 Registry 依赖检查及 diff check 通过 |

本节保留阶段归档与完整迁移的区别。上节的 M1 剩余项、M2/M3 接收契约和安全凭据、M4 安装恢复及 M5 最终授权均未因此勾选。

### 2026-10-12 继续实施：M1 收口与 M2.1 领域预备

本轮输入为 Desk `bdd4d7d6b4e4e25297f89b338c0d3f5cbe73a224` 加本任务工作树，Wing 仍是 clean 的 `fix` / `933dfab800ce58c89b7cdc3ed63d3674941e2d2b`；Auto CAD 与 BOM 接收端只读基线未变。未改版本、manifest/lockfile、依赖目录或旧扩展；没有推送、发布、登录 BOM 或操作个人 CAD 数据。

M1 本轮补齐：

- 轻量字节信息以 `source.document_xml_bytes` 承接：统计提取后、解析前的原始 UTF-8 `Document.xml` 字节，包含保存的 BOM；与压缩文件大小和字符数分开。stored/deflate、多字节/BOM、非法响应字段与页面展示有 10 项新增独立回归。完整对象读取保持 16 MiB，不静默增加放大预算；旧轻量分析 32 MiB 的资源差异仍明确保留，未宣称旧 analysis DTO 同形兼容。
- 真实 Node HTTP 断连覆盖完整上传后等待、读取完成后晚响应、未完成上传、正常结束与内存 Request：7 项新增回归证明断连信号可达 reader，已断开的响应不再写头/正文/错误，正常请求不误取消。30 秒仍是协作预算，不是同步计算的硬抢占。
- 完整浏览器验收发现 Vite 代理未转发“POST 已上传完、响应仍在等”的断连；修正四个既有 API 代理的 premature-close 转发，新增 3 项真实 Vite→HTTP 回归。隔离挂载页面验证 CAD 模块隐藏/恢复、树选文件、完整对象读取、主动取消、关闭页面并切工作空间；两个取消均到达实际 Node adapter，新空间显示其独立对象而非晚到旧结果。为确定性控制取消，隔离 Server 只对预先指定的下一次对象请求加等待闸门；不能据此宣称同步解析可抢占。首次测试端口未配置到 Origin allowlist 的失败属于测试配置错误，修正测试配置后重验，未放宽产品安全规则。
- 跨驱动用例先稳定复现“旧引用 + 新扫描号”。新增 Host read lease 复用冻结旧宿主的同一 WASM `.lock` 原语，并持有单连接 native `BEGIN`；搜索诊断/结果、状态/扫描信息以及详情双向引用不再跨连接拼接。真实 WASM 子进程在各读取中间提交被 busy 拒绝，释放后提交成功；独立 native rollback writer 同样被 OS 读锁拒绝。原两次读取的 carry 断言已改为同一事务内阻止更新、释放后完整看到下一版本，不删除风险验证。

这个读取层只支持正常 `delete` rollback 布局。WAL 主库头或 `-wal/-shm` 在 native open 前拒绝，避免所谓只读 open 自己生成旁路文件；忙锁不回收，锁归属改变不删除，native close 失败保留 lease，双重错误聚合。业务只读会临时创建自有 sidecar 目录，**不等于文件系统零写**。WASM/WAL、绕过协议的写入者、杀进程后的陈旧锁恢复及跨 OS 安装态仍未证明，不用 native-only WAL 成功冒充混驱动支持。

M2.1 当前仅新增 `cad-bom-delivery/envelope.ts` 纯领域边界及 127 项独立测试：允许明确的 `phoenix-desk-tools` / `kt-auto-cad` 双值，保持接收端 v1 字段、trim、排序、数量、引用存在性和 payload hash；producer version 不锁死旧 0.2.0。历史导入保留原始 UTF-8 字节、格式、BOM/CRLF、producer、transferId/hash，并通过防御复制禁止调用方改写。另用 24 组独立输入对照固定 BOM 实现，规范化 payload 与 hash 一致。

明确更严的导入资源规则为原始文本/pre-trim 对象 8 MiB、重复 JSON key 拒绝、32 层深度与循环对象拒绝；接收端只限制规范化后的 envelope，不能描述为无差异。历史 `workspace.scanId` 保持 opaque v1 语义；新生成器须另检 UUID 与 transferId 绑定，源 BOM 图循环等质量门禁也不由 envelope guard 代替。

接收端 `ff19610aa0d16c6643281d6ddf0419df19f009b7` 仍只接受旧 producer，尚未适配类型/guard/Schema/来源显示。当前没有 source builder、文件导出、API/UI 或推送；A09–A12 和整体 M2 不勾选。M2.2 已确认直接实例数量须读 xref `detail_json.quantity`，不是对已经合并的每行 `+1`，也不是递归 BOM 行数量；TechDraw `drawing_source/basic_bom=false` 只算依赖。部分可用、局部 stale、失败资产、旧元数据、引用质量和完整 inventory 必须在新生成器独立阻断。

本轮最终门禁（固定 HEAD＋本任务 dirty 输入，不是发行/退役证明）：

| 门禁 | 实测结果 |
| --- | --- |
| Registry 完整消费测试 | Server 105 文件 / 1,046 项、CAA 11 / 67、Web 126 / 872，共 242 文件 / 1,985 项通过。首轮仅旧两连接快照 carry 失败；保留风险并改为更强的单事务验证后完整重跑通过，没有删测试/清库绕过 |
| LOCAL 完整消费测试 | 同样 1,985 项通过；固定 resolver 环境调用 `test:local-wing-consumers`，不通过包装命令再次重建 Wing；LOCAL 双端类型门禁包含在其中 |
| 类型与顺序构建 | Registry 双端 typecheck 通过；代理配置及其测试额外 strict tsc 通过。Registry 后 LOCAL 的 Web/Server bundle 均成功，SQLite experimental、sourcemap/chunk 等既有警告保留 |
| 边界与文档 | 446 个源码文件 / 5 个 pure graph / 1 个 view root、7 个精确 Registry 包、159 份文档分类/链接及 diff check 均通过；测试目录 242 模块 / 1,985 用例，重复 ID 和加载错误为 0 |

本轮一个专项曾误经 LOCAL wrapper 重建同一 clean Wing，触发开发 watch 重启；最终完整测试/构建采用已固定的 LOCAL resolver 输入并重验，未冒用旧进程证明。当前原 Web/API 服务已再次确认就绪，临时页面与自建服务均已关闭。

隐私复核覆盖本任务文本/夹具语义与当前 Web/Server 构建输出，未把个人工程、机器路径、凭据或原始证明纳入这组归档。原始合成工作空间、截图、数据库、等待闸门和日志均留在仓库外；目标夹具是最小元数据/事务样本，不复刻个人工程。最终压缩历史、发行包、安装恢复和凭据撤销仍属于 M4，不能用本轮增量审查代替。

### 2026-10-12 继续实施：M2.2 后端快照与离线发布

本批输入为 Desk `a9ad8a5f802dc7f0f123ef4cf819ce068dfa8907` 加本任务增量；Wing 和两个只读旧端仍保持上节固定提交。迁移技能的锁定基线、分层验收和原子不覆盖约束用于本批实施；不修改依赖、旧扩展、BOM 接收端或个人 CAD，不推送、不发布。

后端分为 `source.ts`、`snapshot.ts` 和 `export.ts`：直接数量读取完整扫描 xref 的 `detail_json.quantity`，按目标 PartKey 合并，不对已合并引用逐行 `+1`，也不采用递归 BOM 数量。图纸源引用必须明确为 `drawing_source/basic_bom=false` 且无 quantity；依赖仍须解析一致，不能因不计制造数量而忽略断链。检查最新扫描、Schema/协议、统计、资产与目标身份、字段冲突、物理路径和 PartKey 循环；partial、stale、失败文件和旧元数据均不能生成交付包。名称保持旧导出的 PartName→label→零件号回退，不扩张批量改名的单字母禁用规则。

完整扫描在同一提交事务内追加 `bom_json.source_sha256`（整个 FCStd 原字节的 SHA-256）和 `document_role`，不改 Schema v13 或 Wing 公共 writer 契约。角色复用既有静态对象类型与独立 TechDraw 判断，不按文件后缀猜测，也不是运行态几何/任意自定义插件证明。旧索引仍可浏览；交付前必须完整重扫取得这些证明，不能从旧 size/mtime 数据静默补出“可信”内容指纹。失败文件不获得可信证明。

准备与复核各持有一次 native 读事务和同一 WASM Host lease。只收集当前扫描范围的 FCStd 资产及引用，不把历史 missing/ignored 或其他模块资产放进制造清单；源根目录、数据库 inode、扫描代、原始行摘要、实际文件清单与内容指纹一起绑定。预览只由服务端 WeakMap 登记，字节防御复制；伪造的预览或工作空间变动不能交付。发布前重读全部证明，最后同步检查文件及目录清单；物理文件被外部程序在最终检查之后修改的极窄竞争仍不能由 SQLite 锁消除，不声称文件系统全局原子快照或恶意路径重命名沙箱。

离线发布只使用调用方明确选定的绝对目标，不推断外部目录。先在同目录以 `wx`/0600 写临时文件并同步，最终以 hard link 原子 no-replace；已有目标只有原字节相同、身份未变且完整源复核仍通过才返回 existing，格式不同也拒绝。只清理自身 inode 的临时文件。目录同步、lease 关闭或清理在发布后失败时保留明确的已发布回执和警告，不把已落盘误报为未发布；不宣称断电级耐久。测试 hook 仅服务端注入，不能来自请求字段。

资源门禁与旧实现的差异独立列示：沿用发现范围的 5,000 FCStd / 20,000 目录项及单文件 64 MiB；当前引用至多 100,000 行，原始 SQL 文本投影和语义指纹分别累计至多 64 MiB，单项元数据 JSON 和最终包分别至多 8 MiB。目录预检改为有界迭代读取；其后的共享发现器仍有整目录读取，外部程序持续大量加文件时不宣称严格的全流程堆内存沙箱。纯 builder 接受可信类型输入，不作为未知大对象的内存隔离入口。高引用量但聚合包很小也可能因源预算而拒绝，不能把这些限制描述为与旧无限源读取等价。历史 envelope 导入的原字节/ID/producer 规则保持上节不变。

本批最终门禁如下，输入为上述固定提交加本任务增量。LOCAL 直接使用已构建的固定 Wing resolver，不为测试重建 Wing 或打断现有联调进程；Registry 使用 manifest/lockfile 精确包。

| 门禁 | 结果 |
| --- | --- |
| Registry / LOCAL 消费端完整回归 | 各 2,186 项：Server 1,247、CAA 67、Web 872，全部通过 |
| Registry / LOCAL 类型与构建 | 双端类型、Web 与 Server bundle 全部通过 |
| 单测目录注册 | 245 模块 / 2,186 用例，重复 ID 0、加载错误 0 |
| 架构 / 依赖 / 文档 | 449 源文件边界、7 个 Registry 精确 Wing 依赖、159 篇文档链接与 diff 空白检查通过 |
| 本批增量隐私与联调 | 独立最小合成夹具，无个人工程/路径/截图/日志入库；Wing 固定提交未变且 clean，现有 Web/API 返回 200 |

本批只有后端函数与独立合成回归，没有注册导出 API、可点击页面或目标文件选择器；接收端仍只接受旧 producer。A09 和整体 M2 尚未完成，下一批接入安全的预览/导出交互及接收契约，旧系统不因此停用。增量隐私审查不替代 M4 最终压缩历史、实际发行包和安装恢复门禁；本轮不发布、不推送。

### 2026-10-12 继续实施：M2.3 离线交付入口

本批输入为 Desk `d4ced8bf1007d808a0aedf3b309c33e5977aafe3` 加本任务增量；Wing `fix` / `933dfab800ce58c89b7cdc3ed63d3674941e2d2b`、Auto CAD `96b6a846b49fc0f29fc1f3da017cb055cedafafc` 和 BOM `ff19610aa0d16c6643281d6ddf0419df19f009b7` 保持 clean。旧端只读，不修改精确 Registry 依赖、lockfile、Wing 构建目录或个人 CAD 数据，不推送、不发布、不提前停用旧系统。

`bom_delivery` 是 CAD 的独立“交付”入口，不混入批量属性或零件目录；页面、Primary 和三个可折叠 Block 的头部提供相应 action。仅“预检与导出”可用，“推送与审核”“历史与重试”明确迁移中且禁用，无伪成功端点或记录。进入页面不自动扫描、预览、建目录或联网；明确预检整个工作空间，零件/BOM/直接行各以 50 项分页浏览，分页不改变交付载荷。直接 qty 与图纸依赖的规则继续由服务端领域层负责，前端不重建包或 hash。

真实挂载为 `POST /api/cad/bom-delivery/preview`、`export`、`release`。严格 UTF-8 JSON、已知字段和 16 KiB 请求上限；服务端从 manifest 读取生产者版本，不接受客户端 envelope/字节/证明或测试 hook。私有根目录与 proof 留在服务端；随机预览句柄绑定规范工作空间，含准备中预约总计最多 4 项、有效期十分钟、同时仅一个预检/导出。繁忙、过期/服务重启、工作空间不匹配、失效源和冲突均明确拒绝，不排无限请求队列，也不自动重新预览后写入。

权限口径为本机 Origin 拦截、显式工作空间绑定和用户确认，不是 Admin 登录/RBAC 或多用户文件系统沙箱。空 Origin 继续允许已有可信本机工具；工作空间绑定不等于 launcher 当前空间授权器。浏览器本身另以活动 Tab/工作空间代际取消请求、释放预览并忽略晚响应。Node 预览响应完成前的断连会释放已生成的句柄，正常完成后旧请求的取消不能中断新导出；响应 finish 后客户端仍可能遗失句柄，最多受 4 项/十分钟约束，不清空其他 Tab 来隐藏该残余。

导出必须明确目标并再次确认，默认选择“取消”。默认 canonical `.phoenix/outbox` 可改安全 basename，仅有效源复核且 confirmed 后单级创建该目录；自选其他父目录必须已存在，不递归创建，不跟随默认父目录 symlink。旧流程在 SaveDialog 前创建 outbox，新流程把该写入移到确认后，属于明确安全差异。原子 no-replace、0600 文件、原字节 existing 重试、发布后警告回执沿用 M2.2；新生成包采用 canonical JSON 无末尾 LF，历史导入包原字节仍保留。导出取消/失联不保证撤回已发布文件，页面明确“结果未确认，请核对原目标”，不同上下文的晚成功只追加可追溯日志，不覆盖新页状态。

PageSession 仅保存该工作空间的输出目标/目录和折叠状态，恢复时消费本 Tab 快照，不保存预览句柄、envelope 或回执，也不自动调用交付接口。错误与警告自动激活 Output；真实点检发现旧 `log_panel_open` 与 Wing 新 visibility 不一致，现由 Desk 宿主显式恢复 Bottom，保留其它 Block、尺寸、配色和显示偏好。相同主错误/原因去重，不吞掉不同原因。

本批最终源码门禁如下。Registry 的 Server/CAA 串行全量通过后，配置恢复补丁再跑完整 Web；LOCAL 串行完整消费端包含该最终补丁。首次并行跑两套大型扫描回归时，原有 4,999/5,000/5,001 与命名有界耗时用例出现资源竞争超时；没有删用例或提高时间阈值，改为串行后原门禁全部通过。最终 Web 在沙箱内另遇到现有 loopback 监听 EPERM，获准监听本机后完整重跑通过，不绕过该代理断连测试。

| 门禁 | 最终结果 |
| --- | --- |
| Registry / LOCAL 消费端回归 | 各 2,317 项：Server 111 文件 / 1,313 项、CAA 11 / 67、Web 129 / 937；较 M2.2 增加 131 项，未删旧用例 |
| 功能与真实挂载 | Service / routes 61 项、真实完整 App＋Node HTTP 5 项、Web API/controller/实际 SFC 挂载 60 项；均包含于上行，不重复累计 |
| Registry / LOCAL 类型与生产构建 | 双端类型、Web 与 Server bundle 全部通过；LOCAL 复用固定已构建 Wing resolver，未重建 Wing |
| 单测目录注册 | 251 模块 / 2,317 用例，重复 ID 0、加载错误 0 |
| 架构 / 依赖 / 文档 | 456 源文件边界、7 个精确 Registry Wing 依赖、159 篇文档及 diff 空白检查通过 |
| 本批代码与增量隐私 | 13 个新增文件、1,493 物理行，其中运行时代码 640 行、独立测试/支持 853 行；另有宿主接线与文档修改。内容审读与实际 LOCAL Web/Server 输出检查未发现新增个人工程、机器路径或凭据 |

真实隔离浏览器从 CAD Ribbon 进入页面，确认没有自动预览/目录写入；显式预检得到两个独立合成零件、一项直接 BOM 和一条数量为 3 的直接行。确认框默认取消，取消后无 outbox；确认导出产生 980 字节 JSON，同有效预览再导出得到 exact-byte existing。外部改变合成源后拒绝导出且目标不存在；原本隐藏的 Bottom 自动显示唯一主原因。实际刷新保留自选路径与 Block 展开状态，但没有恢复句柄、载荷、回执或发起交付请求；实际重启隔离 API 后旧预览返回 410，确认导出禁用，目标没有产生。OS 目录选择器和跨工作空间晚响应在本批为 controller/边界回归，不冒称已经逐项完成原生 UI 验收。

同固定 Wing / LOCAL 构建规则，M2.2 已提交输入的 Web dist 为 80 文件、raw 2,433,379 / gzip 760,862 字节，本批为 82 文件、raw 2,461,737 / gzip 771,104：增量 raw 28,358 / gzip 10,242。Server 单 bundle 从 raw 1,619,307 / gzip 456,259 到 raw 1,694,803 / gzip 474,599：增量 raw 75,496 / gzip 18,340。未生成 Brotli；这是生产 dist 增量，不是 npm/安装/业务模块发行包体积。实际页面 chunk 和 Server bundle 的原始字节已核对，原有用户联调 Web/API 仍返回 200。

本地浏览器点检用独立合成工程及其截图、映射和原始日志仅留仓外临时目录；提交内单测夹具也独立构造，不复刻个人工程。浏览器宿主保存页面/显示偏好可能写工作空间配置，不能据整个 SQLite 文件字节变化误判 BOM 导出修改了 CAD 索引；无 UI 的真实 mounted API 回归另验证 CAD/DB 原字节不变。增量隐私检查不能替代 M4 最终压缩历史、实际发行包与安装恢复。接收端仍只接受旧 producer，整体 M2 和 A09 尚未退出，下一批需确认 BOM 仓库写入权限与实际 Admin Host 基线后接入接收契约。

### 2026-10-12 继续实施：M1 独立轻量摘要与读取预算

本批输入为 Desk `822683e76e07f487b0899e2ce8e46e2d9d3048d5` 加本任务增量；固定 Wing、旧 Auto CAD 和 BOM 只读输入不变。Registry 精确依赖、lockfile 与 node_modules 未改，不重建 Wing，不启动 FreeCAD、不读取个人 CAD 工程、不联网交付。接收端授权仍待确认，本批不借继续目标扩大跨仓写入范围。

`file_detail` 的“对象信息”新增“轻量摘要”，默认完整对象行为不变；轻量必须点击重新读取，不在进页、切模式或换空间时自动解析。独立 `POST /api/cad/light-info` 不依赖索引、DB 或 native provider，继续消费 Wing `pnwAnalyzeCadIndexDocumentXml` 的对象计数、按源路径去重 XLink 和六个内嵌字段；原始 `documentXmlBytes` 统计提取后、解析前 UTF-8 字节（含 BOM），与压缩大小、字符数及完整对象引用数分开。每页 50 条仅是展示分页，不截断服务结果；即时解析/缺失/自身/歧义分类来自当前安全磁盘清单，不写索引，也不冒称物理实例或 BOM 数量。

轻量和只读索引使用独立 32 MiB XML 配置；完整对象和既有批量写入 helper 仍保持 16 MiB，不静默扩容。64 MiB 容器、256 MiB 声明总量、10,000 ZIP 条目、20,000 目录项/5,000 FCStd 和累计响应预算明确拒绝，目录采用有界流式发现。索引只替换读取配置，原实例数量与图纸依赖角色算法未改；单个损坏/超限文件仍写 error，健康文件可建立部分索引，目录完整性/源变化/取消仍整体中止。

资源预检先验证 ZIP 目录与压缩数据跨度，再以“声明长度＋1”上限证明 deflate 的实际长度，最后提取并验证 CRC 与 UTF-8。独立假长度＋前缀 CRC 回归防止解压器静默截断后误认完整；FIFO 以非阻塞打开并拒绝非普通文件，读取和关闭同时失败保留 AggregateError，HTTP 只输出安全主错误码。最终结果复核所选模型身份/哈希、目录清单与根身份；诊断超额即停止，不先分配整个候选乘积。

两项相对旧端的受控差异明确保留：大小写匹配先精确路径，只有唯一折叠候选才可直接解析，不能任意选择大小写冲突；旧轻量 regex 对引号内原始 `>` 会漏报，当前结构校验后明确拒绝并提示完整对象，不返回部分摘要，注释、CDATA 和 `&gt;` 正常支持。工作空间外文件仍拒绝，未恢复旧受控单文件许可。30 秒是合作式期限，同步 inflate/XML 不是硬实时可抢占操作；本批不宣称全部完整/写入 reader 已获得上述长度保护，既有路径的统一解压审计仍需单列。

常规 BOM/根对象读取失败时，页面保留真正的只读摘要入口，不构造可写 BomPreview，属性写入和改名均不出现/禁用。请求捕获原工作空间，切空间、换文件、隐藏或卸载会取消并丢弃晚响应，同时清除旧表单、缩略图路径与引用/装配缓存。轻量错误或诊断警告自动激活 Bottom；共享日志仅放错误码和汇总，不复制原始机器路径/载荷。

| 门禁 | 最终结果 |
| --- | --- |
| Registry / LOCAL 全量消费端 | 各 2,447 项：Server 117 文件 / 1,365 项、CAA 11 / 67、Web 135 / 1,015；较上一批增加 130 项，未删旧用例。Server/CAA 全量后，入口隐私收口再完整复跑双 Web |
| 新增回归组成 | 后端 52 项（含真实 mounted API 与 Node HTTP 3 项）、Web 78 项（API、controller、实际父页面 SFC、模式挂载与入口隐私）；包含于总量，不重复累计 |
| 类型 / 构建 | Registry / LOCAL Server 与 Web 类型、Web 与 Server bundle 均通过；LOCAL 仅固定 resolver，未构建或覆盖 Wing |
| 单测注册 / 架构 / 依赖 / 文档 | 263 模块 / 2,447 用例，重复 ID 0、加载错误 0；463 源文件边界、7 个精确 Registry Wing 包、159 篇文档与 diff 空白检查通过 |

真实独立浏览器验证：完整对象显示 5 条保存的 XLink，轻量按源路径去重为 4 条，解析/缺失/歧义/自身明确区分；歧义目标标“建议匹配（未解析）”。17 MiB 合成 XML 被完整对象预算拒绝，手动轻量可正常显示原始字节与字段。两个独立原生装配根令常规属性读取失败，仍可手动得到两个对象的只读摘要，未产生写入目标。损坏容器触发轻量错误时，原先关闭的 Bottom 自动打开并显示主错误码。8 个合成 CAD 输入 SHA-256 前后不变；无 UI 的真实 mounted/HTTP 测试另证明没有建 DB/outbox。浏览器宿主保存偏好可能写配置，不能据此宣称整个 UI 工作空间文件系统零写。

实际产物审查发现既存入口会加载第三方远程 capture 脚本；从源码移除并新增只允许本地应用 module 的入口契约，重新完整复跑 Web 与双真源构建，不手改 dist。该发现不证明已经发生数据外传，也不能因其属于旧提交就豁免发布检查。其余新增夹具均独立构造，未复制个人清单/编号/结构/几何。截图、合成输入与日志留仓外；增量复核不能替代 M4 最终压缩历史、实际发行包和安装恢复。

代码增量为 28 文件，其中新增 19 个（运行 6、独立测试 12、support 1）；物理行增加 1,595、减少 22，净增 1,573，新增文件共 1,400 行。代码净增中运行 543、测试 1,021、support 9；另有两篇原文档回执。复用 Wing 分析/匹配与既有 Host 预算/路由/只读对象区，不复制旧业务解析器。最终 LOCAL Web dist 82 文件、raw 2,472,538 / gzip 774,046 字节，Server bundle raw 1,713,828 / gzip 478,619；较上一批分别增加 raw 10,801 / gzip 2,942 与 raw 19,025 / gzip 4,020。gzip 是逐文件 Node 默认 level 6 后合计，未生成 Brotli；不是 npm/native 安装包体积。实际产物只有应用 css/html/js/svg 与 Server bundle，入口仅本地 module，无远程 capture、CAD/库/日志/测试夹具或 source map 附件。本批内容审读与实际增量产物复核无未解决隐私项，不代表历史/最终发行审查完成；Node SQLite experimental、依赖 source map 和 Web 大 chunk 警告仍保留。

原用户 `pnpm wing` Web/API 保持运行并返回 200。同步解析硬中断、受控外部单文件、WASM/WAL/崩溃恢复及安装态 carry 尚未退出；M1、M2–M5 不整体勾选，本次不是发布或退役完成。

### M4 恢复输入的只读复核

本批只复核，没有运行整库删除、恢复覆盖、旧扩展安装或打包。旧 Auto CAD VSIX 内容/哈希校验仍通过，但缺精确 clean 构建来源与真实隔离安装/索引/交付恢复证据；Auto Code 固定金样本与后来本地候选分别记录，不能用本地 Wing 候选冒充 Registry 恢复包。离线缓存存在不等于全部字节校验与离线安装成功，开发路径 Host smoke 也不等于实际 VSIX 安装旅程。

该复核确定的下一项是封住 recreate 的 main/WAL/SHM 删除路径；前端确认不能替代恢复证明。索引 reset 局部备份不是包含所有 Schema v13/人工字段/未知表、outbox 与回执的完整恢复。WAL 自动转 DELETE 的现有初始化器不得用于只读恢复审查。

### M4.1 数据库与 outbox 隔离恢复

本批在固定 Desk 基线的独立工作树实施，不修改旧端或个人模型。`recreatePhoenixDatabase` 与现有 POST 兼容入口一律拒绝（409），忽略客户端伪造的 confirmed/backup/proof；网页只提示兼容核对与原位重建禁用。备份包也不授予原位覆盖、删除或自动迁移权限。

新增受控开发命令，参数见 [Server 命令说明](../../server/scripts/README.md#workspace-recoveryts开发验证命令)：当前主数据库原始全字节、所有 opaque outbox 文件（包括隐藏文件和空目录）做完整清单/大小/SHA-256 与 SQLite integrity_check 验证。未知表、人工字段、索引、触发器与未知 schema 原样保留；不按文件名猜回执完成状态。仅支持当前数据库，不初始化 missing/legacy-only 库，也不转换 WAL。该包不收录工作空间模型/缩略图目录、其他偏好文件或遗留数据库，outbox 内文件仍按 opaque 数据原样保留；不是整工程归档，原有私人内容仍在数据库/outbox 内，包须留在本地受保护位置。

备份/恢复都只能排他建立新目录，每文件排他写入；拒绝符号链接、FIFO、路径遍历、重叠源/目标、既有目标、额外文件/空目录、篡改与超限。完成 marker 最后 no-replace 发布，目录自身不是原子发布；缺 marker 的未完成目录不能视为成功。失败不递归删除未知竞争目标，可能保留已确认属于本次的未完成目录。发布后关闭/清理/目录同步失败以 warnings 报告，不能谎称已完成内容未落盘。

数据库持有同一次混合驱动 lease 与 native 读事务至发布，终检 source/package/target 清单、内容和 lease 身份。outbox 或直接文件写者没有共同锁，只能检测观测到的变化，不承诺跨资源原子快照、持续恶意祖先替换防护或断电耐久性。读端会产生临时 lease sidecar，不是文件系统零写。固定预算为主库 128 MiB、outbox 64 MiB、总数据 192 MiB、4096 文件/目录、8192 目录项、32 层路径、24 MiB manifest。

恢复只写新隔离目录，校验后不切换工作空间、不激活、不重建索引。清单/SHA-256 仅证明包自洽，不是来源签名；Windows 设备名、ADS、尾点/空格等不安全名称整次拒绝，不静默漏备份。manifest 在 JSON.parse 前限制深度、项数和字符串长度。命令当前走源码 `tsx`，不是 Tauri 已打包恢复 UI。本批不等于 M4 完成：恢复页面/安装制品、legacy/WAL 受控迁移、真实 Host/VSIX 安装与数据切换、跨 OS/崩溃恢复和最终隐私/历史范围仍须独立验收；未停用旧扩展。

验收回执（2026-10-12）：Desk 输入固定 `7e17d435`，最终冻结源码在 Registry / 当前 LOCAL 各通过 2,537 项（Server 1,452、CAA 67、Web 1,018），双端类型与 Web/Server 构建通过；464 个源码文件的分层检查、7 包 Registry 精确版本边界及差异检查通过。恢复引擎 71 项涵盖真实 Wing v13 WASM DDL、未知 schema/表/人工字段/BLOB 的整库字节相等、opaque/隐藏/空目录、精确目录项上限、lease 替换、取消、竞争、篡改与发布后 warnings；开发 CLI 的真实子进程备份→检查→新目录恢复也验证原字节及既有目标拒绝。网页只做 SFC 安全契约测试，不冒充真实安装版恢复旅程。

本地 Wing 验收输入最终为 `37405a39`；首次 LOCAL 没有重建公开 dist，不记作最新源码通过。最终采用标准 local-wing 门禁重建 Desk 实际消费的 7 包及 aggregate，再复跑全量与构建；该 Wing 提交只改 Desk 不消费的 run-node，不能据此宣称 run-node 修复已通过消费端验收。Registry manifest/lockfile 没有改变，不推送或发布候选。

增量隐私复核覆盖本任务 16 个文件的语义、独立合成夹具以及最终双真源 Web/Server 产物：未把个人工程的零件清单、编号、结构、几何、机器路径或凭据作为样本；实际入口仅本地资源，没有远程 capture、测试、source map 或恢复包夹带。原始合成库、产物证明与日志留在仓库外，不进入提交。结论只支持本批本地归档，不替代最终压缩后的历史、实际发行包、安装恢复或生产切换审查。

### M4.2 手动恢复页面与受控 API

沿用 M4.1 整库原字节/opaque outbox 引擎，新增 CAD 单一“备份与恢复”入口、真实延迟页面注册与
`/api/workspace-recovery`，不另建 DDL、重写库或恢复 recreate。页面分当前库备份、检查与新目录恢复、
结果说明三个可折叠区域，Header/Block/Primary 保留所需动作；选择父目录后拼接新目录名，完整目标必须
不存在。确认默认取消，明示当前空间、完整目标、范围和私人内容本地保存边界。

服务端不是按 body.workspace 任意读库：先绑定 Host 当前 canonical 工作空间，再验证目录身份。
检查保留有界摘要、实际 canonical manifest 字节的 SHA-256、目录身份及十分钟句柄，最多四个；
恢复不能提交自制 proof，而在同次 verifiedBackup 读取原清单后、创建目标之前比较服务端保存的哈希。
因此另一份计数/大小相同但合法自洽的包也不能替代确认过的包。只写用户明确选择的新目录，不覆盖、
不激活、不切空间、不重建索引；恢复目标也不能与当前工作空间嵌套或成为其祖先。

每服务同时只执行一个操作，16 KiB 实际流请求上限、严格字段/重复字段/UTF-8 与 no-store；
句柄不跨重启，实际恢复尝试单次消费。原始请求取消、空间/包身份变化、释放、到期和服务失活都在完成
marker 实际 no-replace 发布前受控检查。发布后迟到取消不能把真实成功改成“没有写入”；关闭/同步
warnings 仍与回执一起保留。下游响应丢失则结果未确认，不自动重试。只读接口仍有临时 lease sidecar，
没有升级为文件系统零写、跨资源事务、可硬抢占同步解析或断电耐久性保证。

PageSession 只保存路径/折叠，不保存句柄、清单、确认或回执；挂载/刷新不自动检查或写入。
路径/空间/Tab 失活取消旧请求并独立释放，旧上下文迟到成功只记录其真实目标，不污染新页面。
错误/warnings 展开结果区并激活 Bottom；服务端返回有界主错误与 causes/未完成目录，不回传 stack 或
完整 manifest。已消费/到期的 cleanup 410 视为已消失，不制造每次成功后的虚假错误。

独立真实 HTTP 脚本与 bundle/runtime 启动器显式令 legacy 数据入口等于自有隔离运行目录，
防止测试启动时导入个人旧配置，不修改 HOME。合成库带实际 Wing v13 DDL、人工字段/BLOB、未知
索引/触发器/视图和隐藏/空 outbox；不是个人工程换名字。原 CLI 与新参数化用例保留全部行为，仅给
标题增加唯一 case 标识，避免运行单测目录注册时 truncated-array/action 同名造成 full_id 冲突。

此批只支持 Web/API 与本地构建 runtime 收口，不代表 Tauri GUI 安装、旧 VSIX 恢复包已验收；
legacy/WAL 受控迁移、跨 OS/崩溃恢复、最终压缩历史/发行制品以及用户批准的数据切换/停用旧端仍未退出。

验收回执（2026-10-12）：Desk 输入为 `379ef176`，本地 Wing 为 `37405a39`；最终冻结代码在
Registry 与标准 LOCAL 各通过 2,728 项（Server 124 模块 / 1,525，CAA 11 / 67，Web 139 / 1,136），
实际单测目录同步为 274 模块 / 2,728 用例。双真源执行不是两倍独立用例；HTTP 旅程也不混入该总数。
双端类型、双真源 Web/Server 构建、471 源文件分层检查及 7 包 Registry 精确依赖边界通过；
manifest/lockfile 与 node_modules 联调边界不变。工作树文档检查因缺少标准并列仓库链接失败，
不修改检查器绕过；合并回标准主库后另行执行完整文档链接门禁。

真实 Registry bundle、Registry packaged runtime、LOCAL bundle 分别通过 14 项隔离 HTTP 旅程；
原始库/outbox 输入字节未变，新目录恢复不激活，包替换、旧目标、原位 recreate、旧句柄和空间切换均受控。
实际浏览器在同一冻结页面完成手动检查、默认取消确认、新目录恢复、折叠/Primary/Bottom 展示和刷新不自动执行；
截图、合成库与原始日志只留仓外。既有 bundle/runtime health/shutdown 也通过。
bundle/runtime 门禁使用实际 Node 23.7.0；同一 LOCAL bundle 另以主库 Node 22.23.1 重跑 14 项并通过，
不把不同 Node 指纹混算。Registry Server SHA 前缀 `e50de4bd`，LOCAL 为 `d9adccca`，
runtime 副本仍是 Registry，不以当前 LOCAL dist 冒充 Registry runtime。

首次 LOCAL 的 23 个测试超时、1 个清理超时与合盖睡眠相符，另一个 `statement has been finalized`
未复现且根因未证实；旧失败证据保留，不记作通过。另两次 Registry bundle 启动期限失败不能归因合盖。
源 bundle 启动要同步完整测试目录，最终实际两次启动约 12.7–13.7 秒；本新增 HTTP 脚本单独给源模式
30 秒启动宽限，runtime 仍 15 秒、HTTP 仍 10 秒，既有 15 秒 bundle health 门禁未放宽且实际通过；
没有修改恢复引擎或 Vitest 超时掩盖失败。

实际 runtime 资源审查发现 Python 导入闭包缺失两个现有 helper，已补齐受控拷贝和独立闭包回归，
预检缺失/符号链接时不替换既有资源。新增 payload 清单覆盖实际 27 个文件的大小与 SHA（不含清单自身），
由本轮实际制品审查逐项核对；运行态 self-check 仍只检查 Node/Server，不能冒充 FreeCAD 执行通过。
本任务 34 个源码/测试/文档文件及双真源 Web/Server、Registry runtime 做内容级增量隐私检查，
未发现个人工程、机器绝对路径、账号秘密、测试库、截图、日志或恢复包夹带。该结论只支持本阶段本地归档，
不是完整发布历史、真实安装/卸载、跨 OS 或整项目最终隐私验收。

本批复用 M4.1 恢复引擎和 Wing Schema/lease/页面框架，不复制数据库 DDL 或旧 Webview；
当前空间绑定、检查句柄与生命周期属于 Desk 宿主适配，新增页面和 API 是受控薄层，不恢复旧 provider。
实际文件指标按同一 Node 23.7.0 / zlib 1.2.12 的逐文件 gzip level 6 统计，非 npm/安装大小或 Brotli：

| 本批最终产物 | 文件数 | raw 字节 | gzip6 字节 |
| --- | ---: | ---: | ---: |
| Registry Web | 84 | 2,515,587 | 780,384 |
| Registry Server | 1 | 1,779,262 | 489,852 |
| LOCAL Web | 84 | 2,500,953 | 779,430 |
| LOCAL Server | 1 | 1,778,467 | 489,813 |
| Registry runtime（含清单） | 28 | 62,804,167 | 17,034,400 |

同口径重新读取 M4.1 Registry 副本，本批 Web 增加 2 文件、29,051 raw / 9,921 gzip 字节，
Server 增加 63,892 / 13,694 字节；不拿该增量代替 LOCAL，也不与不同 zlib 的统计混用。
Registry 新页面 JS/CSS 共 26,582 raw / 9,019 gzip 字节；31 个非文档任务文件共 4,755 物理行，
其中产品实现 12 文件 / 2,297 行、交付与点检脚本 4 / 462、测试 14 / 1,736、配置 1 / 260。
这是阶段范围/成本核查，不是整体迁移完成率；测试和交付脚本不算产品能力，未重复恢复已有数据算法。

### M4.3 安装 smoke 安全基础

本批从 Desk `3373c656` 接续，Wing 固定为 `37405a39` / 0.8.1，Registry 精确依赖不变。
安装点检不能先启动旧应用再试探能力，也不能按全局 bundle ID 退出用户应用。macOS 入口改为受控
构建生成器：只在仓外新建私有输出目录，以锁文件/离线命令生成本次 app，绑定实际输出的宿主二进制、
Info.plist、runtime 全清单与源输入；无证明、未知原生 profile、版本或字节变化均在启动前拒绝。
本地构建证明是可信工作流程的一致性回执，不是签名、notarization 或针对恶意工具链的来源保证。

受控构建另固定专用 beforeBuild hook：Web/Server 构建后复用自有进程的 bundle 14 项旅程，
准备 runtime，再跑 runtime 14 项旅程。旧普通构建的固定端口 smoke 未证明实例归属，不能在本批
调用或冒充新流程；尤其旧 runtime smoke 可能向已存在服务发送 shutdown。专用 hook 不恢复旧入口，
每步 shell=false、逐项 exit 0 才继续；CLI、恢复旅程及 hook 源字节同样绑定构建审计。

原生隔离 profile 在插件或窗口创建之前验证私有目录与 marker 身份，禁用会读取全局状态的 single-instance
和 window-state 插件，使用非持久 WebView。普通启动仍保留原插件；开发态仍继承本地 Wing loader，
不会为测试改写 HOME/USERPROFILE。隔离子进程只继承 OS 白名单，runtime/legacy/registration/catalog、
临时与 OS 配置目录均使用本次明确的私有根；不转发凭据、NODE_OPTIONS 或其他父进程功能开关。

API 原点来自本次宿主发布的 managed handoff；每次请求核对自有 live Child、宿主/sidecar PID、版本、
协议、UUID 实例与注册目录。退出是带本次 run ID/宿主 PID 的私有请求，不是 GUI 全局退出或对占用端口
盲发 shutdown。正常退出后确认进程 exit 0、端口和注册释放，才重启或追加第 14 项回执。
失败时最多终止本 runner 实际创建的 Child，保留仓外目录，不以名称或可复制 marker 为凭据递归清理。

恢复流程抽出独立参数化旅程，仍使用真实 Wing v13 DDL、未知人工表/BLOB/索引/触发器/视图与 opaque
outbox，不复制个人工程。HTTP 脚本跑真实 bundle/runtime；安装脚本另外承接原 30 条退役 Code
method/path 检查与有界 FCStd 读取。后者的独立最小 XML 只证明 packaged reader，不证明 FreeCAD
几何或实际 GUI 操作。原始库/outbox 保持字节不变，新目录恢复不激活；每次重新启动及回执前后重新
观察实际输入 SHA，后续证明字节必须与初始回执指纹相同。观察式复核不是完整文件系统锁。

Windows 尚未实现文件 ID/ACL 与原生隔离验收，入口在任何读取、构建、安装、卸载或回执之前明确拒绝。
`SkipBuild` 不豁免；不把保留的旧 NSIS 逻辑或静态契约当成 Windows 安装通过。重新开放还须补精确
安装归属、已有安装拒绝/基线、注册与快捷方式匹配、环境恢复、受控证明和当前恢复旅程。

本轮真实原生旅程曾在重启后发现合成库字节变化；逐表对比仅增加工作集的旧 JSON 导入完成标记。
窗口冷初始化会读取工作集，触发该既有一次初始化。修正只在独立夹具的最初快照前合法初始化空工作集，
另以真实 loader 验证空结果与原字节不变；不屏蔽页面请求、不重设旅程基线、不放宽原字节断言。
宿主退出后再校验库/outbox 原字节，防止遗漏窗口关闭时的正常写入；源码改变后重新受控构建证明，
不能修改旧证明的哈希来复用旧候选。失败日志和合成数据库均留仓外。

本轮默认并行完整测试连续三次在真实 4999 文件扫描的原 30 秒预算超时；CAA/Web 因串行失败未执行。
同源码隔离运行该六项 carry 回归通过，4999/5000 文件分别约 2.3/2.1 秒。后续完整覆盖使用显式
单工作进程、双真源逐层复验，所有测试和预算不变；即使通过，也不称默认并行脚本已绿。
调度/资源争用需另行整改，不能通过删身份复核、事务或人工字段门禁改善该问题。

实际 macOS 构建候选未夹带模型、数据库、日志、测试或恢复包；Web/runtime 未发现本机绝对路径，
但原生二进制仍有 435 处账户绝对编译来源路径（355 处 Cargo、80 处 Rust toolchain）。不是个人工程，
仍属未解决的发行隐私项；只能保留为仓外本地候选。正式发布前须受控路径 remap 后重建、重做证明与验收，
不就地替换二进制字符串，也不以关键词无命中替代最终历史/制品审查。

2026-10-12 最终冻结源码的实际回执如下（Node 23.7.0；原始日志、库、proof 与 receipt 均在仓外）：

| 门禁 | 实际结果 | 证据边界 |
| --- | --- | --- |
| Registry 分层完整覆盖 | Server 130 文件 / 1,753 项，CAA 11 / 67，Web 139 / 1,136，共 2,956 项；双端类型通过 | Server 显式 `--maxWorkers=1`，223.03 秒；不是默认并行命令通过 |
| LOCAL 分层完整覆盖 | 同 2,956 项与双端类型通过，Wing `37405a39` clean | 标准本地 wrapper/prepare；Server 单工作进程 231.86 秒，未改精确 Registry 依赖或 node_modules |
| Rust debug-lib | 19 项通过（16 新增、3 carry） | 不是 GUI 或 release 宿主启动证明 |
| 受控 Registry 原生构建 | Web/Server 与实际 `.app` 构建 exit 0，release 编译 54.79 秒，版本 0.5.0 | 仓外新输出；固定安全 hook、锁文件/离线命令，无安装、签名或发布 |
| bundle/runtime 真实 HTTP | 各 14 项；原始库/outbox 不变、自有 child 退出与注册释放 | bundle 两次启动 12,831/12,529 ms（上限 30 秒），runtime 1,252/213 ms（上限 15 秒）；不是 native GUI |
| 实际 release `.app` 宿主旅程 | 恢复/重启/退出 14 项、30 条原 Code method/path 均 404、packaged FCStd reader 通过；退出后原始库/outbox 仍不变 | managed handoff、自有退出、sidecar/端口/注册释放均实测；不冒充 GUI 交互或系统安装/卸载 |
| 架构/依赖/增量隐私 | 471 源文件、5 pure graphs、1 view root 与 7 个精确 Registry 包边界通过；本轮合成源码可归档 | 编译路径脱敏、默认并行调度及旧普通构建 smoke 仍为未退出项 |

最终候选 native SHA 为 `9b2a1a8c…`，runtime manifest `5ffbbdf4…`、payload inventory `c5c83efa…`，
27 个 payload 共 62,798,844 字节；proof `026c8453…` 绑定 11 项源输入，源 digest `c6be6b3d…`，
宿主 schema-v3 receipt 为 `5a621ad2…`。同候选的全部输入在启动、重启及退出后复核；此前失败候选
未覆盖或补写成功回执。二进制 SHA 与前一个候选相同并不代表 proof 可沿用，旅程源和清单必须重新绑定。

本批非文档源码 23 文件（17 新增、6 修改），共 4,804 物理行、281,864 raw / 82,487 gzip-6 字节；
相对这些文件的父提交净增 3,265 行、215,752 raw / 62,261 gzip-6 字节。Node/zlib 与前述同口径，
源码集合 SHA 为 `88c1c4e1…`；配置与文档未混入该成本。大部分增量是受控构建、宿主隔离与回归门禁，
复用原恢复服务与参数化旅程，不把测试/点检脚本计作新增 CAD 产品能力或整体退役完成率。

本批开发、AST、mock、Rust debug-lib 门禁与真实 release 构建、宿主启动、GUI/安装验收分别记账。
后者没有实际执行时不能勾选；旧 VSIX 精确构建/隔离安装、legacy/WAL、崩溃恢复、跨 OS、最终压缩
历史/发行制品隐私和生产切换仍未退出。未取得接收仓写入及切换范围授权，不改变那些仓库或生产写入方。

### M4.4 普通构建点检归属收口

本批接续本地阶段提交 `102536d`，只改普通 bundle/runtime 点检入口与门禁，不扩展 CAD 产品能力，
不安装或停止旧扩展。两个原 CLI 名称及 package/Tauri/CI 调用链保持；入口先拒绝参数，再仅传入
固定 `bundle` 或 `runtime`，委托 M4.3 的同一真实 HTTP 旅程。删除两份独立固定端口、继承环境、
探测健康后退出与递归删目录实现；没有复制另一个宿主、环境或 shutdown 算法。

共享 runner 仍在每个请求前核对本次 live Child、私有登记的 PID/UUID/版本/loopback/端口，
子进程使用 OS 环境白名单及明确隔离的数据、legacy、catalog、配置和临时目录，保留真实 HOME。
本批补严格参数数量检查、每次 exit 0 后登记与 lease 释放，以及最终退出后的原始 DB/outbox 字节核验；
错误只处理 runner 自己创建的 Child，保留仓外证据，不向未知占用服务发送任何请求。

专项回归区分真实薄入口语句的 AST/VM 委托验证和实际构建/HTTP：前者不冒充网络或安装验收。
真实普通 `pnpm build:tauri-runtime` 另以自有 loopback 探针占住旧两个固定端口；检查构建期间探针
始终监听且 HTTP/TCP 计数均为零，最后只关闭自有探针并验证释放。两真源分别记录 bundle/runtime
14 项旅程、实际 Node/Server SHA、登记/lease 释放与退出后原始 payload 字节，不把模式或工具链混算。

共享 runner 新字节经独立复审后更新源码 `AUDITED` 指纹。旧构建证明、回执和候选保持原字节，
真实 production verifier 对旧 app 精确拒绝 `source proof mismatch`，前后证明/回执 SHA 不变；
不是修改旧证明来重新授权旧 app。M4.3 的 native 实测只属于
当时冻结输入，本批未重做 native/GUI/安装，也不把普通 CI 链接通称为 `verify:ci` 整体已通过。

2026-10-12 本批实际门禁（原始日志、探针、库与结果 JSON 均留仓外）：

| 门禁 | 实际结果 | 边界 |
| --- | --- | --- |
| Registry 完整分层覆盖 | Server 130 文件 / 1,757 项，CAA 11 / 67，Web 139 / 1,136，共 2,960 项；双端类型通过 | Node 23.7.0，Server 显式单工作进程 224.48 秒，测试/原预算不变；不是默认并行或整体 CI 通过 |
| LOCAL 完整分层覆盖 | 同 130 / 1,757、11 / 67、139 / 1,136，共 2,960 项；双端类型通过 | Node 23.7.0，Server 单工作进程 227.55 秒，Wing `37405a39` clean；标准 wrapper/prepare，精确 Registry manifest/lock 不变 |
| Node 23.7.0 普通构建 | Registry/LOCAL 各 exit 0、bundle 14＋runtime 14 项；自有探针 HTTP/TCP 0、退出后原字节不变、登记/lease 释放 | bundle 启动 Registry 15,360/15,055 ms、LOCAL 20,008/13,420 ms（30 秒上限）；runtime 1,250/214 与 1,145/214 ms（15 秒上限） |
| Node 22.23.1 普通构建 | Registry exit 0、bundle 14＋runtime 14 项，探针与原字节/释放检查通过 | 本地 darwin-arm64、36,617 ms；bundle 14,800/14,282 ms、runtime 1,866/318 ms；未跑 Node22 LOCAL 或 Ubuntu CI |
| 架构/依赖/增量审查 | 471 源文件、5 pure graphs、1 view root、7 个精确 Registry Wing 包边界通过；源码/文档增量可本地归档 | 默认并行调度、当前 native 重建、编译路径隐私、系统安装与最终历史/发行审查仍待做 |

普通构建的 Registry/LOCAL Server SHA 分别为 `f85d1fba…`、`f4b8f127…`；实际 Node23 为
`a48a4611…`、Node22 为 `2e3f1286…`。占旧端口探针只用于本地真实门禁，未发布任何探针或实际环境日志。
早期完整 Registry 回归曾为更新受审计源码指纹而主动中断（SIGINT/exit 1）；保留该过程日志，
只把新冻结输入后的完整结果计为通过，不把中断冒充回归失败项或通过。

本批非文档源码 5 个修改文件，共 586 物理行、48,801 raw / 16,488 gzip-6 字节；相对 `102536d`
净减 102 行、1,894 raw / 1,264 gzip-6 字节（Node 23.7.0）。源码集合 SHA 为 `88f1fa05…`，
只统计本批源码，不混入文档、配置、产物或旧阶段成本。增量仅使用独立合成数据，实际日志/探针/
库/映射不进入 Git；不是最终压缩历史或完整发行包隐私验收。

后续编译路径脱敏需绑定真实工具链、有效 Cargo 配置/include 闭包及实际 compiler argv，
使用固定的精确来源 remap 后新目录重编译，再核验原始 Mach-O/dSYM/整个 app 并生成新证明；
不映射整个 HOME、不就地编辑二进制。Rust remap 为 best-effort，host 编译单元、Apple OSO、
生成代码与环境字符串均需实际核验，不能仅凭设置 flags 把此前账户编译路径门禁勾掉。

### A13 的 21 个旧命令去向

以下均为旧固定提交的 `ktAutoCad.` command。核实 21 个唯一 activation、15 个 contributed command、5 个可见工具；表中“承接”只表示真实源码出口存在，不表示完整页面或所有业务已验收。

| command | Desk 真实出口 | 状态/阶段 |
| --- | --- | --- |
| `open` | 工作空间树 → `file_detail`；`GET /api/cad/bom/file` | 名称/属性承接，M1 |
| `module.show` | 主页 CAD 勾选；`PATCH /api/workspace/nav-modules` | 宿主承接，M1.4 |
| `module.hide` | 同上移除 CAD；Desk 至少保留一个模块 | 宿主差异，M1.4 |
| `block.filename` | 同 `open` | 承接，M1 |
| `block.scan` | `cad_index` 扫描/检索/状态 | 承接，M1 |
| `block.read` | 文件详情属性/对象信息/引用 | 静态字段承接，M1.2 |
| `block.query` | 文件/零件详情引用与装配；`bom_delivery` 预检/导出 | M1 查询＋M2.3 离线；远程交付 M3 |
| `block.provider` | 旧实际也是打开 `cadRead`，同 `block.read` | 不是 provider 选择动作 |
| `block.diagnostics` | CAD 索引诊断/状态 | 承接，M1.4 |
| `diagnostics` | 索引刷新诊断、`GET /api/cad/index/status`、`GET /api/cad/health`、底部日志 | 业务承接；旧握手机制 obsolete |
| `readFcstdLight` | 文件详情独立轻量摘要、原始 XML 字节＋去重源链接/内嵌字段；`POST /api/cad/light-info` | 工作空间内 32 MiB 只读承接；外部单文件许可及其他 carry 未退出 |
| `readFcstd` | `POST /api/cad/object-info`；引用诊断另走索引 | 静态实现，非旧进程等价，M1.2 |
| `queryWorkspaceDatabase` | `GET /api/file-detail/xrefs`（`refresh_disk=false`）、`/api/cad/bom/xref/*`、`/api/cad/bom/tree` | 查询承接，M1 |
| `exportBomTransfer` | `bom_delivery` / `/api/cad/bom-delivery` 预览、确认导出、释放 | 离线接入 M2.3；接收兼容尚待 M2 |
| `pushBomTransfer` | 尚无 outbox/prepare/status/commit 或审核出口 | 未迁，M2 前置＋M3 |
| `retryBomTransfer` | 尚无原包重试/回执管理 | 未迁，M3/M4 |
| `configurePhoenixBom` | 尚无专用连接/安全凭据端口；FreeCAD 配置不是替代 | 未迁，M3 |
| `clearPhoenixBomCredentials` | 尚无退出/删除秘密动作 | 未迁，M3；不能因旧机制退役删除该业务能力 |
| `scanWorkspace` | `cad_index`；`POST /api/cad/index/scan/start`、GET progress、POST cancel | 单空间宿主承接，M1 |
| `searchWorkspaceIndex` | `GET /api/cad/index/search` → 打开详情 | 已新增；无缓存时不回退，M1.1 |
| `selectDeskToolsProvider` | 不恢复 manifest 选择/握手；业务读取由对象信息承接 | 旧机制 obsolete，仍以 A08 退出门禁为前提 |

汇总为 16 项有业务/宿主出口（含差异），4 项远程交付/凭据动作未迁，1 项 provider 选择机制 obsolete；不等于 21 项已全部迁移。`bom_apply` 和 `/api/cad/bom/file` 是模型属性工作流，不是 Phoenix BOM 交付。

### M2/M3 可执行批次与跨仓门禁

下表是整批退出条件；M2.1 的 Desk 纯领域边界、M2.2 后端快照/离线发布和 M2.3 离线页面/API 已接通，接收端兼容仍缺。BOM 接收端变更属于跨仓实施范围，开始前须确认该仓写入权限、dirty 所有权及实际 Host 基线；不以当前仅可读的环境假定有权修改或发布。

| 批次 | 工作落点 | 退出条件 |
| --- | --- | --- |
| M2.1 envelope 与接收契约 | Desk feature domain；BOM 的类型/guard/Schema/显示名与契约测试 | 新旧 producer、未知 producer 拒绝、历史原字节导入、canonical/hash 和边界一致；不把版本锁死为旧扩展版本 |
| M2.2 一致快照与离线导出 | Desk SQLite snapshot、完整扫描新鲜度、排他临时文件/no-replace | 局部写后陈旧、预览后改名/属性写/扫描、损坏/缺失/歧义/循环、元数据缺失与超限均拒绝；发布前再次核验，竞争既有目标原字节不变，清理临时文件 |
| M2.3 离线页面/API | CAD 独立 BOM 交付入口；仅开放预检、确认导出与释放 | 本地回归、实际浏览器、配置恢复、Bottom 错误和生产构建已验收；不开放推送，不替代接收端兼容和整体 M2 退出 |
| M3.1 认证与凭据宿主 | Desk 非秘密连接设置与安全 get/store/delete 端口 | 固定正式认证流程、目标/账号确认、取消/超时/refresh/撤销；秘密不进入 prefs、localStorage、API 结果或日志。安全存储缺失只能明确会话内模式，不能算持久凭据迁移完成 |
| M3.2 交付/outbox 幂等闭环 | Desk prepare/status/commit、审核跳转、不可变包与终态回执；BOM 权威关联协议 | 先解决同载荷异 ID 契约，验证审核/过期/409/断网/重启/重复提交/作废及服务器绑定；历史包不重写，回执始终能追溯本地原包与权威记录 |
| M3.3 接收端运行态验收 | 固定 Admin Host、受控装配和隔离 PostgreSQL | 实际 400/401/403、actor、审核/计划变化/并发 commit/故障原子回滚；不能用 domain 或 mock 通过代替。安装、数据接管与备份恢复在 M4 继续收口 |

旧导出在读事务关闭后只进行一次文件 stat，不足以证明预览至发布全程绑定；M2.2 增加发布边界核验，使用确定性 hook 覆盖竞争。M3 的真实目标/账号和生产切换不由本地默认值推断；实现批准不等于登录外部服务、发布或操作生产数据的授权。

## 测试语义和验收

| 旧测试 | 分类与目标 |
| --- | --- |
| `detailTools.test.ts` | 入口语义 carry 到 Desk route/导航测试；旧 Webview HTML 属于旧宿主，不要求 DOM 一致 |
| `workspaceScan.test.ts`、`workspaceIndex.test.ts`、`workspaceSchemaContract.test.ts`、`sqliteHostLease.test.ts` | 领域/数据保护 carry；与 Desk `cadIndexScanService.test.ts`、`cadIndexBoundaryServices.test.ts` 对齐；SQLite 驱动差异单独验收 |
| `workspaceDatabaseQuery.test.ts`、`xlinkDiagnostics.test.ts` | 查询/分类语义 carry 到 Desk 引用/索引检索契约测试；不能只删除旧测试 |
| `fcstdTsReader.test.ts`、`nativeRead.test.ts`、`nativeFixtureParity.test.ts` | 业务字段 carry 到 TS 对象读取/ZIP/异常测试；旧 binary 调用协议保留在旧金样本，不恢复发行依赖 |
| `bomTransfer.test.ts` | 迁直接 BOM/重复数量、断链/循环、Schema/新鲜度、旧元数据缺失、no-replace 与确定性竞争回归 |
| `bomDelivery.test.ts` | 迁先落盘、离线恢复、Web 审核、作废终态、409/计划变化、重复提交回执 |
| `phoenixBomClient.test.ts` | 迁 HTTPS/loopback、refresh/401、撤销、日志脱敏；SecretStorage 改为 Desk 安全端口契约测试 |
| `autoCodeShellApi.test.ts`、本地/Registry 开发测试 | 旧 Shell/扩展打包归旧宿主；新增 Desk 注册表/API/安装测试及 Auto Code 无 CAD 回归，不虚计为业务迁移 |

公开测试全部独立构造，不复刻用户的工程编号、型号、装配树或几何。真实 CAD 点检仅在另行授权的本地目录，原始数据/截图/日志/绝对路径不进入提交或发布包；旧夹具先审查许可证和隐私，不能整目录照搬。

阶段门禁：

- [ ] 源命令、目标 route/API、数据表与配置逐项映射；5 个旧工具和 21 个命令均无遗漏。
- [ ] 同样本核对字段/数量/顺序/错误/取消/空态；A08 全字段去向明确，未覆盖项阻止相应能力下线。
- [ ] 预览/应用绑定快照和工作空间；竞争、过期、损坏、超限和未知 schema 均拒绝危险写入。
- [ ] carry 测试先在目标通过，再停旧门禁；分别记录当前实际测试名、数量和输入提交。
- [ ] Desk `pnpm wing:check-local`、`pnpm test:local-wing`、`pnpm build:local-wing`、`pnpm verify:wing-dependencies`；Registry 发布后另跑正式依赖门禁，不混用证据。
- [ ] Web/Tauri 真实操作：选择工作空间→更新索引→详情/检索→导出→推送→Web 审核→重试/回执；错误自动可见、返回/刷新/会话恢复正常。
- [ ] 新旧 producer 的服务端权限、审核和幂等兼容经过 Phoenix BOM 接收端测试；不触碰生产库做演练。
- [ ] 同载荷异 ID 的权威关联/回执闭环通过；完整扫描后局部刷新不会被当作新鲜递归 BOM 交付；坏 envelope 的真实 HTTP 状态与权限拒绝可核实。
- [ ] 包体不含私人样本/机器路径/账号秘密，复核最终历史范围；安装/退出/卸载不清工程数据。
- [ ] 备份恢复和 outbox 接管演练通过，Registry 安装制品可恢复，用户确认后才执行停用。

当前已进入 M1 实施，A09–A12 和安装/恢复/切换仍未完成，**不报告完整迁移百分比**。分别统计可见入口覆盖、可点击路由覆盖、完整能力验收；主体迁移与发布就绪分开。历史 1305 项测试和本轮消费端总量都不能替代逐项跨端等价或退役验收。

## 切换与回退

切换时冻结旧插件写操作/自动扫描，完成数据库与 outbox 备份，再让 Desk 接管。恢复演练必须证明数据库、回执、待重试包和人工字段可恢复；不能假定只切 Git 提交就能回退数据。M5 前重新固定切换前的完整代码、安装制品和数据恢复输入，保护后来独立增量；不能直接回到历史 `438c62d567` 而丢失缩略图、Wing 适配等非迁移修改。原项目文件不因插件退役而删除。

Auto Code 需要清理的具体位置包括 `sidebarViewProvider.ts` 的 CAD 安装建议、`cad-sibling-resolution.mjs`、完整联合 `ext:dev`/`ext:test:host:cad`、launch/smoke 的 CAD 专用断言和旧 provider 文案。保留通用 Shell API 与 Code-only 开发/发行；CAA handoff 和 Desk 集成不是 CAD 扩展专属，不能连带移除。

旧扩展的 Marketplace 下架/弃用说明、停止发布、用户机器停用及仓库归档属于最后的外部动作；由用户确认范围与时机后执行，不自动卸载，不删除 Git 历史。观察期长度和回退负责人在 M5 前确定。旧数据有未完成任务、A08 缺口或 BOM 交付未闭环时，不宣称 Auto CAD 已退役。

## 代码依据

- Auto CAD：固定 commit 下 `package.json`、`src/extension.ts`、`src/detailTools.ts`、`src/workspaceIndex.ts`、`src/fcstdTsReader.ts`、`src/nativeRead.ts`、`src/bomTransfer.ts`、`src/bomDelivery.ts`、`src/phoenixBomClient.ts` 及对应测试。
- Desk：`web-ui/src/layout/pageRegistry.ts`、`server/src/routes/cad.ts`、`server/src/lib/cadIndexScanService.ts`、`cadIndexMutationService.ts`、`cadIndexStatusService.ts`、`fcstdDocumentXmlService.ts`、`pnwBomXrefService.ts`、`bomAttributeService.ts`。
- Phoenix BOM：`packages/admin-plugin/midway/phoenix-bom/domain/bom-transfer.ts` 和 `contracts/transfer-envelope-v1.schema.json`。
- Wing：`packages/cad-core/src/workspaceIndex.ts`、`packages/cad-contracts/src/workspaceIndexV1.ts`、`nativeV1.ts`；以精确提交的公共导出为准。
- 历史 [Wing CAD 核心迁移计划](Wing共享CAD核心迁移计划.md) 包含已经退役的 Rust/provider 方案，仅作历史，不能用于恢复旧发行链。
