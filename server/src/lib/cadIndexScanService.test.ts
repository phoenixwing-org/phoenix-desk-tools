import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { scanCadWorkspaceIndex, startCadIndexScan, getCadIndexScan, cancelCadIndexScan, previewCadIndexReset, resetCadIndex } from "./cadIndexScanService.js";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-shared-index-")); roots.push(root);
  const part = path.join(root, "100.001-S-Bracket.FCStd");
  const xml = `<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties Count="1"><Property name="PartName"><String value="Embedded bracket"/></Property></Properties></Object></ObjectData></Document>`;
  fs.writeFileSync(part, zipSync({ "Document.xml": strToU8(xml) }));
  return { root, part };
}
function readRows(root: string) {
  const db = pnwCreateDb(phoenixDatabasePath(root));
  try { return [db.all("SELECT * FROM phoenix_cad_scan"), db.all("SELECT * FROM phoenix_cad_file_asset"), db.all("SELECT * FROM phoenix_cad_part_key")]; }
  finally { db.close(); }
}
describe("explicit shared CAD index service", () => {
  it("reports progress every ten files and flushes the final remainder", async () => {
    const { root, part } = fixture();
    for (let i = 1; i < 23; i++) fs.copyFileSync(part, path.join(root, `${i}.FCStd`));
    const progress: Array<{ phase: string; scanned: number }> = [];
    await scanCadWorkspaceIndex(root, { onProgress: value => progress.push(value) });
    expect(progress.filter(item => item.phase === "reading").map(item => item.scanned)).toEqual([10, 20]);
    expect(progress.at(-1)?.scanned).toBe(23);
  });
  it("backs up before explicit index reset, retains part records and can rebuild", async () => {
    const { root, part } = fixture(); const bytes = fs.readFileSync(part);
    await scanCadWorkspaceIndex(root);
    const before = readRows(root);
    const preview = previewCadIndexReset(root);
    expect(() => resetCadIndex(root, preview, false, () => {})).toThrow(/confirmation/);
    const result = resetCadIndex(root, preview, true, () => {});
    expect(fs.existsSync(result.backup)).toBe(true);
    expect(readRows(root)[1]).toEqual([]);
    expect(readRows(root)[2]).toEqual(before[2]);
    const backup = pnwCreateDb(result.backup);
    try { expect(backup.all("SELECT * FROM phoenix_cad_file_asset")).toEqual(before[1]); } finally { backup.close(); }
    expect(fs.readFileSync(part)).toEqual(bytes);
    await scanCadWorkspaceIndex(root);
    expect(readRows(root)[1]).toHaveLength(1);
  });
  it("indexes temporary FCStd through Wing without changing its bytes", async () => {
    const { root, part } = fixture(); const before = fs.readFileSync(part);
    const result = await scanCadWorkspaceIndex(root);
    expect(result).toMatchObject({ files: 1, parsedFiles: 1, scanId: 1 });
    expect(fs.readFileSync(part)).toEqual(before);
    expect(readRows(root)[1][0]).toMatchObject({ part_name: "Embedded bracket", file_status: "present" });
    expect(readRows(root)[0][0]).toMatchObject({ status: "done", phase: "ts-light-index" });
  });
  it("can update again after external property edits and rebuilds rule labels from target attributes", async () => {
    const { root, part } = fixture();
    const writeTarget = (name: string) => fs.writeFileSync(part, zipSync({ "Document.xml": strToU8(
      `<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties Count="2"><Property name="PartName"><String value="${name}"/></Property><Property name="Label"><String value="100.001-${name}"/></Property></Properties></Object></ObjectData></Document>`,
    ) }));
    const host = path.join(root, "root.ASSY.FCStd");
    fs.writeFileSync(host, zipSync({ "Document.xml": strToU8(
      `<Document><XLink file="100.001-S-Bracket.FCStd" label="装配实例"/></Document>`,
    ) }));
    const hostBytes = fs.readFileSync(host);
    writeTarget("支架");
    const first = await scanCadWorkspaceIndex(root);
    writeTarget("新支架");
    const targetBytes = fs.readFileSync(part);
    const second = await scanCadWorkspaceIndex(root);
    expect(second.scanId).toBeGreaterThan(first.scanId);
    const db = pnwCreateDb(phoenixDatabasePath(root));
    try {
      expect(db.get("SELECT link_label,rule_label,target_part_name,target_asset_label FROM phoenix_cad_bom_xref"))
        .toEqual({ link_label: "装配实例", rule_label: "100.001-新支架", target_part_name: "新支架", target_asset_label: "100.001-新支架" });
    } finally { db.close(); }
    expect(fs.readFileSync(part)).toEqual(targetBytes);
    expect(fs.readFileSync(host)).toEqual(hostBytes);
  });
  it("preserves a successful index on parse failure and cancellation", async () => {
    const { root } = fixture(); await scanCadWorkspaceIndex(root); const before = readRows(root);
    fs.writeFileSync(path.join(root, "broken.FCStd"), "not a ZIP");
    await expect(scanCadWorkspaceIndex(root)).rejects.toThrow(/原索引保持不变/);
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    await expect(scanCadWorkspaceIndex(root, { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(readRows(root)).toEqual(before);
  });
  it("rejects a late workspace switch or changed file snapshot", async () => {
    const { root, part } = fixture(); await scanCadWorkspaceIndex(root); const before = readRows(root);
    await expect(scanCadWorkspaceIndex(root, { onProgress(progress) {
      if (progress.phase === "checking") fs.appendFileSync(part, "changed");
    } })).rejects.toThrow(/改变/);
    expect(readRows(root)).toEqual(before);
    await expect(scanCadWorkspaceIndex(root, { assertActive() { throw new Error("workspace changed"); } })).rejects.toThrow("workspace changed");
  });
  it("does not migrate an incompatible existing schema", async () => {
    const { root } = fixture(); await scanCadWorkspaceIndex(root);
    const db = pnwCreateDb(phoenixDatabasePath(root));
    db.run("UPDATE phoenix_meta SET value='12' WHERE key='schema_version'"); db.close();
    const before = readRows(root);
    await expect(scanCadWorkspaceIndex(root)).rejects.toThrow(/不会自动迁移/);
    expect(readRows(root)).toEqual(before);
  });
  it("bounds jobs to their workspace and cancels without writing index", async () => {
    const { root } = fixture(); const other = fixture().root;
    const job = startCadIndexScan(root, () => {});
    expect(() => startCadIndexScan(root, () => {})).toThrow(/正在索引/);
    expect(() => getCadIndexScan(other, job.id)).toThrow(/不属于/);
    cancelCadIndexScan(root, job.id);
    for (let i = 0; i < 30 && getCadIndexScan(root, job.id).state === "running"; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(getCadIndexScan(root, job.id).state).toBe("cancelled");
    expect(fs.existsSync(phoenixDatabasePath(root))).toBe(false);
  });
});
