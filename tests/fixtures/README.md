# 测试样例数据

本目录存放 **pytest 与回归** 用的二进制 / XML 样例，不放说明文档（分析见 [`doc/samples/`](../../doc/samples/)）。

## 布局

| 路径 | 用途 |
| --- | --- |
| `workspaces/<名>/document-xml/*.xml` | 从真实 FCStd 导出的 `Document.xml` 片段，供挂载/BOM/解析单测读取 |
| `workspaces/<名>/.phoenix/*.sqlite` | （可选）最小工作空间库；schema 须与现网 v10 一致 |

## 当前样例

- **`workspaces/minimal/document-xml/`**
  - `内部装配示例-Document.xml` — 内部多层 `App::Part` 挂载问题，见 [doc/samples/内部装配示例-挂载分析.md](../../doc/samples/内部装配示例-挂载分析.md)
  - `图纸-通过link来创建-Document.xml` — 图纸 / `App::Link` 场景（待补分析文档）

## 约定

- 尽量 **脱敏**（件号可保留若仅为内部示例）。
- 新增 XML：放 `document-xml/`，在 `doc/samples/` 或本 README 加一行说明。
- 单测引用：`Path(__file__).resolve().parents[N] / "fixtures/workspaces/minimal/document-xml/…"`。
