# phoenix-freecad-desktop

[Gitee](https://gitee.com/PhoenixWing321/phoenix-freecad-desktop) · MIT

**FreeCAD 辅助桌面壳**（CustomTkinter）与 **`scripts/`** 命令行：**XLink 修正**、**FCStd 索引**、**STEP→FCStd** 等工作流。

| 路径 | 内容 |
| --- | --- |
| `fcdesk/` | Python 包：壳、页面、示例配置 |
| `scripts/` | `fcstd_map.py`、`fix_fcstd_xlink_paths.py`、FreeCAD 批量 runner |
| `doc/` | [文档索引](doc/文档索引.md) |

**安装与用法**：[桌面工具-安装说明.md](doc/桌面工具-安装说明.md) · [桌面工具-使用说明.md](doc/桌面工具-使用说明.md)

## 快速启动

```bash
cd /path/to/phoenix-freecad-desktop
python3 -m venv .venv-desktop && source .venv-desktop/bin/activate
pip install -U pip && pip install -e .
python -m fcdesk              # 或 phoenix-fcdesktop
```

依赖见 `pyproject.toml`。Windows + SolidWorks 可选：`pip install -e ".[windows-solidworks]"`。`mainloop()` 会占用当前终端直至关窗口。

## 命名

- **发行名**（Gitee/PyPI）：`phoenix-freecad-desktop`
- **import 包名**：`fcdesk`
