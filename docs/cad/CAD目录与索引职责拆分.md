# CAD 目录与索引职责拆分

状态：current

Owner：Desk Tools CAD maintainers

当前结论（2026-10-04 第二阶段）：已恢复基于 Wing 共享函数的手动全量索引与独立确认清理。
下面“只读诊断 / 共享扫描待做”均为第一阶段历史边界，现状以文末第二阶段回执为准。

## 目标与顺序（2026-10-03）

本轮先完成两个独立入口，再完成批量应用 FreeCAD 自定义属性。产品表/当前产品与正式 BOM 管理继续后置。任务完成状态统一维护在 [TODO](../TODO.md)，批量写入的安全边界维护在 [CAD 批量工具](CAD批量工具.md)。

1. **零件目录**：日常查询、筛选、PartKey 详情、关联文件及既有装配浏览。保留 `part_catalog` 深链接，不插入删除数据库或全量扫描命令。
2. **CAD 索引**：单独 `cad_index` View，显示工作空间、数据库/Schema、已有索引数量、最近扫描、异常和职责说明；只读刷新诊断不修改文件或索引。引导到零件目录、错误修正、文件详情局部刷新；全量扫描当前仍由 KT Auto CAD 执行，Desk 共享入口另列后续。
3. **批量属性写入**：独立批量工具 View，预览目标对象、字段、现值、拟写值与来源，逐文件/字段勾选后确认；不与属性计数修正混同。

## 实施边界

工作空间树的搜索在本机 Pinia 与浏览器存储中按工作空间分别记忆，刷新后恢复。下拉保留最近 5 条已确认搜索（回车、失焦或选择文件时记录），去重并将最近使用项前置；清空筛选不删除历史。空格分隔多个词时要求文件名/路径全部包含这些词，不区分大小写；只筛已有树数据，不额外扫描磁盘。搜索历史不写入工程文件、Git 或服务器。

当前 PartCatalogPage 已只有查询，旧 `fcstd_map` 全量扫描页已经删除。因此本轮是新增受限诊断入口，不是恢复旧扫描页。复用 `cadIndexStatusService`、Wing Schema/SQLite adapter；异常必须区分无数据库、无 CAD 索引、Schema 不匹配、读取失败与扫描未完成。不得把失败显示成 0 条正常。最后扫描时间仅展示记录，不据此声称磁盘已同步；文件缺失数来自已有索引，不偷偷扫描磁盘。

本阶段新页不执行 database/recreate、purge、DDL 或写入扫描记录。旧 `fcstd_map` / `bom_export` 会话迁移规则保持不变。

### 后续扫描恢复方向（用户讨论更新）

用户指出 CAD 不一定适合以 VS Code 为主要入口，确认可采用“恢复 Desk 入口、算法共用”的方向。之前退役的是重复实现，不应永久取消 Desk 独立使用能力。后续将共享扫描规划/解析/入库提炼为 Wing 能力，Desk Node Host 与 VS Code Host 分别适配文件访问、进度和取消；不依赖 VS Code 正在运行，不调用未经定义的插件私有协议。

代码核对：`kt-auto-cad/src/workspaceIndex.ts` 目前仍拥有完整入库与 BOM 构建，`fcstdTsReader.ts` 拥有 ZIP 轻读；Wing 已提供部分 XML/路径规则与 Schema。当前 writer 按整个工作空间标记缺失并替换派生引用图，不能直接套到局部目录：共享契约需明确全量/局部范围、保护范围外数据、写锁、取消、人工数据保留及 SQLite adapter。此项是下一阶段，不将本阶段只读诊断冒充已恢复扫描。

本轮更新 [数据与 API 真源](CAD数据与API真源.md) 及 [减法边界](Desk-CAD减法与保留边界.md) 中旧的“无任何索引页面”表述：允许 Desk Host 所需的只读诊断与明确跳转，不改变 Auto CAD 索引和 Phoenix BOM 正式数据所有权。

## 验收

