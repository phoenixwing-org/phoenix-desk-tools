# Tauri 0.2.0 macOS 发布态验收

状态：archived

Owner：Desk Tools release maintainers

适用版本：0.2.0 / macOS arm64

最后核验：2026-07-20

> 历史回执：本文记录 2026-07-17 的早期 0.2.0 制品，保留当时三个 Rust sidecar 的原始证据，不代表当前运行时。当前源码已改为 TypeScript FCStd ZIP/XML 与 SQLite 路径，操作入口见 [Tauri 构建、启动与验收](tauri-构建启动与验收指南.md)，本轮人工点检见 [Web / Tauri / CAD 手动点检表](platform/2026-07-20-Desk-Web-Tauri-CAD手动点检表.md)。

## 结论

Phoenix Desktop Tools 0.2.0 已在 macOS arm64 从当前源码构建为真实 Tauri `.app`，并通过自动发布态 smoke。当前回执已从 Registry `@phoenix-wing/cad-rust-source@0.4.2` 重建三个 native tools。测试启动的是 `.app/Contents/MacOS/phoenix-desktop`，由它拉起包内 Node runtime；没有启动源码目录的 `tsx` 服务，也没有复用开发态 5180。

本结论只覆盖当前 macOS `.app`，不能替代 Windows 0.2.0 NSIS、代码签名、公证、FreeCAD、SolidWorks 或真实 CAA 编译验收。

## 可重复入口

完整重建并验收：

```bash
pnpm verify:tauri-release:macos
```

已有 `.app` 时只运行发布态 smoke：

```bash
pnpm -C server smoke:tauri-release-app
```

运行前 5180 必须空闲。测试把 HOME、CoreFoundation home、工作空间和临时目录隔离到一次性目录；结束后清理全部测试数据。

## 2026-07-17 证据

| 项目 | 值 |
| --- | --- |
| 产物 | `src-tauri/target/release/bundle/macos/Phoenix Desktop Tools.app` |
| 平台 | `darwin-arm64` |
| 应用版本 | `0.2.0` |
| `.app` 大小 | 79 MB |
| 主二进制 SHA-256 | `cc9f945cf40dafb469cd322438d00e918eddd7236c8eb6540ded843a9d2ac957` |
| runtime manifest SHA-256 | `17611f61181d3f7d7a7bb6ebfce547297fbac8b4077cf53b8b755ed57a16095b` |
| 签名 | ad-hoc/linker-signed；未做 Developer ID 分发签名 |

自动门禁验证：

1. release Tauri 进程启动，包内服务返回 `phoenix-node` protocol v1 健康响应。
2. `launcher_config_path` 位于隔离的应用数据目录，不写源码仓库或真实用户偏好。
3. `fcstd-read`、`fcstd-xlink`、`fcstd-query` 三个工具均从 `.app/Contents/Resources/runtime/bin` 解析。
4. 通过包内 HTTP host 发现并打开 KT Codegen 配置，完成真实 preflight 和单 Marker Apply，复读源码确认写入。
5. 通过包内 CAD/BOM 路由读取由真实 FreeCAD `Document.xml` 构造的有效 `.FCStd`，确认使用包内 `fcstd-read`。
6. 发送应用级正常退出，Tauri 主进程和 Node sidecar 均退出，5180 释放。

## 未关闭边界

- Windows 0.2.0 NSIS 必须在 Windows runner/VM 重新构建并执行同版本安装、启动、读写、退出和卸载门禁；历史 0.1.0 EXE/NSIS 只作迁移证据。
- macOS `.app` 尚未 Developer ID 签名和公证，不是可直接对外分发的最终制品。
- 当前机器没有 FreeCAD、SolidWorks 和 CAA 编译环境；相应外部宿主成功执行不得由包内 adapter、fixture 或明确失败测试代替。
- 本 smoke 验证代表性发布态服务链，不等于 23 个独立页面均已逐页完成 UI 人工点检。
