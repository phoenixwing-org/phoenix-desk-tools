# phoenix-desk-tools

[Gitee](https://gitee.com/PhoenixWing321/phoenix-desk-tools.git) · MIT

**Phoenix 桌面工具集**（Web 为主）：FreeCAD 工作空间管理、BOM、Code 工具等；**`scripts/`** 命令行含 **XLink 修正**、**FCStd 索引**、**STEP→FCStd** 等工作流。桌面 `python -m phoenix` 仅为**启动器**（配置工作空间 + 打开浏览器）。

| 路径 | 内容 |
| --- | --- |
| `phoenix/` | Python 包：Web API、服务、启动器 |
| `scripts/` | `fcstd_map.py`、`fix_fcstd_xlink_paths.py`、FreeCAD 批量 runner |
| `doc/` | [文档索引](doc/文档索引.md) · [总待办](doc/TODO.md) |

**安装与用法**：[桌面工具-安装说明.md](doc/桌面工具-安装说明.md) · [桌面工具-使用说明.md](doc/桌面工具-使用说明.md) · Web 见下文与 [web-ui/README.md](web-ui/README.md)

## 快速启动（桌面启动器）

```bash
cd /path/to/phoenix-desk-tools
python3 -m venv .venv-desktop && source .venv-desktop/bin/activate
pip install -U pip && pip install -e ".[web]"
python -m phoenix              # 配置工作空间，点「打开 Web 版」
```

启动器窗口不再包含各功能页；**全部功能在 Web 版**。也可直接使用下一节的 `python -m phoenix.web`。

## 快速启动（Web）

**日常用法**：用 **`python -m phoenix.web`**。一个 Python 进程同时提供 **API + 已构建的前端**（默认 http://127.0.0.1:5173），与桌面壳共用同一套 `phoenix/` 后端逻辑。

```bash
pip install -e ".[web]"
pnpm install

# 首次或改过 Vue 源码后：构建前端并启动
python -m phoenix.web --build -w /path/to/CAD/workspace

# 已有 web-ui/dist 时
python -m phoenix.web -w /path/to/CAD/workspace
```

前端构建也可在仓库根目录执行 `pnpm build`（无需 `cd web-ui`）。

`-w` 可省略，会使用启动器里「最近的工作空间」（`…/phoenix-wing/phoenix/launcher.json`）。更多选项（自动打开浏览器、换端口等）见 [web-ui/README.md](web-ui/README.md)。

### 三种启动方式

| 方式 | 命令 | 说明 |
| --- | --- | --- |
| **`python -m phoenix.web`** | 单端口 **5173** | **正式运行**：API + `web-ui/dist`；改 Vue 后需 `pnpm build` |
| **`python -m phoenix.web --dev`** | Vite **5173** + API **8765** | **前端开发**：热更新，无需 build；一条命令起双进程 |
| **`pnpm dev`** | 仅 Vite **5173** | 须另开 API；或直接用 `--dev`。根目录 `pnpm dev` 即可 |

结论：**平时用 `python -m phoenix.web`**；**改界面用 `python -m phoenix.web --dev`**。详见 [web-ui/README.md](web-ui/README.md)。

**首次使用 Web**： [doc/新手指引.md](doc/新手指引.md) · [doc/快速开始.md](doc/快速开始.md)

## 待办与规划

维护与开发跟踪见 **[doc/TODO.md](doc/TODO.md)**（P0–P3 总待办）。细项讨论稿：

| 文档 | 说明 |
| --- | --- |
| [TODO.md](doc/TODO.md) | 跨模块总待办（性能、Web 壳层、平台化） |
| [Web与桌面迁移-待办.md](doc/Web与桌面迁移-待办.md) | 页面对照、桌面 Tk → Web 迁移点检 |
| [文件变更历史与引用证据-待办讨论.md](doc/文件变更历史与引用证据-待办讨论.md) | 改名历史入库、引用证据、与 XLink 修正统一 |
| [SQL查询与递归点检-todo.md](doc/SQL查询与递归点检-todo.md) | SQL 日志格式、递归查询点检清单 |
| [Phoenix平台-多应用壳层-规划讨论.md](doc/Phoenix平台-多应用壳层-规划讨论.md) | 多模块壳层（CAD / Code 等）、插件分包与拆仓 |

更多功能说明与架构文档见 [doc/文档索引.md](doc/文档索引.md)。

## 命名

| 项 | 名称 |
| --- | --- |
| Gitee / 发行名 | `phoenix-desk-tools`（旧名 `phoenix-freecad-desktop`） |
| Python import 包名 | `phoenix` |
| 桌面 CLI | `phoenix-desktop` |
| Web CLI | `phoenix-web` |
| 本机 launcher | `…/phoenix-wing/phoenix/launcher.json` |
| 工作空间偏好 | `.phoenix/phoenix-workspace-prefs.json` |
