"""Independent fake-App checks; never loads FreeCAD or user configuration."""

from __future__ import annotations

import unittest
from unittest import mock

from phoenix.freecad.thumbnail_preferences import ensure_save_thumbnail

_PARAMETERS = "User parameter:BaseApp/Preferences/Document"


class _ParameterGroup:
    def __init__(self, app):
        self.app = app

    def SetBool(self, key, value):
        self.app.events.append(("set_bool", key, value))
        if self.app.set_error:
            raise self.app.set_error
        self.app.values[key] = value

    def GetBool(self, key, default):
        self.app.events.append(("get_bool", key, default))
        if self.app.read_error:
            raise self.app.read_error
        if self.app.read_back is not None:
            return self.app.read_back
        return self.app.values.get(key, default)


class _App:
    def __init__(self, *, enabled=False, target="synthetic-current-profile"):
        self.events = []
        self.groups = []
        self.values = {"SaveThumbnail": enabled, "UnrelatedFlag": False}
        self.persisted = {}
        self.target = target
        self.save_result = None
        self.set_error = self.save_error = self.read_error = None
        self.read_back = None
        self.closeDocument = mock.Mock()
        self.newDocument = mock.Mock()

    def ParamGet(self, path):
        if path != _PARAMETERS:
            raise AssertionError("The helper may change only Document parameters")
        self.events.append(("param_get", path))
        group = _ParameterGroup(self)
        self.groups.append(group)
        return group

    def saveParameter(self):
        self.events.append(("save_parameter", self.target))
        if self.save_error:
            raise self.save_error
        if self.save_result is not False:
            self.persisted[self.target] = dict(self.values)
        return self.save_result


class TestThumbnailPreferences(unittest.TestCase):
    def test_sets_persists_then_freshly_rechecks_in_that_order(self):
        app = _App()
        self.assertIs(ensure_save_thumbnail(app), True)
        self.assertEqual(app.events, [
            ("param_get", _PARAMETERS), ("set_bool", "SaveThumbnail", True),
            ("save_parameter", app.target), ("param_get", _PARAMETERS),
            ("get_bool", "SaveThumbnail", False),
        ])
        self.assertIsNot(app.groups[0], app.groups[1])
        self.assertEqual(app.persisted[app.target], {"SaveThumbnail": True, "UnrelatedFlag": False})
        app.closeDocument.assert_not_called()
        app.newDocument.assert_not_called()

    def test_persists_even_if_preference_was_already_enabled(self):
        app = _App(enabled=True)
        self.assertIs(ensure_save_thumbnail(app), True)
        self.assertEqual(sum(event[0] == "save_parameter" for event in app.events), 1)

    def test_delegates_parameter_target_to_the_supplied_app(self):
        first, second = _App(target="synthetic-isolated-target"), _App(target="synthetic-gui-target")
        ensure_save_thumbnail(first)
        ensure_save_thumbnail(second)
        self.assertEqual(set(first.persisted), {first.target})
        self.assertEqual(set(second.persisted), {second.target})

    def test_explicit_persistence_failure_refuses_success(self):
        app = _App()
        app.save_result = False
        with self.assertRaisesRegex(RuntimeError, "SaveThumbnail"):
            ensure_save_thumbnail(app)
        self.assertEqual(len(app.groups), 1)
        self.assertEqual(app.persisted, {})

    def test_persistence_exception_propagates_without_readback(self):
        app = _App()
        app.save_error = OSError("synthetic preference write failure")
        with self.assertRaisesRegex(OSError, "synthetic preference write failure"):
            ensure_save_thumbnail(app)
        self.assertEqual(len(app.groups), 1)
        self.assertEqual(app.persisted, {})

    def test_false_readback_refuses_success(self):
        app = _App()
        app.read_back = False
        with self.assertRaisesRegex(RuntimeError, "SaveThumbnail"):
            ensure_save_thumbnail(app)
        self.assertEqual(len(app.groups), 2)

    def test_parameter_write_and_read_exceptions_are_not_swallowed(self):
        app = _App()
        app.set_error = PermissionError("synthetic parameter write failure")
        with self.assertRaisesRegex(PermissionError, "synthetic parameter write failure"):
            ensure_save_thumbnail(app)
        self.assertFalse(any(event[0] == "save_parameter" for event in app.events))
        app = _App()
        app.read_error = RuntimeError("synthetic parameter read failure")
        with self.assertRaisesRegex(RuntimeError, "synthetic parameter read failure"):
            ensure_save_thumbnail(app)


if __name__ == "__main__":
    unittest.main()
