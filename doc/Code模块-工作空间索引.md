# Code 模块 · 工作空间索引

> 表前缀 **`phoenix_code_*`**，与 CAD 索引共用 `.phoenix/phoenix-workspace.sqlite`。

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

## 前端

侧栏 **Code 索引**（`code_index` 页，`module: code`）。仅勾选 Code 模块时与 **C++ 成员排序** 一并显示。

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

- 删除缺失条目（对标 CAD 索引「删除缺失」）
- 与成员排序联动：仅处理索引库中的文件
- 导出 JSON、Git 脏文件过滤

见 [TODO.md](TODO.md) §P3 Code 工具。
