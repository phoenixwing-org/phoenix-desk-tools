"""encoding 写盘前比对（换行符 / 编码）。"""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from phoenix.code.rename.encoding import (
    apply_newline_style,
    detect_and_read,
    dominant_newline_style,
    text_content_equivalent,
    would_change_on_disk,
    write_text_if_changed,
)
from phoenix.code.reorder_members import reorder_header_file


class TestEncodingWrite(unittest.TestCase):
    def test_text_content_equivalent_ignores_crlf(self) -> None:
        self.assertTrue(text_content_equivalent("a\r\nb\n", "a\nb\n"))

    def test_dominant_newline_style(self) -> None:
        self.assertEqual(dominant_newline_style("a\r\nb\r\n"), "crlf")
        self.assertEqual(dominant_newline_style("a\nb\n"), "lf")

    def test_apply_newline_style_roundtrip(self) -> None:
        src = "line1\r\nline2\r\n"
        norm = apply_newline_style("line1\nline2\n", "crlf")
        self.assertEqual(norm, src)

    def test_write_text_if_changed_skips_crlf_only_diff(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "f.h"
            path.write_bytes(b"void foo();\r\n")
            payload = detect_and_read(path)
            assert payload is not None
            written = write_text_if_changed(path, payload, "void foo();\n")
            self.assertFalse(written)
            self.assertEqual(path.read_bytes(), b"void foo();\r\n")

    def test_would_change_on_disk_detects_real_edit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "f.h"
            path.write_bytes(b"void foo();\r\n")
            payload = detect_and_read(path)
            assert payload is not None
            self.assertTrue(would_change_on_disk(path, payload, "void bar();\n"))

    def test_reorder_header_crlf_already_sorted_reports_unchanged(self) -> None:
        kt = (
            Path(__file__).resolve().parent
            / "fixtures"
            / "KtAlarmClock"
            / "KtAlarmClockUI"
            / "KtAlarmClockParam.h"
        )
        if not kt.is_file():
            self.skipTest("KtAlarmClockParam.h fixture missing")
        raw = subprocess.check_output(
            ["git", "-C", str(kt.parent.parent), "show", "HEAD:KtAlarmClockUI/KtAlarmClockParam.h"]
        )
        crlf = raw.decode("utf-8").replace("\n", "\r\n").encode("utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "KtAlarmClockParam.h"
            path.write_bytes(crlf)
            changed, _ = reorder_header_file(path, dry_run=True, sort_members=False)
            self.assertFalse(changed, "已排序的 CRLF 头文件不应误报变更")


if __name__ == "__main__":
    unittest.main()
