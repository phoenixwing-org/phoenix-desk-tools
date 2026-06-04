from pathlib import Path
from unittest.mock import patch

from fcdesk.services.onboarding_service import (
    _workspace_configured,
    onboarding_status_payload,
)


def test_workspace_configured_matches_recent(tmp_path: Path) -> None:
    ws = tmp_path / "proj"
    ws.mkdir()
    recent = [ws]
    with (
        patch(
            "fcdesk.services.onboarding_service.list_recent_workspace_paths_raw",
            return_value=recent,
        ),
        patch(
            "fcdesk.services.onboarding_service.is_ephemeral_workspace_path",
            return_value=False,
        ),
    ):
        assert _workspace_configured(ws) is True
    with patch(
        "fcdesk.services.onboarding_service.list_recent_workspace_paths_raw",
        return_value=[],
    ):
        assert _workspace_configured(ws) is False


def test_onboarding_status_payload_minimal(tmp_path: Path) -> None:
    ws = tmp_path / "w"
    ws.mkdir()
    with patch(
        "fcdesk.services.onboarding_service._workspace_configured",
        return_value=False,
    ):
        with patch(
            "fcdesk.services.onboarding_service.load_launcher_prefs",
            return_value={"freecad_dir": None},
        ):
            out = onboarding_status_payload(ws)
    assert out["workspace_ok"] is False
    assert out["freecad_ok"] is False
    assert out["index_scanned"] is False
