import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, it } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { scanCadWorkspaceIndex, previewCadIndexReset, resetCadIndex } from "../../lib/cadIndexScanService.js";
import { refreshBomXrefForHost } from "../../lib/pnwBomXrefService.js";
import { phoenixDatabasePath } from "../../lib/phoenixDatabaseService.js";
import type { CadIndexDiagnostics } from "../../lib/cadIndexStatusService.js";
import { cadRoutes } from "../../routes/cad.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
async function diagnostics(root: string): Promise<CadIndexDiagnostics> {
  const response = await cadRoutes.request(`/index/status?workspace=${encodeURIComponent(root)}`);
  expect(response.status).toBe(200);
  return response.json();
}
function write(root: string, rel: string, xml: string) {
  fs.writeFileSync(path.join(root, rel), zipSync({ "Document.xml": strToU8(xml) }));
}

it("exposes real monotonically changing diagnostic IDs across full, partial, full and reset writes", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-search-revision-"))); roots.push(root);
  write(root, "Leaf.FCStd", "<Document/>");
  write(root, "Host.ASSY.FCStd", '<Document><XLink file="Leaf.FCStd" label="Synthetic instance"/></Document>');
  const first = await scanCadWorkspaceIndex(root);
  const ready = await diagnostics(root);
  expect(ready).toMatchObject({ state: "ready", latestScan: { id: first.scanId, status: "done" } });
  expect(await diagnostics(root)).toEqual(ready); // Read-only refresh does not invent a new version.

  refreshBomXrefForHost(root, "Host.ASSY.FCStd", { recursive: false });
  const partial = await diagnostics(root);
  expect(partial).toMatchObject({ state: "attention", lastScanAt: ready.lastScanAt, latestScan: { status: "stale" } });
  expect(partial.latestScan!.id).toBeGreaterThan(ready.latestScan!.id);

  const full = await scanCadWorkspaceIndex(root);
  const rescanned = await diagnostics(root);
  expect(rescanned).toMatchObject({ state: "ready", latestScan: { id: full.scanId, status: "done" } });
  expect(rescanned.latestScan!.id).toBeGreaterThan(partial.latestScan!.id);

  const reset = resetCadIndex(root, previewCadIndexReset(root), true, () => {});
  const cleared = await diagnostics(root);
  expect(cleared).toMatchObject({ state: "empty", totalEntries: 0, lastScanAt: "", latestScan: { id: reset.revision, status: "cleared" } });
  expect(cleared.latestScan!.id).toBeGreaterThan(rescanned.latestScan!.id);
  // The public response is the actual stored generation, including the reset marker.
  const db = pnwCreateDb(phoenixDatabasePath(root));
  try { expect(db.get("SELECT MAX(id) AS id FROM phoenix_cad_scan")).toEqual({ id: cleared.latestScan!.id }); }
  finally { db.close(); }
});
