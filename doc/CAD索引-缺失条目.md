# CAD 索引 — 缺失条目

> [文档索引](文档索引.md) · Web 页 **CAD 索引**（`FcstdMapPage`）

## 扫描范围

**Web / 桌面** CAD 索引的「工程内搜索」「创建索引」均固定从**当前工作空间根**递归扫描（`repo_rel_path` 相对工作空间根）；**不再提供**子目录扫描根设置。Web 扫描选项见 **扫描设置** 子 Tab；桌面仅保留「强制更新 PartName」勾选。

## 「缺失」是什么

工程内搜索时，若某路径**上次在索引里、本次扫描未找到**，其 `file_status` 记为 **`missing`**（界面显示「缺失」）。常见于：

- 文件已从工作空间删除或移走
- 扫描根目录变更，旧路径不再纳入扫描范围
- 临时报告、图片等曾被扫入索引，后来清理掉

缺失条目**不代表**磁盘上仍有该文件；仅保留历史 BOM 字段与路径，供改名追溯、引用分析对照。

## 删除缺失记录

Web **CAD 索引 · 索引列表** 工具栏：**删除缺失（N）**。

| 项 | 说明 |
| --- | --- |
| 作用 | 从 `.phoenix/phoenix-workspace.sqlite` 的 `phoenix_cad_file_asset` 表**永久删除**所有 `file_status=missing` 行 |
| 确认 | 应用内对话框说明删除条数；**默认「取消」**，按 Esc 或点遮罩亦取消；选「删除 N 条」才执行 |
| 连带 | 同步 `part_key` / `part_file_link`；`bom_xref` 中指向已删 `file_asset` 的外键按库规则清理（宿主删除级联、目标置空） |
| 不删 | 磁盘文件（本来已不存在）；**存在** 条目不受影响 |
| 统计 | 删除后刷新顶栏「条目 / 存在 / 缺失」与 `last_scan_stats` |

再次执行工程内搜索时，若文件仍不存在，**不会**自动重现旧缺失行（除非其它流程重新登记该路径）。

## API

`POST /api/fcstd-map/purge-missing` — 返回与 `GET /api/fcstd-map` 相同结构，另含 `purge_deleted`（本次删除条数）。

实现：`phoenix/services/fcstd_map_service.purge_missing_fcstd_map_entries` · `phoenix/freecad/phoenix_store.delete_missing_file_assets`。
