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
| **fcdesk「属性回写」** | ZIP 侧车 **`FcdeskBomAttrs.xml`**，字段与 **`FcstdMapEntry`** / `fcstd_map.json` 对齐；不写 `Document.xml`。约定见 **[Fcdesk嵌入式BOM属性约定.md](Fcdesk嵌入式BOM属性约定.md)**。 |
| **FreeCAD 内向 Body/Part 写 Property** | 改的是文档内对象属性；与侧车 **互不替代**，要对齐需在宏里自行读 XML。 |

**属性面板里的「拆分单词」**：FreeCAD 按大写字母前插空格做展示。**若希望显示成整齐的「Part Number」这类词组，内部名应使用以大写字母开头的大驼峰（PascalCase），例如 `PartNumber`。** 小驼峰 **`partNumber`** 往往会变成 **`part`** + **`Number`** 两段，观感不如 PascalCase。**fcdesk 侧车、`fcstd_map.json` 条目里零件号为键名 `PartNumber`**（与大驼峰 Property 同源）；路径类仍为 `repo_rel_path` / `filename`。

导航 **「BOM 提取」** 为占位页（`bom_export`），尚未接入具体逻辑。
