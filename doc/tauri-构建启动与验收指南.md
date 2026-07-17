# Tauri 构建启动与验收指南

> 更新于 2026-07-17。当前 macOS 验收对象和产物哈希以 [Tauri 0.2.0 macOS 发布态验收](tauri-0.2.0-macOS发布态验收.md) 为准。本文只记录当前 Tauri 2、Node sidecar 和 Rust FCStd 产品链；旧 Python 桌面启动器和 Python HTTP 服务不是生产启动方式。下文 Windows 0.1.0 产物只保留历史迁移证据，不能计作当前 0.2.0 NSIS。

## 1. 构建环境

已验证环境包括 macOS arm64 当前 0.2.0 release，以及 Windows x64 历史 0.1.0 迁移产物。官方 Windows 安装包使用 Tauri NSIS；当前 0.2.0 仍需 Windows runner/VM 重建验证。

FreeCAD、SolidWorks 和系统 Git 不是构建 Tauri 壳的前置条件。Git 只影响 Git 页面和相应发行版自检；FreeCAD/SolidWorks 只影响各自外部引擎页面的成功执行。

## 2. 开发启动

浏览器开发态：

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

- UI：`http://localhost:5173/`
- Node/Hono：`http://127.0.0.1:5180/api/health`
- Windows 根脚本不再使用 Unix `sleep`。

Tauri 开发态：

```powershell
pnpm tauri:dev
```

debug Tauri 可以复用健康的 5180 开发服务。release 不允许复用，以免将打包 UI 与仓库服务、仓库资源和错误的用户数据目录混在一起。

## 3. Release 与安装包

macOS 0.2.0 当前门禁：

```bash
pnpm verify:tauri-release:macos
```

该命令重建未签名 `.app`，再用隔离用户目录启动真实 Tauri 进程，完成健康、Codegen、真实 FCStd 和退出回收验收。已有产物可用 `pnpm -C server smoke:tauri-release-app` 复验。

Windows 0.2.0 当前目标：

```powershell
pnpm verify:tauri-release:windows
```

该入口会执行当前 NSIS 的构建、一次性安装、卸载登记/快捷方式检查、安装态 Codegen 与 FCStd 代表链、正常退出和静默卸载，并写机器可读回执。详细成功条件见 [Windows 发布态门禁待办](tauri-Windows发布态门禁-待办.md)；必须以真实 runner 回执为准。

构建可执行文件及相邻运行时：

```powershell
pnpm build:tauri-runtime
cargo tauri build --no-bundle
```

构建官方 Tauri NSIS：

```powershell
pnpm tauri:installer
```

下表 Windows 产物是 2026-07-11 的 0.1.0 历史基线，不是当前 0.2.0：

| 产物 | 路径 |
| --- | --- |
| release EXE | `src-tauri/target/release/phoenix-desktop.exe` |
| Node runtime | `src-tauri/target/release/runtime/node/node.exe` |
| Node bundle | `src-tauri/target/release/runtime/server/server.mjs` |
| Rust FCStd 工具 | `src-tauri/target/release/runtime/bin/fcstd-read.exe`、`fcstd-xlink.exe` |
| NSIS setup | `src-tauri/target/release/bundle/nsis/Phoenix Desktop Tools_0.1.0_x64-setup.exe` |

2026-07-11 的 NSIS 产物为 26,037,429 字节，SHA256 为 `E3239C4C5737C4AD31F00AFDECD1A91CC7765D191164AE1D917F03D5CD24DA64`。重新构建后必须重新记录哈希。

当前 0.2.0 Windows 验收必须重新构建同版本产物并记录新哈希，不得复用上述 0.1.0 结果。

## 4. 已完成的历史 Windows 产物验收

停止开发后端并确认 5180 空闲后，直接启动 release EXE，已取得以下证据：

1. Tauri 启动 release 自带的 `runtime/node/node.exe`，不是 PATH Node，也不是仓库 `tsx`。
2. `GET /api/health` 返回 `status=ok`、`service=phoenix-node`、`protocol_version=1`。
3. 配置页显示两个 Rust 原生工具均可用，路径位于 release `runtime/bin`。
4. 发行版“单元测试”运行 Code/CAD/Platform/CAA 共 14 项，14 通过、0 失败、0 跳过。
5. 配置页“退出 Phoenix”确认后，Tauri 和 Node 子进程均退出，5180 释放。
6. 5180 被开发服务占用时，release 明确报错并写 `phoenix-startup-error.log`，不会静默借用开发服务。

0.1.0 NSIS 曾在 Codex 隔离账户上下文完成安装、从安装目录启动、安装态 14/14 自检、确认退出和卸载目录清理。它只证明迁移方案曾走通，不证明当前 0.2.0。0.2.0 仍需在 Windows 普通用户上下文运行 setup，检查开始菜单、“已安装的应用”和代表性工作流后再卸载。

## 5. 每次发布必须检查

```powershell
# 启动前 5180 必须空闲
netstat -ano | Select-String ':5180'

# 启动后检查健康响应
Invoke-RestMethod http://127.0.0.1:5180/api/health

# 记录产物哈希与签名
Get-FileHash -Algorithm SHA256 '.\src-tauri\target\release\bundle\nsis\Phoenix Desktop Tools_0.1.0_x64-setup.exe'
Get-AuthenticodeSignature '.\src-tauri\target\release\bundle\nsis\Phoenix Desktop Tools_0.1.0_x64-setup.exe'
```

页面验收顺序：Shell/配置/工作区和工作集 -> Git -> Code -> CAA -> CAD -> 外部引擎。每个写操作都必须检查磁盘产物并重新加载回读；测试数量不能替代页面与文件结果。

## 6. 数据与日志

- launcher 偏好和日志：`%APPDATA%\com.phoenix.desktools\`
- 工作区业务库：`<工作空间>\.phoenix\phoenix-workspace.sqlite`
- sidecar 日志：`%APPDATA%\com.phoenix.desktools\logs\phoenix-server.log`
- 启动失败：`%APPDATA%\com.phoenix.desktools\logs\phoenix-startup-error.log`

生产 sidecar 使用打包 Node/Hono。FreeCAD 页面可以调用打包 runner，再由 FreeCADCmd 内部 Python API 执行；SolidWorks 页面调用打包 PowerShell 脚本和本机 COM。这两者是外部引擎适配器，不是 Python HTTP 后端。

## 7. 已知发布限制

- 当前 EXE/NSIS 未代码签名，Windows SmartScreen 可能提示未知发布者。
- 目标环境必须具备 WebView2；安装器按 Tauri 默认 WebView2 策略处理缺失运行时。
- 当前验收机没有 FreeCAD、SolidWorks 或真实引擎样本，相关页面只能证明发现、编排、报告和明确失败，不能声称成功转换已验收。
- 合成 FCStd 已覆盖 ZIP/XML 读写，但仍不能替代真实 FreeCAD 打开、保存和复杂文档兼容性验证。
