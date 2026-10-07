# Phoenix Desk Tools 当前待办

状态：current

Owner：Desk Tools maintainers

适用范围：develop；历史发布线和评分不作为当前验收结论

最后整理：2026-10-07（0.5.0 本地归档、隐私整改与版本准备；不承诺后续完成日期）

本文件是唯一维护的产品/技术债入口。旧总清单、Git 与 CAA 的逐项完成记录分别保存在 [`archive/TODO-2026-07-17.md`](archive/TODO-2026-07-17.md)、`TODO-GIT.md`、`TODO-CAA.md`，只读不再更新。

## Code 产品收敛（2026-10-04）

- [x] 退役 Code 索引/扫描、成员排序、批量改名、UUID 替换和自动代码；Code 区仅保留忽略设定与 CAA 对话框。移除改名后重扫依赖、专属前后端实现、Codegen 依赖与正向发行用例，新增旧 URL/会话回退和 API 404/数据保全门禁。
- [x] 保留用户工作空间数据库、源文件、旧偏好与 CAA 独立索引；不修改 KT Auto Code/Wing。详见 [退役边界](code/Desk-Code功能退役.md)。

下文已完成的 Codegen/UUID 共享试点与历史打包证据不再表示 Desk 当前提供这些工具，也不恢复原来的双端复刻计划。

### 独立批量改名与关联文档同步分离（2026-10-06）

- [x] 第一阶段：新增通用「批量改名」View（`rename_tasks`），不依赖 CAD 历史。一个工作空间可保存多个命名任务，每个任务包含可编辑/启停的 A→B 列表、目录列表与匹配选项；支持新建、复制、保存、反复预览和勾选应用，最近 30 次尝试保存在工作空间 SQLite。通用执行器复用 Wing Code 一次字面替换与既有文件安全/备份逻辑，原 CAD 页面不切换流程。
- [x] 补齐当前关联文档同步的记录/文件勾选缓存、Block 标题动作、按目录缓存后缀筛选；隐藏项不参与应用。两个入口统一阻止 CATPart、CATProduct 等关联模型和 FCStd 普通磁盘改名；CATDrawing、STEP/STP 勾选后仅改文件名，内部内容及引用保持不变。
- [x] 本地归档前补齐：刷新保留当前任务并使旧预览失效；保存期间的新编辑不被响应覆盖；任务版本变化/删除后拒绝旧预览；目录选择取消与跨工作空间的迟到响应不添加目录；确认期间勾选变化不扩大写入范围。
- [x] 两个批量入口统一清理隐藏、过期、重复及不可执行勾选；执行后的未选项显示“未应用”，后缀筛选空结果单独提示；文件名碰撞检查补齐 Unicode NFC 等价名称。
- [x] 修复本地 Wing 前端类型检查的声明路径与 Vue 单实例解析；参数化测试标题加唯一序号，测试目录发现 194 个模块且无重名/加载错误。本地消费端 1,262 项测试与 Web/Server 构建通过；最终相关用例另行复测。隔离浏览器验证筛选、取消、三文件应用、复制与任务刷新；不代表 Registry 发行或真实 CAD 保存/重开验收。
- [x] 普通改名 Primary 仅保留 A→B，已移除左侧 radio；沿用右侧目录与勾选范围，文件名和内容可同时勾选，文件夹暂独立执行（联合勾选待办见下）；文件夹模式不改处理根目录，子目录优先，检查冲突和预览后的变化，不自动修复内容引用。规则与历史对照表均有编号，历史后续路径在右列分行显示，规则表可独立折叠。
- 草稿恢复按用户决定不做；不新增一键撤销。普通批量改名按用户要求取消自动备份和应用确认弹窗；用户自行备份，通过自己的 Git 或备份恢复误改，保留任务尝试摘要和逐项结果。
- [x] 关联文档同步收敛为历史选择、连续链折叠、冲突提示和 A→B 核对；只读 resolve API 生成最终字面规则，以 v1 配置交接对象（工作空间、来源、任务规则、目录与选项）转到独立批量改名。目标只新建任务，不覆盖已有任务，不传 plan/文件勾选，不自动预览或应用。
- [x] 目录、后缀筛选、文件预览、结果与执行统一在批量改名中；原关联页目录和选项按工作空间带入，新文件选择从空开始。Primary 增加普通查找 A→替换 B，使用当前任务目录（无目录时用工作空间），创建独立任务并预览；CAD 专用文件改名和引用修正仍留在领域入口。旧服务端 preview/apply 仅保留兼容，关联页不再调用。
- [ ] **待安排：三个范围联合执行**。Primary 改为文件名、文件夹名、文件内容三个独立 checkbox，可同时勾选。已核对旧 VS Code 工具 `kt-auto-code/src/core/workspaceRename.ts` 支持 `levels: dir/file/text`，执行顺序为内容→文件→目录；Wing `packages/code-core/src/pnwCodeRenamePlan.ts` 的 `pnwPlanCodeRename` 提供三范围纯规划，但文件系统读写仍由宿主负责。优先复用并适配 Desk 多目录、选中行、嵌套路径、预览指纹和冲突跳过；只用合成样本验证任意组合、部分选择、父子目录最终路径和外部变化。遵循用户决定，不新增自动备份或应用确认弹窗；本次归档不包含此执行改造。
- [x] 表格列宽调整：编号窄列、时间与操作固定宽度、结果占剩余空间；筛选后保留本次预览原始编号。
- [ ] 任务后续维护：按真实需求评估任务归档/删除和完整运行回执浏览；第一阶段保存配置和尝试摘要，旧版本已生成的备份保持原状；新操作不生成自动备份，不宣称支持一键回滚或跨文件原子事务。
- [ ] STEP 隐私清理：普通改名已禁止 STEP/STP 内部文本替换；单独评估默认关闭的头部路径清理，只对 HEADER 的 FILE_NAME 首参数去掉目录、保留文件名。须验证转义、Windows/POSIX 路径、缺失/畸形头部、非 ASCII 名称及 DATA 段字节不变；不把这一项宣称为完整脱敏（作者、组织、描述也可能包含隐私）。

