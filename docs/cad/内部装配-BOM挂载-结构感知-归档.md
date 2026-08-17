# 内部装配 · BOM 挂载结构感知 · 归档

> 样例分析：[samples/内部装配示例-挂载分析.md](samples/内部装配示例-挂载分析.md)  
> 实现：`phoenix/freecad/fcstd_document_bom_props.py`  
> 单测：`tests/test_fcstd_drawing_bom.py::test_internal_assy_mounts_on_structural_root_part`  
> 最后更新：2026-06-22

---

## 问题

纯内部装配（无 XLink）多层 `App::Part` 时，旧规则按 `<Objects>` 声明顺序取**第一个** Part，误挂 `_6222656233` 等几何包装容器，而非树顶 `PCB`。

---

## 规则（已实现）

挂载对象在 **Group 拓扑** 上取**结构顶级**（未被其它对象 `Group` 引用的节点），类型档依次为：

`PartDesign::Body` → type 含 `assembly` → `App::Part` → `App::Link`

同档多根时按 `<Objects>` 声明顺序取第一个。

---

## 验收

| 项 | 状态 |
| --- | --- |
| 样例 XML → `_first_bom_target_object_name` = `PCB` | ✅ |
| 图纸-primary 仍挂 `App::Link` | ✅ |
| 读写 BOM / 索引 / Label 同步走同一挂载函数 | ✅ |

**结论**：文件级 BOM 不再被 XML 扁平顺序误导；已有错误数据需用户重新回写或迁移。
