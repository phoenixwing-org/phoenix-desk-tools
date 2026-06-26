import shutil
import tempfile
import unittest
from pathlib import Path

from phoenix.caa.store import (
    build_catdlg_type_coverage,
    save_caa_index,
    scan_caa_dialog_files,
)


FIXTURE = Path(__file__).parent / "fixtures" / "caa" / "PNXBomAnalysisDlg.CATDlg"


class TestCaaIndexCoverage(unittest.TestCase):
    def test_pnx_bom_analysis_fixture_types_are_in_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            target = (
                root
                / "PNXBomAnalysisWsp"
                / "PNXBomAnalysisFrm"
                / "PNXBomAnalysisUI.m"
                / "LocalInterfaces"
                / FIXTURE.name
            )
            target.parent.mkdir(parents=True)
            shutil.copyfile(FIXTURE, target)

            records = scan_caa_dialog_files(root)
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0].dialog_name, "PNXBomAnalysisDlg")
            self.assertIn("CATDlgMultiList", records[0].type_counts)
            self.assertIn("CATDlgSlider", records[0].type_counts)

            coverage = build_catdlg_type_coverage(records)
            self.assertEqual(coverage["unknown_types"], 0, coverage)
            self.assertGreaterEqual(coverage["total_controls"], 5)

    def test_index_stats_include_control_type_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            target = root / "DemoUI.m" / "LocalInterfaces" / FIXTURE.name
            target.parent.mkdir(parents=True)
            shutil.copyfile(FIXTURE, target)

            records = scan_caa_dialog_files(root)
            meta = save_caa_index(root, records, scan_root=str(root))
            coverage = meta["stats"]["control_type_coverage"]
            self.assertEqual(coverage["unknown_types"], 0)
            self.assertGreaterEqual(coverage["total_types"], 5)


if __name__ == "__main__":
    unittest.main()
