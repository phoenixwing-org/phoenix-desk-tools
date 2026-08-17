# Desk Tools：Wing 共享 CAD 核心迁移计划

> 本文只描述 `phoenix-desk-tools` 的 CAD/Rust/数据库迁出和消费工作。跨语言包结构、公共契约、版本策略与跨端验收，以 `phoenix-wing/docs/跨语言多包架构与三库迁移计划.md` 为唯一权威来源。`kt-auto-cad` 的 VS Code 接入由 `kt-auto-code` 仓库维护。

## 1. 目标

将当前已经在 Desk Tools 中工作的 FCStd、XLink、CAD 查询和数据库契约提升为 `phoenix-wing` 的共享真源，同时保证 Desk Tools 的 Tauri/Web 页面、Node/Hono 编排和安装包能力不倒退。

完成后：

- Wing 拥有 CAD contracts、纯 TS core、数据库 Schema 契约和 Rust 源码。
- Desk Tools 只保留 Node/Tauri adapter、HTTP API、工作区生命周期、Vue 页面和外部软件桥接。
- Desk Tools 与 `kt-auto-cad` 从同一 Wing npm 版本编译 Rust，不再各自修复算法。
- 最终安装包继续内置预编译 native tools，用户不需要 Rust、Node 或 Wing 源码目录。

## 2. 当前资产分类

### 2.1 迁入 Wing，成为唯一真源

| 当前路径 | 目标包 | 说明 |
| --- | --- | --- |
| `server/fcstd-reader/` | `@phoenix-wing/cad-rust-source` | FCStd ZIP/XML、BOM 属性读写 |
| `server/fcstd-xlink/` | `@phoenix-wing/cad-rust-source` | XLink/Label 扫描和 patch |
| `server/cli/` | `@phoenix-wing/cad-rust-source` | `fcstd-read` 稳定 JSON CLI |
| CAD 纯路径/命名/引用/BOM 计算 | `@phoenix-wing/cad-core` | 只迁无 IO、无数据库连接、无产品偏好的函数 |
| CAD API DTO 与 native JSON | `@phoenix-wing/cad-contracts` | JSON Schema + TS/Rust 类型 + fixture |
| `phoenix_cad_*` DDL、版本和迁移规则 | Wing contracts/db | 数据库契约真源，宿主保留连接实现 |

### 2.2 满足前置条件后迁入

原 `server/fcstd-query/` 直接硬编码 Desk Tools 的 `phoenix_cad_*` 表，而且从未进入生产调用。源码迁入 Wing 后已固定为绑定 workspace Schema v13 的 `phoenix-cad-query` v1；协议 guard、参数化查询、共同 fixture 与拒绝旧 Schema 写入门禁通过后，Desk 现从 Wing 编译并可随 provider 发布它。KT Auto CAD 已不再调用该二进制，其 BOM/引用只读 SQL 由 Wing 无驱动查询核心统一。

1. `phoenix-workspace.sqlite` DDL 与 Schema 版本；
2. 兼容、重建和迁移规则；
3. 查询请求/响应 Schema；
4. 去除或收口动态 SQL；
5. 双宿主共用数据库 fixture。

在此前，Desk Tools 只消费 Wing 的查询协议/fixture，不恢复本仓库私有副本，也不扩展未版本化公共行为。

当前 Schema 也不止一份：Node v13 全量 DDL、Python v13 DDL/迁移，以及 FCStd Map、BOM XRef、Part Key 服务中的局部建表语句并存。R0 必须先记录这些副本，后续逐一切换，不能仅移动 `phoenixDatabaseService.ts` 就宣称完成。

### 2.3 永久保留在 Desk Tools

| 区域 | 保留原因 |
| --- | --- |
| `server/src/routes/` | Hono HTTP、请求认证/校验和产品编排 |
| `server/src/lib/nativeToolService.ts` | Tauri resources、开发目录和环境变量解析 |
| 工作区扫描、任务进度、取消和缓存 | 产品生命周期与 IO adapter |
| `web-ui/` 页面、Pinia、Vue/Element Plus | Desk Tools 产品 UI |
| `src-tauri/` | 单实例、窗口、sidecar、安装包资源 |
| FreeCADCmd/Python adapter | 必须在 FreeCAD 引擎中运行 |
| SolidWorks COM | Windows 产品集成 |
| STEP 批处理和桌面启动器 | 外部进程与产品配置 |

