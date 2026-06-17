"""批量任务描述：可被 UI 与 FreeCADCmd _runner 共用。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class StepBatchJob:
    """单次 STEP→FCStd 批量任务参数。"""

    step_dir: Path
    out_dir: Path
    skip_existing: bool = False
    view_fit_last: bool = False
    view_fit_all: bool = False
    report_filename: str = "batch_step_convert_report.md"
    project_tag: str = ""
    step_recursive: bool = False

    def subprocess_env(self) -> dict[str, str]:
        """传给 FreeCADCmd 子进程的环境变量（覆盖项，与系统环境 merge 使用）。"""
        if self.view_fit_all:
            v_last, v_all = "0", "1"
        elif self.view_fit_last:
            v_last, v_all = "1", "0"
        else:
            v_last, v_all = "0", "0"
        return {
            "FCD_BATCH_STEP_DIR": str(self.step_dir.resolve()),
            "FCD_BATCH_OUT_DIR": str(self.out_dir.resolve()),
            "FCD_BATCH_SKIP_EXISTING": "1" if self.skip_existing else "0",
            "FCD_BATCH_VIEW_FIT_LAST": v_last,
            "FCD_BATCH_VIEW_FIT_ALL": v_all,
            "FCD_BATCH_REPORT_NAME": self.report_filename,
            "FCD_BATCH_PROJECT_TAG": self.project_tag,
            "FCD_BATCH_STEP_RECURSIVE": "1" if self.step_recursive else "0",
        }
