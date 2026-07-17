# Desk Tools Node/Hono 服务

当前本地 API 真源，默认监听 `http://127.0.0.1:5180`。服务承载 shell、Code、CAD、CAA route；FreeCADCmd、SolidWorks COM 和 Wing Rust CLI 是受控外部引擎 adapter，不是第二个 HTTP 后端。

## 开发

```bash
# 仓库根目录
pnpm install --frozen-lockfile
pnpm dev:server              # 仅 Node/Hono :5180
pnpm dev                     # Node/Hono :5180 + Vite :5173
```

Tauri 开发使用根目录 `pnpm tauri:dev`；Tauri 会准备自己的前端和 packaged runtime，不要同时运行 `pnpm dev`。

## 质量门禁

```bash
pnpm -C server typecheck
pnpm -C server test
pnpm build:tauri-runtime
```

最后一项从 Registry `@phoenix-wing/cad-rust-source` 重建 native tools，生成 sidecar，并执行 bundle 与 packaged runtime health/shutdown smoke。

CAA 对外入口包含 `GET /api/caa/health`、对话框 list/parse/save 以及版本化 VS Code handoff；当前契约见 [`doc/caa/CAA当前架构与契约.md`](../doc/caa/CAA当前架构与契约.md)。
