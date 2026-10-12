"""STEP save-order regression using fake modules and independently named inputs.

No FreeCAD process, model geometry, thumbnail renderer or user prefs is used.
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


class _Parameters:
    def __init__(self, app):
        self.app = app

    def SetBool(self, key, value):
        self.app.events.append(("set_bool", key, value))
        self.app.parameters[key] = value

    def GetBool(self, key, default):
        self.app.events.append(("get_bool", key, default))
        return self.app.parameters.get(key, default)


class _App(types.ModuleType):
    def __init__(self, *, gui=True, persistence_failure=False):
        super().__init__("FreeCAD")
        self.GuiUp = gui
        self.events = []
        self.parameters = {}
        self.persisted = {}
        self.persistence_failure = persistence_failure

    def ParamGet(self, path):
        if path != "User parameter:BaseApp/Preferences/Document":
            raise AssertionError("Unexpected parameter group")
        self.events.append(("param_get", path))
        return _Parameters(self)

    def saveParameter(self):
        self.events.append(("save_parameter",))
        if self.persistence_failure:
            return False
        self.persisted = dict(self.parameters)
        return None

    def setActiveDocument(self, name):
        self.events.append(("app_active", name))

    def closeDocument(self, name):
        self.events.append(("close", name))


def _load_script(app):
    filename = Path(__file__).resolve().parents[1] / "scripts" / "freecad_batch_step_fc.py"
    spec = importlib.util.spec_from_file_location("synthetic_step_thumbnail_script", filename)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, {"FreeCAD": app, "Import": types.ModuleType("Import")}):
        spec.loader.exec_module(module)
    return module


def _gui(app):
    gui = types.ModuleType("FreeCADGui")
    view = types.SimpleNamespace(viewIsometric=lambda: app.events.append(("isometric",)))
    gui.setActiveDocument = lambda name: app.events.append(("gui_active", name))
    gui.activeDocument = lambda: types.SimpleNamespace(activeView=lambda: view)
    gui.SendMsgToActiveView = lambda message: app.events.append(("view_message", message))
    return gui


def _importer(app):
    def import_new_document(step_path):
        stem = Path(step_path).stem
        name = stem + "_synthetic_document"
        app.events.append(("import", stem))
        doc = types.SimpleNamespace(Name=name, saveAs=lambda output: app.events.append(("save_as", name, Path(output).name)))
        return doc, stem, "Synthetic imported metadata"
    return import_new_document


class TestStepThumbnailPreferences(unittest.TestCase):
    def test_single_gui_preferences_and_requested_view_fit_precede_save(self):
        app = _App()
        script = _load_script(app)
        with tempfile.TemporaryDirectory(prefix="desk-step-thumbnail-") as temporary:
            step = Path(temporary) / "Synthetic.step"
            with mock.patch.object(script, "import_step_into_new_doc_with_body", side_effect=_importer(app)), \
                    mock.patch.dict(sys.modules, {"FreeCADGui": _gui(app)}):
                output, label, doc_name = script.save_step_as_fcstd(step, Path(temporary) / "out", view_fit=True)
        self.assertEqual(Path(output).name, "Synthetic.FCStd")
        self.assertEqual(label, "Synthetic imported metadata")
        self.assertEqual(app.persisted, {"SaveThumbnail": True})
        actions = [event[0] for event in app.events]
        self.assertLess(actions.index("save_parameter"), actions.index("get_bool"))
        self.assertLess(actions.index("get_bool"), actions.index("import"))
        self.assertLess(actions.index("isometric"), actions.index("save_as"))
        self.assertLess(actions.index("view_message"), actions.index("save_as"))
        self.assertIn(("app_active", doc_name), app.events)
        self.assertIn(("view_message", "ViewFit"), app.events)
        self.assertNotIn("close", actions)

    def test_single_gui_view_fit_false_does_not_change_the_view(self):
        app = _App()
        script = _load_script(app)
        with tempfile.TemporaryDirectory(prefix="desk-step-thumbnail-") as temporary, \
                mock.patch.object(script, "import_step_into_new_doc_with_body", side_effect=_importer(app)), \
                mock.patch.dict(sys.modules, {"FreeCADGui": _gui(app)}):
            script.save_step_as_fcstd(Path(temporary) / "Synthetic.step", Path(temporary) / "out", view_fit=False, close_doc=True)
        actions = [event[0] for event in app.events]
        self.assertNotIn("view_message", actions)
        self.assertLess(actions.index("get_bool"), actions.index("save_as"))
        self.assertLess(actions.index("save_as"), actions.index("close"))

    def test_headless_enables_preferences_without_invoking_gui_or_claiming_a_png(self):
        app = _App(gui=False)
        script = _load_script(app)
        with tempfile.TemporaryDirectory(prefix="desk-step-thumbnail-") as temporary, \
                mock.patch.object(script, "import_step_into_new_doc_with_body", side_effect=_importer(app)), \
                mock.patch.dict(sys.modules, {"FreeCADGui": _gui(app)}):
            result = script.save_step_as_fcstd(Path(temporary) / "Synthetic.step", Path(temporary) / "out", view_fit=True)
        self.assertEqual(len(result), 3)
        self.assertEqual(app.persisted, {"SaveThumbnail": True})
        actions = [event[0] for event in app.events]
        self.assertIn("save_as", actions)
        for action in ("app_active", "gui_active", "isometric", "view_message"):
            self.assertNotIn(action, actions)

    def test_persistence_failure_refuses_single_import_and_save(self):
        app = _App(persistence_failure=True)
        script = _load_script(app)
        with tempfile.TemporaryDirectory(prefix="desk-step-thumbnail-") as temporary, \
                mock.patch.object(script, "import_step_into_new_doc_with_body", side_effect=_importer(app)) as importer:
            with self.assertRaisesRegex(RuntimeError, "SaveThumbnail"):
                script.save_step_as_fcstd(Path(temporary) / "Synthetic.step", Path(temporary) / "out")
            importer.assert_not_called()
            self.assertFalse((Path(temporary) / "out").exists())
        self.assertFalse(any(event[0] in ("import", "save_as", "close") for event in app.events))

    def test_batch_all_and_last_view_policies_use_the_shared_pre_save_preferences(self):
        for view_all in (False, True):
            with self.subTest(view_fit_all=view_all):
                app = _App()
                script = _load_script(app)
                with tempfile.TemporaryDirectory(prefix="desk-step-thumbnail-") as temporary, \
                        mock.patch.object(script, "import_step_into_new_doc_with_body", side_effect=_importer(app)), \
                        mock.patch.dict(sys.modules, {"FreeCADGui": _gui(app)}):
                    paths = [Path(temporary) / "First.step", Path(temporary) / "Second.step"]
                    results = script.batch_save_steps_to_fcstd(temporary, Path(temporary) / "out",
                        sorted_paths=paths, view_fit_all=view_all, view_fit_last=not view_all)
                self.assertTrue(all(output and error is None for _step, output, error in results))
                actions = [event[0] for event in app.events]
                self.assertEqual(actions.count("save_parameter"), 2)
                self.assertEqual(actions.count("get_bool"), 2)
                self.assertEqual(actions.count("close"), 2)
                self.assertEqual(actions.count("view_message"), 2 if view_all else 1)
                pending_start = 0
                for index, event in enumerate(app.events):
                    if event[0] == "close":
                        saved_actions = [item[0] for item in app.events[pending_start:index]]
                        self.assertLess(saved_actions.index("get_bool"), saved_actions.index("save_as"))
                        if "view_message" in saved_actions:
                            self.assertLess(saved_actions.index("view_message"), saved_actions.index("save_as"))
                        pending_start = index + 1

    def test_batch_persistence_failure_is_reported_without_import_or_save(self):
        app = _App(persistence_failure=True)
        script = _load_script(app)
        with tempfile.TemporaryDirectory(prefix="desk-step-thumbnail-") as temporary, \
                mock.patch.object(script, "import_step_into_new_doc_with_body", side_effect=_importer(app)) as importer:
            results = script.batch_save_steps_to_fcstd(temporary, Path(temporary) / "out",
                sorted_paths=[Path(temporary) / "First.step", Path(temporary) / "Second.step"])
            importer.assert_not_called()
        self.assertEqual(len(results), 2)
        for _step, output, error in results:
            self.assertIsNone(output)
            self.assertIn("SaveThumbnail", error)
        self.assertFalse(any(event[0] in ("import", "save_as", "close") for event in app.events))

    def test_batch_skip_existing_does_not_resave_or_touch_existing_archive_bytes(self):
        app = _App(gui=False)
        script = _load_script(app)
        with tempfile.TemporaryDirectory(prefix="desk-step-thumbnail-") as temporary, \
                mock.patch.object(script, "import_step_into_new_doc_with_body", side_effect=_importer(app)) as importer:
            base = Path(temporary)
            existing = base / "Synthetic.FCStd"
            opaque_bytes = b"synthetic existing archive placeholder"
            existing.write_bytes(opaque_bytes)
            results = script.batch_save_steps_to_fcstd(base, base, skip_existing=True,
                sorted_paths=[base / "Synthetic.step"])
            self.assertEqual(results, [(str(base / "Synthetic.step"), None, "skip_existing")])
            self.assertEqual(existing.read_bytes(), opaque_bytes)
            importer.assert_not_called()
        self.assertEqual(app.events, [])


if __name__ == "__main__":
    unittest.main()
