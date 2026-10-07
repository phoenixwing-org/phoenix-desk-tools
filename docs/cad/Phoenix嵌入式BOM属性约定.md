# Fcdesk 嵌入式 BOM 属性约定

> [文档索引](../文档索引.md)

Phoenix「属性回写」将可编辑 BOM 字段写入 **`.FCStd` ZIP** 内的 **`Document.xml`**：**按顺序挂载**到 **首个 `PartDesign::Body`**；若无 Body 则 **`Object.type` 中含 ``assembly`` 的对象（总成/装配）**，再否则 **`App::Part`**。属性写在对应对象的 ``<Properties>/<Property/>``，与手写 **`TempKevin`** 等同层。键名与 **`FcstdMapEntry`**、`fcstd_map.json` 一致。

## 1. 存储

| 项 | 约定 |
| --- | --- |
| 宿主 | 工作空间内 `*.FCStd` |
| 主存储 | **`Document.xml`**：**挂载对象**（见上文顺序）上的自定义字符串 **``PartNumber``** … **``PartName``** …（组 **CustomDefine**），以及表单 **``label``** ↔ **Label** |
| UI 字段 `label` | 写入 FreeCAD **`Label`**（`App::PropertyString`） |
| 旧版侧车 | 根路径 **`FcdeskBomAttrs.xml`**：**保存时会删除并完成迁移**；读取时若在 Document 尚无对应字段，则临时沿用侧车值 |
| 写回 | Node/TypeScript ZIP adapter 调用 Wing cad-core 选择根对象和修改字段，再整包原子替换；不以旧 Python 为运行时真源 |
| 占用 | 文档被占用时重写常失败 |

若文档中 **既没有 Body、也没有 type 中含 assembly 的对象、也没有 ``App::Part``**，则当前实现无法挂载（会报错并列出部分 ``Object.type`` 供排查）。

## 2. 字段键名（JSON / XML / Python）

| 用途 | 键名 |
| --- | --- |
| 文档内 BOM 条目 | `repo_rel_path`、`filename`（路径类）；**`PartNumber`**、**`PartVersion`**、**`TypeCode`**、**`ModelSeries`**、**`PartName`**、`label`（表单 **`label`** ↔ 挂载对象 **`Label`**） |
| `extra` | 扩展 dict，不写 `Document.xml` |

**`EDITABLE_ENTRY_ATTRS`**：**`PartNumber`、`PartVersion`、`TypeCode`、`ModelSeries`、`PartName`、`label`**。  
不写 Document：`repo_rel_path`、`filename`。详情页读取到真实对象时，缺失的 **`PartName`** 显示为空，不把索引或文件名推断冒充已有属性。推荐时已有 PartName 优先；为空才按「标签名（默认）/文件名」补全，空标签回退文件名。PartName 使用纯名称，不包含末尾 `.ASSY`；装配 Label 和文件名分别保留一个 `.ASSY`、`.ASSY.FCStd`。推荐只填草稿，确认写入才修改 Document，详见 [CAD 批量工具](CAD批量工具.md#名称统一)。

### 2.1 `TypeCode`（类型码）

| 项 | 约定 |
| --- | --- |
| 含义 | 零件在 BOM / 推荐文件名中的**类型分类**，一般为**单字母**字符串 Property |
| 常用值 | **`H`**：一般件 · **`S`**：标准件 · **`R`**：虚拟零件 |
| 是否枚举 | **推荐**用 H/S/R，**不强制**；Web 表单可下拉选上述三项，也可手输其它值（如将来扩展码） |
| 大小写 | 写入索引与推荐文件名时倾向 **大写**（`fcstd_mapping` 对 `TypeCode` 做 `upper`） |
| 推荐文件名 | ``{PartNumber}.{PartVersion}[-{TypeCode}][-{ModelSeries}]-名称{suffix}``（见 `compose_fcstd_recommended_filename`）；**类型码 S（标准件）时不拼 ModelSeries**，且 Web 推荐会把型号系列置空 |
| 示例 | 一般件：`8000.001-H-PX-所有零件预览.ASSY.FCStd` · 标准件：`8007.001-S-M6X12螺栓.FCStd` |
| 从文件名推断 | `part_naming.hints_from_filename`：在 stem 中匹配 ``…-{H\|S\|R}-…`` 段时写入 `TypeCode` |
| FreeCAD 提示 | 挂载对象 Property **`doc`** 文案：`类型码 (H/S/R)`（`fcstd_document_bom_props._BOM_STRING_PROPERTY_DOC`） |
| Web 界面 | **文件详情 · 属性**、**零件详情 · 属性**：`ComboTextInput`（聚焦或点 ▾ **始终列出全部** H/S/R，可点选切换，亦可手输）；选项见 `TYPE_CODE_OPTIONS`；表头中文 **类型码**（`bomFieldLabels.ts`） |

**与 `ModelSeries` 的区别**：`TypeCode` 表零件**类别**（H/S/R）；`ModelSeries` 表**型号系列**（如 `PX`、`12TB`，常从路径或文件名推断）。

## 2′. 与 FreeCAD Document 序列化对齐

Phoenix **不自定义**并行格式：可编辑 BOM 五项（不含原生 ``Label``）为 **`App::PropertyString`** + 子结点 **`String/@value`**，与 FC **「添加属性」**及 **`PropertyString::Restore`**（[FreeCAD `PropertyStandard.cpp`](https://github.com/FreeCAD/FreeCAD/blob/master/src/App/PropertyStandard.cpp)）可读形态一致。五项的 **`group`** 默认为 **`CustomDefine`**，**`doc`** 为工具提示。更新既有字段必须保留原 `group/doc/attr/ro/hide/status`；新增字段必须写入等价动态属性元数据（当前默认 `status=2097152`），否则 Desk 自读虽能看到值，FreeCAD 保存时会删除未注册字段。**`Label`** 始终存在于挂载对象并保留其原生属性元数据。
## 3. 与索引的先后

**`fcstd_map.json`** 命中 → 初值；否则 **`preview_from_workspace_relative`**；再从 **`Document.xml`**（以及尚未迁移的包内 **`FcdeskBomAttrs.xml`**，仅兜底）叠加可写字段。

## 4. FreeCAD 内 Property（与扩展在同一层）

[BOM工具说明.md](BOM工具说明.md) — 写入后挂载对象上会看到 **`CustomDefine`** 分组下的 ``PartNumber`` 等（或你在源码中改写的组名）。

## 5. 改代码时请同步

Wing cad-core 的字段选择/投影、Desk `fcstdDocumentXmlService.ts` 的 ZIP/FreeCAD 元数据与原子替换、`bomAttributeService.ts` 的可编辑字段、Auto CAD Schema v13 映射，以及 Web 的 `TYPE_CODE_OPTIONS`/字段标签。旧 Python 只在具体回归需要差分时查看，不再要求同步开发。
