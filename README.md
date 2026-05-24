# phoenix-freecad-desktop

[Gitee 仓库](https://gitee.com/PhoenixWing321/phoenix-freecad-desktop) · **MIT License**

本项目为开源的 **FreeCAD 辅助桌面壳**（CustomTkinter）及配套脚本，用于 FCStd **XLink 路径修正**、**文件名索引**等工作流；不绑定任何特定工程设计代号。

本地旧脚本与实验代码可放在已忽略的 `temp/` 目录，不参与发行与协作。

## 仓库布局

| 路径 | 说明 |
| --- | --- |
| `fcdesk/` | Python 包：界面壳、页面、配置 JSON |
| `scripts/` | 命令行：`fcstd_map.py`、`fix_fcstd_xlink_paths.py`；**FreeCADCmd** 用：`freecad_batch_step_runner.py`（见 doc/STEP批量转FCStd.md） |
| `doc/` | [文档索引](doc/文档索引.md) |

安装与使用：**[doc/桌面工具-安装说明.md](doc/桌面工具-安装说明.md)** · **[doc/桌面工具-使用说明.md](doc/桌面工具-使用说明.md)**

## 快速启动

```bash
cd /path/to/phoenix-freecad-desktop   # 默认工作空间为终端当前目录；请在「配置」中设项目根
python3 -m venv .venv-desktop
source .venv-desktop/bin/activate   # Windows: .venv-desktop\Scripts\activate
pip install -U pip
pip install -e .

python -m fcdesk
# 或使用同一安装带来的入口命令：
# phoenix-fcdesktop
```

**说明：** 依赖以 `pyproject.toml` 为准；仅在 Windows 且需要 SolidWorks/pywin32 集成时可：`pip install -e ".[windows-solidworks]"`。`mainloop()` 会一直占着终端直到关窗口；全屏时用 Mission Control / Cmd+Tab 找 Python 窗口。

## 发行名与包名的关系

- **仓库名**（Gitee）：`phoenix-freecad-desktop`。
- **`pyproject.toml` 里的 `name`**：`phoenix-freecad-desktop`，对应 `pip` 安装的发行名。
- **Python 包/import 名**：`fcdesk`（短小、`_` 合法；与 Gitee/PyPI 的 `phoenix-freecad-desktop` 区分）。
