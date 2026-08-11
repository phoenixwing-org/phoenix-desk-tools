# Tauri 分支迁移审计与接手指南

> 当前权威结论，更新于 2026-07-11。恢复工作先读 [Tauri 迁移当前状态基线](tauri-当前迁移状态基线.md)；旧 checkpoint、TODO 和提交说明中的“已完成”不作为证据。页面状态以 [Tauri 逐页功能二验矩阵](tauri-逐页功能二验矩阵.md) 为准，构建和产物检查命令见 [Tauri 构建启动与验收指南](tauri-构建启动与验收指南.md)。

## 1. 目标与完成口径

目标产物是可安装、可离线启动的 Windows x64 Tauri 2 桌面程序，并完整承接迁移前各页面的用户功能。目标运行链为：

```text
Vue Web UI
  -> Tauri 2 desktop shell
  -> packaged Node/Hono service at 127.0.0.1:5180
  -> Rust FCStd ZIP/XML tools
  -> external engine adapters only where unavoidable
     - FreeCADCmd + FreeCAD Python API
     - SolidWorks + PowerShell COM
```

生产运行时不再依赖 Python FastAPI/HTTP 服务。FreeCAD 内部 Python 脚本是 FreeCAD 引擎适配器，不属于被移除的 Python Web 后端。

证据级别：

| 级别 | 判定 |
| --- | --- |
| `U` | 尚未二验，旧文档结论不可信 |
| `I` | UI、API、服务/工具链已定位，主流程无 stub/proxy |
| `F` | 在可丢弃工作区以代表性文件完成真实读写、回读和错误路径验收 |
| `D` | 同一流程在 release Tauri 产物中通过，打包资源和用户数据路径正确 |
| `TBD` | 缺少外部软件/许可/真实样本或明确延后的边界；不能用于掩盖本机可修缺陷 |

只有 `D` 才能称为“桌面迁移完成”。FreeCAD/SolidWorks 页面还需要真实外部软件验收，不能以 mock 或前置检查代替。

## 2. 分支从哪里出发

- 当前分支：`tauri`，checkpoint HEAD 为 `2a946be9`（`过程状态`），父提交为原迁移声明 `20281d1e`。
- 与 `master` 的共同基点：`9d958032`。
- 与 `origin/code` 的共同基点：`49bf1c1c`；`origin/code` 不是 `tauri` 的直接父分支，只作为相关 Code 行为历史的补充证据。
- 分支只有两个已提交迁移节点：
  - `42c5dd9b`：将 `server/caa` 拉平到 `server`，加入迁移计划。
  - `20281d1e`：声明“Python -> Rust/TS 全量迁移 + 页面适配”。
- `20281d1e` 的“全量完成”不可信。二验时仍存在固定空响应、Python HTTP 代理、重复 CAD 路由、只测 stub 的测试和前后端契约错位。
- checkpoint `2a946be9` 已固定此前 292 文件、38,743 行新增和 4,585 行删除的迁移修正。它是可信恢复锚点，但提交范围仍较大并包含部分 `.tmp` 验收证据；最终交付前需要决定保留证据还是清理临时产物。本轮状态文档位于该 checkpoint 之后。

## 3. 实际迁移内容

### 桌面与运行时

- 新增 `src-tauri/`：单实例、窗口状态、原生目录选择、桌面退出、本地服务生命周期和 release 资源定位。
- release 运行时包含 Node、打包后的 `server.mjs`、依赖资源、FreeCAD runner 以及两个 Rust 原生工具。
- release 模式不再静默复用 5180 上的开发服务；端口被占用时明确报错，避免 release 程序误用仓库目录和开发态用户数据。

### 后端所有权

- Shell、工作空间、配置、Git、测试工程、工作集、Code、CAA、CAD 主流程已由 Node/Hono 持有。
- FCStd ZIP/XML 解析和写回由 `fcstd-read.exe`、`fcstd-xlink.exe` 及 Node ZIP 索引逻辑承担。
- 删除了生产路由中的 Python proxy/stub 基础设施、重复路由和旧备份模块。
- Python 只保留旧入口兼容代码和必须运行在 FreeCAD 内的引擎脚本；它们不是 release HTTP 后端。

