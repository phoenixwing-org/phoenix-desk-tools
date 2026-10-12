"""Save-thumbnail preference for an already-running FreeCAD application.

The caller supplies its current ``App``: FreeCAD decides the parameter target,
including any isolated ``-u``/``-s`` profile. This module never opens a config
file, saves/closes documents, or claims a GUI thumbnail has been generated.
"""

from __future__ import annotations

_DOCUMENT_PARAMETERS = "User parameter:BaseApp/Preferences/Document"


def ensure_save_thumbnail(App) -> bool:
    """Enable, persist and recheck ``SaveThumbnail`` in the current App.

    Parameter/persistence exceptions propagate. An explicit failure return or
    a false readback refuses the operation; callers must not save a document
    after that failure. ``True`` certifies the preference, not PNG generation
    (a headless process has no GUI view from which to make a thumbnail).
    """
    App.ParamGet(_DOCUMENT_PARAMETERS).SetBool("SaveThumbnail", True)
    if App.saveParameter() is False:
        raise RuntimeError("FreeCAD SaveThumbnail 偏好持久化失败")
    if App.ParamGet(_DOCUMENT_PARAMETERS).GetBool("SaveThumbnail", False) is not True:
        raise RuntimeError("FreeCAD SaveThumbnail 持久化后未启用")
    return True
