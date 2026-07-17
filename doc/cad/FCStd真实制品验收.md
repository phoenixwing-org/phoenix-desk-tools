# FCStd 真实制品验收

状态：current

Owner：Desk Tools CAD maintainers

适用版本：0.2.x

最后核验：2026-07-17

## 入口

```bash
pnpm verify:real-fcstd
```

该命令先从 Registry 消费的 `@phoenix-wing/cad-rust-source` 以 locked release profile 构建 `fcstd-read`、`fcstd-xlink` 与 `fcstd-query`，再执行真实 FCStd archive 的读、改、回滚 smoke。`build:tauri-runtime` 已包含同一 smoke，因此完整 `pnpm verify:ci` 会阻止回归。

## Fixture 与流程

输入使用仓库冻结的真实 FreeCAD `Document.xml`：`tests/fixtures/workspaces/minimal/document-xml/图纸-通过link来创建-Document.xml`。测试把它和最小 `GuiDocument.xml` 打成有效 `.FCStd` ZIP，而不是把 XML 字符串直接当成 FCStd。

自动门禁依次验证：

1. `fcstd-read --protocol 1 read` 能从 archive 返回 `phoenix-cad-native` v1 成功 envelope 和非空对象。
2. `fcstd-xlink --protocol 1 scan` 精确命中真实中文路径 XLink。
3. legacy patch 在 archive 内只替换一个 XLink attr；修改后 archive 哈希变化，`Document.xml` 含新路径，`fcstd-read` 仍能复读。
4. 注入宿主后续失败后，以写前字节恢复 archive；回滚 SHA-256 与初始值完全一致，原 XLink 语义恢复，并再次通过 native read。
5. 临时/backup 文件不得遗留。

## 边界

此门禁证明的是 Desk 打包使用的 Wing Rust 原生工具能处理有效 FCStd archive，不等于已经启动 FreeCAD 或 SolidWorks。本机缺少这两个外部宿主，相关 E/F 档继续明确记录为环境缺失；Windows NSIS release 也仍需 Windows runner，不由 macOS 开发服务或历史 0.1.0 EXE 代替。
