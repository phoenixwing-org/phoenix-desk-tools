"""part_dedup_scan 单元测试。"""

from __future__ import annotations

from pathlib import Path

from phoenix.part_dedup_scan import run_part_dedup_scan


def test_name_dup(tmp_path: Path) -> None:
    (tmp_path / "123456_v001.SLDPRT").write_text("a")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "123456_v001.SLDPRT").write_text("b")

    out = run_part_dedup_scan(tmp_path, extension=".SLDPRT")
    assert out["file_count"] == 2
    assert out["stats"]["name_dup"] == 1
    assert len(out["results"]["name_dup"][0]["paths"]) == 2


def test_code_dup_fcstd_drawing_vs_model(tmp_path: Path) -> None:
    (tmp_path / "123456_v001.FCStd").write_text("m")
    (tmp_path / "123456_v001.Drawing.FCStd").write_text("d")

    out = run_part_dedup_scan(
        tmp_path,
        extension=".FCStd",
        check_version=True,
    )
    assert out["stats"]["code_dup"] == 0
    assert out["stats"]["ver_dup"] == 0


def test_code_dup_same_number(tmp_path: Path) -> None:
    (tmp_path / "123456_a.SLDPRT").write_text("a")
    (tmp_path / "123456_b.SLDPRT").write_text("b")

    out = run_part_dedup_scan(tmp_path, extension=".SLDPRT", check_version=False)
    assert out["stats"]["code_dup"] == 1
