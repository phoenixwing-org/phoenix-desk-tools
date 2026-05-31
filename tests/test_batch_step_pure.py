"""不依赖 FreeCAD：仅测试 ``fcdesk.batch_step`` 纯算法与报告。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fcdesk.batch_step.job import StepBatchJob
from fcdesk.batch_step.report import (
    parse_batch_step_report_summary,
    parse_batch_step_stderr_summary,
    render_batch_step_report_md,
    write_batch_step_report_md,
)
from fcdesk.batch_step.step_paths import (
    iter_step_paths,
    iter_step_paths_recursive,
    list_step_paths_for_batch,
    sample_step_fcstd_dirs,
    step_tree_stats,
)
from fcdesk.batch_step.step_naming import decode_step_x2_utf16_string, internal_name_from_stem


class TestStepNaming(unittest.TestCase):
    def test_internal_name_digit_prefix(self) -> None:
        self.assertTrue(internal_name_from_stem("1_2-part").startswith("P_"))

    def test_decode_x2_utf16_placeholder(self) -> None:
        s = r"ABC\X2\004100420043\X0\DEF"
        out = decode_step_x2_utf16_string(s)
        self.assertIsInstance(out, str)


class TestStepPaths(unittest.TestCase):
    def test_iter_orders_and_filters(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            td = Path(d)
            (td / "b.step").touch()
            (td / "a.stp").touch()
            (td / "readme.txt").touch()
            (td / "sub").mkdir()
            names = [p.name for p in iter_step_paths(td)]
            self.assertEqual(names, ["a.stp", "b.step"])

    def test_sample_dirs(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            base = Path(d).resolve()
            s, o = sample_step_fcstd_dirs(base, "SampleFoo")
            self.assertEqual(s, base / "SampleFoo" / "step")
            self.assertEqual(o, base / "SampleFoo" / "FreeCAD")

    def test_not_a_dir_raises(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "nope.step"
            p.touch()
            with self.assertRaises(NotADirectoryError):
                list(iter_step_paths(p))

    def test_recursive_lists_subdirs(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            td = Path(d)
            (td / "sub").mkdir()
            (td / "root.stp").touch()
            (td / "sub" / "nested.step").touch()
            top_n, deep_n = step_tree_stats(td)
            self.assertEqual(top_n, 1)
            self.assertEqual(deep_n, 2)
            nested = list(iter_step_paths_recursive(td))
            self.assertEqual({p.name for p in nested}, {"root.stp", "nested.step"})
            shallow = list_step_paths_for_batch(td, recursive=False)
            deep = list_step_paths_for_batch(td, recursive=True)
            self.assertEqual(len(shallow), 1)
            self.assertEqual(len(deep), 2)


class TestStepBatchJob(unittest.TestCase):
    def test_subprocess_env(self) -> None:
        j = StepBatchJob(
            step_dir=Path("/tmp/step"),
            out_dir=Path("/tmp/out"),
            skip_existing=True,
            view_fit_last=False,
            view_fit_all=True,
        )
        e = j.subprocess_env()
        self.assertEqual(e["FCD_BATCH_SKIP_EXISTING"], "1")
        self.assertEqual(e["FCD_BATCH_VIEW_FIT_ALL"], "1")
        self.assertEqual(e["FCD_BATCH_STEP_RECURSIVE"], "0")

        j_rec = StepBatchJob(
            step_dir=Path("/tmp/step"),
            out_dir=Path("/tmp/out"),
            step_recursive=True,
        )
        self.assertEqual(j_rec.subprocess_env()["FCD_BATCH_STEP_RECURSIVE"], "1")


class TestReport(unittest.TestCase):
    def test_write_empty_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tdir = Path(td)
            out = tdir / "r.md"
            write_batch_step_report_md(
                out,
                step_dir=tdir / "step",
                out_dir=tdir / "fc",
                results=[],
                ok=0,
                skip=0,
                fail=0,
                project_tag="X",
            )
            self.assertTrue(out.is_file())
            text = out.read_text(encoding="utf-8")
            self.assertIn("STEP → FCStd", text)
            self.assertIn("X", text)

    def test_parse_summary(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tdir = Path(td)
            out = tdir / "r.md"
            write_batch_step_report_md(
                out,
                step_dir=tdir / "step",
                out_dir=tdir / "fc",
                results=[("a.stp", "a.FCStd", None), ("b.stp", None, "skip_existing")],
                ok=1,
                skip=1,
                fail=0,
            )
            summary = parse_batch_step_report_summary(out)
            self.assertIsNotNone(summary)
            assert summary is not None
            self.assertEqual(summary["ok"], 1)
            self.assertEqual(summary["skip"], 1)
            self.assertEqual(summary["fail"], 0)
            self.assertEqual(summary["total"], 2)

    def test_parse_stderr_summary(self) -> None:
        text = "批量结束\n[fcdesk] OK=3 skip=1 fail=0 total=4\n"
        summary = parse_batch_step_stderr_summary(text)
        self.assertIsNotNone(summary)
        assert summary is not None
        self.assertEqual(summary["ok"], 3)
        self.assertEqual(summary["skip"], 1)
        self.assertEqual(summary["fail"], 0)
        self.assertEqual(summary["total"], 4)

    def test_render_report_roundtrip(self) -> None:
        md = render_batch_step_report_md(
            step_dir="/tmp/step",
            out_dir="/tmp/out",
            results=[("a.stp", "a.FCStd", None)],
            ok=1,
            skip=0,
            fail=0,
        )
        self.assertIn("统计：成功 1", md)
        self.assertIn("a.stp", md)


if __name__ == "__main__":
    unittest.main()
