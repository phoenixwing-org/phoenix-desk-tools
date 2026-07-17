# phoenix-desk-tools

[Gitee](https://gitee.com/PhoenixWing321/phoenix-desk-tools.git) · Apache-2.0

围绕 FreeCAD 工作空间的 **Web 桌面辅助工具**：CAD 索引与检索、BOM、Code 工具等。

## 快速启动

首次运行先安装前端和服务端依赖（仓库使用 pnpm 9.15.9）：

```bash
corepack enable
pnpm install --frozen-lockfile
```

### 浏览器开发模式

```bash
pnpm dev                       # 同时启动 Vite (:5173) 和 Node (:5180)
# 浏览器打开 http://localhost:5173
```

### Tauri 桌面开发模式

桌面模式还需要 Rust 和 Tauri 2 CLI。Tauri 会自行启动前端和本地服务，不需要同时运行 `pnpm dev`。

```bash
cargo install tauri-cli --version "^2.6" --locked  # 仅首次安装
pnpm tauri:dev
```

### 从 VS Code / EXE 打开 CAA 对话框

运行中的 Desk Tools 接受本地 HTTP 请求，并在界面中切换到对应工作空间、打开 `.CATDlg` 编辑 Tab：

```bash
curl -X POST http://127.0.0.1:5180/api/caa/dialog/open \
  -H 'Content-Type: application/json' \
  -d '{"workspaceRoot":"/path/to/workspace","file":"/path/to/workspace/UI/Sample.CATDlg"}'
```

Tauri 可执行文件也接受启动参数；程序已运行时会由单实例桥接转交给现有窗口：

```bash
phoenix-desktop --workspace /path/to/workspace --catdlg /path/to/workspace/UI/Sample.CATDlg
```

也可只传一个 `.CATDlg` 位置；此时文件必须位于当前 Desk Tools 工作空间内。接口还直接接受 `phoenix-desk-tools.caa-dialog.v1` VS Code handoff JSON。

如果启动时提示找不到 `vite/bin/vite.js` 或 `tsx/dist/cli.mjs`，说明本地依赖目录不完整，可强制按锁文件重新安装：

```bash
pnpm install --frozen-lockfile --force
```

默认构建严格使用 `package.json` 锁定的 Wing Registry 0.4.2 包。Codegen Host/Apply、Workspace Schema、Ribbon、UUID/GUID 和 workspace path 契约直接消费包内 fixture；聚合根入口与 composable 子路径的 singleton 由自动测试保护。只有调试 Wing 源码时才显式设置 `PHOENIX_WING_SRC=/path/to/phoenix-wing/src`；不会自动探测相邻仓库。

### 构建 Rust 模块

```bash
pnpm build:native
```

`fcstd-read`、`fcstd-xlink` 与 `fcstd-query` 均从已安装的 `@phoenix-wing/cad-rust-source` 统一 Cargo workspace 编译；Desk Tools 不再保留 Rust 源码副本。查询工具通过 `phoenix-cad-query` v1 绑定 workspace Schema v13，继续供 Desk 构建/诊断使用；KT Auto CAD 的只读 BOM/引用查询已改接 Wing 无驱动查询核心与 VS Code 内置 SQLite，不再消费 Desk provider 中的 `fcstd-query`。

## 架构

```
前端 Vue 3 → Vite :5173
     │
     ▼ proxy /api/*
Node.js Hono :5180
     ├── /api/cad/*  cad-rust (Rust SQLite + 代理)
     ├── /api/caa/*  CAA 对话
     └── /api/*      待迁移（Python 可选）
```

## 测试

```bash
pnpm test                       # Desk 应用层：类型、TS、CAA

# 分类运行
pnpm test:ts                    # TypeScript 测试（server/src/lib/）
pnpm test:caa                   # CAA 测试（catdlg-core + web-ui vitest）
```

Rust workspace 测试由 `phoenix-wing` 的 `test:workspace` 和 npm tarball 三平台门禁统一负责；Desk 的 `build:native` 负责消费端构建、协议握手和真实 fixture parity。

### 测试报告

`pnpm test:ts` 自动生成 HTML 报告 `test-report/index.html`。
由于 HTML 需加载 JS 资源，用 HTTP 查看：

```bash
python3 -m http.server 4173 --directory test-report
# → 浏览器打开 http://localhost:4173
```

## 目录

| 路径 | 说明 |
|------|------|
| `server/` | Node.js + Rust 后端 |
| `web-ui/` | Vue 3 前端 |
| `phoenix/` | Python 包（逐步退役） |
| `scripts/` | 命令行工具 |
| `doc/` | 文档 |

## 文档

- [文档索引](doc/文档索引.md)：当前说明、草案和历史证据的唯一导航
- [总待办](doc/TODO.md)：唯一维护的产品/技术债入口
- [Tauri 当前状态](doc/tauri-当前迁移状态基线.md)与[构建验收](doc/tauri-构建启动与验收指南.md)
- [CAA 当前架构与契约](doc/caa/CAA当前架构与契约.md)
- [CAD 数据与 API 真源](doc/cad/CAD数据与API真源.md)

## 许可证

Copyright © 2024–2026 上海锟钛。项目使用 [Apache License 2.0](LICENSE) 开源。
