"""In-process unit test run cancellation (avoid unreliable ``request.is_disconnected()``)."""

from __future__ import annotations

import threading
import uuid

_lock = threading.Lock()
_active: set[str] = set()
_cancelled: set[str] = set()


def new_run_id() -> str:
    return uuid.uuid4().hex


def begin_run(run_id: str) -> None:
    with _lock:
        _active.add(run_id)
        _cancelled.discard(run_id)


def end_run(run_id: str) -> None:
    with _lock:
        _active.discard(run_id)
        _cancelled.discard(run_id)


def request_cancel(run_id: str) -> bool:
    with _lock:
        if run_id not in _active:
            return False
        _cancelled.add(run_id)
        return True


def is_cancelled(run_id: str) -> bool:
    with _lock:
        return run_id in _cancelled