- 缺失库读取不创建 `.phoenix`；正常/异常 Schema、失败扫描、不可读库有清晰状态。
- 零件目录列表/筛选/详情不变；两个 Ribbon 按钮和独立 Tab 正确，刷新与切换工作空间不串数据。
- 诊断无删除/重建操作；局部 XRef 刷新仍从指定文件详情确认，不暗中扩大范围。
- 批量属性仅对确认的计划/文件/字段写回，默认补缺失；冲突、歧义对象、图纸跳过；计划过期/文件变化拒绝写入，逐项反馈。
- worktree 完成测试、类型、构建、文档/架构门禁；隔离样本浏览器验证，禁止自动写入用户 CAD 原件。

## 实施记录

- 2026-10-03：已建立目标，已完成现状和删除边界核对；开始实现。
- 2026-10-04：worktree 完成职责拆分、批量属性写入与隔离浏览器闭环，按用户约定在验证后以独立中文提交、cherry-pick 提升 develop，不使用 merge、不 push。

## 验收回执（2026-10-04）

### 责任与去重复审查

| 要求 | 实现与证据 |
| --- | --- |
| 独立索引 View | `cad_index` 注册、CAD Ribbon / 单独 Tab、零件目录 Header 跳转；只读状态 API 位于既有 `cadIndexStatusService` |
| 零件查询保留 | `part_catalog` / `part_key_detail` 深链接不变；筛选、关联文件与既有装配 API 未替换；列表按工作空间刷新并拒绝迟到响应 |
| 不恢复旧扫描、不创建产品表 | 新页没有全量扫描、DDL、purge 或重建命令；旧扫描路由仍由退役契约测试约束；共享扫描与产品登记留在 TODO |
| 属性规则共用 | Wing 决定 BOM 根与字段补丁、文件名推断；单文件及批量共用 Desk XML writer / Count 兼容层；路径、受限发现、ZIP 限额和指纹复用 `fcstdBatchFiles` |
| 只写已确认内容 | 五个字段白名单，服务端保存计划，文件/字段默认不选；目录/工作空间/覆盖变更清空预览；哈希、10 分钟有效期、单次计划及原子替换 |
| 保留其他数据 | 图纸/多根跳过，冲突或非字符串字段不可选；不改 Label / XLink / 几何；索引未选字段原值（含大小写/空格）及人工 PartKey 不变；索引失败独立提示 |

### 浏览器真实操作

使用 worktree Web `49410` + 独立 API `48410`，临时工作空间包含一个模型、一个 Drawing 和独立 SQLite；没有操作用户 CAD 原件。内置浏览器连接故障及 Mac 锁定解除后，改用 Chrome 新标签完成，结束时恢复缩放/浅色并关闭该测试标签。

1. CAD Ribbon 显示独立「零件目录」「CAD 索引」「批量工具」。索引页显示 Schema `13 / 13`、索引 `1 / 0`、最近扫描 `done / attrs`，明确“可读取不代表磁盘已同步”，无重建/删除按钮。
2. 从相关工具回零件目录：查询 `not-a-part` 显示空态，清空后恢复 `100001.002`；点击进入既有详情，关联 FCStd 可见。
3. 批量属性 Primary 标题「批量工具」、功能 Block 第一位，包含六个等宽按钮。范围 `attrs` 预览 2 个 FCStd，Drawing 明确跳过，目标 `Body`，默认 0 文件 / 0 字段；已有名称保留。
4. 只勾选 PartNumber / PartVersion，确认框显示 `1 个文件 / 2 个字段`，默认焦点在取消。取消后两个样本 SHA-256 均不变；再次确认，仅模型改变，回执“已写入 2 个字段到 Body”。解压复核 Count 为 4、新字段带 CustomDefine 元数据、Label/原名称和 shape 内容保留，Drawing 哈希未变。
5. 再预览，已写两个字段显示“值已一致”且禁用。剩余字段支持键盘空格取消勾选；切换覆盖选项清空旧预览并禁用写入。迟到请求、跨工作空间、文件变化、过期及部分失败由自动测试覆盖。
6. 浅色及深色实际查看；Chrome 150% 缩放的窄内容区中，表格可滚动到所有字段，Primary 与正文各自保持布局。此项不是所有屏幕尺寸的穷举验收。

