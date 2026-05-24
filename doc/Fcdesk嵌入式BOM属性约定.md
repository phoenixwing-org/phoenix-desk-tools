# Fcdesk 嵌入式 BOM 属性约定

> [文档索引](文档索引.md)

FreeCAD **不内置**以下为仓库索引对齐的 BOM 侧车语义；键名与 **`FcstdMapEntry`**（`fcdesk/fcstd_mapping.py`）一致。需在 **`.FCStd` ZIP** 根目录维护 **`FcdeskBomAttrs.xml`**（与 `Document.xml` 同级）时见下文。

## 1. 存储

| 项 | 约定 |
| --- | --- |
| 宿主 | 工作空间内 `*.FCStd` |
| 侧车 | ZIP 根 `FcdeskBomAttrs.xml` |
| 写回 | 整包原子替换，`fcstd_embedded_attrs.py`，**不改** `Document.xml` |
| 占用 | 文档被占用时重写常失败 |

## 2. 字段键名（JSON / XML / Python）

| 用途 | 键名 |
| --- | --- |
| 文档内 BOM 条目 | `repo_rel_path`、`filename`（路径类）；**`PartNumber`**、**`PartVersion`**；**`TypeCode`**；**`ModelSeries`**、`label`（与 FreeCAD 大驼峰 Property 对齐的键用大驼峰） |
| `extra` | 扩展 dict，侧车 XML **不写** |

**`EDITABLE_ENTRY_ATTRS`**（ZIP 侧车子元素）：**`PartNumber`、`PartVersion`、`TypeCode`、`ModelSeries`、`label`**。  
**不写 XML**：`repo_rel_path`、`filename`。

XML 文档根 **`FcdeskBomAttrs` 的属性 `version="1"`** 表示格式版本，勿与条目字段 **`PartVersion`** 混淆；空串不写子元素；五可写字段全空则删文件。

fcdesk「属性回写」第二行英文名与磁盘键一致（路径类两行仍可由 **RepoRelativePath / Filename** 与 `repo_rel_path` / `filename` 对照）。

## 3. 与索引的先后

**`fcstd_map.json`** 命中 → 初值；否则 **`preview_from_workspace_relative`**；包内 **`FcdeskBomAttrs.xml`** 覆盖可写字段。**首次 XML** 由属性回写保存或脚本调用 **`write_embedded_bom_attrs()`**。

## 4. FreeCAD 内 Property

[BOM工具说明.md](BOM工具说明.md) — `PartNumber` 等可与模型自定义属性对齐；与本侧车**各管一层**时需自行桥接。

## 5. 改代码时请同步

`FcstdMapEntry`、`EDITABLE_ENTRY_ATTRS`、`bom_apply_page._ATTR_ROWS`。
