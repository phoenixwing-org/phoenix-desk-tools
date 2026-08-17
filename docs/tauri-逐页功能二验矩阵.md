# Tauri 逐页功能二验矩阵

> 更新于 2026-07-20。2026-07-17 的早期 macOS Rust-sidecar 制品哈希仅保留在 [历史验收回执](tauri-0.2.0-macOS发布态验收.md)；当前发布入口见 [Tauri 构建、启动与验收](tauri-构建启动与验收指南.md)。`F` 表示已在开发态用可丢弃工作区完成真实读写/回读；`D` 才表示同一用户工作流在当前 release Tauri 中验收完成。

## 判定摘要

| 类别 | 数量/结论 |
| --- | --- |
| 注册 page id | 25；其中 2 组是兼容别名，共 23 个独立页面实现 |
| 已达 `F` | Home/Config、Git、Test Fixtures、Unit Tests 开发态、工作集、Code 全链、CAA 首页/编辑器、CAD 主链与查重 |
| 仅达 `I` | 欢迎面的 Tauri 原生操作、STEP Batch、SW -> STEP |
| 已达 `D` | macOS 0.2.0 `.app` 的打包运行时、隔离用户数据、Codegen/FCStd 代表性服务链与 sidecar 生命周期；页面级 `D` 仍需逐页 UI 工作流 |
| 下一验收点 | 在 macOS 与 Windows runner/VM 构建当前 0.4.0，并在普通用户安装态检查代表性页面、安装登记与卸载 |

## Shell / Core

| 页面/入口 | 主要功能 | 当前所有者 | 证据 | 结论与剩余项 |
| --- | --- | --- | --- | --- |
| 启动/欢迎面 | 选择工作区、最近列表、模块范围、CAA 草稿 | Vue + Node prefs/workspace + Tauri picker | `I` | 浏览器工作区选择与恢复可用；原生 picker、最近列表删除和 release 用户目录待 `D` |
| 主页 `home` | 模块入口、模块开关、onboarding/巡游 | Vue + Node prefs | `F` | 工作区状态、23 个独立页面入口、CAD/Code 模块开关及 Ribbon 同步通过；巡游内容未逐步点击，待 `D` |
| 配置 `config` | 工作区、外部工具、界面/模块偏好、最近列表、退出 | Node services + Tauri commands | `F` + `D`（桌面边界） | 偏好保存、工作区重载、无效最近项确认与清理达到 `F`；CAD Rust 状态区已删除，服务状态、退出确认及 Node sidecar 回收保留；原生 picker 与 factory reset 待验 |
| Git `git` | init/status/diff/stage/restore/commit | Node subprocess Git | `F` | 临时仓库完整操作链通过；运行时数据库保护和仓库级 safe.directory 生效，待 `D` |
| 检出测试工程 `test_fixtures` | 偏好、缺失仓库 shallow clone、状态 | Node + system Git | `F` | 4 项 catalog、勾选偏好、按钮状态和本地 Git clone 服务链通过；未联网下载，已有目录仍有意不自动 pull |
| 单元测试 `unit_tests` | suite/module/case、运行、取消、watchlist、筛选 | 开发态 Vitest；release runtime self-check | `D` | 当前 release 自检覆盖 manifest、应用配置、CAA、TypeScript FCStd XML、Git、GBK 和用户数据写入；旧 14/14 Rust CLI 数量只保留为历史证据 |
| 文件工作集（跨页侧栏） | 增删改查、文件/目录范围、缺失清理 | Node workspace SQLite | `F` | SQLite 持久化、一次性 JSON 导入、Code/CAD 范围解析和清理通过，待 `D` |

## Code / CAA

| 页面 | 主要功能 | 当前所有者 | 证据 | 结论与剩余项 |
| --- | --- | --- | --- | --- |
| Code 索引 `code_index` | 扫描、范围/扩展名、分页搜索、missing purge、导出、CATDlg 子索引 | Node + SQLite | `F` | 真实工作区扫描、精确文件名/路径、搜索、导出、purge 与 CAA 子索引通过；大仓性能待测 |
| Code 忽略 `code_ignore` | ignore 文件、预设、进程目录建议、下游生效 | Node prefs + `.phoenix/code.ignore` | `F` | 读写、旧存储迁移和 Index/Rename/UUID/Reorder 共用规则通过；首次自动 seed 行为需产品确认 |
| C++ 成员排序 `reorder_members` | 范围、预览/写入、header/cpp、冻结区、编码 | Node TS engines | `F` | 真实 fixture 差分、构造函数边界、特殊成员、GBK/CRLF 与锁定区通过；更大 CAA 工程待 `D` |
| KT Codegen `kt_codegen` | JSON/CSV 参数表、32 Block、源码预检、Artifact、源码 Apply | Wing + Node host + Vue | `F` + release API | JSON 保存/回读与指纹冲突 fixture 通过；macOS 0.2.0 `.app` 包内 host 已完成真实预检/Apply/复读，但尚未以页面操作完成完整 UI `D` |
| Code 批量改名 `code_rename` | 文本/文件/目录预览写入、编码、冲突、报告 | Node | `F` | 精确文件名、大小写改名、目录/文本、GBK/UTF-8、冲突与 JSON 报告通过；多文件失败无全事务回滚 |
| Code UUID `code_uuid` | UUID/GUID32/CAA GUID 扫描、选中写入、策略、报告 | Node | `F` | 扫描、dry-run、按命中写入、样式与 GBK 保留、报告通过；`suspicious` 仍为内部分类 |
| CAA 首页 `caa_dialog_home` | SQLite 索引、搜索、分组、打开、新建 | Node CAA index + Vue | `F` | 真实扫描 2 个对话框；向导创建 CATDlg/CATNls 后重扫变 3，清理后恢复 2，待 `D` |
| CAA 编辑器 `caa_dialog` | 解析、Tab/草稿、NLS、Grid 拖放/span、Undo/Redo、dry-run、写回 | Vue + `catdlg-core` + Node | `F` | NLS 保存/撤销重做、span、真实拖动、anchor 保留、预览、CATDlg 写回与回读通过；真实 CAA 编译/Wizard 签名仍需 CAA 环境 |

