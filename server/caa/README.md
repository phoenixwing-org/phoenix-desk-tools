# CAA Node 服务

Hono API，默认 `http://127.0.0.1:5180`。

## 开发

```bash
# 仓库根目录
pnpm install
pnpm dev:caa
```

与 Phoenix 联调（API + 前端 + CAA）：

```bash
# 终端 1：Python API（热更新 :8765）
python -m phoenix.web --dev

# 终端 2：前端 + CAA Node（Vite :5173 + 本服务 :5180）
pnpm dev

# 也可只启动 CAA Node（无前端界面）：
pnpm dev:caa                  # 本服务 :5180
```

Web 打开 **Code → CAA 对话框**。

## API

- `GET /api/caa/health`
- `POST /api/caa/dialog/list` — body `{ "workspaceRoot": "…", "includeDemo": true }`
- `POST /api/caa/dialog/parse` — body `{ "demo": true }` 或 `{ "workspaceRoot", "catDlgRel", "catNlsRel?" }`
