"""web_launcher 辅助函数测试。"""

from __future__ import annotations

import unittest
from unittest import mock

from fcdesk.shell import web_launcher


class TestWebLauncher(unittest.TestCase):
    def test_web_server_status_not_running(self) -> None:
        with mock.patch.object(web_launcher, "_server_healthy", return_value=False):
            st = web_launcher.web_server_status(host="127.0.0.1", port=5173)
        self.assertFalse(st["running"])
        self.assertEqual(st["url"], "http://127.0.0.1:5173")

    def test_stop_when_not_running(self) -> None:
        with mock.patch.object(web_launcher, "web_server_running", return_value=False):
            result = web_launcher.stop_web_ui(host="127.0.0.1", port=5173)
        self.assertIn("未运行", result.message)
        self.assertTrue(result.ok)

    def test_find_listening_pids_parses_lsof(self) -> None:
        fake = mock.Mock(returncode=0, stdout="12345\n67890\n")
        with mock.patch.object(web_launcher.subprocess, "run", return_value=fake):
            pids = web_launcher.find_listening_pids(5173)
        self.assertEqual(pids, [12345, 67890])

    def test_stop_requests_shutdown_then_waits(self) -> None:
        with (
            mock.patch.object(web_launcher, "web_server_running", side_effect=[True, False]),
            mock.patch.object(web_launcher, "find_listening_pids", return_value=[999]),
            mock.patch.object(web_launcher, "_request_shutdown", return_value=(True, ["ok"])),
            mock.patch.object(web_launcher, "_wait_until_stopped", return_value=True),
            mock.patch.object(web_launcher, "push_shell_logs"),
            mock.patch.object(web_launcher, "push_shell_log"),
        ):
            result = web_launcher.stop_web_ui(host="127.0.0.1", port=5173)
        self.assertIn("已关闭", result.message)
        self.assertTrue(result.ok)

    def test_stop_api_unavailable_falls_back_to_kill(self) -> None:
        with (
            mock.patch.object(web_launcher, "web_server_running", side_effect=[True, True, False]),
            mock.patch.object(web_launcher, "find_listening_pids", return_value=[123]),
            mock.patch.object(web_launcher, "_pid_alive", return_value=True),
            mock.patch.object(
                web_launcher,
                "_request_shutdown",
                return_value=(False, ["POST /api/shutdown → HTTP 405"]),
            ),
            mock.patch.object(web_launcher, "_wait_until_stopped", side_effect=[False, True]),
            mock.patch.object(web_launcher, "_terminate_pid") as kill,
            mock.patch.object(web_launcher, "push_shell_logs"),
            mock.patch.object(web_launcher, "push_shell_log"),
        ):
            result = web_launcher.stop_web_ui(host="127.0.0.1", port=5173)
        kill.assert_called()
        self.assertTrue(result.ok)


if __name__ == "__main__":
    unittest.main()
