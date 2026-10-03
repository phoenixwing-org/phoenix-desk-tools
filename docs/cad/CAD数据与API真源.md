# CAD 数据与 API 真源

状态：current

Owner：Desk Tools CAD maintainers

适用版本：Workspace Schema v13 / Phoenix Wing CAD packages 0.6.3

最后核验：2026-09-04

## 单一真源

| 事实 | 真源 | Desk 责任 |
| --- | --- | --- |
| Workspace Schema v13 表、列和协议版本 | `@phoenix-wing/workspace-schema` | Host 自有表按 Wing 建库；CAD 扫描记录与文件索引由 KT Auto CAD 创建/升级，Desk 只校验、读取及执行必要的文件级局部更新 |
| CAD 查询与 XML 领域规则 | `@phoenix-wing/cad-core` | Hono route、ZIP/I/O 与产品权限 adapter |
| SQLite Node 连接 | `@phoenix-wing/db-node` | 生命周期、工作空间路径和错误呈现 |
| FCStd ZIP/Document.xml | Wing `cad-core` + Desk `fcstdDocumentXmlService` | Wing 选择对象/投影/补丁；Desk 解压、原子替换、回滚 |
| 产品页面状态与写入流程 | Desk `server` / `web-ui` | 用户确认、事务边界、缓存刷新和 UI |

产品级能力的减法、迁移入口和 Desk 保留条件见 [Desk CAD 减法与保留边界](Desk-CAD减法与保留边界.md)。Desk 不再把 CAD 索引页或 BOM 列表页作为新功能入口；这些流程分别迁往 KT Auto CAD 与 Phoenix BOM Web。

旧 `CAD数据库表结构.md` 与重命名计划只描述 schema v10，不能用于实现当前查询；历史研究和迁移点检也不能覆盖 Wing package 的机器契约。

## API 规则

- Desk route 可以兼容前端字段，但必须在 adapter 层转换；不得在 UI 或 route 内重写查询算法。
- 文件发现、SQLite、FCStd 读取/BOM 写回、XLink/Label 修改默认且唯一走 TypeScript；不得恢复逐文件启动 Rust CLI 的路径。
- Wing cad-core 保持纯 XML/路径算法，不依赖 Node、DOM 或 Vue；Desk Node adapter 唯一拥有 ZIP 和文件系统。
- Desk 保留的 CAD route 只服务文件详情、改名/XLink 写事务、PartKey 本地关系和外部引擎；不得重新加入全量扫描、交付 outbox 或 Web 正式数据管理。
- Desk 局部 XRef 刷新必须附着到 KT Auto CAD 已存在的扫描 ID；不得伪造完成扫描，也不得改写全局扫描时间/统计元数据。
- `pnpm build:tauri-runtime` 必须完成 Node sidecar health/shutdown 与 packaged TypeScript CAD runtime smoke，不再生成 native provider。

消费版本和 lockfile 来源由 `pnpm verify:wing-dependencies` 检查，不在本文复制第二份依赖矩阵。
