"""默认 FreeCAD 安装路径。"""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest import mock

from phoenix.freecad.default_install import default_freecad_install_dir


class TestDefaultFreecadInstall(unittest.TestCase):
    def test_darwin(self) -> None:
        with mock.patch("phoenix.freecad.default_install.sys.platform", "darwin"):
            self.assertEqual(default_freecad_install_dir(), "/Applications/FreeCAD.app")

    def test_win32(self) -> None:
        with mock.patch("phoenix.freecad.default_install.sys.platform", "win32"), mock.patch.dict(
            os.environ, {"ProgramFiles": r"C:\Program Files"}, clear=False
        ):
            got = default_freecad_install_dir()
            assert got is not None
            self.assertEqual(Path(got), Path(r"C:\Program Files") / "FreeCAD 1.1")

    def test_linux_none(self) -> None:
        with mock.patch("phoenix.freecad.default_install.sys.platform", "linux"):
            self.assertIsNone(default_freecad_install_dir())


if __name__ == "__main__":
    unittest.main()
