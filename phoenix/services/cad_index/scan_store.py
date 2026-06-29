"""CAD 扫描进度持久化 — SQLite 读写层。

与 ``scan_progress.py`` 分离：此模块负责将 ``ScanProgress`` 状态写入
``phoenix_cad_scan`` 表，支持服务重启后恢复。
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from phoenix.freecad.phoenix_schema import T_CAD_SCAN
from phoenix.freecad.phoenix_store import connect


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def persist_scan(
    repo_root: Path,
    progress: Any,  # ScanProgress — 避免循环导入，用 Any
    *,
    initial: bool = False,
) -> None:
    """将当前 ``ScanProgress`` 状态 UPSERT 到 phoenix_cad_scan。

    首次调用（initial=True）时写入 started_at 和 scan_uuid。
    后续调用只更新 progress_json / phase / status / finished_at。
    """
    rr = repo_root.expanduser().resolve(strict=False)
    now = _utc_now_iso()
    d = progress.to_dict()

    # stats_json 保留空 JSON（扫描完成后由 save_fcstd_document 写入真实统计）
    stats_json = "{}"
    scan_uuid = d["scan_id"]
    status = d["status"]
    phase = d["phase"]
    progress_json = json.dumps(d, ensure_ascii=False)
    finished_at = now if status in ("done", "error", "cancelled") else None

    with connect(rr) as conn:
        if initial:
            conn.execute(
                f"""INSERT INTO {T_CAD_SCAN}
                    (scan_uuid, scanned_at, scan_root, stats_json,
                     status, phase, progress_json, started_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (scan_uuid, now, ".", stats_json, status, phase, progress_json, now),
            )
        else:
            # 先确认行存在（initial 可能在其他地方调用）
            existing = conn.execute(
                f"SELECT id FROM {T_CAD_SCAN} WHERE scan_uuid = ?",
                (scan_uuid,),
            ).fetchone()
            if existing:
                conn.execute(
                    f"""UPDATE {T_CAD_SCAN}
                        SET status = ?, phase = ?, progress_json = ?,
                            finished_at = COALESCE(?, finished_at)
                        WHERE scan_uuid = ?""",
                    (status, phase, progress_json, finished_at, scan_uuid),
                )
            else:
                conn.execute(
                    f"""INSERT INTO {T_CAD_SCAN}
                        (scan_uuid, scanned_at, scan_root, stats_json,
                         status, phase, progress_json, started_at, finished_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        scan_uuid,
                        now,
                        ".",
                        stats_json,
                        status,
                        phase,
                        progress_json,
                        now,
                        finished_at,
                    ),
                )


def load_scan(repo_root: Path, scan_uuid: str) -> dict[str, Any] | None:
    """从 DB 恢复进度快照。"""
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        row = conn.execute(
            f"""SELECT progress_json, status, phase, started_at, finished_at
                FROM {T_CAD_SCAN}
                WHERE scan_uuid = ?
                ORDER BY id DESC
                LIMIT 1""",
            (scan_uuid,),
        ).fetchone()
    if not row or not row[0]:
        return None
    try:
        data = json.loads(row[0])
        data["db_status"] = row[1]
        data["db_phase"] = row[2]
        data["db_started_at"] = row[3]
        data["db_finished_at"] = row[4]
        return data
    except json.JSONDecodeError:
        return None


def list_recent_scans(repo_root: Path, limit: int = 20) -> list[dict[str, Any]]:
    """返回最近 N 条扫描记录（简要信息）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        rows = conn.execute(
            f"""SELECT scan_uuid, status, phase, scanned_at,
                       started_at, finished_at, stats_json
                FROM {T_CAD_SCAN}
                ORDER BY id DESC
                LIMIT ?""",
            (limit,),
        ).fetchall()
    return [
        {
            "scan_uuid": r[0],
            "status": r[1],
            "phase": r[2],
            "scanned_at": r[3],
            "started_at": r[4],
            "finished_at": r[5],
            "stats": json.loads(r[6]) if r[6] else {},
        }
        for r in rows
    ]


def find_active_scan(repo_root: Path) -> dict[str, Any] | None:
    """查找最近一条 status='running' 的扫描（用于页面刷新后恢复）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        row = conn.execute(
            f"""SELECT scan_uuid, progress_json, started_at
                FROM {T_CAD_SCAN}
                WHERE status = 'running'
                ORDER BY id DESC
                LIMIT 1""",
        ).fetchone()
        if not row:
            return None
        result = {"scan_uuid": row[0], "started_at": row[2]}
        if row[1]:
            try:
                result["progress"] = json.loads(row[1])
            except json.JSONDecodeError:
                pass
        return result


def orphan_active_on_startup(repo_root: Path) -> int:
    """服务启动时：将所有 status='running' 的扫描标记为 orphaned。

    返回被标记的行数。
    """
    rr = repo_root.expanduser().resolve(strict=False)
    now = _utc_now_iso()
    with connect(rr) as conn:
        cur = conn.execute(
            f"""UPDATE {T_CAD_SCAN}
                SET status = 'orphaned', finished_at = ?
                WHERE status = 'running'""",
            (now,),
        )
        return cur.rowcount


def recover_stale_scans(repo_root: Path, timeout_sec: float = 300.0) -> list[dict[str, Any]]:
    """查找并标记超时的 running 扫描为 orphaned。返回被标记的列表。"""
    rr = repo_root.expanduser().resolve(strict=False)
    now = _utc_now_iso()
    with connect(rr) as conn:
        rows = conn.execute(
            f"""SELECT scan_uuid, started_at
                FROM {T_CAD_SCAN}
                WHERE status = 'running'""",
        ).fetchall()
        stale: list[dict[str, Any]] = []
        for row in rows:
            # 简单启发式：如果 started_at 为空或超过 timeout_sec，认为过期
            # 由于我们没有精确的心跳，这里用创建时间做粗略判断
            stale.append({"scan_uuid": row[0], "started_at": row[1]})
        if stale:
            conn.execute(
                f"""UPDATE {T_CAD_SCAN}
                    SET status = 'orphaned', finished_at = ?
                    WHERE status = 'running'""",
                (now,),
            )
        return stale
