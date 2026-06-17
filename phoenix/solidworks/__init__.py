"""SolidWorks COM 与模型路径遍历。"""

from phoenix.solidworks.com import attach_solidworks, batch_export_models_to_step, windows_only
from phoenix.solidworks.models import iter_sw_model_paths, sw_doc_type_suffix

__all__ = [
    "attach_solidworks",
    "batch_export_models_to_step",
    "windows_only",
    "iter_sw_model_paths",
    "sw_doc_type_suffix",
]
