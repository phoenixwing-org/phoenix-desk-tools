# phoenix-desk-tools

[Gitee](https://gitee.com/PhoenixWing321/phoenix-desk-tools.git) · MIT

围绕 FreeCAD 工作空间的 **Web 桌面辅助工具**：CAD 索引与检索、BOM、Code 工具等。功能在浏览器中使用；`python -m phoenix` 仅作轻量启动器（选工作空间、打开 Web）。

## 快速启动

完整安装（Python、Node.js、pnpm）见 [桌面工具-安装说明](doc/user/桌面工具-安装说明.md)。Windows 可一键：`scripts\setup_dev.bat`

```bash
pip install -e ".[web]"
pnpm install                   # 需 Node.js；--dev 必需

python -m phoenix.web --dev    # 开发：Vite 热更新 + API
python -m phoenix.web          # 日常：API + 前端，http://127.0.0.1:5173
python -m phoenix              # 启动器：配置工作空间后打开 Web
```

`-w /path/to/CAD/workspace` 指定工作空间；省略则读 launcher 最近记录（未配置时不会使用工具源码目录或当前终端 cwd）。

## 文档

| 用途 | 链接 |
| --- | --- |
| 安装 | [桌面工具-安装说明](doc/user/桌面工具-安装说明.md) |
| 使用 | [桌面工具-使用说明](doc/user/桌面工具-使用说明.md) · [Web 壳层说明](doc/user/Web壳层-使用说明.md) |
| 上手 | [新手指引](doc/user/新手指引.md) · [快速开始](doc/user/快速开始.md) |
| 前端开发 | [web-ui/README.md](web-ui/README.md) |
| 全量索引 | [doc/文档索引.md](doc/文档索引.md) |

## 仓库结构

| 路径 | 说明 |
| --- | --- |
| `phoenix/` | Python 包：Web API、服务、启动器 |
| `web-ui/` | Vue 前端 |
| `scripts/` | 命令行工具（XLink 修正、FCStd 索引、STEP→FCStd 等） |
| `doc/` | 用户与开发文档 · [待办](doc/TODO.md) |

## 参考

| 项 | 值 |
| --- | --- |
| 发行名 | `phoenix-desk-tools` |
| Python 包 | `phoenix` |
| 工作空间偏好 | `.phoenix/phoenix-workspace-prefs.json` |
