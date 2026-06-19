# 测试样例数据

本目录存放 **pytest 与回归** 用的二进制 / XML 样例，不放说明文档（分析见 [`doc/cad/samples/`](../../doc/cad/samples/)）。

## 布局

| 路径 | 用途 |
| --- | --- |
| `KtAlarmClock/` | **C++ 成员排序** 回归：完整 Qt 模块拷贝（含 `KtAlarmClockUI/KtAlarmClockParam.h` CAA Wizard 用例） |
| `reorder_members/` | （规划）最小 `.h`/`.cpp 片段，一规则一文件，供 `test_reorder_protected_regions.py` |
| `workspaces/<名>/document-xml/*.xml` | 从真实 FCStd 导出的 `Document.xml` 片段，供挂载/BOM/解析单测读取 |
| `workspaces/<名>/.phoenix/*.sqlite` | （可选）最小工作空间库；schema 须与现网 v10 一致 |

## 当前样例

- **`KtAlarmClock/`** — 成员排序与 CAA 保护区用例；见 [doc/code/成员排序-保护区与回归用例.md](../../doc/code/成员排序-保护区与回归用例.md)。本机也可用 `ln -s` 指向完整工程（见 `test_reorder_members_service.py`）。
- **`workspaces/minimal/document-xml/`**
  - `内部装配示例-Document.xml` — 内部多层 `App::Part` 挂载问题，见 [doc/cad/samples/内部装配示例-挂载分析.md](../../doc/cad/samples/内部装配示例-挂载分析.md)
  - `图纸-通过link来创建-Document.xml` — 图纸 / `App::Link` 场景（待补分析文档）

## 约定

- 尽量 **脱敏**（件号可保留若仅为内部示例）。
- 新增 XML：放 `document-xml/`，在 `doc/cad/samples/` 或本 README 加一行说明。
- 单测引用：`Path(__file__).resolve().parents[N] / "fixtures/workspaces/minimal/document-xml/…"`。
