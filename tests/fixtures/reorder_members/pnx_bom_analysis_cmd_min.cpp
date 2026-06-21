/**
 * Minimal excerpt from PNXBomAnalysisCmd.cpp (PNX BOM Analysis CAA command).
 * Source: PNXBomAnalysisWsp/PNXBomAnalysisFrm/PNXBomAnalysisUI.m/src/PNXBomAnalysisCmd.cpp
 *
 * case_id=pnx-bom-cmd-min-pending
 * Status: fixture only — regression tests not wired yet.
 *
 * Intended later coverage:
 * - Kevin CAA Wizard blocks inside member function bodies (.cpp)
 * - Manual code between Wizard END and following statements
 * - Optional: #pragma region VirtualFunction (see doc — 待研究)
 */
#include "PNXBomAnalysisCmd.h"

//-----------------------------------------------------------------------------
CATBoolean PNXBomAnalysisCmd::ActionSelectorListPda(void* data) {
    int field = CATPtrToINT32(data);

    // START KEVIN CAA WIZARD SECTION PNXBomAnalysis CMD ACTION PDA

    // clang-format off
    // Field count = 0

    // clang-format on
    // END KEVIN CAA WIZARD SECTION PNXBomAnalysis CMD ACTION PDA

    if (fieldChange) fiaAgentUpdate();

    return TRUE;
}
//-----------------------------------------------------------------------------
CATBoolean PNXBomAnalysisCmd::ActionSelectorListFia(void*) {
    if (NULL == _pfiaElementSelect) return CATFalse;

    // START KEVIN CAA WIZARD SECTION PNXBomAnalysis CMD ACTION FIA

    // clang-format off
    int count = 0;

    // clang-format on
    // END KEVIN CAA WIZARD SECTION PNXBomAnalysis CMD ACTION FIA

    AfterValueChange();
    return TRUE;
}
//-----------------------------------------------------------------------------
void PNXBomAnalysisCmd::fiaAgentClear() {
    // START KEVIN CAA WIZARD SECTION PNXBomAnalysis CMD AGENT FIA CLEAR

    // clang-format off

    // clang-format on
    // END KEVIN CAA WIZARD SECTION PNXBomAnalysis CMD AGENT FIA CLEAR
}
//-----------------------------------------------------------------------------
void PNXBomAnalysisCmd::fiaAgentUpdate() {
    fiaAgentClear();

    // START KEVIN CAA WIZARD SECTION PNXBomAnalysis CMD AGENT UPDATE STATE

    // clang-format off
    // Field count = 0

    // clang-format on
    // END KEVIN CAA WIZARD SECTION PNXBomAnalysis CMD AGENT UPDATE STATE
}
//-----------------------------------------------------------------------------
CATBoolean PNXBomAnalysisCmd::ActionValueChange(void*) {
    daValueChange_->InitializeAcquisition();
    AfterValueChange();
    return TRUE;
}
