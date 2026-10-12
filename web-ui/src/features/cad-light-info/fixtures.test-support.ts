import type { CadLightInfoResult } from "./types";
/** Independent transport metadata only; no engineering inventory or geometry. */
export function syntheticLightInfo(): CadLightInfoResult {
  return {
    analysis: { documentXmlBytes: 240, objectCount: 2, xlinks: [{ file: "components/child.FCStd", label: "Saved instance" }], embeddedFields: { PartName: "Synthetic metadata", label: "", TypeCode: "generic" } },
    diagnostics: { items: [{ file: "components/child.FCStd", label: "Saved instance", status: "resolved", targetRelativePath: "components/child.FCStd", candidates: ["components/child.FCStd"], message: "Immediate file match" }], counts: { resolved: 1, ambiguous: 0, missing: 0, self: 0, non_fcstd: 0 } },
    source: { file_size: 120, mtime_ms: 1 }, warnings: [],
  };
}
