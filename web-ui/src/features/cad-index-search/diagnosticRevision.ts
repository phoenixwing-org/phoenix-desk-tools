import type { CadIndexDiagnostics } from "../../api";

/** A confirmed diagnostic version, not the last *successful* scan time. */
export function cadIndexSearchRefreshToken(diagnostics: CadIndexDiagnostics | null | undefined): string | undefined {
  if (!diagnostics) return undefined; // Refresh loading is not an index mutation.
  const latest = diagnostics.latestScan;
  // Current servers supply the monotonic scan ID for full/partial/reset writes.
  // Stable metadata also detects state/schema changes; old responses without ID
  // remain usable, but cannot certify distinct scans with identical metadata.
  return [diagnostics.state, diagnostics.schemaVersion ?? "unknown", diagnostics.expectedSchemaVersion,
    diagnostics.totalEntries, diagnostics.missingEntries, latest?.id ?? "no-id",
    latest?.status ?? "no-scan", latest?.root ?? "", latest?.at ?? ""]
    .map(value => encodeURIComponent(String(value))).join("|");
}
