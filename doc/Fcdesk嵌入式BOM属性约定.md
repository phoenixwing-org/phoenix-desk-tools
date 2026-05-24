# Fcdesk 嵌入式 BOM 属性约定

> 文档索引：[文档索引.md](文档索引.md)

FreeCAD 文档本身**没有**一套与仓库级 BOM 索引完全一致的现成属性块；以下字段名由 **fcdesk 桌面壳**在仓库侧统一定义，与数据类 `FcstdMapEntry`（`fcdesk/fcstd_mapping.py`）对齐。  
需要「落到文件里、不依赖 FreeCAD 进程」时，由壳在 **`.FCStd` ZIP 内**写入侧车 XML；FreeCAD 打开文档时通常**忽略**未在格式说明中列出的 ZIP 成员，因此这些属性相当于在包内**由外面初始化、由 fcdesk 维护**。

## 1. 存储位置（文件级）

| 项 | 约定 |
| --- | --- |
| 宿主 | 工作空间内的 `*.FCStd`（ZIP 容器） |
| 侧车文件 | ZIP **根目录**下的 `FcdeskBomAttrs.xml`（与 `Document.xml` 同级） |
| 写回方式 | 整包复制替换（见 `fcdesk/fcstd_embedded_attrs.py`），**不修改** `Document.xml` |
| 占用 | 若 FreeCAD 正打开该 FCStd，写 ZIP 常失败，需先关闭文档 |

## 2. 属性名字段（稳定英文名）

以下 **Python / JSON / XML 元素标签**三处使用**同一套英文键名**，便于与 `fcstd_map.json` 的 `entries[]` 条目对照。

### 2.1 逻辑全集（与 `FcstdMapEntry` 一致）

| 键名 | 含义（中文） | 谁维护 | 说明 |
| --- | --- | --- | --- |
| `repo_rel_path` | 仓库相对路径 | 工作空间 / 索引 | 相对工作空间根，规范形式见 [路径与目录显示约定.md](路径与目录显示约定.md)；界面只读 |
| `filename` | 文件名 | 文件系统 | 界面只读 |
| `part_no` | 零件号 | **fcdesk 可写** | 可写入 `FcdeskBomAttrs.xml` |
| `version` | 版本 | **fcdesk 可写** | 同上 |
| `type_code` | 类型码（如 H/S/R） | **fcdesk 可写** | 同上 |
| `model_series` | 型号 / 系列（如 `3TB`） | **fcdesk 可写** | 同上 |
| `label` | 可读标签 | **fcdesk 可写** | 同上 |
| `extra` | 扩展字典 | 预留 | 当前嵌入式 XML **未**序列化 `extra`；将来可版本化扩展 |

### 2.2 实际写入 ZIP 内 XML 的字段

代码常量：`EDITABLE_ENTRY_ATTRS`（`fcdesk/fcstd_embedded_attrs.py`）

- `part_no`
- `version`
- `type_code`
- `model_series`
- `label`

`repo_rel_path` / `filename` **不写入**该 XML（以磁盘路径与树选为准，避免与包内副本冲突）。

### 2.3 XML 形状（摘要）

根元素：`FcdeskBomAttrs`，属性 `version="1"`。  
每个可写字段为**子元素**，标签名等于上表键名，文本内容为值；**空字符串不写元素**；若某次保存后五个可写字段全空，则**删除**包内 `FcdeskBomAttrs.xml`。

## 3. 与 FreeCAD / 索引的关系

| 来源 | 作用 |
| --- | --- |
| `fcstd_map.json`（工作空间根） | 若存在且 `repo_rel_path` 匹配，提供条目的初值（与 `FcstdMapEntry` 一致） |
| 文件名 + 路径启发 | 未命中索引时，`FcstdMapEntry.preview_from_workspace_relative()` 推断 |
| `FcdeskBomAttrs.xml` | 对「可写五字段」**覆盖**上述结果；即：**包内保存的优先** |

FreeCAD **不会**自动生成 `FcdeskBomAttrs.xml`：首次需在 **fcdesk「属性回写」页保存**，或由后续脚本调用 `write_embedded_bom_attrs()` 初始化。

## 4. 与「FreeCAD 内 BOM 脚本」的差异

仓库中另有在 **FreeCAD 进程内**为对象添加自定义属性的 BOM 脚本（见 [BOM工具说明.md](BOM工具说明.md)）。  
与本约定关系：

- **本约定**：ZIP 侧车 XML + 桌面编辑，不需要 FreeCAD 运行；字段名锚定 `FcstdMapEntry`。
- **FreeCAD 内脚本**：在 `Document.xml` / 对象 `Property` 上操作，与本侧车文件**互不替代**；若需两边一致，需在宏或脚本中自行读 `FcdeskBomAttrs.xml`（未来可另做桥接）。

## 5. 代码锚点（改名时请同步改代码）

| 说明 | 模块 / 常量 |
| --- | --- |
| 数据类与索引推断 | `fcdesk.fcstd_mapping.FcstdMapEntry`、`preview_from_workspace_relative` |
| ZIP 侧车文件名、可写字段元组 | `fcdesk.fcstd_embedded_attrs.EMBEDDED_BOM_XML`、`EDITABLE_ENTRY_ATTRS` |
| 属性回写界面 | `fcdesk.pages.bom_apply_page`、`doc` 与本文件 |

若增加新字段：先扩展 `FcstdMapEntry` 与序列化契约，再在 `EDITABLE_ENTRY_ATTRS` 与界面行配置中勾选是否「可写入 ZIP」，并递增 XML 文档 `version` 或另行约定兼容性。
