# FCStd 真实制品验收

状态：current

Owner：Desk Tools CAD maintainers

适用版本：0.2.x

最后核验：2026-07-20

## 入口

```bash
pnpm verify:real-fcstd
```

该命令直接运行 TypeScript FCStd ZIP/Document.xml 读取、BOM 补丁、XLink/Label 与原子替换回归，不构建 CAD Rust 工具。完整 Tauri runtime 另由 `pnpm build:tauri-runtime` 验证 Node sidecar 和 packaged runtime。

## Fixture 与流程

输入使用仓库冻结的真实 FreeCAD `Document.xml`：`tests/fixtures/workspaces/minimal/document-xml/图纸-通过link来创建-Document.xml`。测试把它和最小 `GuiDocument.xml` 打成有效 `.FCStd` ZIP，而不是把 XML 字符串直接当成 FCStd。

自动门禁依次验证：

1. fflate 只提取并解码 archive 的 `Document.xml`，Wing cad-core 从新旧 schema 选择根 BOM 对象并投影字段。
2. BOM 补丁更新既有/缺失字符串属性，XML 特殊字符正确转义，随后 TypeScript 复读值一致。
3. XLink 补丁只替换目标 `<XLink file>`；Label 补丁只改变对应宿主对象。
4. ZIP 重建保留 `GuiDocument.xml` 等非目标条目；原子替换失败可恢复原件。
5. 临时/backup 文件不得遗留。

## 边界

此门禁证明的是 Wing 纯 XML 规则和 Desk Node ZIP/I/O adapter 能处理有效 FCStd archive，不等于已经用 FreeCAD 打开并重新保存复杂文档。真实 FreeCAD 往返、FreeCAD/SolidWorks 外部引擎和 Windows NSIS release 仍按手动点检表独立验收。
