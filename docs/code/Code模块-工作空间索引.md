# Code 模块 · 工作空间索引

> 表前缀 **`phoenix_code_*`**，与 CAD 索引共用 `.phoenix/phoenix-workspace.sqlite`。  
> **勿用 `phoenix_audit_*`**：该前缀保留给 CAD 改名 / XLink 审计（`phoenix_audit_rename_log` 等）。

## 表名约定

| 前缀 | 模块 | 示例 |
| --- | --- | --- |
| `phoenix_code_*` | Code（索引、改名审计、后续 FileWorkset 落库等） | `phoenix_code_scan`、`phoenix_code_file_asset` |
| `phoenix_audit_*` | CAD 审计 | `phoenix_audit_change_event`、`phoenix_audit_rename_log` |
| `phoenix_cad_*` | CAD 索引 / BOM | `phoenix_cad_file_asset` |

Code 新增表一律 **`phoenix_code_` 开头**；schema 变更不迁移旧库，版本不符时重建数据库即可。

## 用途

- 递归扫描工作空间内的 **源文件**、**配置**、**文档**、**资源**
- 写入 SQLite，供 Code 工具页浏览、筛选与后续联动（成员排序等）

## 文件分类

| kind | 说明 | 示例扩展名 |
| --- | --- | --- |
| `source` | C/C++ 等源码 | `.cpp` `.h` `.hpp` `.c` `.m` |
| `config` | 工程与工具配置 | `.json` `.cmake` `.yaml` `CMakeLists.txt` |
| `doc` | 文档 | `.md` `.rst` `.txt` |
| `resource` | UI / 媒体资源 | `.qrc` `.ui` `.png` `.svg` |

完整映射见 `phoenix/code/kinds.py`。

## 扫描规则

- 根目录：当前工作空间根（`.`）
- **跳过目录**：`build`、`dist`、`node_modules`、`web-ui`、`.phoenix`、`.git`、`__pycache__`、`.venv`、`cmake-build-*` 等（见 `phoenix/code/scan_index.py`）
- **缺失标记**：再次扫描时，磁盘上已不存在的路径标为 `missing`，不自动删除历史行

## 数据表

| 表 | 说明 |
| --- | --- |
| `phoenix_code_scan` | 每次扫描记录（时间、统计 JSON） |
| `phoenix_code_file_asset` | 文件资产（路径、类型、状态、大小） |

DDL 在 `phoenix/code/schema.py`，`connect()` 时与 CAD 表一并 `CREATE IF NOT EXISTS`。

元数据键：`code_last_scan_at`、`code_last_scan_stats`（`phoenix_meta`）。

## Web API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/code/index` | 摘要（上次扫描、统计、类型标签） |
| POST | `/api/code/index/scan` | 全量扫描并写库 |
| GET | `/api/code/index/entries` | 分页列表；`kind` / `status` / `q` |
| POST | `/api/code/index/purge-missing` | 删除缺失条目 |
| POST | `/api/code/index/export-json` | 导出 `.phoenix/exports/code_index.json` |

## 前端

侧栏 **Code 索引**（`code_index` 页，`module: code`）。仅勾选 Code 模块时与 **C++ 成员排序** 一并显示。

页头 **工作集 combo**：选择工作集后过滤索引列表（仅显示工作集内的文件），与 CAD 索引 / 成员排序 / 批量改名同模式。扫描操作也可限定工作集范围。

## 源码布局

```
phoenix/code/
  kinds.py        # 扩展名分类
  schema.py       # phoenix_code_* DDL
  scan_index.py   # 递归扫描
  store.py        # SQLite 读写
phoenix/services/code_index_service.py
```

## 待办（未实现）

- 与成员排序联动：通过工作集间接完成（页头 combo → `workset_resolve` 展开）；直接「仅处理索引库中文件」待评估
- Git 脏文件过滤
- **批量改名**（文件夹 / 文件 / 文本）、**UUID 扫描勾选替换** — 见 [Code模块-批量改名-规划.md](Code模块-批量改名-规划.md)

见 [TODO.md](../TODO.md) §P3 Code 工具。
