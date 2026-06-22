"""native_dialog 选目录（Web/API 隔离调用）。"""

from __future__ import annotations

import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest import mock

from phoenix.shell import native_dialog


class TestNativeDialogIsolated(unittest.TestCase):
    def test_initialdir_unset_workspace_uses_documents(self) -> None:
        with mock.patch.object(
            native_dialog,
            "default_browse_directory",
            return_value=Path("/Users/me/Documents"),
        ):
            initial = native_dialog.resolve_directory_dialog_initialdir(None, path_hint="")
        self.assertEqual(Path(initial).as_posix(), "/Users/me/Documents")

    def test_macos_cancel_returns_empty(self) -> None:
        with mock.patch.object(
            native_dialog.subprocess,
            "run",
            return_value=CompletedProcess(
                args=["osascript"],
                returncode=1,
                stdout="",
                stderr="User canceled.",
            ),
        ):
            sel = native_dialog.pick_directory_isolated(title="选目录", initialdir="/tmp")
        self.assertEqual(sel, "")

    def test_macos_success_returns_path(self) -> None:
        with mock.patch.object(
            native_dialog.subprocess,
            "run",
            return_value=CompletedProcess(
                args=["osascript"],
                returncode=0,
                stdout="/Users/me/workspace\n",
                stderr="",
            ),
        ):
            sel = native_dialog.pick_directory_isolated(title="选目录", initialdir="")
        self.assertEqual(sel, "/Users/me/workspace")

    def test_macos_error_raises(self) -> None:
        with mock.patch.object(
            native_dialog.subprocess,
            "run",
            return_value=CompletedProcess(
                args=["osascript"],
                returncode=2,
                stdout="",
                stderr="execution error: something broke",
            ),
        ):
            with self.assertRaises(RuntimeError):
                native_dialog.pick_directory_isolated(title="选目录", initialdir="")


if __name__ == "__main__":
    unittest.main()
