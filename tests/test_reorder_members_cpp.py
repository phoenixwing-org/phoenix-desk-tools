"""reorder_members .cpp 扫描与排序。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from phoenix.code.reorder_members import reorder_cpp_file

KT_ALARM_CLOCK_CORE_CPP = """\
/**
 * @copyright   Shanghai Kuntai Software Technology Co., Ltd. 2022
 * @file        KtAlarmClockCore.cpp
 */
#include <QDebug>
#include "KtAlarmClockCore.h"
#include "KtAlarmClockParam.h"

//------------------------------------------------
KtAlarmClockCore::KtAlarmClockCore()
    : parameter(nullptr)
    , m_Pretreat(KT_E_FAIL) {
    // qDebug() << "KtAlarmClockCore::KtAlarmClockCore()";
}
//------------------------------------------------
KtAlarmClockCore::~KtAlarmClockCore() {
    parameter = nullptr; // outside
}
//------------------------------------------------
int KtAlarmClockCore::pretreat() {
    qDebug() << "KtAlarmClockCore::pretreat()";
    m_Pretreat = KT_E_FAIL;
    if (nullptr == parameter) {
        return m_Pretreat;
    }
    m_Pretreat = KT_E_UNEXPECTED; // unfinish
    return m_Pretreat;
}
//------------------------------------------------
int KtAlarmClockCore::calculate() {
    qDebug() << "KtAlarmClockCore::calculate()";
    if (m_Pretreat > KT_S_OK) {
        return m_Pretreat;
    }
    return KT_E_UNEXPECTED; // unfinish
}
"""

# 回归用例 fixture 目录
_FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "reorder_members"


class TestReorderMembersCpp(unittest.TestCase):
    def test_qdebug_in_body_does_not_split_blocks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "KtAlarmClockCore.cpp"
            path.write_text(KT_ALARM_CLOCK_CORE_CPP, encoding="utf-8")
            changed = reorder_cpp_file(path, dry_run=True)
            self.assertTrue(changed)
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("//----------------------------------------\n    qDebug()", text)
            self.assertNotIn(
                "//----------------------------------------\n    // qDebug()",
                text,
            )

    def test_reorder_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "KtAlarmClockCore.cpp"
            path.write_text(KT_ALARM_CLOCK_CORE_CPP, encoding="utf-8")
            self.assertTrue(reorder_cpp_file(path, dry_run=False))
            after_first = path.read_text(encoding="utf-8")
            self.assertFalse(reorder_cpp_file(path, dry_run=True))
            self.assertEqual(path.read_text(encoding="utf-8"), after_first)

    def test_alphabetical_member_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "KtAlarmClockCore.cpp"
            path.write_text(KT_ALARM_CLOCK_CORE_CPP, encoding="utf-8")
            reorder_cpp_file(path, dry_run=False)
            text = path.read_text(encoding="utf-8")
            calc = text.index("KtAlarmClockCore::calculate()")
            pret = text.index("KtAlarmClockCore::pretreat()")
            self.assertLess(calc, pret)

    def test_gbk_encoded_cpp_dry_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "GbSample.cpp"
            body = (
                "// comment with Chinese: 中文\n"
                "void GbSample::run() {}\n"
                "void GbSample::init() {}\n"
            )
            raw = body.encode("gbk")
            path.write_bytes(raw)
            self.assertIsNotNone(reorder_cpp_file(path, dry_run=True))
            self.assertEqual(path.read_bytes(), raw)

    # ------------------------------------------------------------------
    # 回归：注释分隔线 / 内部调用（fixture 隔离，不泄露 Xy 代码）
    # ------------------------------------------------------------------

    def test_annotation_sep_comments_not_absorbed(self) -> None:
        """注释分隔线（//---static---... 等）应保留为分隔线，不被吸收进函数块。"""
        src = (_FIXTURE_DIR / "annotation_sep.cpp").read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "annotation_sep.cpp"
            path.write_text(src, encoding="utf-8")
            reorder_cpp_file(path, dry_run=False)
            text = path.read_text(encoding="utf-8")
            # 跳过 Doxygen 头注释后检查排序结果
            doxy_end = text.index("*/")
            code_text = text[doxy_end + 2:]
            # 注释分隔线应保留在输出中作为函数间分隔（不因排序丢失）
            self.assertIn("//---static---", code_text)
            self.assertIn("//---INSIDE FUNCTION---", code_text)
            # 排序后 alpha 应在 compare 之前（字母序）
            alpha_pos = text.index("FooString::alpha()")
            compare_pos = text.index("FooString::compare(const")
            self.assertLess(alpha_pos, compare_pos)
            # 不应出现双分隔线（连续两条 //---...）
            lines = text.splitlines()
            for i in range(len(lines) - 1):
                if lines[i].startswith("//---") and lines[i + 1].startswith("//---"):
                    self.fail(
                        f"double separator at line {i}: {lines[i]!r} / {lines[i+1]!r}"
                    )
            # 幂等性：二次运行无变更
            self.assertFalse(reorder_cpp_file(path, dry_run=True))

    def test_internal_calls_not_extracted(self) -> None:
        """函数体内的 ClassName::method() 调用不应被提取为独立函数块。"""
        src = (_FIXTURE_DIR / "internal_calls.cpp").read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "internal_calls.cpp"
            path.write_text(src, encoding="utf-8")
            reorder_cpp_file(path, dry_run=False)
            text = path.read_text(encoding="utf-8")
            # ctor 体内调用 FooString::init(nullptr) + void FooString::init(…) 定义 = 共 2 处
            # 如果 init 被错误提取为独立块，会出现 3+ 处
            init_count = text.count("FooString::init")
            self.assertEqual(
                init_count, 2,
                f"expected 2 FooString::init (ctor body call + definition), got {init_count}",
            )
            # ctor 体内调用 safeDelete + safeDelete 定义 = 共 2 处
            safe_delete_count = text.count("FooString::safeDelete")
            self.assertEqual(
                safe_delete_count, 2,
                f"expected 2 FooString::safeDelete, got {safe_delete_count}",
            )
            # 三个真实函数定义都应在（函数定义行特征：返回值 + ClassName::name(）
            self.assertIn("FooString::FooString()", text)
            self.assertIn("void FooString::init(", text)
            self.assertIn("void FooString::safeDelete(", text)
            # 幂等性：二次运行无变更
            self.assertFalse(reorder_cpp_file(path, dry_run=True))

    # ------------------------------------------------------------------
    # 回归：} //--- 行尾粘连分隔符
    # ------------------------------------------------------------------

    def test_glued_sep_stripped_from_block_end(self) -> None:
        """} //--- 粘连分隔符应剥离到独立行，不重复补插。"""
        src = """\
KTCAutoHSO::KTCAutoHSO() {
}

int KTCAutoHSO::AddElement(CATISpecObject_var object) {
    return 1;
} //-----------------------------------------------------------------------------
int KTCAutoHSO::AddElement(const CATListValCATISpecObject_var& list) {
    return 2;
}
"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "glued_sep.cpp"
            path.write_text(src, encoding="utf-8")
            self.assertTrue(reorder_cpp_file(path, dry_run=False))
            text = path.read_text(encoding="utf-8")
            # } 不应粘连 //---
            self.assertNotIn("} //", text)
            # 分隔符独立一行
            self.assertIn("}\n//", text)
            # 没有相邻两行都是 //--- 分隔线
            lines = text.split("\n")
            for i in range(len(lines) - 1):
                both_sep = (
                    lines[i].strip().startswith("//-")
                    and lines[i + 1].strip().startswith("//-")
                )
                self.assertFalse(
                    both_sep,
                    f"双重分隔符 at line {i}: {lines[i]} / {lines[i+1]}",
                )
            # 幂等
            self.assertFalse(reorder_cpp_file(path, dry_run=True))


if __name__ == "__main__":
    unittest.main()
