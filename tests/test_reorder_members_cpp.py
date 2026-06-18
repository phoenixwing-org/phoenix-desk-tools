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


if __name__ == "__main__":
    unittest.main()
