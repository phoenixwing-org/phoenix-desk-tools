"""Phoenix 工作空间数据库状态与重建（遗留库自动丢弃 + 可选删库重建 v10）。"""

from __future__ import annotations

from pathlib import Path

from phoenix.freecad.phoenix_schema import (
    LegacyPhoenixDatabaseError,
    database_status_payload,
    recreate_database,
)


def phoenix_database_status(repo_root: Path) -> dict:
    return database_status_payload(repo_root)


def phoenix_database_recreate(repo_root: Path) -> dict:
    return recreate_database(repo_root)


__all__ = [
    "LegacyPhoenixDatabaseError",
    "phoenix_database_recreate",
    "phoenix_database_status",
]
