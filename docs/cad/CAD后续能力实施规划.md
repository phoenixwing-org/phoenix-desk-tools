# CAD 后续能力实施规划

状态：分期实施；默认 V2 七动作与 V3 单文件任务库试点已接入主目录；完整 T1c 与受控写入未完成。日期：2026-10-20。

本轮接续统一批量任务管理首期，规划 CAD 只读接入、体积密度质量、高级出图及伴随 MD 兼容。Tool 负责代码、数据与安全执行；工程侧负责文档迁移映射、活动链接和真实工程审查。采用本地 SQLite/服务驱动的适中结构，不新增另一套队列，不恢复已经移出范围的远程 BOM 业务。

无损 MD identity helper 和保存态 XML 观察已分期接入；已有 PNG 摘要仍待后续。保存 BRep 单文件 Native 测量已单独试点，通用尺寸重测、缓存写入及复杂修改仍须分别过门禁，不能把原页面已有按钮称为已接入统一任务。

## 当前交付和基线

M0/M1a 已完成纯共享契约、独立六表 SQLite、定义/revision、预览、幂等保存与接纳、持久串行队列、取消、步骤/事件、管理页与 Wing 监控。首期三个动作是 `file.metadata`、`file.text-stats`、`cad.saved-properties`；2026-10-20 实际接入主目录并增加 `cad.saved-links`、`cad.saved-drawing`，共五个保存态只读动作。2026-10-19 双真源各 94 项及真实服务重启是历史回执；最新门禁见 [任务书集成回执](../platform/统一批量任务管理任务书与实施规划.md)。重启后 running/queued 标 interrupted、不自动重放，不等于自动恢复或断点续跑。

T1b 已注册 `cad.geometry-cache` 与整批 `cad.name-audit`，连同原五项共七动作；V2 服务、schema/备份兼容和管理页已接入主目录。`v2-service.test.ts` 的 12 项回归覆盖整批范围、缺失/阻塞、缓存变化、同请求并发合并及关闭中止；最终定向门禁见任务书，不代表全仓或 Native 验收。P0 另有 86 项纯输入核验回归，未注册物性 action，不证明 Native 测量或来源新鲜度。

