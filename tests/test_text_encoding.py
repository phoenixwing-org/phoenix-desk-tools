"""text_encoding 检测。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from phoenix.code.text_encoding import (
    ENC_ASCII,
    ENC_BINARY,
    ENC_GBK,
    ENC_UTF8,
    ENC_UTF8_BOM,
    detect_text_encoding_label,
)


class TestTextEncoding(unittest.TestCase):
    def test_utf8_bom(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "bom.cpp"
            p.write_bytes(b"\xef\xbb\xbf// hi\n")
            self.assertEqual(detect_text_encoding_label(p), ENC_UTF8_BOM)

    def test_utf8_plain(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "u8.cpp"
            p.write_text("// 中文\n", encoding="utf-8")
            self.assertEqual(detect_text_encoding_label(p), ENC_UTF8)

    def test_ascii(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "a.cpp"
            p.write_text("int main(){}\n", encoding="utf-8")
            self.assertEqual(detect_text_encoding_label(p), ENC_ASCII)

    def test_gbk(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "g.cpp"
            p.write_bytes("// \xb2\xe2\xca\xd4\n".encode("latin-1"))  # GBK 测试
            self.assertEqual(detect_text_encoding_label(p), ENC_GBK)

    def test_binary_png(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "x.png"
            p.write_bytes(b"\x89PNG\r\n")
            self.assertEqual(detect_text_encoding_label(p), ENC_BINARY)


if __name__ == "__main__":
    unittest.main()
