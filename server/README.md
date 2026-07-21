# Desk Tools Node/Hono 服务

当前本地 API 真源首选监听 `http://127.0.0.1:48375`；端口占用时依次尝试后续 31 个端口。实际端口原子写入当前用户平台标准配置目录中的 `phoenix-wing/phoenix/services/desk-tools/service.v1.json`，供 Auto Code 等本机客户端发现。服务承载 shell、Code、CAD、CAA route；FreeCADCmd 和 SolidWorks COM 是受控外部引擎 adapter，不是第二个 HTTP 后端。FCStd ZIP/XML 与 SQLite 路径均由 TypeScript 服务处理。

## 开发

```bash
# 仓库根目录
pnpm install --frozen-lockfile
pnpm dev:server              # 仅 Node/Hono，首选 :48375
pnpm dev                     # Node/Hono 动态端口 + Vite :5173
```

Tauri 开发使用根目录 `pnpm tauri:dev`；Tauri 会准备自己的前端和 packaged runtime，不要同时运行 `pnpm dev`。

## 质量门禁

```bash
pnpm -C server typecheck
pnpm -C server test
pnpm build:tauri-runtime
```

最后一项生成 Node sidecar 与 Tauri runtime，并执行 bundle、packaged runtime health/shutdown smoke；不再构建或打包 CAD Rust 工具。

CAA 对外入口包含 `GET /api/caa/health`、对话框 list/parse/save 以及版本化 VS Code handoff；当前契约见 [`doc/caa/CAA当前架构与契约.md`](../doc/caa/CAA当前架构与契约.md)。