### 前端收口

- 24 个 page id 均映射到真实 Vue 页面；`bom_apply` 与 `file_detail`、`rename_analysis` 与 `file_rename` 是有意兼容别名。
- 删除重复的 `Cr*` CAD 页面、旧 BOM viewer 和脱离主流程的文件改名面板。
- 页面统一接入 Node API、工作区数据库、工作集和 Tauri runtime bridge。

## 4. 当前可信完成度

已达到 `F` 的自主可验功能：

- Home/Config/Test Fixtures/Unit Tests：模块开关、偏好保存、最近列表清理、catalog/勾选和开发态 Vitest 流式执行。
- Git：临时仓库初始化、状态、diff、stage、commit、restore 链路。
- File Worksets：SQLite 增删改查、跨 Code/CAD 范围解析和缺失清理。
- Code Index/Ignore/Rename/UUID/Reorder：真实扫描、查询、报告、编码保留、写入和回读；包含精确文件名、大小写改名和 C++ 构造函数边界。
- CAA 首页/编辑器：持久化索引、新建文件、解析、NLS 编辑与保存、Undo/Redo、Grid span/拖动、dry-run、CATDlg 写回与重新解析。
- CAD：使用包含真实 ZIP + `Document.xml` 结构的三文件 FCStd 工作区完成索引、BOM、PartKey、属性写回、改名、递归引用、XLink 修正、标签修正、查重和报告导出。

桌面产物证据：

- `src-tauri/target/release/phoenix-desktop.exe` 已在 5180 空闲、没有开发后端的条件下独立启动；它拉起的进程是 release 自带的 `runtime/node/node.exe`，`/api/health` 返回 `phoenix-node`、协议 1。
- release 配置页显示 `fcstd-read.exe`、`fcstd-xlink.exe` 均来自打包资源且可用；发行版“单元测试”页运行 Code/CAD/Platform/CAA 自检为 14/14 通过。
- 配置页确认退出后，Tauri 壳、打包 Node 进程均退出，5180 释放。端口占用时的明确失败对话框和诊断日志路径也已验收。
- 官方 Tauri NSIS 已生成 `src-tauri/target/release/bundle/nsis/Phoenix Desktop Tools_0.1.0_x64-setup.exe`。安装、从安装目录启动、安装态 14/14、自主退出和卸载目录清理已通过；由于 Codex MSIX 隔离账户会虚拟化 shell known-folder/注册表，普通用户开始菜单和“已安装的应用”登记仍需用户手动双击补验。
- 上述证据只使“打包运行时、配置页桌面状态/退出、发行版自检”达到 `D`；其他页面仍以开发态 `F` 为主，不能据此声称“全部页面桌面迁移完成”。

外部依赖边界：

- 当前机器没有 FreeCAD、SolidWorks，也没有由这些软件产生的验收文件。
- STEP Batch 与 SW -> STEP 已完成参数、环境、发现、报告解析和失败信息链，最高只记 `I`。
- 合成 FCStd 能证明 ZIP/XML 迁移逻辑，不等于真实 FreeCAD 兼容性认证。

## 5. 本轮发现并修正的高风险问题