T1c 已完成显式 host V3 `cad.saved-shape-measurement` 的任务库单文件试点：唯一 file+node、保存 BRep、固定 profile、实际子进程归属和关闭，成功结果只写任务账本。主目录独立样件的正常、取消、超时及关闭后再次运行通过；默认仍为七个 Native-free 动作，Web 对 V3 只读，不开放 Body/装配/多文件或缓存/CAD/产物写入。材料只保留未解析元数据，不采密度或质量；详细范围见[任务书回执](../platform/统一批量任务管理任务书与实施规划.md#t1c-任务库单文件试点回执)。

图纸工具与通用任务共享服务、路由和页面注册等入口。集成前须冻结目标文件及依赖闭包，逐项核对重叠改动，不整目录覆盖或混入无关暂存。

### 合入策略

1. 合入前在忽略的本地验收目录分别冻结两侧 HEAD、index/worktree 清单及 SHA，逐项确认本轮文件归属，保留首期回执和任务逻辑备份；不复制运行 DB 作为源码。
2. 在隔离集成环境按文件名单接通用任务新增目录。重叠入口按 base/main/task 三方逐 hunk 整理，保留 `drawing_batch` 与 `batch_tasks` 两路，不修改用户原 index。TODO 合并准确完成状态；manifest 按最终文件生成，不拼接重复 JSON。
3. 主目录最新图纸守护和纯装配读取分别归属复核。只读 Adapter 仅提升必要纯读模块和测试；不顺带搬整套 Native 未提交改动，也不用任务 worktree 的旧图纸模块覆盖新实现。
4. 合流后重跑定向双真源测试、类型、构建、依赖/导入边界及增量隐私审查。普通可逆接线按已授权阶段推进，只纳入归属清晰的本任务内容；暂存、提交和推送不因集成自动取得授权，不操作用户原暂存内容。

非标准 worktree 联调设置 `PHOENIX_WING_ROOT`，继续使用精确 Registry manifest/lockfile及启动 resolver；不使用 link/file/workspace 依赖或改 node_modules。工作树缺少并列仓库时的既有跨仓文档链接检查需单独核实真实目标，不把环境缺失包装成全门禁通过。

## 分期及依赖

| 阶段 | 交付 | 进入下一阶段的门槛 |
| --- | --- | --- |
| T0 基线协调 | 分离文件清单、重叠入口方案、领域守护归属 | 原 index 保留；首期回执不漂移；不以整目录复制集成 |
| D0 MD 兼容 | 无损 identity、候选发现/有界读取，随后新输出组 | 与工程侧对齐 variant/别名；旧名可读、冲突可见、新旧防覆盖和 PDF 来源识别同步 |
| T1a 静态观察 | 已有 PNG 摘要、静态链接、Rigid/Joint 窄报告 | 仅选中文件，真实宿主/内部 Name，取消/字节预算，未知不算健康 |
| T1b 缓存及整批分析 | 七动作、只读缓存快照、名称查重 batch scope、schema/备份 V2 和管理页已接主目录 | 不将缓存 stamp 当 SHA 新鲜度，不扩大目录，不顺带写主库；Native 和写入另验 |
| T1c 显式 Native 采集 | 已验单文件保存 BRep 任务库试点；通用重测与缓存更新仍待后续 | 自有进程及实际 close、完整范围与来源核验；试点不授予缓存、CAD 或产物写入权 |
| T2 受控动作 | 依次接现有属性、改名、转换、图纸修正/新稿执行器 | 一套执行权；每种动作独立 CAS、发布、未知结果核对和重开验收 |
| P0 单件物性 | 有效最终实体体积、原生/明确来源密度与质量 | 单位/材料来源/保存新鲜度可核对；空值有原因，不写材料或模型 |
| P1 总成物性 | 真实实例/数量/缩放、混合材料及完整性汇总 | 嵌套/重复/缺失/抑制策略独立验收；不按文件去重，不猜未知质量 |
| G0 至 G4 高级出图 | 公开样件多页、静态总成增量、精确修复与重排 | 每个增量有预览、源保护、独立重开和人工工程审查，见下文 |

研究、纯 helper 和静态测试可并行；Native 及写入动作不并抢资源。D0 兼容先于工程侧正式 MD pilot；不要求全部批量能力完成才能使用首期管理页。

## 只读与缓存的底层复用

| 能力 | 现有底层 | 不能直接套用的入口和补项 |
| --- | --- | --- |
| 已有 PNG | `fcstdThumbnail.extractFcstdThumbnail(bytes)` | 从冻结文件字节提取，仅记存在性、PNG 宽高/hash和来源；不把 data URL 写任务库，不把像素称为零件尺寸。保留 ZIP/PNG 有界校验 |
| 静态链接 | `fcstdLinkIdentity.fcstdLinkInstances`、`cad-light-info.buildCadLightDiagnostics` | T1a 只报告保存的声明/宿主 Name，目标未核验；读取器覆盖有限，遗漏不代表无引用。候选解析须先扩展冻结清单契约；不调用全空间 inventory 或会保存偏好的高层入口 |
| Rigid/Joint | 主目录 `fcstdAssemblyState.readFcstdAssemblyState` 及测试 | 只读保存 XML、不跟外链；Rigid 缺失/异常为未知，Joint 只报告明确空端/缺本地对象，不代表实际 Frames 或求解健康 |
| 尺寸缓存 | 隔离 `batch-tasks/geometry-cache` 与 `cadSqliteReadLease` | 精确 rel、固定白名单库、真 readonly、64 MiB 库和 256 KiB 字段/结果预算；缺库/表不创建。已有 `withGeometry` 的 stamp 比较不提供全 SHA 新鲜度 |
| 尺寸重测 | 试点 `cad-native-measurement/manifest`、`runner` 及 `batch-tasks/native-runtime`；旧 `geometrySnapshot`、`readGeometryBatch` 保留 | 试点仅单文件保存形状且不写缓存；完整依赖、Body/实例和文档坐标另验，不嵌套 `startGeometryJob` |
| 缩略图缓存更新 | `part-gallery/service` 单文件 inspect 与存储逻辑 | 抽显式 files[]，声明图片/主库缓存写效果；不调用会展开产品引用的图册 job |
| 编号查重 | 隔离 `shared/cad-name-audit` 的显式选择集纯分析 | `cad.name-audit` 每 action 实例整批一次，保留 variant/初稿及 manual；不调用旧递归/写偏好入口，不冒称已保存 PartNumber 真值 |

尺寸/缩略图/链接/查重基础模块两侧相同；装配 XML reader 及接线只在主目录未提交。`pnwPartKeyService.loadPartKeysPayload` 会写同步投影，不能当纯查询；其旧 PartNumber/PartVersion 键也不用于合并 MD variant。

### 最小契约扩展

T1a 只读本文件保存事实，沿 collect/逐文件模型增加版本化观察值，不改 Wing workspace schema13。值缺失可作为观察成功，但 UI 必须显示 missing/unknown，不能显示“尺寸已获取”或“装配健康”。隔离 V2 对未取得源 SHA/bytes 的输入保留 null 和原因，并阻断受影响步骤；真正不适用单列 not_applicable，不静默丢项。没有 ready 步骤时拒绝接纳。

V2 已扩 Descriptor/Plan：`scope=file|batch`、effects、冻结 sources/resources、ready/blocked/not_applicable、结果 schema/算法版本与协作取消。V2 sources 是明确所选文件及已读取缓存投影，不是完整 CAD 依赖 manifest；整批执行端口接收完整冻结 items，不借第一个文件冒充整批主体。V2 效果仍仅 `read_file`、`read_cache`、`write_task_db`。V3 试点另冻结保存 BRep manifest/profile/票据，并声明 `run_native_readonly`、`write_private_temp`；不允许用 V2 描述冒充 Native 权限，缓存更新/输出/CAD 写入未开放。

任务库已升级 schema3 八表：原 meta/task/plan/run/step/event 加 Native attempt 和稳定事件。V1/V2 先保全并核验原版逻辑备份，再事务迁移；历史、导入 JSON 和纯状态 eligibility 不授予执行、kill 或租约释放权，未知原生归属保持阻塞，不自动重放。输出 artifact 与发布未知处置仍属后续写入契约；不改变 Wing workspace schema13。

### T1b 隔离验收和兼容边界

纯 V2 编译器、显式选择集名称查重和严格只读尺寸缓存 port 已接入隔离服务及管理页。V2 以 action-major 排序：action 实例按保存顺序；file 步骤按冻结输入顺序；batch 每实例仅一条完整范围步骤。预览展示实际 file/batch、ready/blocked/not_applicable 数量及原因，不再套用 N×M。不可读输入保留在整批目标中并阻断分析，其余独立 ready 项可继续。

host 对 canonical payload 计算 digest，并在接纳和执行时核对完整 envelope、动作版本、来源与资源；typeguard 和纯编译器均不授予运行权限。新确认请求必须声明 `protocol_version: 2`；旧恢复指针仅能查询原 run，没有记录时重新预览，不能按 V2 重发旧计划。相同 requestId/计划/摘要合并在途接纳，关闭服务先中止并等待未决接纳，避免 404 后仍有旧请求迟到提交。

任务库 schema 和逻辑备份已隔离升级 1→2：迁移前先保存并核验原 v1 逻辑备份，失败不推进 schema 或中断旧队列；活 owner 不迁移。旧终态 run 的快照、结果和 digest 保持，只读展示；旧 fresh 计划失效，active/queued interrupted，不恢复执行许可。恢复仍仅允许空任务库，先核对原备份 checksum，再校验版本与完整范围，不导入 owner 或资源授权。旧程序须拒绝新协议库；不改变 Wing workspace schema13。

缓存 snapshot 保留 missing/unknown/invalid/record，`freshness` 始终为 `unverified`；raw hash/stamp 不证明当前 CAD/依赖新鲜。服务端只认白名单缓存 key、精确 selector，使用 readonly 租约建立/释放自有临时协调锁，不回收已有锁，不创建缺失库/表或重测；未知效果、版本、多余来源和投影变化拒绝继续。blocked/not_applicable 不执行可选缓存读取，也不伪造未读的来源；声明能力仍在预览可见。

P0 单件物性模型当前仅完成 86 项纯输入核验：显式节点/来源 DTO、单位与密度证据、计算和缺失/冲突语义。输出保留 `validation_scope: pure_model`、`native_proof: not_checked`、`source_freshness: not_checked`；即使计算出 mass，也不等于真实 FreeCAD 测量、全依赖 SHA 已核验或业务 action 已开放。

旧尺寸、STEP、缩略图及图纸入口已接同一固定 host gate，mock 回归覆盖终止请求、kill 失败和实际 close 前不释放；它们没有因此获得新的实际 Native 验收。任务库试点另外验证了单文件保存 BRep 四例，不能扩为旧入口、完整依赖、文档坐标或 Native 崩溃恢复证明；exit、计时器和 PID 本身都不是关闭证明。

## 一个协调器复用领域执行器

现有属性/改名/转换/图纸执行器保留各自真实目标、预检、CAS、备份政策、发布和复验。先抽 `executeOne(frozenInput, ownedExecutionContext)` 一类单元端口，不在新 worker 内再调用旧 HTTP start/job 队列。旧 UI 可暂用原流程；某工具切换时只有一套 Coordinator 拥有任务和 Native 资源，兼容入口不得重复派工。

只读单文件步骤可独立失败继续；改名及入向宿主修改需全批计划与依赖屏障。末尾缓存/索引归并只执行一次。普通改名既有“不自动备份/不重复弹确认”边界继续沿用，不能因平台统一而偷偷更改政策。进程或文件已发布但任务提交未确认时记录结果未知并核对，不直接自动重跑。

### T1c T2 受控执行契约

下列条件是进入 Native 或写入阶段的门槛，不是当前七动作的已开放权限。T1c 先做不保存 CAD 的显式测量；需要缓存写入时单独声明资源和效果。T2 再按领域逐项接写入/转换/图纸，不通过修改只读 descriptor 绕过准入。

- 冻结完整来源：预览列出所有源、实际依赖、模板/材料映射和配置的 SHA，以及精确内部 node、最终实体、宿主及完整 occurrence/实例身份。不能只验所选主文件或 stamp，也不能运行时扫描补入未授权依赖；缺失、歧义、Frame/求解状态不可证明时保持 manual/blocked。
- 自有进程归属：固定程序/参数数组、私有配置和受控环境；票据绑定 run/step、owned PID、nonce、引擎及来源摘要。PID 或心跳本身不能证明归属，不附着用户 GUI；取消、超时或 kill 失败仍持有同一租约，必须取得自有 child 的实际 close proof 后才清理并释放，exit/计时器不是关闭证明。
- 唯一执行权：Web、未来 CLI 与领域兼容入口连接同一 Coordinator，按冻结资源协调；复用单元执行器，不在新 worker 内嵌旧 HTTP start/job。当前固定 host 私有 gate 持久记录 launch/PID/actual close，未知或残留保持 busy，不按 PID、超时或任务终态回收；单文件原生试点不等于 Native 跨进程崩溃恢复、完整进程树、跨宿主或离线执行验收。
- CAS 与发布：执行前核对源/依赖 SHA、目标身份和原值；写 CAD 沿领域备份/暂存/最终重开规则，新输出 no-replace。缓存写入也要冻结行/算法前提并验证提交结果，不以任务 DB 事务冒充文件系统或另一业务库的原子事务。
- 未知结果先核对：进入发布前持久化意图，记录自有 stage/产物、摘要与发布进度。文件或缓存已提交但回执不明时进入 `needs_reconcile`，阻断受影响下游，不自动重放、不伪报 cancelled/零输出；先核对相同归属票据与已知产物再作显式处置。该状态及 attempt/artifact 持久契约须在开放写效果前迁移，当前只读状态机不冒充已支持。

## 体积 密度和质量契约

材料牌号、物性绑定和计算输入分别记录。公开 study06 展示原生材料卡、显式物性 Link、CalculationDensity 及 Mass 表达式，并明确改材料卡后需显式同步；这不构成全库或装配材料服务。借鉴其单位和独立复验方法，不复制示例专用身份校验或把教学常数作为默认值。

FreeCAD 的 Shape 提供实体体积与边界盒，Quantity 提供带单位转换；新式 PropertyMaterial 保存 UUID，再通过材料管理器恢复，因此 UUID 字符串本身不是密度随文档携带的证明。依据：[TopoShape API](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/TopoShape_API.md)、[Quantity](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Quantity.md)、[FreeCAD 1.1.0 PropertyMaterial](https://github.com/FreeCAD/FreeCAD/blob/1.1.0/src/Mod/Material/App/PropertyMaterial.cpp)。

拟定每次物性观察至少包括：

| 字段组 | 内容 |
| --- | --- |
| identity | 工作空间相对 rel、内部 node、实体选择策略；装配另含完整 occurrence path/宿主及 linked target |
| provenance | 源及依赖 SHA、材料卡/显式映射摘要与版本、FreeCAD/算法版本、采集时间；fresh/stale/missing/unknown/conflict |
| geometry | 最终实体状态、有效/闭合 solid 数、`volume_mm3` 或 null、放置/缩放口径及诊断 |
| material | 牌号原文及属性来源，原生绑定类型/对象/是否解析；不以字符串牌号替代 density |
| density | `density_kg_m3` 或 null、原单位、材料来源、明确覆盖及冲突；保留 CalculationDensity 与卡片不一致 |
| mass | `mass_kg` 或 null、公式/输入摘要、已保存 Mass 与计算值区别、完整性/未知项数量和原因 |

P0 先支持明确唯一最终 Body/Tip 或显式实体节点，不将 Body、Tip、BaseFeature 和历史特征重复求和。空 Shape、开壳、无效实体、非有限/负体积、不明确多实体或多材料返回 manual/unknown，不用绝对值或零值掩盖问题。只读采集不改材料卡、不同步 CalculationDensity、不创建 Mass 属性、不保存 CAD。

密度必须是可解析的原生物性或用户明确选择的版本化映射，校验维度及有限正数；仅有 PartMaterial、失效 UUID、缺材料卡或多个冲突来源时不套默认密度。规范单位为 mm³、kg/m³、kg，计算 `mass_kg = volume_mm3 × density_kg_m3 / 1e9`。界面可称重量，但不混用力 N。已保存 Mass 只能作为带来源的值，不能证明与当前 Shape/材料同步。

原生采集必须显式通过带单位转换输出规范量值，不能将 Quantity.Value 直接标为 kg/m³：官方 [Quantity 文档](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Quantity.md) 说明 Value 使用内部 mm/kg/s，且提供 getValueAs；[FreeCAD 1.1.0 单位表](https://github.com/FreeCAD/FreeCAD/blob/1.1.0/src/Base/UnitsSchemasData.h) 的密度换算也与此一致。纯 TS 模型的显式单位白名单是输入核验，不代替真实 FreeCAD 的单位维度与材料卡解析验收。

P1 按真实实例汇总，不按唯一文件集合相加。嵌套、阵列、重复、被排除实例、镜像及缩放策略进入冻结计划；可见性不等于 BOM/质量排除。同源多实例可复用基础测量，但每个 occurrence 的数量/变换保留。正缩放 2 倍对应体积 8 倍只计一次；实现须证明 Shape 是否已施加变换，避免重复缩放。非均匀、镜像、未知阵列先 manual，完成独立实证后才开放。

混合材料逐实例/实体分别计算，不平均牌号或密度。某个实例未知时保留 `known_mass_kg` 和未知数量，整体 `mass_kg=null, complete=false`，不能把小计显示为整机质量。装配质量按零件质量求和，不把相交几何做融合后的体积当汇总值。

后续 Native P0 试点仅使用独立公开样件；P1 再验证 source/Link/Joint 实际 Frames、无求解和源文件保持。静态 XML 的 Rigid 报告不提供这些证明。运行缺引擎、来源越界或源装配状态不可确证，保持 manual，不能通过开关 Rigid、删除 Joint 或附着用户 GUI 完成采集。

最低样例矩阵：单实体、有孔最终体、历史特征不重复；等价单位、零/负/NaN/无单位密度；卡片与计算输入不同步、失效 UUID；无材料；同源三实例、嵌套、数量与缩放、混合材料、一个缺件/未知材料；修改几何/卡片/外部映射后的新鲜度。解析、TS 单位模型、mock 进程和真实隔离 Native 分层验收，不把 mock 通过当原生证明。

## 高级出图分期

主目录现有新稿仍拒绝 Assembly/Joint 依赖，批量总成只供研究/人工；维护精确补丁不包含任意 X/Y/Scale/References2D，且当前维护为单页。现有新稿 Front/Side/Iso 不等于“完整三正投影加标准 ISO”；多页、总成新稿、坏引用自动修复、旧图重排仍未实现。

| 阶段 | 最小增量 | 验收和停止条件 |
| --- | --- | --- |
| G0 来源保护 | 只读页面图谱，冻结精确源/依赖、模板、Page Name/顺序、视图/标注依赖、真实引用、Link 位姿与 Joint 实际 Frames | 源 Assembly/Frame/无求解无法确证即 manual；不因新按钮放宽旧拒绝条件 |
| G1 自有多页新稿 | 公开单件新建两页，明确 page id/顺序/模板/比例与分卷 PDF | 页数/标题栏页码/模板/逐页 PDF/缩略图/最终 ZIP 独立重开一致；不碰旧人工页面 |
| G2 公开静态总成 | 明确实例清单的正常视图，追加真 ISO、同向爆炸和 BOM | 从零独立样件；ISO冻结 Direction/XDirection及投影口径，爆炸只移动生成副本，不移动/保存源；不可扩为任意装配自动求解 |
| G3 安全修复试点 | 先对明确范围和唯一真实映射做精确修正预览 | 坏 Edge/Vertex 不猜接、不用固定文本掩盖；缺映射/拓扑变化/尺寸几何不一致为 manual |
| G4 旧图布局建议 | 只读提出指定页/视图布局差异，先新版本输出，再选择性应用位置策略 | 不重生成覆盖人工页；保留节点 Name、真实尺寸引用、材料、公差、技术要求及未选项；碰撞或语义变化拒绝 |

G2 的 BOM 必须明确装配 owner、展开层级、实例/数量、排除/镜像规则；不能退回文档所有 root，也不按 basename 去重。输出字段默认不含绝对路径。表格与图框上缘同宽、自下向上布局只是产品布局方案；行数超限需分页/明细页，不能遮盖视图或技术要求。官方 [BomObject 实现](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/Assembly/App/BomObject.cpp) 的 owner/分组/文件路径行为说明需要显式范围和字段过滤，不代表 Tool 已接入。

沿用最新主目录已有守护：真实投影与有限 Edge/Vertex、实际字高和 ISO 引线、源指纹/Link/Joint状态、自有 PID 与私有配置、停止后等待进程关闭、最终 ZIP 后独立原生重开。PNG、PDF 与 Page 分别验收，页面看起来正常不证明图框资源和引用有效；原生 ZIP 顺序和嵌入资源处理继续遵守维护规范。

公开 study 的同向 ISO/爆炸/原生表格可作研究样板，不证明嵌套/抑制/镜像或任意总成守护。研究稿、生成成功、正式工程批准分别计数；完整工程标注、公差与工艺审查不能由自动布局代替。

## MD 兼容与工程分工

见 [CAD 伴随文档兼容规划](CAD伴随文档兼容规划.md)。第一步无损保存数字版次、P/P1/P2 或未知 variant，并绑定明确 source/drawing/node，不改旧零件键。兼容新用途后缀、旧 `.Drawing.ai.md`、裸同名说明；同用途不同内容候选冲突可见，不自动合并或覆盖。新说明输出、防覆盖集合和 generated PDF 识别同批调整。

工程侧提供明确迁移映射和活动/历史边界，Tool 不读取私人清单来构造公开测试，不改工程生成器或正式路径。初稿序号与独立输出目录权限分离。

## 每阶段交付和停止规则

每阶段保存实际代码名单、版本化契约、独立样件测试、原生实证范围、源/输出指纹及未实现项。失败原因进入 Bottom 并自动显示；成功进度不抢日志。关闭显示不取消，取消失败不伪完成。任务定义可复用，运行授权不可跨输入/版本复用。

出现第二套执行权、未声明写入、越界/指纹变化、仅 stamp 冒称全 hash 新鲜、源对象/实例身份丢失、未知记零、文档 variant 折叠、自动猜接引用、覆盖人工文档、源求解/Frame保持无法证明或进程未 close 就释放资源时，停止该阶段。只读独立项可继续，不把受影响写入和下游当安全项继续。

主目录默认七个只读动作及原有独立领域工具保持；V3 仅显式 host 单文件保存 BRep 试点，Web 只读展示。D0b 产品 MD 安全阅读页、通用 Native、缓存写入及 T2 受控写入仍按各自门禁推进；P0 纯输入核验不计真实物性完成。不新增无限制脚本或公网执行入口，不推送，不迁生产数据库。

关联：[首期任务书](../platform/统一批量任务管理任务书与实施规划.md)、[CAD 动作清单](CAD批量动作接入清单.md)。
