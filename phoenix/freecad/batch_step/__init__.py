"""STEP 批量转 FCStd：纯算法与报告（不得在 FreeCAD 内运行才能 import 的包内逻辑）。"""

from __future__ import annotations

from phoenix.freecad.batch_step.job import StepBatchJob
from phoenix.freecad.batch_step.report import (
    parse_batch_step_report_summary,
    parse_batch_step_stderr_summary,
    render_batch_step_report_md,
    write_batch_step_report_md,
)
from phoenix.freecad.batch_step.step_naming import (
    body_label_from_file_stem_and_step,
    decode_step_x2_utf16_string,
    first_product_fields_from_step_file,
    internal_name_from_stem,
    part_number_version_from_stem,
)
from phoenix.freecad.batch_step.step_paths import iter_step_paths, sample_step_fcstd_dirs

__all__ = [
    "StepBatchJob",
    "body_label_from_file_stem_and_step",
    "decode_step_x2_utf16_string",
    "first_product_fields_from_step_file",
    "internal_name_from_stem",
    "iter_step_paths",
    "sample_step_fcstd_dirs",
    "part_number_version_from_stem",
    "write_batch_step_report_md",
]
