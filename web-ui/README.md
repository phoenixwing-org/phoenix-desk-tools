# Web 样例（单端口）

**一个进程、一个端口**：Python 同时提供 API 与已构建的 Vue 前端（默认 **5173**）。无需再开 Vite 开发服。

## 首次

```bash
pip install -e ".[web]"
cd web-ui && pnpm install && cd ..
```

## 启动

```bash
# 构建前端（若 dist 不存在会自动尝试 build）+ 启动
python -m fcdesk.web --build -w /path/to/CAD/workspace

# 已有 web-ui/dist 时
python -m fcdesk.web -w /path/to/CAD/workspace
```

启动后会**自动在 Cursor / VS Code 内置浏览器**中打开（默认 http://127.0.0.1:5173），不是系统 Safari/Chrome。

- 依赖：终端里能调用 `cursor` 或 `code` CLI（Cursor 菜单：**Shell Command: Install 'cursor' command in PATH'**）
- 工作区已设 `workbench.browser.openLocalhostLinks: true`（`.vscode/settings.json`），CLI 失败时可 **Cmd+单击** 终端里的链接
- 不要自动打开：加 `--no-open`
- 要用系统浏览器：`--open-system`

`-w` 省略时使用 launcher 配置里**最近的工作空间**（`web-ui/.local/launcher.json`）。

## 仅 API（调试）

```bash
python -m fcdesk.web --api-only --port 5173
```

## 开发前端

改 Vue 源码后需重新构建：

```bash
cd web-ui && pnpm build
# 重启 python -m fcdesk.web
```

（不再推荐 `pnpm dev` + 8765 双进程；`vite.config.ts` 里的 proxy 仅作遗留。）

## 备忘：5173 端口被占用

默认端口 **5173** 由 `python -m fcdesk.web`（uvicorn）占用。若再次启动报端口冲突，说明上次进程还在：

```bash
# 查看占用 5173 的进程（通常是 Python）
lsof -nP -iTCP:5173 -sTCP:LISTEN

# 结束进程（将 <PID> 换成上一行输出的 PID）
kill <PID>
```

或在正在跑 `python -m fcdesk.web` 的终端里按 **Ctrl+C** 正常退出。

换端口启动：`python -m fcdesk.web --port 8765`

