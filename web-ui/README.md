# Phoenix 桌面辅助工具（Web · 单端口 / 开发双进程）

## 两种启动方式

| 模式 | 命令 | 端口 | 适用 |
| --- | --- | --- | --- |
| **单服务（默认）** | `python -m phoenix.web` | **5173**（API + `dist` 静态页） | 日常使用、验收 |
| **开发热更新** | `python -m phoenix.web --dev` | **5173** Vite + **8765** API | 改 Vue/TS，无需 build |

## 首次

```bash
pip install -e ".[web]"
pnpm install    # 仓库根目录；依赖装在 web-ui
```

`pnpm dev` / `pnpm build` / `pnpm preview` 可在**仓库根目录**直接运行（转发至 `web-ui`）；在 `web-ui/` 下执行同样有效。

## 单服务启动（正式）

```bash
# 构建前端（若 dist 不存在会自动尝试 build）+ 启动
python -m phoenix.web --build -w /path/to/CAD/workspace

# 已有 web-ui/dist 时
python -m phoenix.web -w /path/to/CAD/workspace
```

改 Vue 源码后需重新构建：

```bash
pnpm build
# 重启 python -m phoenix.web
```

## 开发模式（Vite 热更新）

**一条命令**（推荐）：

```bash
python -m phoenix.web --dev -w /path/to/CAD/workspace
```

- 浏览器打开 **http://127.0.0.1:5173**（Vite）
- `/api` 自动代理到 **http://127.0.0.1:8765**
- 修改 `web-ui/src/**` 即时刷新，**不用** `pnpm build`

**或手动双终端**：

```bash
# 终端 1：仅 API
python -m phoenix.web --api-only --port 8765 -w /path/to/CAD/workspace

# 终端 2：Vite（需与 API 端口一致）
PHOENIX_API_PORT=8765 pnpm dev
```

换 API 端口：`python -m phoenix.web --dev --api-port 9000`（Vite 读 `PHOENIX_API_PORT` 或 `PHOENIX_API_PORT`）。

## 浏览器

单服务 / `--dev` 默认在 **Cursor / VS Code 内置浏览器**打开，不是系统 Safari/Chrome。

- 依赖：终端里能调用 `cursor` 或 `code` CLI
- 不要自动打开：加 `--no-open`
- 要用系统浏览器：`--open-system`

`-w` 省略时使用 launcher 里**最近的工作空间**。

## 仅 API（调试）

```bash
python -m phoenix.web --api-only --port 8765
```

## 备忘：5173 端口被占用

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
kill <PID>
```

开发模式下 5173 由 Vite 占用，8765 由 Python API 占用；单服务模式下 5173 由 Python 独占。

换单服务端口：`python -m phoenix.web --port 8765`

## 新手指引

首次打开 Web 壳建议：

1. 阅读仓库 [doc/user/新手指引.md](../doc/user/新手指引.md) 或 [doc/user/快速开始.md](../doc/user/快速开始.md)。
2. 在浏览器 **主页 → 新手指南** 按四步完成配置（工作空间 → 推荐 FreeCAD → CAD 索引 → 打开文件详情）。
3. 可选 **界面巡游**（driver.js，熟悉导航 / Tab / 工作区树 / 日志）。

状态 API：`GET /api/onboarding/status`。实现说明：[doc/user/新手指引-实现备忘.md](../doc/user/新手指引-实现备忘.md)。

## 前端栈（2026-06 起）

| 项 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript + Vite |
| UI 库 | **Element Plus**（`unplugin-vue-components` 按需） |
| 状态 | Pinia |
| 与后端 | 仅 `/api/*`；开发时 Vite 代理到 8765 |

壳层采用 **Ribbon 工具台**（Chili3D 式 Tab + 分组工具按钮）。启动默认 **欢迎页**（最近工程、Gitee 链接）；**主页**保留新手指南与功能模块入口。

规划见 [doc/platform/Web壳层-Ribbon改型-规划.md](../doc/platform/Web壳层-Ribbon改型-规划.md)。

改壳层相关 Vue 后：`python -m phoenix.web --dev` 下保存即热更新；若白屏查浏览器 Console，必要时 `Cmd+Shift+R` 硬刷新。
