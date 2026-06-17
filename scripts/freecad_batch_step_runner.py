#!/usr/bin/env python3
"""
由 **FreeCADCmd** 执行的入口脚本（不要用系统 python 直接运行）。

桌面「STEP 批量」页会通过子进程传入环境变量 ``FCD_BATCH_*``。

本脚本把仓库根与 ``scripts`` 加入 ``sys.path``，再载入同目录下的
``freecad_batch_step_fc``（其中再导入 ``phoenix.batch_step``）。

**注意：** 由 ``freecadcmd`` 加载本文件时，``__name__`` 往往不是 ``"__main__"``，
因此脚本在**载入末尾无条件调用** ``main()``，避免整批静默不运行。
"""

from __future__ import annotations

import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPTS_DIR.parent
for _p in (_REPO_ROOT, _SCRIPTS_DIR):
    _s = str(_p)
    if _s not in sys.path:
        sys.path.insert(0, _s)


def _runner_stderr(msg: str) -> None:
    try:
        sys.stderr.buffer.write(msg.encode("utf-8"))
    except (AttributeError, TypeError):
        try:
            sys.stderr.write(msg)
        except:
            pass
    sys.stderr.flush()


def main() -> None:
    """由 FreeCAD 解释器加载；若没有环境变量，尽快写 stderr（命令行可见）。"""
    import os

    sd = os.environ.get("FCD_BATCH_STEP_DIR", "").strip()
    od = os.environ.get("FCD_BATCH_OUT_DIR", "").strip()
    _runner_stderr(
        f"[phoenix:runner] batch 脚本已载入 __name__={__name__!r}\n"
        f"[phoenix:runner] FCD_BATCH_STEP_DIR={sd!r}\n[phoenix:runner] FCD_BATCH_OUT_DIR={od!r}\n",
    )

    if not sd or not od:
        msg = (
            "phoenix STEP 批量：本进程里没有 FCD_BATCH_STEP_DIR / FCD_BATCH_OUT_DIR。\n"
            "在终端须先 export，或与 freecadcmd 同一行前缀变量，例如：\n\n"
            "  export FCD_BATCH_STEP_DIR=/path/step\n"
            "  export FCD_BATCH_OUT_DIR=/path/out\n"
            "  export FCD_BATCH_SKIP_EXISTING=0\n"
            "  /Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd \\\n"
            "      /path/to/phoenix-freecad-desktop/scripts/freecad_batch_step_runner.py\n\n"
            "phoenix 界面「运行 STEP 批量」会自动注入上述环境变量。\n"
        )
        _runner_stderr(msg)
        raise SystemExit(2)

    import freecad_batch_step_fc  # noqa: E402

    freecad_batch_step_fc.run_step_batch_from_environ()


# FreeCADCmd 常把脚本当模块载入，此时 __name__ 不是 "__main__"；只靠
# ``if __name__ == "__main__"`` 会导致 main() 从不执行 → 无任何输出。
main()
