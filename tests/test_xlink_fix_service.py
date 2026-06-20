"""XLink 修正服务：Part Key 推断与手选写回校验。"""

from __future__ import annotations

from pathlib import Path

import pytest

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


def test_apply_override_missing_host(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="宿主"):
        apply_xlink_fix_override(
            tmp_path,
            host_repo_rel="missing/host.FCStd",
            old_path="old.FCStd",
            target_repo_rel="target.FCStd",
        )
