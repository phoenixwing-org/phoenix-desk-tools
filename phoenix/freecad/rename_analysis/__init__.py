"""改名分析模块 — 评估改名对 XLink 引用的影响，并支持按宿主写回修正。

与 ``xlink_fix``（路径失效重定向）互补：本模块在 **已知旧 basename → 新 basename**
时，只替换 ``Document.xml`` 内 ``<XLink file="…">`` 的末尾文件名段。

公开 API
--------
- ``analyze_workspace_xlink_refs`` — 工作空间扫描（分析）
- ``apply_host_xlink_corrections`` — 单宿主写回（修正）
- ``replace_basename_in_xlink_attr`` — 纯函数，可单测
"""

from phoenix.freecad.rename_analysis.report import write_rename_analysis_report
from phoenix.freecad.rename_analysis.types import (
    HostRefGroup,
    RenameAnalysisError,
    XLinkBasenameHit,
)
from phoenix.freecad.rename_analysis.xlink import (
    analyze_workspace_xlink_refs,
    apply_host_reference_label_corrections,
    apply_host_xlink_corrections,
    patch_fcstd_xlink_attrs,
    replace_basename_in_xlink_attr,
    scan_document_xml_xlink_hits,
    scan_fcstd_host_hits,
)

# 兼容旧名
RenameRefFixError = RenameAnalysisError
scan_workspace_xlink_basename_refs = analyze_workspace_xlink_refs
apply_host_ref_patches = apply_host_xlink_corrections

__all__ = [
    "HostRefGroup",
    "RenameAnalysisError",
    "RenameRefFixError",
    "XLinkBasenameHit",
    "analyze_workspace_xlink_refs",
    "apply_host_ref_patches",
    "apply_host_reference_label_corrections",
    "apply_host_xlink_corrections",
    "patch_fcstd_xlink_attrs",
    "replace_basename_in_xlink_attr",
    "scan_document_xml_xlink_hits",
    "scan_fcstd_host_hits",
    "scan_workspace_xlink_basename_refs",
    "write_rename_analysis_report",
]