### 自动门禁与未覆盖项

定向 Server 5 files / 28 tests 和 Server/Web typecheck 通过：覆盖诊断只读、异常 Schema、字段白名单、非选字段保留、来源冲突、多根、图纸、计划过期、文件变化、符号链接、部分失败、原子替换回滚，以及文件已提交但索引失败的回执。健康检查测试使用独立空工作空间，禁止读取开发者当前 CAD 数据库。

最终 `pnpm test:registry` 通过：Server 72 files / 296 tests、core 11 files / 67 tests、Web 78 files / 419 tests，共 782 项。`pnpm typecheck`、`pnpm build:registry`（Web + Server bundle）、`pnpm verify:architecture`（358 源文件）、`pnpm verify:wing-dependencies`（7 个精确 Registry 依赖）、`pnpm docs:check`（154 文档）及 `git diff --check` 通过。构建既有 Rollup 注释/source-map/chunk-size 提示不作为错误，未改 manifest/lock、Wing 或其他产品仓。

FreeCAD 原生 GUI 对批量输出保存/重开、Tauri 安装包与 Windows SolidWorks 本轮未重跑；不得把合成 FCStd 字节/交互验证等同于这些外部引擎验收。旧 Header 非 props 警告的跨框架迁移仍不属于本轮。

2026-10-04 用户调整开发方式：本轮独立提交后 cherry-pick 到主库 develop，确认无遗漏再清理临时 worktree / 分支；后续在主库开发，不再为本低频项目常驻第二个 worktree。

## 联合整改目标与发布准备（2026-10-04）

用户已授权本专项调整 Wing 和 KT Auto CAD，解除其“共享索引不得消费本地候选”的限制；
三个仓库均在主库修改，不建立新 worktree，不修改 KT Auto Code，不 push/tag/publish。
上文的“诊断完成”是阶段回执，不代表以下共享索引已经完成。产品表继续后置。

1. **界面与来源基线**：Desk Header 按 Wing `center/right` 契约收敛；Desk 与 Auto CAD 均用
   `pnpm wing` 显式消费最新并列主库，`pnpm dev` 保持 Registry。正式依赖精确锁定，源码联调
   不直接改变发布依赖；缺失仓库/导出必须停止。
2. **共享核心**：先冻结 Auto CAD 现有扫描输入、文件名/XML 字段投影、XLink/BOM 计划和 SQLite
   写入行为，再提炼公共函数。Wing 不接收 Vue/VS Code/HTTP 产品接口；两宿主只保留文件发现、
   权限、UI 进度/取消及平台适配，不保留第二套算法。
3. **安全恢复 Desk**：CAD 索引独立 View 显式执行，进入不自动扫描。首轮扫描范围、排除和上限
   必须完整可解释；局部扫描不能冒充全量。人工 PartKey、文件关联、偏好、审计、outbox 和
   范围外资产不被清除。解析失败不把旧图静默覆盖成空；过期快照/工作空间切换拒绝提交。
SQLite 事务保证失败回滚，并验证两个宿主竞争、取消及 schema 不兼容。禁止“删除整库重建”。
4. **回归与归档**：共享函数固定样本、两消费者测试/类型/构建、真实临时工作空间 UI，最后
   区分本地候选门禁、正式 Registry 门禁与外部引擎人工项。每阶段独立中文本地提交。
5. **发布准备**：共享 API 稳定后列出 Wing scoped 包/两个产品的版本建议、依赖发布顺序、
   release note、制品检查与回退方法。只有相关 Wing 包正式发布后才提升消费者 Registry
   manifest/lock；此目标不包含执行发布。

当前进度：阶段一 Header 已验证；Auto CAD 新本地 runner 已通过 54 项本地/Registry 测试、
类型、架构、构建及 thin VSIX 门禁。Wing 此时尚未修改领域源码，共享扫描提炼尚待完成。

