# Desk CAD 减法与保留边界

状态：current

Owner：Desk Tools CAD maintainers

最后核验：2026-10-04

2026-10-04 专项更新：用户授权将 Auto CAD 的索引领域算法提炼为 Wing 公共函数，两宿主独立
消费，Desk 恢复手动全量入口与确认清理。下方删除清单是旧实现退役事实，不禁止新的共享 Host
入口；实现和安全边界以 [第二阶段回执](CAD目录与索引职责拆分.md#第二阶段共享索引与用户缺陷收口2026-10-04) 为准。

## 产品边界

- `kt-auto-cad` 保留 VS Code 文件发现/ZIP/SQLite adapter、BOM 交付等产品能力；XML 字段投影、索引计划和 SQL 事务已提炼到 Wing 本地候选。不将 VS Code 设为 Desk 运行前提。
- `phoenix-bom` 是正式 Part/BOM 数据、导入审核、权限、审计和发布状态的唯一真源。
- Desk Tools 不再提供第二套索引算法或正式 BOM 管理客户端；CAD 索引页面调用共享 Wing 函数，并保留 Desk 文件事务、外部引擎与确认交互，不恢复旧 `fcstd_map` 页面/路由。
- TypeScript/Node 与 Wing 是当前实现基线。Python 只在出现现行契约无法解释的具体回归时用于定点对照；FreeCADCmd 内执行的薄脚本属于外部引擎 adapter，不是后端真源。

## 删除清单

| Desk 能力 | 替代真源 | 删除范围 | 迁移方式 |
| --- | --- | --- | --- |
| CAD 索引页面 | KT Auto CAD | `fcstd_map` 导航、页面、页面专用组件/composable、扫描/purge/JSON 导出前端 API | 在 VS Code 运行 KT Auto CAD 扫描与查询；继续复用同一工作区 `.phoenix/phoenix-workspace.sqlite` |
| Desk CAD 全量扫描器 | KT Auto CAD | `/api/cad/fcstd-map/*` 扫描、进度、取消、历史、偏好、purge、导出路由及其页面专用服务 | KT Auto CAD 负责 Schema v13 事务化扫描；Desk 只读/局部更新现有索引 |
| BOM 列表页面 | KT Auto CAD + Phoenix BOM Web | `bom_export` 导航、页面、页面属性与 assembly-hosts 页面 API | 本地查询/交付在 KT Auto CAD；正式查看、审核和发布在 Phoenix BOM Web |
| Desk 扫描 onboarding 动作 | KT Auto CAD | “去 CAD 索引”入口 | 改为明确提示从 VS Code 的 KT Auto CAD 完成扫描，不在 Desk 隐式重扫 |
| 重复的 Python HTTP/CAD 页面实现 | Node/Hono + KT Auto CAD | 不进入 Desk 发行运行时；不恢复为开发主路径 | 仅作为冻结兼容参考，发现具体现行回归后按函数/fixture 定点查阅 |

旧工作台会话若仍保存 `fcstd_map` 或 `bom_export`，由兼容迁移将其引导到当前 CAD 默认页，不恢复已退役页面。删除不改变 Workspace Schema v13，也不删除用户的 SQLite、FCStd 或导出文件。

## 必须保留的 Desk 能力

| 能力 | 保留原因 | Owner | 退役条件 |
| --- | --- | --- | --- |
| 文件详情与 BOM 属性写回 | 需要 Desk 文件系统权限、FCStd ZIP 原子替换、回滚、编辑确认和缓存刷新；Auto CAD 当前只读 | Desk | Auto CAD/统一 Host 具备等价写入事务、回滚和真实制品门禁，且产品决定迁移 |
| 文件改名与索引局部更新 | 涉及磁盘改名、目标冲突、引用影响、审计和失败恢复，不是纯索引查询 | Desk | Auto CAD 获得完整写事务与恢复计划并通过多文件部分失败门禁 |
| XLink/Label 修复 | Auto CAD 只诊断；Desk 仍拥有确认、FCStd 写回、精确回滚和引用缓存刷新 | Desk | Auto CAD/统一 Host 支持安全写回并通过真实 FCStd 回读、字节回滚和权限门禁 |
| 零件目录、零件详情与编号查重 | Auto CAD 没有等价产品 UI；Desk 文件详情和改名流程仍消费 PartKey 关系 | Desk | Phoenix BOM Web 或 Auto CAD 覆盖本地文件关联、冲突处理和跳转契约 |
| BOM/XLink 只读查询与单宿主刷新 | 文件详情、改名、XLink 修复仍需要；属于 Desk 写事务后的局部一致性 adapter | Desk | 上述 Desk 写事务全部退役，或统一 Host 提供同等局部刷新 API |
| STEP → FCStd | 依赖本机 FreeCADCmd；薄 Python runner 在 FreeCAD 解释器中执行 | Desk external-engine adapter | KT Auto CAD 或独立工具提供同等批处理、取消、日志和发行门禁 |
| SolidWorks → STEP | 依赖 Windows SolidWorks COM 与本机进程生命周期 | Desk external-engine adapter | 独立工具提供同等 Windows COM 流程和失败恢复 |
| Tauri/Node Host 生命周期与诊断 | 属于 Desk 产品壳、打包、服务发现和文件权限边界 | Desk | Desk 产品整体退役 |

保留项不得继续扩展为第二套扫描算法、交付或 Web 正式管理客户端。共享扫描是用户授权专项例外，其他新增能力仍先记录无法复用原因、owner 和退役条件。

## 数据兼容门禁

`cad_index` 的产品呈现归 Desk；领域计划/事务归 Wing，不拥有独立 DDL/迁移真源，不等同于已删除的 `fcstd_map`。只读诊断不触发扫描；更新及清理分别明确确认。

1. Desk 与 KT Auto CAD 只消费 Wing 的 Workspace Schema v13，不在 Desk 复制 DDL 或字段推断规则。
2. Desk 读取 Auto CAD 生成的数据库时不得隐式全量重扫、覆盖人工 PartKey 字段或改变交付快照。
3. Desk 文件写事务只做必要的索引局部更新，并在失败时保持磁盘与 SQLite 可恢复。
4. 删除页面和扫描 API 后，保留的文件详情、零件目录、改名、XLink、STEP 与 SolidWorks 流程必须通过现有自动测试和生产构建。
5. 发布说明必须明确：Desk 或 KT Auto CAD 均可通过 Wing 共享索引扫描，Desk 提供本地文件修复，Phoenix BOM Web 管理正式数据；共享候选须在 Wing 发布并精确采用后才能正式发行。

## 2026-09-04 实施回执

- 进行中 worktree 提交：`phoenix-desk-tools@76a7123`。
- 删除 `fcstd_map`、`bom_export` 两个产品入口、全量扫描/导出 Server API、页面专用组件/composable/ViewModel、历史恢复轮询和无消费者字段 adapter；共 74 个文件变更，新增 454 行、删除 6,008 行。
- 旧工作台会话中的两个退役页会迁移并去重为一个“零件目录”Tab；若会话已含当前零件目录，则优先保留当前 Tab 和页内状态。
- Onboarding、主页、配置、零件/XLink 空状态均改为明确引导用户到 VS Code 的 KT Auto CAD 扫描，不再暗示 Desk 内仍有扫描页。
- 局部 XRef 刷新只消费已有扫描 ID，不伪造扫描记录、不改写 Auto CAD 全局扫描元数据；文件改名后的索引更新遇到目标冲突或异常时 fail-closed，不删除冲突行。
- Registry Wing 完整测试：Server 253、CATDlg Core 67、Web 405，全部通过；本地 Wing 同组 725 项测试全部通过。架构/依赖边界、Registry Web build、本地 Wing Web + Server bundle、Tauri runtime health/shutdown smoke 均通过。
- 联合收口提交为 `phoenix-bom@ff19610` 与 `kt-auto-cad@854a860`：Web 已拥有逐项审核、计划过期和 PostgreSQL 原子写，Auto CAD 已拥有目标确认、认证推送、不可变 outbox、断网恢复、回执和 stale 文件门禁。以上能力不再构成 Desk 保留理由。
- 本轮没有继续删除“必须保留”表中的能力：它们仍有文件写事务、Tauri/Host 生命周期、PartKey 现存消费者或 FreeCAD/SolidWorks 外部引擎边界。新增删除必须先满足对应退役条件，不能仅因名称与 Auto CAD 相似而移除。

Python 旧桌面/HTTP 源码暂时保留为冻结兼容参考，不再作为 Tauri/Node 运行时或新功能入口。发行运行时只保留 FreeCADCmd STEP 转换必须加载的薄脚本/模块；后续只有具体回归证据指向旧行为时才按函数查看 Python。