## CAD

| 页面 | 主要功能 | 当前所有者 | 证据 | 结论与剩余项 |
| --- | --- | --- | --- | --- |
| CAD 索引 `fcstd_map` | 范围扫描、进度/取消/恢复、历史、missing、导出、XRef | Node TypeScript + SQLite + Wing cad-core | `F` | 三文件真实 ZIP/Document.xml 工作区扫描、历史、XRef rebuild 与导出通过；超大文件取消和真实 FreeCAD 文件待验 |
| BOM 列表 `bom_export` | 总成/BOM/树、搜索导出、链接标签修正 | Node SQLite + FCStd writer | `F` | 装配树/BOM 与标签实际写入 FCStd、回读和 ZIP 其他成员保留通过，待真实 FreeCAD 打开验证 |
| 文件详情 `file_detail` | BOM 属性、推荐/公式、文档类型、改名、引用/树 | Node TypeScript + Wing cad-core | `F` + release API | FCStd 属性写入、预览、磁盘改名和引用链通过；release 改为打包 TypeScript reader，页面 UI 与真实 FreeCAD 复杂样本待验 |
| 兼容入口 `bom_apply` | 与 `file_detail` 同页面 | 同上 | `F` | 有意兼容别名，不是重复实现 |
| 零件目录 `part_catalog` | PartKey 同步、搜索、关联文件、详情入口 | Node SQLite | `F` | 扫描结果同步、目录搜索和详情跳转数据链通过；同步仍为页面读取触发而非扫描事务 |
| 零件详情 `part_key_detail` | 元数据、文件角色/备注、装配树 | Node SQLite | `F` | 元数据/关联和装配树链通过；需再验证重复重扫不覆盖所有用户字段 |
| 改名分析 `file_rename` | 改名、日志、递归引用、XLink/标签修正、报告 | Node + FCStd writers | `F` | 直接/间接引用分析、磁盘改名、XLink dry-run/apply、标签与报告通过；部分失败不是跨文件 ACID 事务 |
| 兼容入口 `rename_analysis` | 与 `file_rename` 同页面 | 同上 | `F` | 有意兼容别名，不是重复实现 |
| 链接路径修正 `xlink_fix` | 批量/单 XML 分析、候选/手选、dry-run、写回 | Node TypeScript + Wing cad-core | `F` | 断链识别、手选/自动候选、dry-run、TypeScript ZIP/XML 写回与 Windows 文件替换通过；真实 FreeCAD 打开待验 |
| 编号查重 `part_dedup` | 目录/工作集扫描、文件名/编号版本分组、CSV | Node | `F` | 临时文件树分组和 CSV 导出通过，待 `D` |
| STEP 批量 `step_batch` | 偏好、发现/预览、FreeCADCmd、结果汇总 | Node orchestration + FreeCAD Python adapter | `I` | 目录计数、7 个环境变量、runner 调用、报告解析和明确失败通过；缺 FreeCAD，不能记 `F` |
| SW -> STEP `sw_step_export` | 偏好、part/assembly 发现、COM 导出、失败明细 | Node + PowerShell COM | `I` | 扫描、作业文件、SaveAs fallback、已打开文档保护和错误形状已审计；缺 SolidWorks/许可，不能记 `F` |

## 功能性结论

1. 原提交的 checkpoint 不可信，但当前工作区已经把大多数“页面打开但按钮空转”的主链改成真实 Node/TypeScript 实现；FreeCAD/SolidWorks 仅作为外部引擎适配器。
2. 自主可验证的 Code、CAA、CAD 主要读写功能已达 `F`；它们不是由测试数量推断，而是检查了磁盘产物并重新加载回读。
3. macOS 0.2.0 release 打包运行时与代表性服务链已经作为历史基线通过；当前 0.4.0 的 macOS/Windows 制品、Windows NSIS 构建/安装/卸载、逐页 release `D`、代码签名，以及 FreeCAD/SolidWorks 的真实引擎验证仍是缺口。
4. 在上述缺口关闭前，项目应描述为“核心功能迁移已可接手，macOS 0.2.0 历史 release 代表性链路已通过、0.4.0 跨平台制品与逐页桌面验收未完”，不能描述为“全部页面全部功能迁移完成”。