### 2.4 CAD TypeScript 文件逐项归属

下表是 D0 的完整候选范围。标签以“文件最终保留形态”为准：`move` 表示列出的纯计算仍需迁到 Wing，`adapter` 表示文件继续留在 Desk 但只负责 IO/数据库/native 编排，`product-only` 表示能力永久属于桌面产品。一个 adapter 中尚待抽取的纯函数在“后续动作”中单独列明，迁出后原文件仍保留 adapter 身份。

| 当前文件 | 标签 | 已迁/保留边界 | 后续动作 |
| --- | --- | --- | --- |
| `bomAttributeService.ts` | `adapter` | 命名、Label、文档类型已迁 `cad-core`；保留 FCStd/DB/偏好 IO | 写回开放前改为消费公共不可变计划 |
| `fcstdReferenceLabelService.ts` | `adapter` | 保留 native tool 调用、原子替换和短期 Node fallback | native v2 写回稳定后删除重复 XML patch fallback，不迁复制品 |
| `nativeToolService.ts` | `product-only` | Tauri resources、环境变量和可执行文件发现 | 不迁 Wing |
| `phoenixDatabaseService.ts` | `adapter` | DDL/版本已迁 `workspace-schema`，连接已用 `db-node` | 仅保留工作区路径、WAL 和重建确认 |
| `pnwBomXrefIndexEngine.ts` | `adapter` | XML 提取和目标选择已迁 `cad-core` | 只保留 ZIP、SQLite、扫描进度和取消 |
| `pnwBomXrefService.ts` | `adapter` | BFS/装配树 ViewModel 已迁 `cad-core` | 只保留查询与 API 形状 facade |
| `pnwFcstdMapService.ts` | `adapter` + `move` | 保留扫描、DB upsert、历史和取消 | `computeStats`、文件名 hints、merge/排序等无 IO 计算迁 `cad-core` |
| `pnwPartDedupService.ts` | `adapter` + `move` | 保留目录选择、偏好和文件枚举 | 文件名解析、分组键、分组/排序迁 `cad-core` |
| `pnwPartKeyService.ts` | `adapter` + `move` | 保留数据库读写和工作区状态 | PartKey 归一化、候选排名与诊断迁 `cad-core` |
| `pnwRenameService.ts` | `adapter` + `move` | 保留文件改名、报告、SQLite 与引用刷新 | 引用传播分析、不可变改名计划和结果汇总迁 `cad-core` |
| `pnwXlinkFixService.ts` | `adapter` + `move` | 目标解析已迁 `cad-core`；保留 DB 查询、native apply 和刷新 | hints、路径提议、issue grouping/stats 与不可变写回计划迁 `cad-core` |
| `pnwStepBatchService.ts` | `product-only` | FreeCADCmd、Python runner、桌面偏好和进程生命周期 | 不迁 Wing；只通过 handoff 给插件使用 |
| `pnwSwStepExportService.ts` | `product-only` | SolidWorks COM、Windows 注册、许可和进程生命周期 | 不迁 Wing；只通过 handoff 给插件使用 |

真实引擎仍未覆盖的边界也固定如下，不能用合成 fixture 或 macOS 构建结果替代：

- FreeCAD 0.20/0.21/1.x 真实保存文件，包含复杂 `App::Part`/Body、外链编码、损坏 ZIP、被占用文件及写回后由 FreeCAD 再打开。
- Windows 上不同位数和版本的 FreeCADCmd、PATH/注册安装、非管理员账户、长路径与中文路径。
- SolidWorks 不同年度版本/位数、COM 注册与许可弹窗、无界面启动、只读/占用模型、失败退出和 STEP 结果复开。
- Tauri/NSIS 安装目录中的 sidecar 权限、签名/杀毒软件拦截、普通用户启动、退出清理和卸载残留。

## 3. 迁移原则

### 3.1 跨 Git 仓库不直接“移动”