## 第二阶段：共享索引与用户缺陷收口（2026-10-04）

### 共享与 Host 边界

| 层 | 唯一职责 | 两端消费 |
| --- | --- | --- |
| Wing cad-core | XML 结构检查/字段投影、路径与排除规则、XLink 解析、基础 BOM 计划 | Desk 与 Auto CAD 直接调用相同公开函数 |
| Wing cad-contracts | Schema v13 事务写入、代数/写锁、人工数据保留；显式清理协议 | Desk 接 db-node，Auto CAD 接 node:sqlite |
| Desk Host | 受限文件发现/ZIP、文件快照、HTTP 任务、10 文件进度、确认和备份 | 不启动 FreeCAD，不复制 Auto CAD SQL |
| Auto CAD Host | VS Code 文件权限/发现、ZIP、进度/取消、Node SQLite adapter | 原 workspaceIndex 领域算法和 SQL 删除，保留只读搜索 |

普通更新仅接受完整工作空间，排除 `.git/.phoenix/node_modules/.venv/__pycache__`，最多
5000 个 FCStd。Desk 另有目录项上限；第二阶段原契约为超限、损坏 XML/ZIP、文件变化、取消、目录切换、
重复历史路径、Schema 不兼容或竞争批次均拒绝提交。只有空数据库可按公开 DDL 初始化；
已有数据库不自动迁移。普通更新保留人工 PartKey、文件关联与忽略状态，不清理排除目录资产。

基础 BOM 只是 XML 引用图，不等于 FreeCAD 几何实例或生产数量。多根工作空间由 Auto CAD
逐根提交；取消后已提交的前面根不会撤销，界面不得宣称跨库全部回滚。

### 2026-10-11 Desk 部分可用模式

Desk 更新索引现允许单文件 ZIP/XML 解析失败：在完整且稳定的目录清单内，正常文件继续提交，
失败资产标为 `error` 并保留已有身份、属性与人工关联。扫描状态明确为 `partial`，持久化失败数量
与逐文件原因；CAD 索引页恢复清单并自动打开 Bottom 日志。图册只消费 `present` 资产，BOM 明确
不完整，不能作为完整数量依据；失败宿主的旧派生图不冒充本次有效结果。修正后完整重扫可恢复 `done`。

这是 Desk 的独立 partial 写入适配，不改变 Wing 完整扫描协议，也不向完整 writer 伪报 `complete: true`。
超限、目录无法遍历、符号链接、扫描中文件变化、取消、目录切换、Schema 不兼容和竞争批次仍拒绝提交。
独立合成样本验证首次部分索引可供图册使用、人工资料保留、失败目标身份、修复重扫和事务回滚；
真实工程点检仅在本地，路径、失败清单、图像与日志不进入文档、单测或发布包。

锁审计补充：WASM 驱动 0.8.59 使用 `<数据库>.lock` 目录锁，原生 SQLite 使用 OS 锁，二者不能
只靠 `BEGIN IMMEDIATE` 互斥。Auto CAD 的统一 Node SQLite loader 现对所有读写持有兼容目录锁，
并由真实 WASM/原生驱动及子进程测试验证双向阻断；打开失败释放自己锁，不自动抢锁/删除残留锁。
异常退出遗留锁须先停止所有相关宿主后人工检查。第三方未遵守该锁协议的 SQLite 工具不得并发写库。

### 显式清理的例外边界

用户确认旧本地索引可丢弃，故增加独立「清理旧索引」，不等同于普通更新：

1. 只读预览文件、关联、引用与 BOM 数量；确认框默认“取消”，明示人工文件关联也会删除。
2. 写锁内重新核对代数/计数；自动复制当前 rollback-journal 数据库为同目录
   `phoenix-workspace.sqlite.before-index-reset-<时间>-<随机>.bak`。备份失败或日志模式不安全即停止。
