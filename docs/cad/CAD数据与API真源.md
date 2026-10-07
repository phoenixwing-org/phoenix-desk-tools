# CAD 数据与 API 真源

状态：current

Owner：Desk Tools CAD maintainers

适用版本：Workspace Schema v13 / Phoenix Wing CAD 正式包及共享索引本地候选

最后核验：2026-10-04

## 单一真源

| 事实 | 真源 | Desk 责任 |
| --- | --- | --- |
| Workspace Schema v13 表、列和协议版本 | `@phoenix-wing/workspace-schema` | 只初始化空库，已有库严格校验、不自动迁移 |
| 全量索引计划与事务 | Wing `cad-core` / `cad-contracts` | Desk 与 KT Auto CAD 共用函数，Host 负责完整发现、权限、快照、确认和进度 |
| CAD 查询与 XML 领域规则 | `@phoenix-wing/cad-core` | Hono route、ZIP/I/O 与产品权限 adapter |
| SQLite Node 连接 | `@phoenix-wing/db-node` | 生命周期、工作空间路径和错误呈现 |
| FCStd ZIP/Document.xml | Wing `cad-core` + Desk `fcstdDocumentXmlService` | Wing 选择对象/投影/补丁；Desk 解压、原子替换、回滚 |
| 产品页面状态与写入流程 | Desk `server` / `web-ui` | 用户确认、事务边界、缓存刷新和 UI |

产品级能力的减法、迁移入口和 Desk 保留条件见 [Desk CAD 减法与保留边界](Desk-CAD减法与保留边界.md)。2026-10-04 用户授权恢复 [共享 CAD 索引入口](CAD目录与索引职责拆分.md)：两宿主独立使用同一 Wing 计划/事务函数，不复制退役扫描器。正式 BOM 管理仍归 Phoenix BOM Web，Desk 不恢复交付功能或整库删除。

旧 `CAD数据库表结构.md` 与重命名计划只描述 schema v10，不能用于实现当前查询；历史研究和迁移点检也不能覆盖 Wing package 的机器契约。

## API 规则

- Desk route 可以兼容前端字段，但必须在 adapter 层转换；不得在 UI 或 route 内重写查询算法。
- 文件发现、SQLite、FCStd 读取/BOM 写回、XLink/Label 修改默认且唯一走 TypeScript；不得恢复逐文件启动 Rust CLI 的路径。
- Wing cad-core 保持纯 XML/路径算法，不依赖 Node、DOM 或 Vue；Desk Node adapter 唯一拥有 ZIP 和文件系统。
- Desk CAD route 服务文件事务、查询/关系、外部引擎和 Wing 共享索引 Host adapter；不得复制领域算法、交付 outbox 或 Web 正式数据管理。
- Desk 局部 XRef 刷新必须附着到已有成功扫描 ID；不得伪造完成扫描或改写全局扫描元数据。新的共享全量扫描成功后才能由 Wing writer 产生新扫描记录。
- 「清理旧索引」是单独确认协议：自动备份后清 CAD 派生表/文件关联，保留 PartKey 等人工资料，不删除整库；详见拆分文档第二阶段边界。
- `pnpm build:tauri-runtime` 必须完成 Node sidecar health/shutdown 与 packaged TypeScript CAD runtime smoke，不再生成 native provider。

消费版本和 lockfile 来源由 `pnpm verify:wing-dependencies` 检查，不在本文复制第二份依赖矩阵。
