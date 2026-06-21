"""XLink 修正服务：Part Key 推断与手选写回校验。"""

from __future__ import annotations

from pathlib import Path

import pytest

from phoenix.freecad.phoenix_store import connect
from phoenix.services.xlink_fix_service import analyze_xlink_fix, apply_xlink_fix_override, part_hints_from_xlink_old_path


def test_part_hints_from_xlink_old_path() -> None:
    h = part_hints_from_xlink_old_path("8003.001-H-PHOENIX-滑轨.FCStd")
    assert h["basename"] == "8003.001-H-PHOENIX-滑轨.FCStd"
    assert h["part_number"] == "8003"
    assert h["part_version"] == "001"
    assert h["part_key"] == "8003.001"


def test_part_hints_relative_attr() -> None:
    h = part_hints_from_xlink_old_path("../parts/100082.002-R-FOO.FCStd")
    assert h["basename"] == "100082.002-R-FOO.FCStd"
    assert h["part_number"] == "100082"
    assert h["part_version"] == "002"


def test_part_hints_short_number_and_underscore() -> None:
    h = part_hints_from_xlink_old_path("8003.001_H_PHOENIX-滑轨.FCStd")
    assert h["part_key"] == "8003.001"
    h2 = part_hints_from_xlink_old_path("8003.001-H-PX-滑轨.Drawing.FCStd")
    assert h2["part_key"] == "8003.001"


def test_analyze_requires_cad_index(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="CAD 索引"):
        analyze_xlink_fix(tmp_path)


def test_analyze_all_in_dir_requires_fcstd(tmp_path: Path) -> None:
    with connect(tmp_path) as conn:
        conn.execute(
            "INSERT INTO phoenix_cad_file_asset(repo_rel_path, filename, updated_at) "
            "VALUES (?, ?, ?)",
            ("./parts/a.FCStd", "a.FCStd", "2026-01-01T00:00:00+00:00"),
        )
    with pytest.raises(ValueError, match="未找到 .FCStd"):
        analyze_xlink_fix(tmp_path, batch_dir_input=".", all_in_dir=True)


def test_apply_override_missing_host(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="宿主"):
        apply_xlink_fix_override(
            tmp_path,
            host_repo_rel="missing/host.FCStd",
            old_path="old.FCStd",
            target_repo_rel="target.FCStd",
        )