3. 一个事务清空 CAD 文件资产、文件关联、派生引用/BOM 和扫描历史；PartKey 资料/备注、工作集、
   偏好、其他模块表和审计记录保留（审计资产外键按 Schema 置空）。不删除数据库或 CAD 文件。
4. 新的 `cleared` 代数使清理前的扫描失效。清理成功后用户再点「更新索引」，不自动扫描。
5. 恢复备份前须关闭所有写入同一库的宿主；备份是整库快照，恢复会回退快照之后其他模块的变化，
   因而不在运行中的页面提供一键覆盖。先保留当前库，再由维护者确认恢复范围。

### 实测回执

- 主库浏览器确认 Header 仅右侧操作，扫描状态与已处理文件位于 Primary 首个「索引维护」。
- 真实库只打开清理预览并取消；默认焦点在“取消”，原索引没有被本次点检清理。
- Welcome 实际将同一条目 CAD → Code → CAD，无刷新立即更新；测试后恢复原类型，console 无 warn/error。
  原因是保存更新 launcher 而控件读取旧 controller snapshot；现在读取同一 launcher 真源，不复制 Wing 状态机。
- 临时文件自动测试覆盖 23 文件的 10/20/最终 23 进度、确认清理/备份可读/重新建立、CAD 文件字节不变，
  以及解析失败、取消、文件变动、Schema 不匹配和跨工作空间任务。Wing SQLite 测试覆盖两连接写锁、
  过期代数、历史路径、人工信息保留、写入及清理中途失败的全事务回滚。
- 追加主库隔离 Web/API（49410/48410，独立配置、合成工作空间）浏览器闭环：进入不扫描；确认更新
  23 文件成功；确认清理后显示备份路径；再次更新成功，零件目录显示 23 键。备份和当前 SQLite
  `integrity_check=ok`，两者各保有 23 PartKey，合成 Document.xml 内容全部未改。
- 不把自动测试替代原生 FreeCAD、Tauri 安装包、Windows 或 VS Code Extension Host 人工验收。

### 发布准备与剩余门禁

新 API 当前只在主库本地 Wing 中存在；正式依赖仍是可验证的 Registry 精确版本，不填写未发布版本。
Desk 新增 `cad-contracts@0.6.3` 正式依赖；Auto CAD 三包仍为 `0.6.2`。这两套正式版本均不具备
本轮全部新导出，因此当前源代码 **不能视为 Registry/发行已就绪**。`pnpm wing` / 本地门禁用于验收候选。

建议顺序：Wing CAD core/contracts 以兼容新增 API 的 minor 候选准备（建议 `0.7.0`，最终依其独立包矩阵），
Schema DDL 未变，不因索引函数改动而升 Schema；相关包正式发布后，两个消费者同批精确更新 manifest/lock，
再跑 Registry 测试、构建、Desk Tauri 与 Auto CAD thin VSIX 门禁。根 UI 的 `0.7.7` 与 CAD 子包版本独立。

Desk 当前本地 manifest/tag 仍为 `0.4.0`，与用户口述已发布 `0.5.0` 不一致，未查询远端或改写历史；
正式定版需先对齐已有发布，若 0.5.0 已发布则建议下一版 0.6.0。Auto CAD 新共享索引建议 0.3.0，
身份与 Shell API v2 不变。本轮不改产品版本、不 push/tag/publish、不改 KT Auto Code。

人工点检表：

- [x] 在临时工作空间从空索引确认更新；Primary 显示完成 23 个，零件目录能查询（10 文件节流由自动测试验证）。
- [ ] 再次更新、取消、损坏样本失败时，原人工字段/关联和 CAD 文件字节保持预期。
- [x] 清理确认先取消，再仅对临时样本确认；备份/PartKey 保留、重新更新成功；偏好保留由事务测试验证。
- [ ] VS Code Host 对同一临时样本扫描和查询，验证与 Desk 结果一致及竞争明确失败。
- [ ] Wing 发布并精确升级后，Registry build、Tauri macOS/Windows、VSIX 安装/启动分别留证。

### 最终门禁回执

