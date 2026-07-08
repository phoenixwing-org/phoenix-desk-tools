/** pdtCadStub — 验证 stub 覆盖的 CAD 函数不崩溃
 *  对应 Python: test_bom_apply_prefs/bom_recommend/bom_rename
 *              test_xlink_fix_service/test_rename_ref_fix
 */

import { describe, it, expect } from "vitest";
import { analyzeRenameReferences, applyRenameCorrections, loadRenameAnalysis, listRenameLogs } from "./pnwRenameService";
import { analyzeXlinkFix, runXlinkFix, applyXlinkFixOverride, listXlinkFixCandidates } from "./pnwXlinkFixService";
import { rebuildBomXrefs, ensureBomXrefBuilt, refreshBomXrefForHost } from "./pnwBomXrefService";

describe("pdtCadStub — stub 函数不崩溃", () => {
  it("rename 函数返回空不崩溃", () => {
    const r1 = analyzeRenameReferences("", "", "");
    expect(r1.hosts).toEqual([]);
    const r2 = applyRenameCorrections("", []);
    expect(r2.applied).toBe(0);
    const r3 = loadRenameAnalysis("", 1);
    expect(r3.hosts).toEqual([]);
    const r4 = listRenameLogs("");
    expect(r4.entries).toEqual([]);
  });

  it("xlink_fix 函数返回空不崩溃", () => {
    const r1 = analyzeXlinkFix("", {});
    expect(r1.hosts).toEqual([]);
    const r2 = runXlinkFix("", {});
    expect(r2.fixed).toBe(0);
    const r3 = applyXlinkFixOverride("", {});
    expect(r3.applied).toBe(0);
    const r4 = listXlinkFixCandidates("");
    expect(r4.candidates).toEqual([]);
  });

  it("bom_xref 写函数返回 stub", () => {
    const r1 = rebuildBomXrefs("");
    expect(r1._stub).toBe(true);
    ensureBomXrefBuilt(""); // no throw
    const r2 = refreshBomXrefForHost("", "");
    expect(r2._stub).toBe(true);
  });
});