每个模块按三步完成：

1. 将源码和 fixture 复制到 Wing，保留 Desk Tools 旧实现；
2. Desk Tools 切换到 Wing npm tarball/Rust source 构建结果，运行等价测试；
3. 验收通过后删除本仓库旧真源，必要时只保留带 `@deprecated` 的短期 facade。

任何阶段都不得让两个版本同时接受独立功能修改。

### 3.2 不同时改变算法和宿主

Rust 首次迁移只允许调整目录、crate workspace、公共命名和协议包装；不得顺带改变 FCStd/XLink 语义。算法改进在 parity 通过后的独立提交进行。

当前 CLI 仍使用 `key=value` 命令行参数，路径或值含 `=` 时存在表达限制；Node 侧还保留 fflate XLink/Label 解析写回 fallback。迁移基线必须冻结这两套结果，协议升级为 JSON stdin/stdout 和删除 fallback 分别使用后续独立提交。

### 3.3 写盘保持两阶段

Desk Tools 继续负责用户确认和工作区 IO；Wing 负责：

```text
analyze -> immutable plan + diagnostics
apply(plan, current fingerprint) -> applied/skipped/conflict report
```

取消、文件指纹变化、未知协议/数据库主版本必须阻止写入。

## 4. Rust source 消费

### 4.1 开发构建

Desk Tools 从 `@phoenix-wing/cad-rust-source` 的已安装路径寻找 Cargo manifest，并显式设置：

```text
CARGO_TARGET_DIR=<desk-tools>/server/.native-target/<platform-arch>
```

禁止向 `node_modules` 或 pnpm store 写 target。构建命令使用 `--release --locked`，不使用 npm `postinstall`。

### 4.2 Tauri 打包

现有 `build:native`/`build:tauri-runtime` 继续作为产品入口，但内部改为：

1. 定位 Wing Rust source 包；
2. 编译目标平台工具；
3. 校验 `--protocol-version` 和能力清单；
4. 复制到 `src-tauri/resources/bin/`；
5. 从最终 resources 启动一次产物 smoke。

Desk Tools 同时在安装资源中发布 `runtime/native-provider.json`，并在写盘前通过 Wing `cad-contracts` v1 guard。清单包含 provider ID、平台、native protocol、Wing workspace Schema ID/版本/DDL 哈希、工具相对路径、能力与 SHA-256。`kt-auto-cad` 默认作为 thin companion，不在 VSIX 内置 Rust 二进制；Wing TS 文件名语义、工作区 FCStd 检索、基础 View 和已有数据库只读查询不依赖 Desk Tools，只有 native 内容读取和后续写回在执行时发现或由用户选择 provider，并在协议握手通过后调用 Desk Tools 随附的工具。本机 provider 不承诺服务远程 SSH/WSL 工作区。

`nativeToolService.ts` 最终只解析开发缓存、Tauri resources 和显式环境变量，不再把 `server/<crate>/target` 当成生产真源。

`fcstd-query` 只有在 Schema/协议/golden 门禁通过后才复制到 runtime；provider 同时记录查询契约、能力与二进制 SHA-256。它保留为 Desk/协议诊断能力，Auto CAD 不再调用该 sidecar，也不暴露 `file-upsert`。

### 4.3 npm tarball 门禁

本地相邻仓库联调通过不等于发布完成。CI 必须从 Wing npm tarball 安装并完成一次 Cargo 构建，证明 `files`、Cargo 锁文件、path dependencies、LICENSE/NOTICE 完整。

## 5. 数据库迁移

### 5.1 Wing 持有

- `phoenix_meta.schema_version` 及兼容矩阵；
- `phoenix_cad_*`、CAD 所需审计表的 DDL 和索引；
- 可升级、必须重建、只读兼容三类迁移结论；
- 公共查询输入输出与数据库 fixture。

### 5.2 Desk Tools 持有

- `.phoenix/phoenix-workspace.sqlite` 路径选择；
- `node:sqlite`/WASM adapter、WAL 处理和文件权限；
- HTTP API、产品缓存、长任务和重建确认；
- UI session、Code/CAA 等尚未提升为公共契约的产品表 adapter。

