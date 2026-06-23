# CAA Node 服务

Hono API，默认 `http://127.0.0.1:5180`。

## 开发

```bash
# 仓库根目录
pnpm install
pnpm dev:caa
```

与 Phoenix 联调：

```bash
python -m phoenix.web --dev   # Vite :5173 + Python :8765
pnpm dev:caa                  # 本服务 :5180
```

Web 打开 **Code → CAA 对话框**。

## API

- `GET /api/caa/health`
- `POST /api/caa/dialog/list` — body `{ "workspaceRoot": "…", "includeDemo": true }`
- `POST /api/caa/dialog/parse` — body `{ "demo": true }` 或 `{ "workspaceRoot", "catDlgRel", "catNlsRel?" }`
