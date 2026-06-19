# 测试样例数据

本目录存放 **pytest 与回归** 用的二进制 / XML 样例，不放说明文档（分析见 [`doc/cad/samples/`](../../doc/cad/samples/)）。

**外链开源 C++ 工程**（KtAlarmClock、PNXCaaStudy）见 **[doc/code/测试工程外链-fixture.md](../../doc/code/测试工程外链-fixture.md)** 与 `external-links.manifest.json`；本机 clone 后运行 `python3 scripts/link_test_fixtures.py` 或启动 Web 时自动尝试链接。

## 布局

| 路径 | 用途 |
| --- | --- |
| `KtAlarmClock/` | **symlink** · Qt 闹钟完整工程（成员排序 Kevin Wizard 回归） |
| `PNXCaaStudy/` | **symlink** · CAA 学习工程（CAA2 Wizard、GUID 等） |
| `reorder_members/` | 最小 `.h` 片段（锁定段用例），供 `test_reorder_avoidance_rules.py` |
| `uuid/` | UUID / GUID 形态小样本（摘自 PNXCaaStudy），供 UUID 引擎单测 |
| `workspaces/<名>/document-xml/*.xml` | 从真实 FCStd 导出的 `Document.xml` 片段，供挂载/BOM/解析单测读取 |
| `workspaces/<名>/.phoenix/*.sqlite` | （可选）最小工作空间库；schema 须与现网 v10 一致 |

## 当前样例

- **`reorder_members/`** — 锁定段最小片段；单测见 `tests/test_reorder_avoidance_rules.py`。
- **`uuid/`** — `caa_guid_snippet.cpp`、`sample_feature.json` / `sample_ref.json`（同一 GUID 跨文件引用）。
- **`KtAlarmClock/`** · **`PNXCaaStudy/`** — 需本机 clone + 链接；见 [测试工程外链-fixture.md](../../doc/code/测试工程外链-fixture.md)。
- **`workspaces/minimal/document-xml/`**
  - `内部装配示例-Document.xml` — 内部多层 `App::Part` 挂载问题，见 [doc/cad/samples/内部装配示例-挂载分析.md](../../doc/cad/samples/内部装配示例-挂载分析.md)
  - `图纸-通过link来创建-Document.xml` — 图纸 / `App::Link` 场景（待补分析文档）

## 约定

- 尽量 **脱敏**（件号可保留若仅为内部示例）。
- 新增 XML：放 `document-xml/`，在 `doc/cad/samples/` 或本 README 加一行说明。
- 单测引用：`Path(__file__).resolve().parents[N] / "fixtures/workspaces/minimal/document-xml/…"`。