三仓主库归档：Wing `12d3902`（共享 API）、Auto CAD `96b6a84`（消费与混合驱动锁）；
Desk 本轮提交包含本节回执。前一阶段 Header 为 Desk `4e0cb48`，本轮不重写历史、不推送。

- Wing `pnpm verify:ci`：104 文档、249 源文件架构、12 包矩阵、全 workspace 测试/类型、聚合
  dist、11 份 npm tarball 隔离消费、CAD Rust tarball 全通过；本轮直接相关 core 36 / contracts 49 项。
- Desk `pnpm test:local-wing`：Server 234 + Core 67 + Web 511 = **812 项**、类型/品牌通过；
  `pnpm build:local-wing` 的 Web 和 Server bundle 通过。最终排除目录改为直接引用 Wing 常量后，
  再跑类型、相关 Server 15 项和 Server bundle 通过。文档 155、架构 333、精确依赖 7 项及 diff check 通过。
- Auto CAD `pnpm wing`：16 files / **59 项**、公开声明类型、31 源文件架构、11 个精确依赖与
  本地 bundle 通过；其中 4 项混合驱动锁测试含真实 WASM 子进程。测试专用 WASM 不加入运行 bundle。
- 反向确认正式来源：Desk `pnpm typecheck` 因 Registry 无新导出而失败；Auto CAD
  `pnpm release:check` 因同一原因在测试阶段失败，未进入正式打包。不是忽略失败或降低门禁，
  而是明确等待新的 Wing CAD 包发布。上文第一阶段 Registry/VSIX 成功不适用于此候选。
- 本轮没有运行 VS Code GUI、Tauri 安装包或 Windows 原生引擎；没有以本地 bundle 发布制品。

## 2026-10-04 界面收敛补充

- CAD 索引移至零件目录之前。Primary 首个维护 Block 以名称/值两列显示工作空间、扫描进度、
  数据库、Schema、数量和扫描记录；不再重复工具介绍。Main 负责功能说明与操作引导，使用三个
  默认展开的 Wing Block：如何维护、遇到问题时、范围与注意事项。折叠与键盘/ARIA 由 Wing 管理。
- 移除 Desk 的旧三角 SVG 折叠图标覆盖，恢复 Wing 默认箭头。Main 内容排版不重造 Block 外壳。
- Wing Header 的短标题按内容占宽，center 使用剩余宽度。零件目录筛选按实际 center 宽度在
  完整单选和紧凑下拉间切换；Primary 仍保留全部筛选，消费者没有私有 Header 网格覆盖。
- 文件详情将四个内容 Tab 放到 Header center；页内标题与操作共用单行工具栏。
  编辑属性最终采用「名称 / 原值 / 编辑值 / 操作」四列，一行一个属性；恢复只改当前编辑值，
  不触发写入。仓库相对路径不是 BOM 属性，放在表格下方只读单行。文档类型与匹配选项共用一行。
- 移除重复「去改名」，Header 的改名弹窗优先带入当前文件名草稿。三个引用修正选项首次默认全选，
  Pinia 共享并持久保存选择；每次执行固定当次选项快照。部分引用/标签修正失败保留警告与分析入口，
  不再显示成全部成功。全选仅覆盖本次改名与索引可解析的入向宿主，不保证漏索引或其他引用问题自动修好。
- 旧 PartName 含 `.ASSY` 导致推荐后缀重复，修复落在 Wing cad-core 共享组合函数；只修推荐结果，
  不擅自改写实际模型、属性或文件名。两个 Desk 推荐入口均用临时样本验证。

浏览器已确认 Primary 元数据位置、三 Block 默认箭头和键盘折叠；框架 Header 示例的 380px
窄容器与浮出/收回保留输入通过。文件详情四列与约 35px 行高、单行选项条通过读取页面几何验证。
点检未点击实际工作空间的写入、改名、更新索引或清理操作。新增批量「名称统一」独立实现与验收见
[CAD 批量工具](CAD批量工具.md)，不把本节 UI 点检当作批量真实数据执行授权。
