# Fcdesk 嵌入式 BOM 属性约定

> [文档索引](文档索引.md)

fcdesk「属性回写」将可编辑 BOM 字段写入 **`.FCStd` ZIP** 内的 **`Document.xml`**：挂在 **首个 `PartDesign::Body`** 对象的 `<Properties>` 中，与你在 FreeCAD 里添加的自定义属性（例如 **`TempKevin`**）同一层级。键名仍与 **`FcstdMapEntry`**（`fcdesk/fcstd_mapping.py`）及 **`fcstd_map.json`** 一致。

## 1. 存储

| 项 | 约定 |
| --- | --- |
| 宿主 | 工作空间内 `*.FCStd` |
| 主存储 | **`Document.xml`**：`PartDesign::Body` 上的自定义字符串：**``PartNumber``**、``PartVersion``、``TypeCode``、``ModelSeries``、**``PartName``**（组 **CustomDefine**，工具提示见各 ``Property/@doc``），以及 **`Label`**（表单字段 ``label``） |
| UI 字段 `label` | 写入 FreeCAD **`Label`**（`App::PropertyString`） |
| 旧版侧车 | 根路径 **`FcdeskBomAttrs.xml`**：**保存时会删除并完成迁移**；读取时若在 Document 尚无对应字段，则临时沿用侧车值 |
| 写回 | 整包原子替换，`fcdesk/fcstd_document_bom_props.py` / **`write_embedded_bom_attrs()`** |
| 占用 | 文档被占用时重写常失败 |

无 **PartDesign::Body** 的 FCStd **不支持**在当前实现下写入（会报错）。

## 2. 字段键名（JSON / XML / Python）

| 用途 | 键名 |
| --- | --- |
| 文档内 BOM 条目 | `repo_rel_path`、`filename`（路径类）；**`PartNumber`**、**`PartVersion`**、**`TypeCode`**、**`ModelSeries`**、**`PartName`**、`label`（表单 **`label`** ↔ Body **`Label`**） |
| `extra` | 扩展 dict，不写 `Document.xml` |

**`EDITABLE_ENTRY_ATTRS`**：**`PartNumber`、`PartVersion`、`TypeCode`、`ModelSeries`、`PartName`、`label`**。  
不写 Document：`repo_rel_path`、`filename`。属性回写：若 **`PartName`** 为空保存，则用当前 **`label`** 写入 Document；载入时 **`PartName`** 为空则界面用 **`label`** 预填。

## 2′. 与 FreeCAD Document 序列化对齐

fcdesk **不自定义**并行格式：可编辑 BOM 五项（不含原生 ``Label``）为 **`App::PropertyString`** + 子结点 **`String/@value`**，与 FC **「添加属性」**及 **`PropertyString::Restore`**（[FreeCAD `PropertyStandard.cpp`](https://github.com/FreeCAD/FreeCAD/blob/master/src/App/PropertyStandard.cpp)）可读形态一致。五项的 **`group`** 默认为 **`CustomDefine`**（常量 **`FCDESK_EMBEDDED_BOM_PROPERTY_GROUP`**）；**`doc`** 为工具提示。**`status` / `attr` …** Bitmask 新建时尽量从参照复制；空串则从 Body 移除该自定义属性结点；**`Label`** 始终存在。
## 3. 与索引的先后

**`fcstd_map.json`** 命中 → 初值；否则 **`preview_from_workspace_relative`**；再从 **`Document.xml`**（以及尚未迁移的包内 **`FcdeskBomAttrs.xml`**，仅兜底）叠加可写字段。

## 4. FreeCAD 内 Property（与扩展在同一层）

[BOM工具说明.md](BOM工具说明.md) — 写入后 Body 上会看到 **`CustomDefine`** 分组下的 ``PartNumber`` 等（或你在源码中改写的组名）。

## 5. 改代码时请同步

`FcstdMapEntry`、`compose_fcstd_body_label_display`、`EDITABLE_ENTRY_ATTRS` / **`EDITABLE_DOCUMENT_ATTRS`**、`FCDESK_EMBEDDED_BOM_PROPERTY_GROUP`（及别名 `FCDESK_BOM_PROPERTY_GROUP`、`PHOENIX_BOM_PROPERTY_GROUP`）、`_BOM_STRING_PROPERTY_DOC`、`bom_apply_page._ATTR_ROWS`、`fcdesk/fcstd_document_bom_props.py`。