验收范围：空工作空间无需 CAD 库即可使用；不同任务/工作空间互不污染；旧任务版本、过期计划及重复提交拒绝；后缀隐藏项不进入批量选择；只用独立构造的临时文件做写入测试，不对真实工程自动执行。

## P0：联合治理

- [x] 0.5.0 本地归档整理：本机临时数据移出 Git、工程导出替换为独立合成夹具、私人点检清单移到仓库外；配套 Wing 0.8.0 / CAD 子包 0.7.0 候选。范围及验证见 [归档审查](platform/0.5.0本地代码归档与隐私审查.md)。
- [ ] 发布历史范围清理：旧提交仍含已从当前树移除的日志、偏好、数据库或工程导出；正式对外前明确整理方案并复核历史。当前本地快照不代表全部 Git 历史可公开。
- [ ] Registry 依赖闭环：当前精确包缺少候选 CAD 接口，Registry Server 检测 168 项失败；待 Wing 获授权发布后升级精确依赖，再跑完整 Registry 和平台发行门禁。
- [ ] 正式发布前隐私门禁：以最终压缩/整理后的源码、文档、单测夹具、提交范围和实际发布包逐项审查；个人工程不得作为公开范本，真实样本与点检明细仅保留本地。检查附带日志、截图、配置、数据库、source map 和隐藏文件；未解决隐私项阻断发布。关键词扫描仅为辅助，不代替内容审查。
- [x] 拣选 FreeCAD 外部进程安全边界：realpath 拒绝 GUI launcher、子进程环境白名单、日志/异常/回执脱敏与输出限长。
- [ ] 来源分支记录的旧 GUI launcher 凭据撤销/轮换待责任方确认完成；不复制旧值或输出，未确认前保留其发布阻断状态。

- [x] 删除 Desk Codegen Apply 的纯投影副本，统一调用 Wing 公共入口；Desk 只保留权限、原子写、文件模式、备份与 rollback adapter。
- [x] 用 AST/import graph 固化 pure core、server host、Vue view 的依赖方向，并为例外记录 owner 和到期条件。
- [x] 文档首轮治理：全量分类、current 断链检查、TODO 单一真源和过时入口处理。
- [x] 与 Wing/Auto 建立 Analyze/Apply/Schema golden fixtures；Desk 直接消费 Registry 0.4.2，未知未来版本 fail-closed。

## CAD 推进顺序（按阶段验收，不设完成日期）

用户确认优先级：**1. 批量工具 → 2. 零件目录 / CAD 索引职责拆分 → 3. 产品能力**。先把小闭环做好，再进入下一项；不并行扩展产品表。本节维护状态，具体交互与安全约束见 [CAD 批量工具](cad/CAD批量工具.md)。

### 1. 批量工具与批量修正（当前）

