/** Native CAD boundary behavior for an absent workspace/index. */

import { describe, it, expect } from "vitest";
import { analyzeRenameReferences, applyRenameCorrections, loadRenameAnalysis, listRenameLogs } from "./pnwRenameService.js";
import { analyzeXlinkFix, runXlinkFix, applyXlinkFixOverride, listXlinkFixCandidates } from "./pnwXlinkFixService.js";
import { rebuildBomXrefs, ensureBomXrefBuilt, refreshBomXrefForHost } from "./pnwBomXrefService.js";

describe("native CAD empty-workspace behavior", () => {
  it("returns an empty rename analysis and rejects an empty apply selection", () => {
    const r1 = analyzeRenameReferences("", { old_basename: "OldPart", new_basename: "NewPart" });
    expect(r1.hosts).toEqual([]);
    expect(() => applyRenameCorrections("", {
      old_basename: "OldPart",
      new_basename: "NewPart",
      host_repo_rel_paths: [],
    })).toThrow(/at least one host/i);
    expect(() => loadRenameAnalysis("", 1)).toThrow(/not found/i);
    const r4 = listRenameLogs("");
    expect(r4.entries).toEqual([]);
  });

  it("returns index-pending XLink results for an absent workspace", () => {
    const r1 = analyzeXlinkFix("", {});
    expect(r1.issue_rows).toEqual([]);
    expect(r1.index_pending).toBe(true);
    const r2 = runXlinkFix("", {});
    expect(r2.total_changes).toBe(0);
    const r3 = applyXlinkFixOverride("", {});
    expect(r3.applied).toBe(0);
    const r4 = listXlinkFixCandidates("");
    expect(r4.candidates).toEqual([]);
  });

  it("returns index-pending BOM XRef results for an absent workspace", () => {
    const r1 = rebuildBomXrefs("");
    expect(r1.index_pending).toBe(true);
    expect(r1.edge_count).toBe(0);
    ensureBomXrefBuilt(""); // no throw
    const r2 = refreshBomXrefForHost("", "");
    expect(r2.hosts_refreshed).toBe(0);
    expect(r2.updated_hosts).toBe(0);
    expect(r2.edge_count).toBe(0);
  });
});
