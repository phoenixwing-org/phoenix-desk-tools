"""phoenix ↔ 外部 CAD 进程的轻量集成（兼容 re-export）。

新代码请使用 ``phoenix.freecad`` / ``phoenix.solidworks``。
"""

from phoenix.freecad.inbox_bridge import enqueue_step_batch, peek_response, response_path, take_response
from phoenix.solidworks.com import attach_solidworks, batch_export_models_to_step, windows_only
from phoenix.solidworks.models import iter_sw_model_paths, sw_doc_type_suffix

__all__ = [
    "enqueue_step_batch",
    "peek_response",
    "response_path",
    "take_response",
    "attach_solidworks",
    "batch_export_models_to_step",
    "windows_only",
    "iter_sw_model_paths",
    "sw_doc_type_suffix",
]
