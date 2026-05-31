# FreeCAD 内 BOM 与 fcdesk 侧车

> [文档索引](文档索引.md)

## 与本仓库的现状

以前在独立 **`python/`** 下的宏脚本（如 `bom_generator`、`initial_bom_attributes`）**已不再随本仓库提供**。若你从其它分支或个人备份、`temp/` 里拿到旧脚本，可把**仓库克隆根**加入 FreeCAD Python 路径后自行使用：

```python
import sys
sys.path.append("/path/to/phoenix-freecad-desktop")  # 改成你的路径
```

API 参阅：[Python scripting tutorial](https://wiki.freecad.org/Python_scripting_tutorial)。

## 两条线，别混用

| 路线 | 说明 |
| --- | --- |
| **fcdesk「属性回写」** | 直接写 **`Document.xml`** **挂载对象**上的 Property：**优先**首个 **`PartDesign::Body`**，否则 **`Object.type`** 中含 **`assembly`** 的对象（总成/装配），再否则 **`App::Part`**（示例见 **[Fcdesk嵌入式BOM属性约定.md](Fcdesk嵌入式BOM属性约定.md)**）；键名与 **`TempKevin`** 等自定义字符串同类。表单键与 **`FcstdMapEntry`** / `fcstd_map.json` 对齐。**旧侧车** `FcdeskBomAttrs.xml` **保存时被移除**。 |
| **仅在 FreeCAD 内改 Property** | 与 fcdesk 写的是 **同一处**文档数据；fcdesk **不替代** CAD 建模，但若字段名一致会互相覆盖。 |

**属性面板里的「拆分单词」**：FreeCAD 按大写字母前插空格做展示。**若希望显示成整齐的「Part Number」这类词组，内部名应使用以大写字母开头的大驼峰（PascalCase），例如 `PartNumber`。** 小驼峰 **`partNumber`** 往往会变成 **`part`** + **`Number`** 两段，观感不如 PascalCase。**`fcstd_map.json`、属性回写字段零件号为键名 `PartNumber`**（与大驼峰 Property 同源）；路径类仍为 `repo_rel_path` / `filename`。

导航 **「BOM 列表」**（`bom_export`）展示装配一层子件表格，见 **[BOM列表页设计.md](BOM列表页设计.md)**。FreeCAD 内多级 BOM 导出仍待方案。
