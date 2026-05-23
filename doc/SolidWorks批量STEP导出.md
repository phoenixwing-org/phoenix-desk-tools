# SolidWorks 批量导出 STEP（fcdesk）

在 **Windows** 上利用 **SolidWorks COM**（`pywin32`）连接**已打开的** SolidWorks，对指定目录中的 **`.sldprt` / `.sldasm`** 逐个打开并另存为与模型同名的 **`.step`**（不含 **`.slddrw`** 图纸）。导出的 STEP 可再接本工具的 **STEP 批量** 页转成 FCStd。

## 前置条件

1. **已安装并可启动 SolidWorks**（本流程不替你安装）。
2. 运行 fcdesk 所用的 **Python 与 pip 环境里安装 pywin32**：

   ```text
   pip install pywin32
   ```

   可选：从项目根目录用 extras 声明依赖：

   ```text
   pip install -e ".[windows-solidworks]"
   ```

3. 建议 **先手动打开 SolidWorks 一次**。工具会优先 `GetActiveObject("SldWorks.Application")`；若尚未有实例则可能 `Dispatch`，行为取决于当前机器上的 COM 注册与许可。

## 界面用法（fcdesk）

1. 打开应用，左侧进入 **SW→STEP**。
2. 选择 **SolidWorks 模型目录**（含 `.sldprt` / `.sldasm`）。
3. 选择 **STEP 输出目录**（将写入 `模型名.step`）。
4. 按需勾选 **递归扫描子目录**。
5. 点击 **预览** 可只看数量；点击 **导出** 在后台线程里跑 COM。

工作区偏好会写入 **`sw_step_export`**（见仓库内 `workspace.custom.json.example`）。

## 环境变量（排障）

| 变量 | 含义 | 默认 |
|------|------|------|
| `FCDESK_SW_OPEN_OPTIONS` | 传给 `OpenDoc6` 的 `Options` 整型 | `1` |
| `FCDESK_SW_SAVEAS_SILENT_OPTS` | `SaveAs3` / `SaveAs2` 的版本与静默参数，逗号分隔两个整数，如 `128,8` | `128,8` |

若出现 **Silent / 版本号** 相关报错，请在本机用 SolidWorks **宏录制**一次「另存为 STEP」，对照 API 帮助或社区帖调整上述两个值（不同 SW 主版本可能不同）。

## 代码入口

- 扫描列表：`fcdesk/integration/solidworks_models.py`（`iter_sw_model_paths`）
- COM 逻辑：`fcdesk/integration/solidworks_com.py`（`attach_solidworks`、`batch_export_models_to_step`）

## 非 Windows（开发与布局）

fcdesk **不会调用** SolidWorks COM，但 **SW→STEP 页会与 Windows 上显示同款完整界面**（目录、勾选、预览、偏好保存、日志区），便于在 **macOS/Linux** 上开发时调布局、`workspace.custom.json` 写好路径再在 Windows 实测导出。点「批量导出 STEP」时只会提示须在 Windows 上执行。