当前 Desk 的 WASM adapter 不能可靠消费活动 WAL，因此 Desk 自身仍按产品生命周期处理 journal/checkpoint。KT Auto CAD 不使用该 WASM adapter，也不写数据库；它通过 Extension Host 内置 `node:sqlite` 只读打开，已验证能看到尚未 checkpoint 的 WAL 记录。

迁移初期可以由 Desk Tools 组合“Wing CAD DDL + 产品附加 DDL”，但相同表不得在两个仓库各留一份字符串真源。

## 6. 分阶段实施

### D0：冻结与清单

- [x] `fcstd-reader`、`fcstd-xlink` 的真实 Document.xml、协议 fixture 和 golden JSON 已由 Wing source/contracts 持有并进入 parity 门禁。
- [x] Wing 已冻结真实 FCStd/XLink、Schema v13 对象/DDL 哈希、查询 SQL 与历史版本兼容 fixture；Desk 构建直接消费并校验。
- [x] native v1/query v1 contracts、source manifest 和 Desk 构建门禁已记录 CLI 参数、能力、退出错误与 stdout/stderr 规则。
- [x] §2.4 已逐项标记 13 个 CAD TypeScript 候选文件的 `move`、`adapter`、`product-only` 边界和下一迁移点。
- [x] server 已改为精确消费 Wing 小包，web-ui 保留精确 `phoenix-wing` UI 聚合包；自动源码 alias 与 bundle 内开发目录硬编码已移除，仅显式联调开关可用相邻源码。
- [x] §2.4 已记录真实 FreeCAD/SolidWorks 版本、路径、权限、占用、COM/许可和安装态仍未覆盖的边界。

退出条件：后续迁移能证明等价，而不是只证明“可以编译”。

### D1：契约先行

- [x] Desk Tools native 构建与握手直接使用 Wing `cad-contracts` v1 guard、major 和 capability 清单。
- [x] Desk native 构建用 Wing 真实 `Document.xml` 临时生成 FCStd 并执行 read，同时执行 XLink scan；read 比较稳定领域摘要，scan 比较完整 golden JSON，两者都先通过 `cad-contracts` runtime guard。
- [x] native CLI 增加协议版本和能力查询。

退出条件：当前 Desk Tools 页面通过 adapter 保持无行为变化。

### D2：迁 `fcstd-reader` 与 `fcstd-xlink`

- [x] crates、CLI 和测试已迁入 Wing Cargo workspace。
- [x] Wing 已提供真实 npm tarball 解包 release 测试脚本；macOS arm64 本地通过，三平台 CI 已落地。
- [x] Desk Tools 构建脚本切换到 Wing source；通过已安装 npm 包的 `source-manifest.json` 定位统一 Cargo workspace，并校验 native protocol v1。
- [~] native build、server bundle、Tauri resources 准备与 runtime smoke 已通过；实际 Tauri dev/release 安装包仍待完整桌面环境验收。
- [x] 删除本仓库 `fcstd-reader`、`fcstd-xlink`、`cli` Rust 真源及过时 `test:rust`；Rust workspace 测试归 Wing，Desk 只保留 `build:native` 消费、协议握手和 parity 门禁。
- [x] `fcstd-query` 已随源码迁入 Wing并固定查询协议；Desk 删除旧副本，从 Wing 编译后随 provider 发布。

退出条件：测试、golden JSON 和写盘后重新读取结果等价。

### D3：纯 TS CAD core

- [x] 从 `bomAttributeService` 提取首批 BOM 文件名解析、文档类型、标签和推荐文件名算法到 `@phoenix-wing/cad-core`，原服务保留兼容 facade。
- [x] 将 `pnwBomXrefIndexEngine` 的纯 `Document.xml` XLink 提取、entity 解码、去重与 Label 规则迁入 `cad-core`，Desk facade 名称保持不变。
- [x] 将 XLink direct/self/missing/ambiguous 目标选择、FreeCAD/项目版本优先级和规则标签迁入 `cad-core`；Desk adapter 只查询候选文件是否存在。
- [x] 将入向引用 BFS（direct/indirect/via_chain/limit）和循环保护的装配树 ViewModel 迁入 `cad-core`；Desk 只查询 edge rows。
- [ ] 继续从 `pnwFcstdMapService` 和改名/Preview-Apply 服务中提取无 IO 计算。
- [x] 首批 Host adapter 仍保留 fs、SQLite、native tool、进度和偏好职责。
- [x] 首批页面和 API 只通过 Desk facade 消费 Wing 公共 exports，不依赖 Wing 内部文件结构。

