"""CAD 扫描进度管理 — 线程安全的状态共享。

后台线程写进度，API 端点读进度。用 ``threading.Lock`` 保护。
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ScanPhase:
    """单个扫描阶段的进度快照。"""

    phase: str = ""
    """当前阶段: walk | bom | xref | done | error"""
    total: int = 0
    """本阶段需处理的文件总数"""
    processed: int = 0
    """已处理数"""
    skipped: int = 0
    """已完成跳过的文件数"""
    failed: int = 0
    """失败文件数"""
    current_file: str = ""
    """当前正在处理的文件路径"""
    errors: list[dict[str, str]] = field(default_factory=list)
    """失败明细 [{rel, error}, ...]"""
    started_at: float = 0.0
    finished_at: float = 0.0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    @property
    def percent(self) -> float:
        total = max(1, self.total)
        return min(100.0, round((self.processed / total) * 100, 1))

    @property
    def elapsed_sec(self) -> float:
        if not self.started_at:
            return 0.0
        end = self.finished_at or time.monotonic()
        return round(end - self.started_at, 1)


@dataclass
class ScanProgress:
    """一次扫描的整体进度。"""

    scan_id: str
    phase: str = "walk"
    status: str = "running"  # running | done | error | cancelled
    step: int = 0
    """0=walk, 1=bom, 2=xref, 3=done"""
    total_cad_files: int = 0
    total_fcstd_files: int = 0
    cancelled: bool = False
    error: str = ""
    created_at: float = field(default_factory=time.monotonic)
    finished_at: float = 0.0

    # 各阶段进度
    walk: ScanPhase = field(default_factory=ScanPhase)
    bom: ScanPhase = field(default_factory=ScanPhase)
    xref: ScanPhase = field(default_factory=ScanPhase)

    # 顶层锁
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    # 持久化回调（由 scan_store 注入）
    on_change: Callable[["ScanProgress"], None] | None = field(default=None, repr=False, compare=False)

    def _notify(self) -> None:
        if self.on_change:
            try:
                self.on_change(self)
            except Exception:
                pass  # 持久化失败不影响扫描

    def set_phase(self, phase: str, total: int = 0) -> ScanPhase:
        with self._lock:
            self.phase = phase
            if phase == "walk":
                self.step = 0
            elif phase == "bom":
                self.step = 1
            elif phase == "xref":
                self.step = 2
            elif phase == "done":
                self.step = 3
                self.status = "done"
                self.finished_at = time.monotonic()

            phase_obj = getattr(self, phase, None)
            if isinstance(phase_obj, ScanPhase) and total:
                with phase_obj._lock:
                    phase_obj.total = total
                    if not phase_obj.started_at:
                        phase_obj.started_at = time.monotonic()
        self._notify()
        return phase_obj if isinstance(phase_obj, ScanPhase) else self.bom

    def increment(self, phase: str, file_rel: str = "", success: bool = True, skipped: bool = False) -> None:
        with self._lock:
            phase_obj: ScanPhase | None = getattr(self, phase, None)
            if not isinstance(phase_obj, ScanPhase):
                return
            with phase_obj._lock:
                if skipped:
                    phase_obj.skipped += 1
                elif success:
                    phase_obj.processed += 1
                else:
                    phase_obj.failed += 1
                phase_obj.current_file = file_rel
        self._notify()

    def add_error(self, phase: str, file_rel: str, error: str) -> None:
        with self._lock:
            phase_obj: ScanPhase | None = getattr(self, phase, None)
            if not isinstance(phase_obj, ScanPhase):
                return
            with phase_obj._lock:
                phase_obj.failed += 1
                phase_obj.errors.append({"rel": file_rel, "error": error})
        self._notify()

    def cancel(self) -> None:
        with self._lock:
            self.cancelled = True
            self.status = "cancelled"
            self.finished_at = time.monotonic()
        self._notify()

    def set_error(self, msg: str) -> None:
        with self._lock:
            self.status = "error"
            self.error = msg
            self.finished_at = time.monotonic()
        self._notify()

    def to_dict(self) -> dict[str, Any]:
        with self._lock:
            return {
                "scan_id": self.scan_id,
                "phase": self.phase,
                "step": self.step,
                "status": self.status,
                "cancelled": self.cancelled,
                "error": self.error,
                "total_cad_files": self.total_cad_files,
                "total_fcstd_files": self.total_fcstd_files,
                "started_at": self.created_at,
                "finished_at": self.finished_at or 0.0,
                "walk": {
                    "total": self.walk.total,
                    "processed": self.walk.processed,
                    "skipped": self.walk.skipped,
                    "failed": self.walk.failed,
                    "current_file": self.walk.current_file,
                    "percent": self.walk.percent,
                    "errors": list(self.walk.errors),
                    "started_at": self.walk.started_at,
                    "finished_at": self.walk.finished_at,
                },
                "bom": {
                    "total": self.bom.total,
                    "processed": self.bom.processed,
                    "skipped": self.bom.skipped,
                    "failed": self.bom.failed,
                    "current_file": self.bom.current_file,
                    "percent": self.bom.percent,
                    "errors": list(self.bom.errors),
                    "started_at": self.bom.started_at,
                    "finished_at": self.bom.finished_at,
                },
                "xref": {
                    "total": self.xref.total,
                    "processed": self.xref.processed,
                    "skipped": self.xref.skipped,
                    "failed": self.xref.failed,
                    "current_file": self.xref.current_file,
                    "percent": self.xref.percent,
                    "errors": list(self.xref.errors),
                    "started_at": self.xref.started_at,
                    "finished_at": self.xref.finished_at,
                },
            }


# ---------------------------------------------------------------------------
# 全局注册表
# ---------------------------------------------------------------------------

_registry: dict[str, ScanProgress] = {}
_registry_lock = threading.Lock()


def register_scan() -> str:
    """注册一次新扫描，返回 scan_id。"""
    scan_id = uuid.uuid4().hex[:12]
    progress = ScanProgress(scan_id=scan_id, phase="walk")
    with _registry_lock:
        _registry[scan_id] = progress
    return scan_id


def get_progress(scan_id: str) -> ScanProgress | None:
    with _registry_lock:
        return _registry.get(scan_id)


def cancel_scan(scan_id: str) -> bool:
    progress = get_progress(scan_id)
    if not progress:
        return False
    progress.cancel()
    return True


def cleanup_scan(scan_id: str) -> None:
    with _registry_lock:
        _registry.pop(scan_id, None)


def cleanup_stale(max_age_sec: float = 3600.0) -> int:
    """清理超过 max_age_sec 的已完成/取消扫描。"""
    now = time.monotonic()
    stale: list[str] = []
    with _registry_lock:
        for sid, p in _registry.items():
            if p.status in ("done", "error", "cancelled"):
                age = now - (p.finished_at or p.created_at)
                if age > max_age_sec:
                    stale.append(sid)
        for sid in stale:
            _registry.pop(sid, None)
    return len(stale)
