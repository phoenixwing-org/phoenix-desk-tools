"""加载 app_config.json。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_DEFAULT_CONFIG = Path(__file__).resolve().parent / "app_config.json"

DEFAULT_APP_TITLE = "Phoenix 桌面工具"


def load_app_config(path: Path | str | None = None) -> dict[str, Any]:
    config_path = Path(path) if path else _DEFAULT_CONFIG
    with config_path.open(encoding="utf-8") as f:
        return json.load(f)
