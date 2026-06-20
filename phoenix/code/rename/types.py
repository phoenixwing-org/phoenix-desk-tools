"""批量改名与 UUID 扫描的共享类型。"""

from __future__ import annotations

from typing import Any, Literal

RenameLevel = Literal["dir", "file", "text"]
UuidApplyStrategy = Literal["map_per_value", "fresh_per_hit"]

RENAME_LEVELS: tuple[RenameLevel, ...] = ("dir", "file", "text")
DEFAULT_RENAME_LEVELS: tuple[RenameLevel, ...] = ("text",)
LEVEL_ORDER: tuple[RenameLevel, ...] = ("dir", "file", "text")
DEFAULT_TARGET_ENCODING = "utf-8"
TARGET_ENCODINGS: tuple[str, ...] = ("utf-8", "gbk")

NOT_IMPLEMENTED_MESSAGE = "引擎尚未接入，当前仅提供界面与 API 契约；实现方式（自研 / 旧 CLI）待定。"


class RenameScanOptions:
    __slots__ = ("old", "new", "levels", "scope", "include_ignored", "indexed_paths")

    def __init__(
        self,
        old: str,
        new: str,
        levels: list[RenameLevel],
        scope: str = "",
        include_ignored: bool = False,
        indexed_paths: frozenset[str] | None = None,
    ) -> None:
        self.old = old
        self.new = new
        self.levels = levels
        self.scope = scope
        self.include_ignored = include_ignored
        self.indexed_paths = indexed_paths


def empty_rename_summary() -> dict[str, int]:
    return {
        "dirs": 0,
        "files": 0,
        "text_files": 0,
        "total_hits": 0,
        "skipped": 0,
    }


def empty_uuid_summary() -> dict[str, int]:
    return {
        "files_scanned": 0,
        "total_hits": 0,
        "unique_uuids": 0,
    }


def not_implemented_rename_payload(*, dry_run: bool) -> dict[str, Any]:
    return {
        "ok": False,
        "implemented": False,
        "dry_run": dry_run,
        "message": NOT_IMPLEMENTED_MESSAGE,
        "hits": [],
        "summary": empty_rename_summary(),
        "log": NOT_IMPLEMENTED_MESSAGE,
        "lines": [NOT_IMPLEMENTED_MESSAGE],
    }


def not_implemented_uuid_scan_payload() -> dict[str, Any]:
    return {
        "ok": False,
        "implemented": False,
        "message": NOT_IMPLEMENTED_MESSAGE,
        "scan_id": None,
        "hits": [],
        "summary": empty_uuid_summary(),
    }


def not_implemented_uuid_apply_payload(*, dry_run: bool) -> dict[str, Any]:
    return {
        "ok": False,
        "implemented": False,
        "dry_run": dry_run,
        "message": NOT_IMPLEMENTED_MESSAGE,
        "mappings": [],
        "summary": empty_uuid_summary(),
        "log": NOT_IMPLEMENTED_MESSAGE,
        "lines": [NOT_IMPLEMENTED_MESSAGE],
    }
