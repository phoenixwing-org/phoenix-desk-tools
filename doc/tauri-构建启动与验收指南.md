# Tauri 构建启动与验收指南

> 更新于 2026-07-11。当前验收对象和产物哈希以 [Tauri 迁移当前状态基线](tauri-当前迁移状态基线.md) 为准。本文只记录当前 Tauri 2、Node sidecar 和 Rust FCStd 产品链；旧 Python 桌面启动器和 Python HTTP 服务不是生产启动方式。

## 1. 构建环境

已验证环境为 Windows x64、Node 22.16、pnpm 9.15、Rust MSVC stable、Tauri CLI 2.11。官方安装包使用 Tauri NSIS；当前 bundler 需要 NSIS 3.11 和 `nsis_tauri_utils` 0.5.3。

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

构建可执行文件及相邻运行时：

```powershell
pnpm build:tauri-runtime
cargo tauri build --no-bundle
```

构建官方 Tauri NSIS：

```powershell
pnpm tauri:installer
```

当前产物：

| 产物 | 路径 |
| --- | --- |
| release EXE | `src-tauri/target/release/phoenix-desktop.exe` |
| Node runtime | `src-tauri/target/release/runtime/node/node.exe` |
| Node bundle | `src-tauri/target/release/runtime/server/server.mjs` |
| Rust FCStd 工具 | `src-tauri/target/release/runtime/bin/fcstd-read.exe`、`fcstd-xlink.exe` |
| NSIS setup | `src-tauri/target/release/bundle/nsis/Phoenix Desktop Tools_0.1.0_x64-setup.exe` |

2026-07-11 的 NSIS 产物为 26,037,429 字节，SHA256 为 `E3239C4C5737C4AD31F00AFDECD1A91CC7765D191164AE1D917F03D5CD24DA64`。重新构建后必须重新记录哈希。

当前阶段应先验收上述冻结产物，不要在页面验收前无理由重新构建；否则必须先更新状态基线中的所有受影响哈希，避免把不同二进制的结果混在同一结论中。

## 4. 已完成的产物验收

停止开发后端并确认 5180 空闲后，直接启动 release EXE，已取得以下证据：

1. Tauri 启动 release 自带的 `runtime/node/node.exe`，不是 PATH Node，也不是仓库 `tsx`。
2. `GET /api/health` 返回 `status=ok`、`service=phoenix-node`、`protocol_version=1`。
3. 配置页显示两个 Rust 原生工具均可用，路径位于 release `runtime/bin`。
4. 发行版“单元测试”运行 Code/CAD/Platform/CAA 共 14 项，14 通过、0 失败、0 跳过。
5. 配置页“退出 Phoenix”确认后，Tauri 和 Node 子进程均退出，5180 释放。
6. 5180 被开发服务占用时，release 明确报错并写 `phoenix-startup-error.log`，不会静默借用开发服务。

NSIS 已在 Codex 隔离账户上下文完成安装、从安装目录启动、安装态 14/14 自检、确认退出和卸载目录清理。Windows 会把该上下文的 shell known-folder/注册表写入隔离用户位置；因此开始菜单目标和卸载登记不作为普通用户证据。正式签收前仍需在普通用户上下文运行一次 setup，检查开始菜单、“已安装的应用”和逐页工作流后再卸载。

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
