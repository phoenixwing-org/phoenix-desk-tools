# CAD 数据与 API 真源

状态：current

Owner：Desk Tools CAD maintainers

适用版本：Workspace Schema v13 / Wing 0.4.3

最后核验：2026-07-17

## 单一真源

| 事实 | 真源 | Desk 责任 |
| --- | --- | --- |
| Workspace Schema v13 表、列和协议版本 | `@phoenix-wing/workspace-schema` | 创建/升级本地数据库并拒绝不兼容版本 |
| 只读 CAD 查询与 JSON 契约 | `@phoenix-wing/cad-contracts` / `@phoenix-wing/cad-core` | Hono route 与产品权限 adapter |
| SQLite Node 连接 | `@phoenix-wing/db-node` | 生命周期、工作空间路径和错误呈现 |
| FCStd read/XLink/query Rust 源码 | `@phoenix-wing/cad-rust-source` | 构建 native tools、打包和 parity smoke |
| 产品页面状态与写入流程 | Desk `server` / `web-ui` | 用户确认、事务边界、缓存刷新和 UI |

旧 `CAD数据库表结构.md` 与重命名计划只描述 schema v10，不能用于实现当前查询；历史研究和迁移点检也不能覆盖 Wing package 的机器契约。

## API 规则

- Rust CLI stdout 只输出版本化协议 JSON，诊断走 stderr。
- Desk route 可以兼容前端字段，但必须在 adapter 层转换；不得在 UI 或 route 内重写查询算法。
- native tools 必须从已安装的 Registry `@phoenix-wing/cad-rust-source` 构建；禁止恢复相邻仓库路径或 Desk 内 Rust 源码副本。
- `pnpm build:tauri-runtime` 必须完成 native parity、sidecar health/shutdown 与 packaged runtime smoke。

消费版本和 lockfile 来源由 `pnpm verify:wing-dependencies` 检查，不在本文复制第二份依赖矩阵。