- [x] worktree 完成统一入口：CAD Ribbon「批量工具」+ Primary「功能」Block，右侧独立打开错误修正、STEP → FCStd、SW → STEP、编号查重；复用既有 View/API，不复制转换引擎。`0bec01f` 已通过 cherry-pick 提升 develop，未 push。
- [x] worktree 完成错误修正：链接路径、属性计数可分别或一起分析，结果分类；勾选后确认写回，文件变化/范围切换后旧计划失效。属性计数修复不覆盖业务字段；隔离样本分析/取消/写回/复查已通过，回执见 [本轮验证](cad/CAD批量工具.md#本轮验证2026-10-03)。
- [x] 独立「批量属性写入」View：预览当前值 / 拟写值 / 来源，再勾选文件和字段；默认只补缺失，覆盖已有值显式开启。复用 Wing 根对象选择和文件详情 XML writer；目标不明/来源冲突不自动写。worktree 隔离浏览器已验预览、取消、两字段写回与复查，详见 [拆分验收](cad/CAD目录与索引职责拆分.md#验收回执2026-10-04)。
- [x] 文件详情装配标签按实际目标对象推荐，同级重复件按树序编号；单行/当前总成全部应用、数量展开、真实标签与最终目标链接通过用户多个文件逐个测试及保存重开。表格撑满、工具条合为一行、说明移至 Primary 末尾；文件详情视图上限由 8 增至 32，超限弹出警告且不丢已有草稿。见 [点检与隐私归档](cad/CAD改名与装配标签-点检隐私审查-归档.md)。
- [x] 名称统一批量改名封装为后台任务，逐个调用单文件改名入口，完成该文件引用修正后再处理下一项；局部映射随单项更新，批次结束只触发一次全量 CAD 索引更新。Primary 显示批量及索引进度；局部失败继续后续安全项，仅全局索引变化或改名后状态不明才停止整批。错误及宿主原因写入 Bottom 并自动激活运行日志，成功进度不抢面板；隔离 63 文件批次验证首项失败后其余项继续，不等同真实批量 FreeCAD 验收。
- [ ] 改名引用标签同步升级为对象级：现有文件级标签接口遇到一个文件中多个目标对象时安全拒绝，后置文件级规则名校验也可能误报；复用装配结构已验证的“宿主对象 + 目标对象 + 路径”精确推荐/写入和同级重复编号，限定到本次改名关联实例，不整体覆盖宿主或无关标签。路径成功与标签待修正分开呈现，支持只补修标签、不重复改名；保留多目标对象保护，不通过移除保护来消除报错。
- [ ] **模型改名后的关联图纸同步改名**：
  - 优先使用图纸内源模型引用与 CAD 索引确认对应关系；编号/版本只作辅助核对，不能仅按旧英文名或相似名称猜测。无唯一模型、图纸引用多个独立模型、目标重名等情况列为需确认，禁止自动覆盖。
  - 图纸名称采用模型新基础名 + `.Drawing.FCStd`；模型为 `示例组件.ASSY.FCStd` 时对应 `示例组件.Drawing.FCStd`，不是 `示例组件.ASSY.Drawing.FCStd`。普通零件 `示例支架.FCStd` 对应 `示例支架.Drawing.FCStd`；完整编号、版本、类型与型号前缀保持模型规则。
  - 先预览“源模型 → 图纸原名 → 图纸新名”，支持模型已完成改名后单独补修图纸；用户勾选确认后复用安全改名、指纹检查、备份及引用路径修正，逐项反馈失败，不重放已完成的模型改名。
  - 图纸不写 BOM 属性、不改图纸内容或几何；改动图纸文件名需修正其入向引用，整批结束统一更新一次索引。单测独立构造普通零件、ASSY、多图纸/多源歧义、目标冲突、来源变化与重复执行场景，不使用私人项目样本。
- [x] 批量属性目标零件名可编辑，浏览器草稿刷新保留；新预览校验后可单行写入或勾选批量写入。已有 PartName 优先、缺失时标签/文件名可选；默认不搜索图纸，开启包含图纸后只显示诊断不写入。
- [x] 工作空间树搜索按空间由 Pinia + 浏览器本地存储记忆；下拉最近 5 条去重历史，空格多词要求全部包含，不额外请求或递归扫描磁盘。
- [ ] 在工程副本验证批量改名后 FreeCAD 重算、保存、重开及引用；用户已确认的单文件改名通过不替代此项。
- [ ] 单独调查 FreeCAD 链接时间戳/部分重载提示及 Joint 待移除日志；用户确认当前引用名称修正完成，不以时间戳提示撤销这项验收，也不据此宣称所有 Joint 状态安全。
- [x] **新增「批量工具 → 总成链接标签修正」入口**（2026-10-05 已实现，真实 FreeCAD 批量副本验收另列）：
  - 搜索目录内预览，每个 ASSY 一行，显示待修正标签数量、可跳转文件详情及无法确认/失败原因；默认不勾选、不写盘，勾选后明确确认应用。
  - 复用已通过单总成测试的对象定位、目标显示名和同级重复件 `.001` 起编号算法；后台逐个总成应用，反馈进度、成功/失败数量及备份位置，不另写一套标签算法。
  - 只修改选中总成的引用实例 Label，不改文件名、XLink 路径、几何或被引用源文件。跨文件只读解析与写入范围分开；文件变化、身份歧义、缺失引用阻止对应项，正常项不可误报需修正。
  - 复用现有写前备份、原值/文件指纹校验与写后局部引用索引刷新；先验证局部刷新能否保证标签和数量显示一致。能保证则无需全量 CAD 扫描；确需全量更新时只在整个批次结束触发一次，禁止逐文件全扫。
  - 隔离自动测试覆盖预览零写入、重复编号、部分失败、已修改文件或引用目标拒绝旧计划、再次预览无差异；浏览器验证筛选、勾选和取消确认。影响范围小于文件改名，不因此省略写入安全检查。
- [x] 用户确认两组工程样本链接名正确；其中一组已试的几项批量标签修正在工具中查看正确（2026-10-05）。
- [x] 用户在 FreeCAD 打开其中一组工程样本，确认重复件 `.001、.002…` 按树中从上到下正确排序（2026-10-05）。
- [ ] 跨多个总成标签批处理的工程副本 FreeCAD 保存重开验收；工具内已检查的几项正确，不扩大为全部文件或原生保存重开通过。
- [ ] 后续局部入口：文件详情带文件上下文跳转错误修正，支持“仅本文件 / 含下级”，只扩大显式确认的范围；保留原全目录入口。

验收：分析不写 CAD 文件；取消不写；部分失败单独反馈；临时样本自动测试和 FreeCAD 副本重开。STEP/SW 外部引擎复用不等于本轮重新完成跨平台验收。

### 2. 零件目录 / CAD 索引职责拆分（共享候选完成，正式发行待依赖发布）

2026-10-03 已建立执行目标，范围与验收见 [拆分计划](cad/CAD目录与索引职责拆分.md)。本轮同时纳入上节批量属性写入；产品表不进入本轮。

2026-10-04 用户已授权专项修改 Wing / Auto CAD，并明确三个主库联合实施、点检归档和发布准备。
最新范围见 [联合整改目标](cad/CAD目录与索引职责拆分.md#联合整改目标与发布准备2026-10-04)；
不再因 Auto CAD 的旧本地联调冻结而等待。正式包依赖仍待发布后升级，不改 KT Auto Code。

- [x] Desk 全部 Header 按 Wing 0.7.6 的 center/right 迁移并完成宽窄屏/键盘验证；开发服务指向 Wing 主库 0.7.7 候选，正式 UI 包精确 0.7.6。
- [x] Auto CAD 增加显式 `pnpm wing` 本地公共制品 resolver；`dev/prepare/release` 继续 Registry，测试/类型/本地构建及 Registry VSIX 门禁通过。

- [x] 已核对现有页面/API，新增两个独立主入口：**零件目录**保留查询、筛选、文件/零件详情，**CAD 索引**承接只读状态、最近扫描范围、诊断、相关工具跳转；没有新增空的第三个 BOM 页。
- [x] 索引诊断复用既有 SQLite / Schema 真源，区分无库、Schema 不兼容、不可读、扫描未完成/失败与可读取；不创建库、不扫描磁盘。错误修正从相关工具进入；局部 XRef 刷新继续从指定文件详情执行。
- [x] 保留 `part_catalog` / 详情深链接和既有装配树/查询 API，不复制 BOM 后台；正式 BOM 管理/交付仍归 Phoenix BOM。拆分新增工作空间切换与过期请求保护。
- [x] Wing 统一 XML 投影、引用/BOM 计划和事务 writer；Desk/Auto CAD 直接消费，普通刷新保留人工字段/关联、排除范围数据；解析失败/取消/快照过期/竞争事务失败不覆盖旧索引。
- [x] Desk 恢复手动更新入口，不要求打开 VS Code；Primary 首个维护 Block 每 10 个文件更新进度，Header 只保留右侧动作。
- [x] 用户追加「清理旧索引」：显式确认删除文件关联并先自动备份，仅清 CAD 索引相关表；PartKey、偏好和审计保留，不删整库/磁盘文件。与普通更新分开。
- [x] Welcome 类型选择即时刷新，读取最新 launcher 偏好；浏览器 CAD/Code 双向切换通过。
- [x] 零件目录用索引字段指纹持久缓存 PartKey/文件关联投影：相同输入不再逐行重复写库，主文件路径在一次聚合查询中取得，不解析 FCStd 或递归装配；隔离 500 文件样本验证缓存命中与变更失效。
- [ ] 在实际大工程复核零件目录冷/热加载耗时；不把隔离样本耗时当作真实工程性能保证。
- [ ] 发布相关 Wing scoped 包后精确升级两个消费者，重跑 Registry/Tauri/VSIX 门禁；VS Code Extension Host 与平台安装包人工项仍需点检，见第二阶段回执。

验收：常用零件列表不夹杂危险维护操作；索引缺失/过期/失败有明确状态和可用入口；旧深链接可用，无新扫描/数据库真源。

### 3. 产品与后续 BOM 共用能力（正式产品表暂缓，零件图册先行）

- [x] 独立「零件图册」View：从产品总成沿文件引用提取内嵌 PNG，SQLite 缓存复用；卡片搜索、类别/子总成筛选、A4 预览和下载打印页；用户明确选择 Git 内目录归档同名 PNG，文档默认不归档。主库 Web 与隔离 Git 样本已验证，不修改 CAD、不自动提交 Git。见 [需求与实现记录](cad/零件图册需求.md)。
- [ ] 零件图册人工项：系统浏览器另存 PDF 与实际 A4 打印检查；高分辨率或统一视角渲染另行设计，不把 FCStd 内嵌缩略图当作最新几何保证。

- [ ] 设计产品登记表：一个主目录 + 一个主文件；编号、版本、名称等以主文件属性为真源。增加可空“派生自（基线产品）”，界面按编号.版本展示，底层稳定 ID 关联，禁止自指和循环，不自动继承/覆盖属性。
- [ ] 范围语义：新版主目录可引用旧版、标准件目录；BOM 沿实际 XLink 展开，不能只扫主目录。默认批量写入仅限主目录，修改旧版/共用目录须另列清单并确认；派生关系不等于 BOM 引用。
- [ ] 对齐 Desk / Wing / Phoenix BOM：Desk 是本地 SQLite，BOM 是服务端数据库，共用的是领域契约、规则及版本化交换格式，不是直接共用一个 SQLite 文件。确认 schema 所有权、增量迁移和人工数据保留后再落表，避免创建后又复制另一套。
- [ ] 之后才接“当前产品”选择、持久化、BOM 消费和跨产品操作提示；多窗口状态/并发写入冲突必须有检测。

验收：主文件身份可追溯；跨版本/标准件引用不丢；基线无环；索引维护不丢产品数据；BOM 端有真实契约测试再宣称共用完成。本轮不建产品表、不改 Phoenix BOM。

## P1：MVC 与复用
- [x] 在 KT Codegen 页实现 Page Param + UI-neutral PropertySchema + derive 试点，明确 Model、ViewModel、Controller、Host adapter 数据所有权。
- [x] 提炼 UUID/GUID 与 workspace path 两项无 UI 纯能力；扫描/格式/计划与相对路径规范/包含关系由 Wing 唯一实现，Desk 只保留编码、I/O、SQLite 和 UI adapter。
- [x] 通用 Primary 复用 Wing 折叠头，收敛上下文/摘要/分组计数，并按控件类型提供紧凑双列与单列表单布局。
- [ ] 所有新公共算法必须进入 Wing 或有不晋升 ADR，不得继续写入超大 Vue 页面。

## Git

- [ ] 完成分区批量预览、`GitFilePage` 和点文件开 Diff Tab。
- [x] 随成员排序退役删除其 spike Git 路由；保留工具继续走壳层 `/api/git/*`。
- [ ] 完成分侧停靠/分割条人工点检，并评估 `diff2html` 与 `status-paths`。
- [ ] 其它写盘工具通过共享 HTTP adapter 接入，不各自启动 subprocess。

## CAA

- [ ] 用真实 CAA fixture/编译确认 Widget construction、MultiList `SetColumnTitles` 与字段绑定签名。
- [ ] 完成 left/top drop、span resize、ROWRES/COLRES 和 Group/MultiList/Button 的实机 UI 复测。
- [ ] 推进对话框索引与多 Tab；复杂表达式和无控件 ID 线索继续保守只读。
- [ ] `catdlg-core` 对外迁移只在第二个消费者出现且契约稳定后实施；Electron 壳不进入当前承诺。

## CAD 与运行可靠性

- [x] 拣选 CAD 去重复实现：退役 FCStd 全量扫描、索引管理和 BOM 导出页面；保留索引只读查询、本地文件写事务与外部引擎适配。
- [x] 拣选 FreeCAD 写回修复：保留动态属性元数据，更新既有索引的字段与 XRef 投影，并提供真实样本隔离点检脚本。来源点检方法与历史回执见 [CAD 关键写操作点检与评分](cad/CAD关键写操作点检与评分.md)。
- [ ] develop 当前安装版仍需 UI/Host 写事务、FreeCAD 保存/重开与进程生命周期复验；来源分支历史评分不自动继承。

- [x] 用 release profile Wing Rust 二进制和真实 `Document.xml` 构造 FCStd archive，自动验收协议读、XLink 修改、修改后复读与精确字节回滚。
- [x] 曾从 0.2.0 源码构建 macOS arm64 Tauri `.app`，自动验收真实启动、隔离用户数据、Codegen Apply、FCStd 读取和 sidecar 正常回收；该回执作为历史基线保留。
- [x] `fcstd_map` 已通过分页 API 与页码/页大小状态避免全表加载；大型 UI 目标进一步把查询、分页和 session 规则移入纯 ViewModel。
- [x] FCStd ZIP/Document.xml 读取、BOM 写回、XLink/Label 修复和 SQLite 查询统一使用 TypeScript；XML 领域投影进入 Wing cad-core，Desk 只保留 ZIP、文件系统、原子替换和产品事务。
- [x] 删除 Desk 的 `cad-rust-source`、native provider、三个 CAD Rust sidecar 构建/打包/状态 API 和发行版自检；Tauri 仅保留桌面壳自身的 Rust 生命周期代码。
- [x] 建立 [2026-07-20 Web / Tauri / CAD 手动点检表](platform/2026-07-20-Desk-Web-Tauri-CAD手动点检表.md)，统一覆盖端口、首开 View、四区布局、Primary、Codegen、CAD TypeScript 与 release。
- [x] CAD 索引扫描统一以 AsyncProgress 轮询终态驱动；刷新恢复复用同一 poller 并重新注册服务端取消，终态/异常注销 cancel，避免页面出现第二套扫描状态。
- [x] 完成 [Desk API 单实例与多宿主发现](platform/Desk-API单实例与多宿主发现.md) 的近期范围：API 原子锁、Web/Tauri 登记发现与兼容复用、后台归属和版本显示。
- [ ] 决定 Desk 多 UI 策略。近期建议采用“单 UI 宿主并明确拒绝第二个 UI”；若选择 Web/Tauri 同开，必须先实现后台工作空间 revision、状态广播和切换冲突处理。
- [ ] 继续把其它长任务的进度、取消与运行日志收敛到 AsyncProgress，不让页面各自维护第二套任务状态。
- [ ] 将剩余 Python 兼容入口逐项判定为外部引擎 adapter 或退役路径；Node/Hono 是当前 HTTP 真源。
- [ ] **用户手工验收**：在自有 Windows 机器执行当前 NSIS 构建/安装/退役 Code API 404/FCStd/退出/卸载门禁，回传脚本生成的 JSON 回执与最终成功日志；Codex 不连接远程 Windows、不创建 GitHub 镜像。FreeCAD/SolidWorks 外部进程 E/F 档仍需独立环境；历史 0.1.0 Windows 产物不计入当前版本。

## 后期：大型 UI 拆分

2026-07-18 的联合成熟度记录只作为历史基线。当前优先 `UnitTestsPage.vue`、`CaaDialogEditorPage.vue`、`AssemblyTreeTable.vue`；`FcstdMapPage.vue` 已退役，以下拆分记录仅作历史参考。拆分前继续禁止向这些文件加入新的领域算法或数据库真相。

- [x] `FcstdMapPage.vue` 第一切口：资产行投影、查询/分页规则和 v2–v4 session 迁移进入 UI-neutral `fcstdMapViewModel.ts`，页面从 1,208 行降到 1,161 行；纯测试与页面边界测试已建立。
- [x] `FcstdMapPage.vue` 第二切口：entries 加载、loading/error、filter/pager 与单一 debounce 已进入可注入 fetch port 的 `useFcstdMapEntries`；扫描任务、purge、export、Shell 和 localStorage 未进入列表 controller。页面现为 1,111 行。
- [x] `FcstdMapPage.vue` 第三切口 A：其余三个 Desk 大页面均已建立首条边界；索引 pane 的搜索/筛选、12 列、行身份/动作、三类空状态、分页和 Page Host/session 真源已由 4 项 characterization 冻结。
- [x] `FcstdMapPage.vue` 第三切口 B：单消费者 `FcstdMapIndexPane.vue` 已拥有索引列表 DOM、12 列 UI 定义、展示投影和 scoped style；三组筛选由受控 `v-model` 回到 Page，分页与打开动作只发语义事件。Controller、扫描/purge/export、Shell、localStorage、session 和导航安全复核继续留在 Page；Page 从 1,111 行降到 851 行，Pane 为 290 行；滚动、筛选、空状态和窄宽度按 [CAD 索引面板人工点检](cad/CAD索引面板-人工点检清单.md) 留证。
- [x] `FcstdMapPage.vue` 第三切口 C：单消费者 `FcstdMapSettingsPane.vue` 已拥有扫描说明、工作空间路径、JSON 导出入口与调试 SQL DOM/style，只收四项受控输入并上抛 `exportJson`。Page 继续唯一拥有 export API/log/refresh、scan/purge/prefs、Pinia、localStorage、PageSession、Primary、Prompt 与 Host；同时删除八组无消费者旧 scoped CSS，页面从 851 行降到 661 行，见 [CAD 索引设置页面壳验收](cad/CAD索引设置页面壳验收.md)。
- [x] `FcstdMapPage.vue` 扫描 controller：启动/防重、冲突确认、终态、取消、刷新恢复和异常提示进入可注入 `useFcstdMapScanController`；Page 只接收完成结果并刷新数据/分页/onboarding，真实 FCStd/FreeCAD 与展示 Pane 均不承载任务真相。
- [x] `UnitTestsPage.vue` 第一切口：确认既有 Pinia store 继续作为 session 真源；运行范围勾选迁移、结果过滤/分组、通过率/摘要和 run options 组装已进入 UI-neutral `unitTestsViewModel.ts`，并由边界测试锁住 plan/stream/cancel API 仍归 Page Host 层。页面从 2,214 行降到 2,152 行。
- [x] `UnitTestsPage.vue` 流式 Controller 拆分前基线：启动状态、stream/cancel 端口、start/case_done 副作用、成功结果同步、watchlist 分支、无结果/终止/异常与 finally 解锁已由 5 项 characterization 冻结；下一提交只迁移编排责任。
- [x] `UnitTestsPage.vue` 流式 run controller：stream/cancel、AsyncProgress、Host 运行日志、唯一 `running/result` 与终止/异常收口进入可注入 `useUnitTestRunController`；Page 保留 Pinia/session、范围门禁、request 组装、watchlist/history 和结果筛选。Controller 同时拒绝重叠运行并把重复终止收敛为一次；页面从 2,152 行降到 2,101 行。
- [x] `UnitTestsPage.vue` plan controller：计划 transport、`plan/loading/error` 与 request epoch 进入可注入 `useUnitTestPlanController`；只允许最新请求提交 success/error/finally，关闭范围会使在途响应失效。计划发现只发送 suite、关注排除和 case detail，不再携带旧计划的 `include_modules`；Page 保留模块勾选同步与 catalog。
- [x] `UnitTestsPage.vue` RunScope page shell：单消费者 `UnitTestRunScopePane.vue` 已拥有运行范围 DOM、局部折叠、列定义、纵横滚动和 scoped style；行投影进入纯 ViewModel，所有持久状态、Controller、Host、Primary contribution 与 request 组装仍归 Page。Page 从 2,131 行降到 1,810 行，实测记录见 [Unit Tests 运行范围页面壳验收](platform/UnitTests-运行范围页面壳验收.md)。
- [x] `UnitTestsPage.vue` Watchlist page shell：描述/56 字摘要/日期/suite/status 进入纯 `projectUnitTestWatchlistRows()`；单消费者 `UnitTestWatchlistPane.vue` 已拥有关注 DOM、9 列表格、scoped style 与 360px 内部横滚，只收五项受控输入并上抛十类语义事件。Page 继续唯一拥有 Pinia、localStorage utility、catalog、确认框、Run Controller、Primary 和 request payload；页面从 1,810 行降到 1,437 行。既有“全部复测”实际要求勾选且只跑 checked IDs 的问题只记录、不在视觉提交中修复；见 [失败关注页面壳验收](platform/UnitTests-失败关注页面壳验收.md)。
- [x] `UnitTestsPage.vue` Result pane：摘要、进度比例、筛选控件、模块表、case 展开/空态与横滚进入单消费者 `UnitTestResultPane.vue`；Page 保留过滤集合/纯投影、Pinia、Run Controller、watchlist 与 request payload。
- [ ] `UnitTestsPage.vue` 后续产品切口：另立行为提交决定“全部复测”是改名还是允许无勾选时发送全部关注 ID；不要混入 Result pane 视觉拆分。
- [x] `CaaDialogEditorPage.vue` 第一切口：IR/session 校验、NLS map 清洗、历史栈裁剪、source text 脱敏和草稿/dirty snapshot 组装已进入 UI-neutral `caaDialogSessionViewModel.ts`；`usePageSession`、解析、草稿 API 与写回继续由 Page Host 层负责。页面从 1,898 行降到 1,795 行。
- [x] `CaaDialogEditorPage.vue` history controller：先用 characterization 冻结按钮、快捷键、10 个编辑调用点、PageSession 与 Host/API 契约，再把 snapshot/record/restore、undo/redo/reset 和两个栈迁入可注入 Page-local refs 的 `useCaaDialogHistoryController`。Page 继续持有 local session、dirty/clean、Pinia/sidebar 镜像、解析/草稿/写回与 active-tab 路由；页面降到 1,757 行。
- [x] `CaaDialogEditorPage.vue` NLS session ViewModel：IR/草稿构建、snapshot current overlay、六项 NLS dirty 与 key 数量差异投影进入 UI-neutral `caaDialogNlsSessionViewModel.ts`；Page 继续持有六个 refs、active locale/canvas 翻译、History 与 locale API/IR side effect。页面从 1,757 行降到 1,731 行，兼容契约见 [NLS 会话 ViewModel 验收](caa/CAA对话框-NLS会话ViewModel验收.md)。
- [x] `CaaDialogEditorPage.vue` Canvas Controller baseline：按函数区段冻结选择双向镜像、删除守卫与回选、ROWRES/COLRES toggle/set、Builder add/insert/setChildren、既有 NLS 清理差异、Delete/Backspace 输入避让和 Host API 禁入；责任图与提炼点检见 [CAA 对话框画布命令责任与提炼点检](caa/CAA对话框-画布命令责任与提炼点检.md)。
- [x] `CaaDialogEditorPage.vue` Canvas Controller：选择、右键/Drop 临时状态、ROWRES/COLRES、直接删除、Builder add/remove/insert/setChildren 与 `CAA_CONTROL_KEY` 组装进入可注入 Page-local refs/ports 的 `useCaaDialogCanvasController`；Page 继续拥有 Pinia、active Tab、键盘、PageSession、parse/draft/save/write、Shell 与 locale UI。C1–C8 和 direct delete 不清 NLS 的既有差异均由行为/边界测试锁定，Page 从 1,731 行降到 1,489 行，Controller 为 327 行。
- [ ] `CaaDialogEditorPage.vue` 后续切口：先完成人工 Canvas 交互点检，再单独评估 NLS save/write Host 编排；不在该评估中拆 1,011 行的 `CaaDialogGrid.vue`，不改变真实写盘协议。
- [x] `AssemblyTreeTable.vue` 第一切口：递归树行/多实例投影、角色与状态语义、展开视觉状态、标签编辑比较、规则预览和写盘 patch 投影已进入 UI-neutral `assemblyTreeViewModel.ts`；组件保留懒加载、弹窗与宿主动作，从 1,213 行降到 1,030 行。
- [x] `AssemblyTreeTable.vue` 第二切口：单消费者 `AssemblyTreeRowGroup.vue` 已拥有主行/多实例附加行 DOM、五列单元格与行级 scoped style，只接受受控投影并上抛五类语义事件；Page shell 继续唯一拥有 API、Shell、替换弹窗、展开/懒加载/编辑 Map、公开 props/events/`defineExpose`。父组件从 1,030 行降到 517 行，RowGroup 为 618 行；Browser 真实 DOM、360px 双向滚动和交互证据见 [装配树行组件页面壳验收](cad/装配树行组件-页面壳验收.md)。
- [x] `AssemblyTreeTable.vue` 展开 Controller：`ensureSubtree` 缓存/并发去重、nodes epoch、失败回退、全部展开/折叠进入可注入 `useAssemblyTreeController`；API transport 通过 port 注入，Shell 状态只由回调连接，XLink 弹窗和标签写盘仍留在 Table Host，RowGroup 保持无状态。

## KT Auto CAD 下线计划

- [ ] **待安排**：按 [KT Auto CAD 下线计划](cad/KT-Auto-CAD下线计划.md) 决定 BOM 交付与深度读取的迁移范围，完成同样本替代验收、旧数据接管和 Host 依赖清理后再安排停用。本轮仅保存计划，未启动迁移或下线。
