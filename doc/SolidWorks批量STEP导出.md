# SolidWorks → STEP（fcdesk）

**Windows**：**SolidWorks COM**（`pywin32`），对已打开或派生的 **SldWorks** 会话逐文件打开 **`.sldprt` / `.sldasm`**，另存为同名 **`.step`**（跳过 **`.slddrw`**）。可与 **STEP 批量** 转成 FCStd 衔接。

## 前置

1. 本机可启动 SolidWorks。  
2. 同一 Python 环境里安装 **pywin32**，或：`pip install -e ".[windows-solidworks]"`。  
3. 建议先在机器上手动开过一次 SolidWorks（`GetActiveObject` / `Dispatch` 行为依赖注册与许可）。

## 界面（fcdesk → SW→STEP）

选 **模型目录**、**STEP 输出目录**；可选 **递归**。**预览** 仅计数；**导出** 后台线程 COM。偏好写入工作空间 **`sw_step_export`**（`.phoenix-freecad-desktop.json`，见 **`workspace.dotfile.example`**）。

## 排障环境变量

| 变量 | 含义 | 默认 |
| --- | --- | --- |
| `FCDESK_SW_OPEN_OPTIONS` | `OpenDoc6` 的 Options | `1` |
| `FCDESK_SW_SAVEAS_SILENT_OPTS` | `SaveAs3`/`SaveAs2` 静默参数，`,` 隔开两整数 | `128,8` |

## 代码

`solidworks_models.py`：`iter_sw_model_paths` · `solidworks_com.py`：`attach_solidworks`、`batch_export_models_to_step`

## 非 Windows

界面与偏好可开发与预览；点击导出会提示须在 Windows 执行。
