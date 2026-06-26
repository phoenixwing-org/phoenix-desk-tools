# phoenix-desk-tools

[Gitee](https://gitee.com/PhoenixWing321/phoenix-desk-tools.git) · MIT

围绕 FreeCAD 工作空间的 **Web 桌面辅助工具**：CAD 索引与检索、BOM、Code 工具等。功能在浏览器中使用；`python -m phoenix` 仅作轻量启动器（选工作空间、打开 Web）。

## 快速启动

完整安装（Python、Node.js、pnpm）见 [桌面工具-安装说明](doc/user/桌面工具-安装说明.md)。Windows 可一键：`scripts\setup_dev.bat`

```bash
pip install -e ".[web]"
pnpm install                   # 需 Node.js

# Python API 后端
python -m phoenix.web --dev    # 开发：仅 API 热重载（端口 8765）
python -m phoenix.web          # 日常：API + 静态前端，http://127.0.0.1:5173

# 前端 + CAA Node（pnpm）
pnpm dev          # 全栈：Vite (:5173) + CAA Node (:5180)
pnpm dev:ui       # 仅 Vite 前端 (:5173)
pnpm dev:caa      # 仅 CAA Node 后端 (:5180)

python -m phoenix              # 启动器：配置工作空间后打开 Web
```

`-w /path/to/CAD/workspace` 指定工作空间；省略则读 launcher 最近记录（未配置时不会使用工具源码目录或当前终端 cwd）。

### 启动器点检

| 项 | 预期 | 失败处理 |
|------|------|---------|
| `python -m phoenix` 启动 | 窗口自适应大小，无报错 | 检查 customtkinter 安装 |
| 三服务状态指示 | ● 绿色 / ○ 灰色 正确 | HTTP 超时检查网络 |
| `▶ 全部启动` | 弹出 Terminal 3 Tab | 确认 wt.exe 可用 |
| `■ 终止`（单个） | 弹进程 PID → 确认 → 强杀 | `/T` 杀进程树 |
| `■ 全部关闭` | 列出全部 PID → 确认 → 全部强杀 | 逐端口检查 |
| `🌐 打开浏览器` | 打开 localhost:5173 | 确认 Vite 运行中 |
| 拖拽窗口不卡 | 即时响应 | 健康检查在后台线程 |
| Vite 检测 `[::1]` | 识别为运行中 | `netstat -ano` 无 -p tcp |
| CAA 索引 panel 双视图 | 📋/🌳 切换，默认列表 | Pinia 缓存 |
| CAA 索引列表模式 | 序号 + 图标 + 去 .CATDlg | 检查 flatRows computed |
| CAA 关联文件图标 | CATDlg→Grid, CATNls→ChatLineSquare, CATRsc→Picture, .h/.cpp→Document | 检查 fileIcon() |
| 索引面板按钮 | hover 高亮 + title tooltip + 紧凑间距 | 刷新页面验证 |
| 控件树 SVG 图标 | 31 控件类型各有图标 | `assets/icons/widget/phoenix-widget-*.svg` |
| 图标命名规则 | `phoenix-widget-{lower-kebab}.svg` 14×14 currentColor | 按 catalog icon 字段匹配 |
| 工具箱折叠/布局 | ↕垂直水平 ☰grid/ribbon 📌折叠悬浮 | Pinia 跨页面保持 |
| 工具箱按钮 | SVG图标+文字，ribbon 大图标+组间竖线 | 刷新验证 |
| 编辑/拖拽模式 | 默认编辑 ✎，切 ⇅ 拖拽/插入，工具箱+拖放+指示器 | 新对话框默认编辑 |

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
