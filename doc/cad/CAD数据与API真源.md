# CAD 数据与 API 真源

状态：current

Owner：Desk Tools CAD maintainers

适用版本：Workspace Schema v13 / Wing 0.4.3

最后核验：2026-07-20

## 单一真源

| 事实 | 真源 | Desk 责任 |
| --- | --- | --- |
| Workspace Schema v13 表、列和协议版本 | `@phoenix-wing/workspace-schema` | 创建/升级本地数据库并拒绝不兼容版本 |
| CAD 查询与 XML 领域规则 | `@phoenix-wing/cad-core` | Hono route、ZIP/I/O 与产品权限 adapter |
| SQLite Node 连接 | `@phoenix-wing/db-node` | 生命周期、工作空间路径和错误呈现 |
| FCStd ZIP/Document.xml | Wing `cad-core` + Desk `fcstdDocumentXmlService` | Wing 选择对象/投影/补丁；Desk 解压、原子替换、回滚 |
| 产品页面状态与写入流程 | Desk `server` / `web-ui` | 用户确认、事务边界、缓存刷新和 UI |

旧 `CAD数据库表结构.md` 与重命名计划只描述 schema v10，不能用于实现当前查询；历史研究和迁移点检也不能覆盖 Wing package 的机器契约。

## API 规则

- Desk route 可以兼容前端字段，但必须在 adapter 层转换；不得在 UI 或 route 内重写查询算法。
- 文件发现、SQLite、FCStd 读取/BOM 写回、XLink/Label 修改默认且唯一走 TypeScript；不得恢复逐文件启动 Rust CLI 的路径。
- Wing cad-core 保持纯 XML/路径算法，不依赖 Node、DOM 或 Vue；Desk Node adapter 唯一拥有 ZIP 和文件系统。
- `pnpm build:tauri-runtime` 必须完成 Node sidecar health/shutdown 与 packaged TypeScript CAD runtime smoke，不再生成 native provider。

消费版本和 lockfile 来源由 `pnpm verify:wing-dependencies` 检查，不在本文复制第二份依赖矩阵。
