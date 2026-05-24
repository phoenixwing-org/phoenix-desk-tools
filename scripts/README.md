命令行脚本（可被桌面壳的子进程调用，也可单独运行）：

- **`fcstd_map.py`**：扫描生成映射。默认 **`--json`** 写出 **schema≥2** 结构化文档（`entries[]`：`repo_rel_path`、`filename`、**`PartNumber`、`PartVersion`、`TypeCode`、`ModelSeries`、`label`、`extra`**）；**`--legacy-json`** 仍可写旧扁平字典。推断见 **`fcdesk/fcstd_mapping.py`**。
- **`fix_fcstd_xlink_paths.py`**：按 **`--map-json`**（默认可省略，则使用 `<map-anchor>/fcstd_map.json`）解析映射重写 XLink；**`--map-anchor`** 须与 **`fcstd_map --relative-to` / JSON 所在目录**一致。桌面壳下即 **工作空间根**。旧名 `fc_linkfix_fcstd_map.json` 已由单一 `fcstd_map.json` 取代。未提供映射时可 **`--live-scan`**。
- **`setup_desktop_venv.sh`**（macOS）：一键创建 `.venv-desktop` 并以可编辑方式安装本项目（读取 `pyproject.toml` 依赖）。

**FreeCADCmd（须在 FreeCAD 安装内执行，不要用系统 Python 跑）：**

- **`freecad_batch_step_runner.py`**：读环境变量 `FCD_BATCH_*`，批量 STEP→FCStd；桌面「STEP 批量」页会调用它。实现细节见 `doc/STEP批量转FCStd.md`。
- **`freecad_batch_step_fc.py`**：供 runner / 收件箱监听导入，依赖 FreeCAD 解释器。
- **`freecad_fcdesk_inbox_listener.py`**：在 **FreeCAD 已打开的 GUI** 内执行一遍，fcdesk「STEP 批量」可勾选 **收件箱桥接** 投递任务（见 `doc/FreeCAD-fcdesk桥接.md`）。

手写验收（**须 `export` 环境变量**，见 `example_run_step_batch.sh` 与 `doc/STEP批量转FCStd.md`）。

在仓库根执行示例：

```bash
python -m unittest discover -s tests -v
python scripts/fcstd_map.py --root /path/to/workspace/cad \\
  --relative-to /path/to/workspace \\
  --json /path/to/workspace/fcstd_map.json
python scripts/fix_fcstd_xlink_paths.py --map-anchor /path/to/workspace --map-json /path/to/workspace/fcstd_map.json \\
  --dry-run --all-in-dir /path/to/your/FreeCAD
python scripts/fix_fcstd_xlink_paths.py --dry-run --live-scan --search-root /path/to/cad --all-in-dir /path/to/your/FreeCAD
```
