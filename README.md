# phoenix-freecad-desktop

[Gitee](https://gitee.com/PhoenixWing321/phoenix-freecad-desktop) · MIT

**FreeCAD 管理工具**（Web 为主）与 **`scripts/`** 命令行：**XLink 修正**、**FCStd 索引**、**STEP→FCStd** 等工作流。桌面 `python -m fcdesk` 仅为**启动器**（配置工作空间 + 打开浏览器）。

| 路径 | 内容 |
| --- | --- |
| `fcdesk/` | Python 包：Web API、服务、启动器 |
| `scripts/` | `fcstd_map.py`、`fix_fcstd_xlink_paths.py`、FreeCAD 批量 runner |
| `doc/` | [文档索引](doc/文档索引.md) |

**安装与用法**：[桌面工具-安装说明.md](doc/桌面工具-安装说明.md) · [桌面工具-使用说明.md](doc/桌面工具-使用说明.md) · Web 见下文与 [web-ui/README.md](web-ui/README.md)

## 快速启动（桌面启动器）

```bash
cd /path/to/phoenix-freecad-desktop
python3 -m venv .venv-desktop && source .venv-desktop/bin/activate
pip install -U pip && pip install -e ".[web]"
python -m fcdesk              # 配置工作空间，点「打开 Web 版」
```

启动器窗口不再包含各功能页；**全部功能在 Web 版**。也可直接使用下一节的 `python -m fcdesk.web`。

## 快速启动（Web）

**日常用法**：用 **`python -m fcdesk.web`**。一个 Python 进程同时提供 **API + 已构建的前端**（默认 http://127.0.0.1:5173），与桌面壳共用同一套 `fcdesk/` 后端逻辑。

```bash
pip install -e ".[web]"
cd web-ui && pnpm install && cd ..

# 首次或改过 Vue 源码后：构建前端并启动
python -m fcdesk.web --build -w /path/to/CAD/workspace

# 已有 web-ui/dist 时
python -m fcdesk.web -w /path/to/CAD/workspace
```

`-w` 可省略，会使用启动器里「最近的工作空间」（`…/phoenix-wing/fcdesk/launcher.json`）。更多选项（自动打开浏览器、换端口等）见 [web-ui/README.md](web-ui/README.md)。

### `python -m fcdesk.web` 和 `pnpm dev` 有什么区别？

| 方式 | 用途 | 说明 |
| --- | --- | --- |
| **`python -m fcdesk.web`** | **正式运行 Web 版** | 单端口；静态页来自 `web-ui/dist`；改 Vue 后需 `pnpm build` 再重启（或 `--build`） |
| **`pnpm dev`**（在 `web-ui/` 下） | **仅前端开发预览** | Vite 热更新，改 `.vue` / `.ts` 即时刷新；**不能代替** Python 服务，API 仍要另开 `python -m fcdesk.web --api-only` |
| **`pnpm preview`** | 预览构建结果 | 只托管 `dist`，无 API，一般不用 |

结论：**平时用 Web 界面请用 `python -m fcdesk.web`**。`pnpm dev` 是给改前端界面的人用的在线编辑预览，且需双进程（前端 + API），当前仓库**不推荐**作为默认启动方式；详见 [web-ui/README.md](web-ui/README.md) 的「开发前端」一节。

## 命名

- **发行名**（Gitee/PyPI）：`phoenix-freecad-desktop`
- **import 包名**：`fcdesk`
