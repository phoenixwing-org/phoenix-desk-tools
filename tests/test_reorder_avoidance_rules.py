"""成员排序 · 锁定段（locked region，P0）回归。"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from phoenix.code.reorder_avoidance import (
    AVOIDANCE_RULES,
    extract_avoidance_blocks,
    find_avoidance_spans,
    list_avoidance_rules,
    rule_ids,
)
from phoenix.code.reorder_members import reorder_cpp_file, reorder_header_file

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "reorder_members"
PNX_BOM_CMD_MIN = FIXTURES / "pnx_bom_analysis_cmd_min.cpp"
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
KT_PARAM_H = _REPO_ROOT / "KtAlarmClock" / "KtAlarmClockUI" / "KtAlarmClockParam.h"
KT_PARAM_CPP = KT_PARAM_H.with_suffix(".cpp")
PNX_CURVE_DIVISION_H = (
    _REPO_ROOT / "PNXCaaStudy"
    / "PNXCurveDivisionWsp" / "PNXCurveDivisionFrm"
    / "PNXCurveDivisionUI.m" / "LocalInterfaces"
    / "PNXCurveDivisionDlg.h"
)


def _reorder_header_copy(path: Path, *, sort_members: bool = False) -> tuple[str, str]:
    before = path.read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as tmp:
        cp = Path(tmp) / path.name
        shutil.copy(path, cp)
        reorder_header_file(cp, dry_run=False, sort_members=sort_members)
        after = cp.read_text(encoding="utf-8")
    return before, after


def _reorder_cpp_copy(path: Path) -> tuple[str, str]:
    before = path.read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as tmp:
        cp = Path(tmp) / path.name
        shutil.copy(path, cp)
        reorder_cpp_file(cp, dry_run=False)
        after = cp.read_text(encoding="utf-8")
    return before, after


def _assert_avoidance_blocks_unchanged(before: str, after: str) -> None:
    assert extract_avoidance_blocks(before) == extract_avoidance_blocks(after)


class TestAvoidanceRuleParsing(unittest.TestCase):
    def test_rule_registry_has_unique_ids(self) -> None:
        """锁定规则 id 唯一且可列举。"""
        ids = rule_ids()
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreaterEqual(len(ids), 4)
        listed = list_avoidance_rules()
        self.assertEqual({r["id"] for r in listed}, set(ids))
        for rule in AVOIDANCE_RULES:
            self.assertTrue(rule.start.pattern)
            self.assertTrue(rule.end.pattern)

    def test_find_kevin_and_clang_in_kt_param_h(self) -> None:
        """case_id=kt-param-h-parse"""
        text = KT_PARAM_H.read_text(encoding="utf-8")
        spans = find_avoidance_spans(text)
        self.assertGreaterEqual(len(spans), 1)
        merged = spans[0].content
        self.assertIn("// clang-format off", merged)
        self.assertIn("//START KEVIN CAA WIZARD SECTION", merged)

    def test_caa2_fixture_has_one_block(self) -> None:
        """case_id=caa2-wizard-parse"""
        text = (FIXTURES / "caa2_wizard_section.h").read_text(encoding="utf-8")
        blocks = extract_avoidance_blocks(text)
        self.assertEqual(len(blocks), 1)
        self.assertIn("//CAA2 WIZARD", blocks[0])
        self.assertIn("_ComboSelector", blocks[0])

    def test_clang_format_wraps_nested_markers_as_one_zone(self) -> None:
        """case_id=clang-nested-parse — clang-format 外层吞并内部 Wizard"""
        text = (FIXTURES / "clang_format_nested_markers.h").read_text(encoding="utf-8")
        spans = find_avoidance_spans(text)
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].rule_id, "clang-format")
        block = spans[0].content
        self.assertIn("// clang-format off", block)
        self.assertIn("//START KEVIN CAA WIZARD SECTION", block)
        self.assertIn("//CAA2 WIZARD", block)
        self.assertIn("// clang-format on", block)


class TestReorderAvoidanceRules(unittest.TestCase):
    def test_clang_format_block_unchanged(self) -> None:
        """case_id=clang-off-on"""
        path = FIXTURES / "clang_format_off_on.h"
        before, after = _reorder_header_copy(path)
        _assert_avoidance_blocks_unchanged(before, after)
        off = before.index("// clang-format off")
        on = before.index("// clang-format on") + len("// clang-format on")
        self.assertEqual(before[off:on], after[off:on])

    def test_kevin_wizard_section_unchanged(self) -> None:
        """case_id=kevin-wizard-min"""
        path = FIXTURES / "kevin_wizard_section.h"
        before, after = _reorder_header_copy(path)
        _assert_avoidance_blocks_unchanged(before, after)
        start = before.index("//START KEVIN CAA WIZARD SECTION")
        end = before.index("//END KEVIN CAA WIZARD SECTION") + len(
            "//END KEVIN CAA WIZARD SECTION SampleKevinWizard PARAM DECLARATION"
        )
        self.assertEqual(before[start:end], after[start:end])
        zebra = before.index("ZebraField")
        apple = before.index("AppleField")
        self.assertLess(zebra, apple)
        self.assertLess(after.index("ZebraField"), after.index("AppleField"))

    def test_caa2_wizard_section_unchanged(self) -> None:
        """case_id=caa2-wizard"""
        path = FIXTURES / "caa2_wizard_section.h"
        before, after = _reorder_header_copy(path)
        _assert_avoidance_blocks_unchanged(before, after)
        self.assertLess(after.index("_PushButtonApply"), after.index("_ComboSelector"))

    def test_pragma_region_block_unchanged(self) -> None:
        """case_id=pragma-region"""
        path = FIXTURES / "pragma_region.h"
        before, after = _reorder_header_copy(path)
        _assert_avoidance_blocks_unchanged(before, after)
        region = extract_avoidance_blocks(before)[0]
        self.assertIn("#pragma region GeneratedFields", region)
        self.assertLess(region.index("field_z_first"), region.index("field_a_second"))
        self.assertLess(after.index("field_z_first"), after.index("field_a_second"))
        self.assertLess(after.index("apple"), after.index("beta"))

    def test_clang_format_nested_markers_unchanged(self) -> None:
        """case_id=clang-nested — Kevin + CAA2 嵌套在 clang-format 内"""
        path = FIXTURES / "clang_format_nested_markers.h"
        before, after = _reorder_header_copy(path)
        _assert_avoidance_blocks_unchanged(before, after)
        self.assertEqual(len(find_avoidance_spans(before)), 1)
        for name in ("KevinFirst", "KevinSecond", "_WidgetA", "_WidgetB"):
            self.assertIn(name, extract_avoidance_blocks(after)[0])
        self.assertLess(after.index("KevinFirst"), after.index("KevinSecond"))
        self.assertLess(after.index("_WidgetA"), after.index("_WidgetB"))

    def test_clang_format_doubled_nesting_unchanged(self) -> None:
        """case_id=clang-doubled — 两层 clang-format off/on"""
        path = FIXTURES / "clang_format_doubled.h"
        before, after = _reorder_header_copy(path)
        _assert_avoidance_blocks_unchanged(before, after)
        block = extract_avoidance_blocks(after)[0]
        order = [block.index(n) for n in ("outer_keep_first", "inner_keep_alpha", "inner_keep_beta", "outer_keep_last")]
        self.assertEqual(order, sorted(order))

    def test_public_methods_outside_wizard_sorted(self) -> None:
        """case_id=kevin-wizard-min — Wizard 外方法仍字母序"""
        path = FIXTURES / "kevin_wizard_section.h"
        _, after = _reorder_header_copy(path)
        get_apple = after.index("getApple")
        set_zebra = after.index("setZebra")
        self.assertLess(get_apple, set_zebra)

    def test_pnx_caa2_widget_decl_unchanged(self) -> None:
        """case_id=pnx-caa2-widget-min — CAA2 WIDGET DECLARATION 段不重排"""
        path = FIXTURES / "pnx_caa2_widget_decl.h"
        before, after = _reorder_header_copy(path)
        _assert_avoidance_blocks_unchanged(before, after)
        widgets = ["_FrameParams", "_LabelBaseCurve", "_SelectorListBaseCurve", "_SpinnerPointCount"]
        block = extract_avoidance_blocks(after)[0]
        order = [block.index(w) for w in widgets]
        self.assertEqual(order, sorted(order))

    @unittest.skipUnless(PNX_CURVE_DIVISION_H.is_file(), "PNXCaaStudy PNXCurveDivisionDlg.h fixture missing")
    def test_pnx_curve_division_dlg_widgets_unchanged(self) -> None:
        """case_id=pnx-curve-dlg — 完整 PNX 头文件 CAA2 控件段"""
        before, after = _reorder_header_copy(PNX_CURVE_DIVISION_H)
        _assert_avoidance_blocks_unchanged(before, after)
        self.assertIn("//CAA2 WIZARD WIDGET DECLARATION SECTION", after)
        self.assertIn("_SpinnerPointCount", after)

    @unittest.skipUnless(KT_PARAM_H.is_file(), "KtAlarmClockParam.h fixture missing")
    def test_kt_param_h_wizard_unchanged(self) -> None:
        """case_id=kt-param-h"""
        before, after = _reorder_header_copy(KT_PARAM_H)
        _assert_avoidance_blocks_unchanged(before, after)
        spans = find_avoidance_spans(before)
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].rule_id, "clang-format")
        members = ["WorkTime", "WorkBreak", "TimeForce", "TimeTotal", "WorkStep", "TimeCounter"]
        wizard_before = extract_avoidance_blocks(before)[0]
        wizard_after = extract_avoidance_blocks(after)[0]
        order_before = [wizard_before.index(m) for m in members]
        order_after = [wizard_after.index(m) for m in members]
        self.assertEqual(order_before, order_after)

    @unittest.skipUnless(KT_PARAM_H.is_file(), "KtAlarmClockParam.h fixture missing")
    def test_kt_param_h_crlf_preserves_public_sections(self) -> None:
        """case_id=kt-param-h-crlf — CRLF 行尾仍须识别全部 public: 段，函数在 Wizard 成员之前"""
        before = KT_PARAM_H.read_text(encoding="utf-8")
        crlf = before.replace("\r\n", "\n").replace("\n", "\r\n")
        with tempfile.TemporaryDirectory() as tmp:
            cp = Path(tmp) / "KtAlarmClockParam.h"
            cp.write_bytes(crlf.encode("utf-8"))
            reorder_header_file(cp, dry_run=False, sort_members=False)
            after = cp.read_text(encoding="utf-8")
        _assert_avoidance_blocks_unchanged(before.replace("\r\n", "\n"), after.replace("\r\n", "\n"))
        public_lines = [ln.strip() for ln in after.splitlines() if ln.strip().startswith("public")]
        self.assertEqual(
            public_lines,
            ["public:", "public: // functions", "public:"],
            "须保留 ctor / functions / Wizard 三个 public 段",
        )
        clear_pos = after.index("void clear();")
        work_time_pos = after.index("int WorkTime;")
        self.assertLess(clear_pos, work_time_pos, "函数须在 Wizard 成员变量之前")

    @unittest.skipUnless(KT_PARAM_H.is_file(), "KtAlarmClockParam.h fixture missing")
    def test_reorder_idempotent_kt_param_h(self) -> None:
        """case_id=kt-param-h-idempotent"""
        with tempfile.TemporaryDirectory() as tmp:
            cp = Path(tmp) / "KtAlarmClockParam.h"
            shutil.copy(KT_PARAM_H, cp)
            reorder_header_file(cp, dry_run=False, sort_members=False)
            once = cp.read_text(encoding="utf-8")
            changed, _ = reorder_header_file(cp, dry_run=True, sort_members=False)
            self.assertFalse(changed)
            self.assertEqual(cp.read_text(encoding="utf-8"), once)

    @unittest.skipUnless(KT_PARAM_CPP.is_file(), "KtAlarmClockParam.cpp fixture missing")
    def test_kt_param_cpp_wizard_blocks_unchanged(self) -> None:
        """case_id=kt-param-cpp"""
        before, after = _reorder_cpp_copy(KT_PARAM_CPP)
        _assert_avoidance_blocks_unchanged(before, after)
        self.assertIn(
            "//START KEVIN CAA WIZARD SECTION KtAlarmClockParam PARAM CONSTRUCTOR",
            after,
        )
        self.assertIn(
            ": WorkTime(2700)",
            after[after.index("PARAM CONSTRUCTOR") : after.index("PARAM DESTRUCTOR")],
        )

    def test_wizard_end_blank_line_before_next_member(self) -> None:
        """case_id=pnx-bom-param-min-blank — END 控制符与后续成员之间空行保留"""
        path = FIXTURES / "pnx_bom_analysis_param_min.h"
        before, after = _reorder_header_copy(path)
        _assert_avoidance_blocks_unchanged(before, after)
        end = "// END KEVIN CAA WIZARD SECTION PNXBomAnalysis PARAM DECLARATION"
        for text in (before, after):
            idx = text.index(end) + len(end)
            self.assertTrue(
                text[idx : idx + 4].startswith("\n\n"),
                msg=f"expected blank line after wizard END, got {text[idx : idx + 20]!r}",
            )
        self.assertLess(after.index("productItems"), after.index("errorMessage"))

    def test_kevin_system_code_segment_sorted_together(self) -> None:
        """case_id=pnx-bom-param-min-system — 段内字母序，输出不含 START/END 标记"""
        path = FIXTURES / "pnx_bom_analysis_param_min.h"
        before, after = _reorder_header_copy(path)
        self.assertNotIn("// KEVIN_SYSTEM_CODE START", after)
        self.assertNotIn("// KEVIN_SYSTEM_CODE END", after)
        sys_pos = after.index("public: // KEVIN_SYSTEM_CODE")
        err_pos = after.index("ConvertErrorListToString", sys_pos)
        conv_pos = after.index("convertJson", sys_pos)
        ver_pos = after.index("GetSoftwareVersion", sys_pos)
        self.assertLess(err_pos, conv_pos)
        self.assertLess(conv_pos, ver_pos)
        self.assertLess(after.index("getApple"), after.index("setZebra"))

    def test_kevin_system_code_merges_functions_section(self) -> None:
        """case_id=pnx-bom-param-system-split — 合并 // functions 内 @note/static，保留其它方法"""
        path = FIXTURES / "pnx_bom_param_system_split.h"
        before, after = _reorder_header_copy(path)
        self.assertNotIn("// KEVIN_SYSTEM_CODE START", after)
        block_start = after.index("public: // KEVIN_SYSTEM_CODE\n")
        fn_start = after.index("public: // functions\n", block_start)
        block = after[block_start:fn_start]
        fn_block = after[fn_start:after.index("};")]
        self.assertLess(block.index("ConvertErrorListToString"), block.index("convertJson"))
        self.assertLess(block.index("convertJson"), block.index("GetSoftwareVersion"))
        self.assertIn("CheckoutAxis", fn_block)
        self.assertNotIn("convertJson", fn_block)

    def test_pnx_bom_analysis_param_min_idempotent(self) -> None:
        """case_id=pnx-bom-param-min-idempotent"""
        path = FIXTURES / "pnx_bom_analysis_param_min.h"
        with tempfile.TemporaryDirectory() as tmp:
            cp = Path(tmp) / path.name
            shutil.copy(path, cp)
            reorder_header_file(cp, dry_run=False, sort_members=False)
            once = cp.read_text(encoding="utf-8")
            changed, _ = reorder_header_file(cp, dry_run=True, sort_members=False)
            self.assertFalse(changed)
            self.assertEqual(cp.read_text(encoding="utf-8"), once)

    @unittest.skip("待实现：PNXBomAnalysisCmd.cpp Wizard 段 + 可选 #pragma region VirtualFunction")
    def test_pnx_bom_analysis_cmd_min_pending(self) -> None:
        """case_id=pnx-bom-cmd-min-pending — fixture 见 pnx_bom_analysis_cmd_min.cpp"""
        self.assertTrue(PNX_BOM_CMD_MIN.is_file())
        before = PNX_BOM_CMD_MIN.read_text(encoding="utf-8")
        self.assertIn("START KEVIN CAA WIZARD SECTION PNXBomAnalysis CMD ACTION FIA", before)
        self.assertIn("END KEVIN CAA WIZARD SECTION PNXBomAnalysis CMD ACTION FIA", before)


if __name__ == "__main__":
    unittest.main()
