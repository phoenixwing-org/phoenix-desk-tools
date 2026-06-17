"""桌面进程：STEP 批量投递到「收件箱」，由 FreeCAD 内监听宏取用。"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from phoenix.freecad.batch_step.job import StepBatchJob
from phoenix.freecad.bridge_paths import ensure_bridge_dirs, inbox_dir


def enqueue_step_batch(phoenix_clone_root: Path | str, job: StepBatchJob) -> str:
    """写成 ``{uuid}_queued.json``；``phoenix_clone_root`` 为 **phoenix-freecad-desktop** 克隆根（含 ``phoenix/``）。

    （与工具条所选「数据仓库」无关——FreeCAD 里要从该克隆根导入 ``phoenix`` 与 ``scripts``。）
    """
    root = Path(phoenix_clone_root).expanduser().resolve()
    uid = uuid.uuid4().hex
    ensure_bridge_dirs()
    inbox = inbox_dir()
    payload = {
        "id": uid,
        "phoenix_clone_root": str(root),
        "env": job.subprocess_env(),
    }
    tmp = inbox / f"{uid}_queued.json.tmp"
    dst = inbox / f"{uid}_queued.json"
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(dst)
    return uid


def response_path(uid: str) -> Path:
    from phoenix.freecad.bridge_paths import done_dir

    return done_dir() / f"{uid}_result.json"


def peek_response(uid: str) -> dict | None:
    p = response_path(uid)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def take_response(uid: str) -> dict | None:
    """读取并删除结果文件。"""
    p = response_path(uid)
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        p.unlink(missing_ok=True)
        return data
    except (json.JSONDecodeError, OSError):
        return None
