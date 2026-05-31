"""ui_session / workbench 会话持久化。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fcdesk.freecad.phoenix_store import (
    cad_database_path,
    load_ui_session,
    save_ui_session,
    ui_session_updated_at,
)
from fcdesk.services.workbench_service import get_workbench_session_payload, save_workbench_session


class WorkbenchSessionTests(unittest.TestCase):
    def test_ui_session_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = {
                "version": 1,
                "active_tab_id": "tab-1",
                "tabs": [
                    {
                        "id": "tab-1",
                        "pageId": "bom_apply",
                        "title": "part.FCStd",
                        "pageState": {"v": 1, "rel": "./part.FCStd"},
                    }
                ],
            }
            updated = save_ui_session(root, payload)
            self.assertTrue(updated)
            self.assertTrue(cad_database_path(root).is_file())
            loaded = load_ui_session(root)
            self.assertEqual(loaded, payload)
            self.assertEqual(ui_session_updated_at(root), updated)

    def test_workbench_service_api(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            got = get_workbench_session_payload(root)
            self.assertIsNone(got["session"])
            body = save_workbench_session(
                root,
                {
                    "active_tab_id": "tab-a",
                    "tabs": [{"id": "tab-a", "pageId": "home", "title": "配置"}],
                },
            )
            self.assertEqual(body["session"]["active_tab_id"], "tab-a")
            again = get_workbench_session_payload(root)
            self.assertEqual(again["session"]["tabs"][0]["pageId"], "home")


if __name__ == "__main__":
    unittest.main()
