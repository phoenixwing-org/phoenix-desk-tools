# server/scripts/ — 保留 Python 程序

这里放置暂不迁移的 Python 模块，通过 `pnwPythonSidecar` 调用。

## 调用方式

```typescript
import { runPython } from "../lib/pnwPythonSidecar";
const result = await runPython("step_batch.py", ["--input", "..."]);
```

Python 路径由 `PHOENIX_PYTHON_PATH` 环境变量指定，或自动检测。

## 脚本清单

| 脚本 | Python 源 | 功能 | 依赖 |
|------|----------|------|------|
| `step_batch.py` | `phoenix/services/step_batch_service.py` | STEP→FCStd 批量转换 | freecadcmd |
| `freecad_dimensions.py` | 新建 | FCStd 几何包围盒提取 | freecadcmd |
| `sw_step_export.py` | `phoenix/services/sw_step_export_service.py` | SolidWorks→STEP | Windows + COM |

## 迁移计划

- `step_batch.py` — 长期保留（freecadcmd 无替代）
- `freecad_dimensions.py` — 长期保留（OpenCASCADE 无 Rust/JS 替代）
- `sw_step_export.py` — Windows only，可选拆除