退出条件：浏览器/Node core 测试可独立执行，产品服务变薄且不复制规则。

### D4：数据库契约与 `fcstd-query`

- [x] 将当前生产 v13 组合 DDL、版本、旧文件/旧表清单和重建判定切换到 Wing `workspace-schema`；宿主保留路径、连接和 WAL adapter。
- [x] 将 Node SQLite 连接实现切换到 `@phoenix-wing/db-node`，删除 Desk 的旧根包 ambient module 补丁；`workspace-schema` 仍不依赖驱动。
- [x] Wing `workspace-schema` 已冻结生产 v13 DDL/对象 fixture 和 v10/v12/v13/未知未来版本兼容矩阵；当前只承诺 v13 可写，其余明确要求重建或升级宿主。
- [x] `fcstd-query` 源码、参数化 SQL、Schema v13 门禁和共同 fixture 已迁入 Wing；Desk native 构建校验 `--contract` 后将其加入 Tauri resources/provider。
- [x] Wing v1 BOM/引用 SQL 已下沉为无驱动查询核心：同一 Rust v13 fixture 经 `db-node` adapter 通过共同期望；KT Auto CAD 又以 VS Code 内置 SQLite 对活动 WAL 完成真实只读验证，不再依赖 Desk `fcstd-query`。

退出条件：未知主版本拒绝写入；重建/升级必须由明确规则驱动。

### D5：清理与发布

- [~] 已删除过时 Rust crate、`test:rust` 与旧查询真源；剩余局部 Schema 建表和短期 TypeScript facade 继续按消费者迁移。
- [ ] 更新单元测试目录发现、Tauri resources、NOTICE 和 SBOM。
- [ ] 验证浏览器开发、Tauri dev、release、NSIS 安装态。
- [ ] 在装有真实 FreeCAD/SolidWorks 的机器补外部引擎验收。
- [x] server/web-ui 已从 npm Registry 精确消费 Wing `0.4.1`，移除 committed 相邻仓库 override、自动源码 alias 和 bundle 内过时的 `node_modules/phoenix-wing/src` 硬编码；server 237、catdlg-core 67、web 222 项测试及类型检查、生产构建均通过。显式 `PHOENIX_WING_SRC` 只用于未提交的本地联调，不作为发布验收依据。

## 7. 测试与门禁

| 层级 | 必须通过 |
| --- | --- |
| Wing Rust | `cargo test --locked`、golden JSON、写回往返 |
| Wing npm | tarball 内容、干净 Cargo 构建、协议 fixture |
| Desk Node | server typecheck/test、native adapter 异常分支 |
| Desk Web | typecheck/test/build，页面契约不倒退 |
| Tauri | dev resources、release resources、sidecar 回收 |
| Installer | NSIS 安装、启动、自检、退出、卸载 |
| 跨端 | Desk Tools 与 `kt-auto-cad` 的 FCStd/XLink/DB fixture 等价 |

测试中的合成 FCStd 证明 ZIP/XML 与协议行为，不替代真实 FreeCAD 兼容性认证。

## 8. 提交拆分

建议使用中文提交并保持可独立回退：

1. `docs(desk-tools): 固化 CAD 核心迁出与消费步骤`
2. `test(cad): 冻结 Rust 与数据库迁移基线`
3. `refactor(cad): 接入 Wing CAD v1 契约适配器`
4. `build(native): 从 Wing Rust 源码编译 CAD 工具`
5. `refactor(cad): 删除已迁入 Wing 的 Rust 真源`
6. `refactor(database): 切换 Wing CAD Schema 契约`

禁止把源码迁移、数据库重建策略、UI 调整和安装包修复压成一个提交。
