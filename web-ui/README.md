# FreeCAD 管理工具（Web · 单端口 / 开发双进程）

## 两种启动方式

| 模式 | 命令 | 端口 | 适用 |
| --- | --- | --- | --- |
| **单服务（默认）** | `python -m fcdesk.web` | **5173**（API + `dist` 静态页） | 日常使用、验收 |
| **开发热更新** | `python -m fcdesk.web --dev` | **5173** Vite + **8765** API | 改 Vue/TS，无需 build |

## 首次

```bash
pip install -e ".[web]"
pnpm install    # 仓库根目录；依赖装在 web-ui
```

`pnpm dev` / `pnpm build` / `pnpm preview` 可在**仓库根目录**直接运行（转发至 `web-ui`）；在 `web-ui/` 下执行同样有效。

## 单服务启动（正式）

```bash
# 构建前端（若 dist 不存在会自动尝试 build）+ 启动
python -m fcdesk.web --build -w /path/to/CAD/workspace

# 已有 web-ui/dist 时
python -m fcdesk.web -w /path/to/CAD/workspace
```

改 Vue 源码后需重新构建：

```bash
pnpm build
# 重启 python -m fcdesk.web
```

## 开发模式（Vite 热更新）

**一条命令**（推荐）：

```bash
python -m fcdesk.web --dev -w /path/to/CAD/workspace
```

- 浏览器打开 **http://127.0.0.1:5173**（Vite）
- `/api` 自动代理到 **http://127.0.0.1:8765**
- 修改 `web-ui/src/**` 即时刷新，**不用** `pnpm build`

**或手动双终端**：

```bash
# 终端 1：仅 API
python -m fcdesk.web --api-only --port 8765 -w /path/to/CAD/workspace

# 终端 2：Vite（需与 API 端口一致）
FCDESK_API_PORT=8765 pnpm dev
```

换 API 端口：`python -m fcdesk.web --dev --api-port 9000`（Vite 仍读 `FCDESK_API_PORT`）。

## 浏览器

单服务 / `--dev` 默认在 **Cursor / VS Code 内置浏览器**打开，不是系统 Safari/Chrome。

- 依赖：终端里能调用 `cursor` 或 `code` CLI
- 不要自动打开：加 `--no-open`
- 要用系统浏览器：`--open-system`

`-w` 省略时使用 launcher 里**最近的工作空间**。

## 仅 API（调试）

```bash
python -m fcdesk.web --api-only --port 8765
```

## 备忘：5173 端口被占用

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
kill <PID>
```

开发模式下 5173 由 Vite 占用，8765 由 Python API 占用；单服务模式下 5173 由 Python 独占。

换单服务端口：`python -m fcdesk.web --port 8765`