1. FCStd writer 原先会破坏旧/新 XML schema、对象区和多行属性，并在 Windows 上直接替换打开中的 ZIP；现已按 schema 写回并使用临时文件/回滚替换。
2. CAD 改名会遇到 SQLite 目标路径旧行冲突，且 XRef 快照可能失去一致性；现已清理 stale target 并同步引用。
3. BOM 标签接口原先只改 SQLite；现已真实修改 FCStd `Document.xml`。
4. XLink 单文件模式和批量模式曾被重复路由遮蔽；现统一到真实分析/写回服务。
5. CAA NLS 属性编辑未进入 Undo/Redo 历史；现连同默认/多语言 NLS map 一起快照。
6. CAA Grid 拖动会静默丢失 `CATGRID_4SIDES`；现同容器、跨容器和插入位移都保留 anchor，并已 UI 写回/回读验证。
7. release 程序原先会复用开发态 5180 服务；现 release 遇到端口占用直接失败并提示关闭开发服务。
8. 根 `pnpm dev` 使用 Unix `sleep`，Windows 无法启动 UI；现改为跨平台并行启动。
9. Vite 只预打包 `phoenix-wing` 根入口，导致确认弹层 Host 与调用者各持一份响应式单例；现禁止该包预打包，确认/危险操作恢复可用。
10. 最近列表“清理无效项”只删除重复/临时项，不删除不存在目录；现按界面承诺清理 missing 路径并保留有效项。
11. Unit Tests 子进程继承 `PHOENIX_USER_DATA_DIR` 等桌面覆盖，造成隔离测试写入同一工作区并产生假失败；现运行源码 Vitest 前清理 `PHOENIX_*`，只显式保留源码 repo root。
12. `node-sqlite3-wasm` 在 pnpm 下是目录联接，原运行时准备脚本把它继续复制成指向仓库的符号链接；开发 smoke 能借仓库解析依赖，但 release 复制资源后模块消失并在启动时退出。现复制时强制解引用为实体文件，并新增从最终 `src-tauri/resources/runtime` 自带 Node 启动的产物 smoke。

完整修正历史见 [tauri-migration-correction.md](tauri-migration-correction.md)。

## 6. 如何启动和检查

### 浏览器开发态

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

或在两个终端分开运行：

```powershell
pnpm dev:server
pnpm dev:ui
```

- UI：`http://localhost:5173/`
- API：`http://127.0.0.1:5180/api/health`

### Tauri 开发态

先停止单独运行的 UI；5180 上已有健康开发服务时 debug Tauri 可以复用，否则会自行启动 Node 服务：

```powershell
pnpm tauri:dev
```

### release 构建

```powershell
pnpm build:tauri-runtime
cargo tauri build --no-bundle
```

当前可执行文件：`src-tauri/target/release/phoenix-desktop.exe`。

官方 NSIS 安装包：

```powershell
pnpm tauri:installer
```

产物：`src-tauri/target/release/bundle/nsis/Phoenix Desktop Tools_0.1.0_x64-setup.exe`。项目的 `bundle.targets` 已收敛为 `nsis`，不会在普通 bundle 构建时额外要求 WiX/MSI。

启动 release 前必须停止 `pnpm dev`，确保 5180 空闲。release 应自行启动打包 Node 服务；日志位于 Tauri 应用数据目录的 `logs/phoenix-server.log`，启动失败写入 `phoenix-startup-error.log`。

### 建议检查顺序

1. 选择一个可丢弃工作区，确认最近列表、配置和工作区数据库创建。
2. 依次运行 Git、工作集、Code 扫描/写入、CAA 解析/写回和 CAD 扫描/写回。
3. 每次写操作都检查磁盘内容，再重新加载页面确认回读一致。
4. release 下重复相同链路，确认资源路径不指向仓库、用户数据库不写入安装目录。
5. 在装有 FreeCAD/SolidWorks 的机器上完成外部引擎验收。

## 7. 剩余交付顺序

> 继续执行前以 [Tauri 迁移当前状态基线](tauri-当前迁移状态基线.md) 固定的产物哈希和恢复顺序为准，不再重做分支来源、旧 checkpoint 失真和开发态 `F` 主链审计。

1. 用户在普通用户上下文运行 NSIS，补验开始菜单目标和“已安装的应用”登记；隔离账户下的安装树、内置 sidecar、安装态自检、退出和卸载目录清理已经通过。
2. 在 release/已安装程序中用可丢弃工作区重复 Shell、工作集、Git、Code、CAA 和合成 FCStd CAD 主链，把逐页 `F` 证据提升到 `D`。
3. 补齐欢迎面的 Tauri 原生目录选择、关闭工作区，以及配置页 factory reset 边界验收；桌面状态、确认退出和 sidecar 回收已通过。
4. 用真实 FreeCAD FCStd、STEP 和 SolidWorks part/assembly 完成外部引擎验收。
5. 按桌面壳、Shell/Code、CAA、CAD/Rust、文档分拆提交并复核无临时 `.tmp` 产物。
