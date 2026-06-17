# CAD 数据库表结构 — 重命名（已实施）

> [文档索引](文档索引.md) · 现网表结构：[CAD数据库表结构.md](CAD数据库表结构.md)  
> 状态：**已实施**（`schema_version` **10**，2026-06）  
> 最后更新：2026-06

---

## 1. 决策摘要

| 项 | 决策 |
| --- | --- |
| 库文件名 | `phoenix-workspace.sqlite`（旧：`cad-database.sqlite`、`phoenix-cad.sqlite`） |
| 表前缀 | CAD/BOM/零件：`phoenix_cad_*`；审计：`phoenix_audit_*`；壳层：`phoenix_meta`、`phoenix_ui_session` |
| 迁移策略 | **不做 RENAME TABLE 迁移**；`discard_legacy_database_files` 自动删遗留文件/含旧表名的库；可选 Web **确认重建** |
| API JSON | 逻辑字段名不变（如 `part_key`、`bom_xref` 统计键） |

---

## 2. 新旧对照

| 曾用名 | 新表名 |
| --- | --- |
| `meta` | `phoenix_meta` |
| `fcstd_scan` | `phoenix_cad_scan` |
| `file_asset` | `phoenix_cad_file_asset` |
| `part_key` | `phoenix_cad_part_key` |
| `part_file_link` | `phoenix_cad_part_file_link` |
| `bom_xref` | `phoenix_cad_bom_xref` |
| `bom_assembly_cache` | `phoenix_cad_bom_assembly_cache` |
| `bom_tree_occurrence` | `phoenix_cad_bom_tree_occurrence` |
| `change_event` | `phoenix_audit_change_event` |
| `rename_log` | `phoenix_audit_rename_log` |
| `ref_hit` | `phoenix_audit_ref_hit` |
| `ref_patch_log` | `phoenix_audit_ref_patch_log` |
| `ui_session` | `phoenix_ui_session` |

---

## 3. 代码落点

| 模块 | 职责 |
| --- | --- |
| `fcdesk/freecad/phoenix_schema.py` | 常量、`CREATE_SCHEMA_DDL`、`detect_legacy_database`、`recreate_database`、`database_status_payload` |
| `fcdesk/freecad/phoenix_store.py` | `connect()` 前自动 `discard_legacy_database_files`、业务 SQL |
| `fcdesk/services/phoenix_database_service.py` | 状态 / 重建封装 |
| Web API | `GET /api/phoenix/database/status`、`POST /api/phoenix/database/recreate` |
| Web UI | `AppShell` 旧库横幅 + 确认重建 |

---

## 4. 运维

1. 拉取含 v10 的代码后打开工作空间。
2. 若顶部出现「检测到旧版 CAD 数据库」横幅，点 **确认重建数据库**。
3. 执行 **CAD 索引 → 工程内搜索** 重建索引与 BOM 引用。
4. 改名历史、UI Tab 会话等**不会**从旧库保留。

---

## 5. 历史规划（归档）

原 v10 `RENAME TABLE` 迁移方案已废弃，原因：简化实现、避免迁移失败回滚复杂度。完整 ER 与字段说明见 [CAD数据库表结构.md](CAD数据库表结构.md)。
