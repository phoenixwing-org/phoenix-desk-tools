"""run_cancel token registry."""

from __future__ import annotations

import unittest

from phoenix.testing.run_cancel import begin_run, end_run, is_cancelled, new_run_id, request_cancel
from phoenix.testing.runner import iter_unit_test_run_events


class TestRunCancel(unittest.TestCase):
    def test_cancel_token_stops_after_current_case(self) -> None:
        run_id = new_run_id()
        begin_run(run_id)
        try:
            checks = [0]

            def cancel_check() -> bool:
                checks[0] += 1
                if checks[0] > 2:
                    request_cancel(run_id)
                return is_cancelled(run_id)

            full = list(iter_unit_test_run_events(["code"]))
            full_cases = sum(1 for e in full if e["type"] == "case_done")

            events = list(iter_unit_test_run_events(["code"], cancel_check=cancel_check))
            self.assertEqual(events[-1]["type"], "cancelled")
            partial = sum(1 for e in events if e["type"] == "case_done")
            self.assertGreater(partial, 0)
            self.assertLess(partial, full_cases)
        finally:
            end_run(run_id)

    def test_no_cancel_runs_all_code_ignore_cases(self) -> None:
        events = list(iter_unit_test_run_events(["code"]))
        self.assertEqual(events[-1]["type"], "done")
        cases = [
            e["case"]["method"]
            for e in events
            if e["type"] == "case_done" and e["case"]["module"] == "tests.test_code_ignore"
        ]
        self.assertEqual(
            sorted(cases),
            sorted(
                [
                    "test_code_ignore_file_primary",
                    "test_file_and_custom_merge",
                    "test_legacy_files_when_no_primary",
                    "test_merge_dedupes",
                    "test_prefs_roundtrip",
                ]
            ),
        )


if __name__ == "__main__":
    unittest.main()
