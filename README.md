# phoenix-desk-tools

[Gitee](https://gitee.com/phoenixwing/phoenix-desk-tools.git) · Apache-2.0

围绕 FreeCAD 工作空间的 **Web 桌面辅助工具**：CAD 索引与检索、BOM、Code 工具等。

## 快速启动

首次运行先安装前端和服务端依赖（仓库使用 pnpm 9.15.9）：

```bash
corepack enable
pnpm install --frozen-lockfile
```

### 浏览器开发模式

标准开发目录要求 `phoenix-desk-tools` 与 `phoenix-wing` 并列：

```bash
pnpm dev                       # 本地 Wing；Vite 首选 :49373，发现已登记 API 时直接复用
# 浏览器打开 http://localhost:49373
```

`pnpm dev` 找不到 `../phoenix-wing` 会直接停止，不会静默回退 npm 包。需要验证当前 Registry 正式包时明确运行：

```bash
pnpm dev:registry              # package.json + pnpm-lock.yaml 锁定版本
```

非并列目录可用 `PHOENIX_WING_ROOT=/path/to/phoenix-wing pnpm dev`。完整的本地测试、构建命令和安全边界见 [Wing 并列仓库联调](docs/platform/Wing并列仓库联调.md)。

### Tauri 桌面开发模式

桌面模式还需要 Rust 和 Tauri 2 CLI。Tauri 会自行启动前端；发现兼容的已登记 Desk API 时复用它，否则启动自己的后台 API。

```bash
cargo install tauri-cli --version "^2.6" --locked  # 仅首次安装
pnpm tauri:dev                    # 49373 被占用时自动尝试 49374、49375……
```

如需先关闭遗留进程，先查 PID，再只结束对应进程：

```bash
# macOS / Linux（把 49373 换成报错中的端口，例如 5137）
lsof -nP -iTCP:49373 -sTCP:LISTEN
kill <PID>                       # 普通终止；仍未退出时才使用 kill -9 <PID>

# Windows PowerShell
Get-NetTCPConnection -LocalPort 49373 -State Listen | Select-Object OwningProcess
Stop-Process -Id <PID>
```

`pnpm tauri:dev` 会把选中的端口同时传给 Vite、Tauri `devUrl` 和开发 CSP；可用 `WEB_UI_PORT=50000 pnpm tauri:dev` 指定自动搜索的起始端口。浏览器模式 `pnpm dev` 同样会从 49373 开始自动寻找 UI 端口。Vite 端口不是 Desk API：Auto Code、Web 与 Tauri 都通过 `service.v1.json` 发现唯一 API。API 进程通过 `instance.v1.lock` 保证单实例，不能通过端口跃迁启动第二份。

### 从 VS Code / EXE 打开 CAA UI

运行中的 Desk Tools 接受本地 HTTP 请求，并在界面中切换到对应工作空间、打开 `.CATDlg` 编辑 Tab：

```bash
curl -X POST http://127.0.0.1:48375/api/caa/dialog/open \
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

正式依赖始终使用 `package.json` 锁定的 Wing Registry 0.4.3 包。Codegen Host/Apply、Workspace Schema、Ribbon、UUID/GUID 和 workspace path 契约直接消费包内 fixture；聚合根入口与 composable 子路径的 singleton 由自动测试保护。本地联调由启动进程临时 alias/resolver 完成，不执行 `link:` / `file:` 安装，也不修改清单、锁文件或 `node_modules`。

FCStd 文件发现、SQLite 查询、ZIP/Document.xml 读取与 BOM/XLink 写回均由 TypeScript 完成。Desk 不再构建或随 Tauri 打包 `fcstd-read`、`fcstd-xlink`、`fcstd-query` Rust sidecar；Tauri 自身只保留桌面窗口和 Node sidecar 生命周期所需的薄 Rust 壳。

## 架构

```
前端 Vue 3 → Vite :49373
     │
     ▼ proxy /api/*
Node.js Hono :48375（占用时向上寻找）
     ├── /api/cad/*  TypeScript（SQLite + ZIP/XML）
     ├── /api/caa/*  CAA 对话
     └── /api/*      待迁移（Python 可选）
```

Web 与 Tauri 的 API 发现、复用规则及多 UI 未决项见 [Desk API 单实例与多宿主发现](docs/platform/Desk-API单实例与多宿主发现.md)。

## 测试

```bash
pnpm test                       # Desk 应用层：类型、TS、CAA

# 分类运行
pnpm test:ts                    # TypeScript 测试（server/src/lib/）
pnpm test:caa                   # CAA 测试（catdlg-core + web-ui vitest）
```

真实 FCStd 的 TypeScript 读写回归可单独运行 `pnpm verify:real-fcstd`；Tauri runtime 构建由 `pnpm build:tauri-runtime` 完成。

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
| `server/` | Node.js/TypeScript 后端 |
| `web-ui/` | Vue 3 前端 |
| `phoenix/` | Python 包（逐步退役） |
| `scripts/` | 命令行工具 |
| `docs/` | 文档 |

## 文档

- [文档索引](docs/文档索引.md)：当前说明、草案和历史证据的唯一导航
- [总待办](docs/TODO.md)：唯一维护的产品/技术债入口
- [Tauri 当前状态](docs/tauri-当前迁移状态基线.md)与[构建验收](docs/tauri-构建启动与验收指南.md)
- [CAA 当前架构与契约](docs/caa/CAA当前架构与契约.md)
- [CAD 数据与 API 真源](docs/cad/CAD数据与API真源.md)

## 许可证

Copyright © 2024–2026 上海锟钛。项目使用 [Apache License 2.0](LICENSE) 开源。
