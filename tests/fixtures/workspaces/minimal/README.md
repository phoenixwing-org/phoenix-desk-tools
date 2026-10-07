# minimal 工作空间样例

仅含独立手工构造的最小 **Document.xml**，不是用户工程导出、完整 FCStd ZIP 或几何样本。
两份 XML 分别只表达「声明顺序与 Group 归属不同」和「图纸通过 Link 读取模型」的算法条件。
本地生成的 `.phoenix/` 数据库不进入 Git；测试运行时自行创建隔离数据。

| 文件 | 说明 |
| --- | --- |
| `document-xml/内部装配示例-Document.xml` | 两个 Part，子节点先声明，BOM 应挂 RootPart |
| `document-xml/图纸-通过link来创建-Document.xml` | 一个 Page 和一个指向合成模型名的 Link |

分析文档：[docs/cad/samples/内部装配示例-挂载分析.md](../../../../docs/cad/samples/内部装配示例-挂载分析.md)
