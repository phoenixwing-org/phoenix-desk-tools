import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { scanCadWorkspaceIndex, startCadIndexScan, getCadIndexScan, cancelCadIndexScan, previewCadIndexReset, resetCadIndex } from "./cadIndexScanService.js";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";
import { galleryOptions, startGalleryJob, galleryJob, loadGallery } from "../features/part-gallery/service.js";

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
  it("indexes a Unicode native assembly identity without rewriting the source archive", async () => {
    const { root } = fixture();
    const filename = "GenericAssembly.FCStd", file = path.join(root, filename);
    const xml = '<Document><Objects><Object name="示例总成" type="Assembly::AssemblyObject"/></Objects><ObjectData><Object name="示例总成"><Properties><Property name="PartName" type="App::PropertyString"><String value="Generic assembly"/></Property></Properties></Object></ObjectData></Document>';
    fs.writeFileSync(file, zipSync({ "Document.xml": strToU8(xml) }));
    const before = fs.readFileSync(file);
    const result = await scanCadWorkspaceIndex(root);
    expect(result).toMatchObject({ files: 2, parsedFiles: 2 });
    expect(readRows(root)[1]).toEqual(expect.arrayContaining([expect.objectContaining({ filename, part_name: "Generic assembly", file_status: "present" })]));
    expect(fs.readFileSync(file)).toEqual(before);
  });

  it("stores distinct AssemblyLink Rigid states in bom_json and refreshes them without saving CAD", async () => {
    const { root } = fixture(); const rel = "Synthetic.ASSY.FCStd"; const file = path.join(root, rel);
    const model = (value: string) => `<Document><Objects><Object name="Assembly" type="Assembly::AssemblyObject"/><Object name="Stage" type="Assembly::AssemblyLink"/></Objects><ObjectData>
      <Object name="Assembly"><Properties><Property name="Group" type="App::PropertyLinkList"><LinkList count="1"><Link value="Stage"/></LinkList></Property></Properties></Object>
      <Object name="Stage"><Properties><Property name="Label" type="App::PropertyString"><String value="Stage"/></Property><Property name="Rigid" type="App::PropertyBool"><Bool value="${value}"/></Property></Properties></Object></ObjectData></Document>`;
    const saved = () => {
      const db = pnwCreateDb(phoenixDatabasePath(root));
      try { return JSON.parse(db.get<{ bom_json: string }>("SELECT bom_json FROM phoenix_cad_file_asset WHERE filename=?", [rel])!.bom_json).assembly_links; }
      finally { db.close(); }
    };
    for (const [value, expected] of [["true", true], ["false", false], ["invalid", null]] as const) {
      fs.writeFileSync(file, zipSync({ "Document.xml": strToU8(model(value)) }));
      const before = fs.readFileSync(file);
      await scanCadWorkspaceIndex(root);
      expect(saved()).toEqual([{ object_name: "Stage", label: "Stage", target_object_name: null, target_file: null, rigid: expected }]);
      expect(fs.readFileSync(file)).toEqual(before);
    }
  });
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
  it("commits archive content and actual document-role proofs without changing Schema v13", async () => {
    const { root, part } = fixture();
    const drawing = path.join(root, "UnmarkedSheet.FCStd");
    fs.writeFileSync(drawing, zipSync({ "Document.xml": strToU8(`<Document><Objects><Object name="Page" type="TechDraw::DrawPage"/></Objects><ObjectData><Object name="Page"><Properties/></Object></ObjectData></Document>`) }));
    await scanCadWorkspaceIndex(root);
    const db = pnwCreateDb(phoenixDatabasePath(root));
    try {
      expect(db.get("SELECT value FROM phoenix_meta WHERE key='schema_version'")).toEqual({ value: "13" });
      for (const file of [part, drawing]) {
        const row = db.get<{ bom_json: string }>("SELECT bom_json FROM phoenix_cad_file_asset WHERE filename=?", [path.basename(file)])!;
        expect(JSON.parse(row.bom_json)).toMatchObject({ source_sha256: `sha256:${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`,
          document_role: file === drawing ? "drawing" : "model" });
      }
    } finally { db.close(); }
  });
  it("replaces a prior content proof after a fresh complete scan", async () => {
    const { root, part } = fixture();
    await scanCadWorkspaceIndex(root);
    const before = JSON.parse((readRows(root)[1][0] as { bom_json: string }).bom_json).source_sha256;
    fs.writeFileSync(part, zipSync({ "Document.xml": strToU8("<Document/>") }));
    await scanCadWorkspaceIndex(root);
    const after = JSON.parse((readRows(root)[1][0] as { bom_json: string }).bom_json).source_sha256;
    expect(after).not.toBe(before);
    expect(after).toBe(`sha256:${createHash("sha256").update(fs.readFileSync(part)).digest("hex")}`);
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
    await expect(scanCadWorkspaceIndex(root, { continueOnParseError: false })).rejects.toThrow(/原索引保持不变/);
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    await expect(scanCadWorkspaceIndex(root, { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(readRows(root)).toEqual(before);
  });
  it("builds a usable partial index from healthy files even on the first scan", async () => {
    const { root, part } = fixture();
    const broken = path.join(root, "Broken.FCStd");
    fs.writeFileSync(broken, "not a ZIP");
    const bytes = [fs.readFileSync(part), fs.readFileSync(broken)];
    const result = await scanCadWorkspaceIndex(root);
    expect(result).toMatchObject({ files: 2, parsedFiles: 1, partial: true, failed_count: 1 });
    expect(result.failures).toMatchObject([{ rel: "Broken.FCStd" }]);
    const [scans, assets] = readRows(root);
    expect(scans[0]).toMatchObject({ status: "partial" });
    expect(assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ file_status: "present", part_name: "Embedded bracket" }),
      expect.objectContaining({ file_status: "error", filename: "Broken.FCStd" }),
    ]));
    expect(JSON.parse((assets.find(asset => (asset as { file_status: string }).file_status === "present") as { bom_json: string }).bom_json))
      .toMatchObject({ document_role: "model", source_sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) });
    expect(JSON.parse((assets.find(asset => (asset as { file_status: string }).file_status === "error") as { bom_json: string }).bom_json))
      .not.toHaveProperty("source_sha256");
    expect(galleryOptions(root).indexed_files).toBe(1);
    const job = startGalleryJob(root);
    for (let i = 0; i < 100 && galleryJob(root, job.id).state === "running"; i++) await new Promise(resolve => setTimeout(resolve, 5));
    // The synthetic healthy CAD intentionally has no embedded image: its card
    // is still usable, with the ordinary missing-thumbnail attention state.
    expect(galleryJob(root, job.id).state).toBe("attention");
    expect(loadGallery(root).rows).toHaveLength(1);
    expect([fs.readFileSync(part), fs.readFileSync(broken)]).toEqual(bytes);
    fs.writeFileSync(broken, zipSync({ "Document.xml": strToU8("<Document/>") }));
    const repaired = await scanCadWorkspaceIndex(root);
    expect(repaired).toMatchObject({ partial: false, parsedFiles: 2, failed_count: 0, failures: [] });
    expect(readRows(root)[0].at(-1)).toMatchObject({ status: "done" });
    expect(galleryOptions(root).indexed_files).toBe(2);
  });
  it("still rejects changed failed-file snapshots and unsafe discovery instead of committing partial coverage", async () => {
    const { root } = fixture();
    await scanCadWorkspaceIndex(root);
    const before = readRows(root);
    const broken = path.join(root, "Broken.FCStd");
    fs.writeFileSync(broken, "bad ZIP");
    await expect(scanCadWorkspaceIndex(root, { onProgress(progress) {
      if (progress.phase === "checking") fs.appendFileSync(broken, "changed");
    } })).rejects.toThrow(/改变/);
    expect(readRows(root)).toEqual(before);
    fs.symlinkSync("missing-target", path.join(root, "Unsafe.FCStd"));
    await expect(scanCadWorkspaceIndex(root)).rejects.toThrow(/符号链接/);
    expect(readRows(root)).toEqual(before);
  });
  it("indexes drawing XSource lists as dependencies without physical BOM rows", async () => {
    const { root, part } = fixture();
    const drawing = path.join(root, "Sheet.Drawing.FCStd");
    const xml = `<Document><Objects><Object name="Model" type="App::Link"/>
      <Object name="Group" type="TechDraw::DrawProjGroup"/><Object name="Front" type="TechDraw::DrawProjGroupItem"/>
      <Object name="Side" type="TechDraw::DrawProjGroupItem"/></Objects><ObjectData>
      <Object name="Model"><Properties><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="100.001-S-Bracket.FCStd" name="Body"/></Property></Properties></Object>
      ${["Group", "Front", "Side"].map(name => `<Object name="${name}"><Properties><Property name="XSource" type="App::PropertyXLinkList"><XLink file="100.001-S-Bracket.FCStd" name="Body"/></Property></Properties></Object>`).join("")}
      </ObjectData></Document>`;
    fs.writeFileSync(drawing, zipSync({ "Document.xml": strToU8(xml) }));
    const before = [fs.readFileSync(part), fs.readFileSync(drawing)];
    expect(await scanCadWorkspaceIndex(root)).toMatchObject({ files: 2, references: 1, bomLines: 0 });
    const db = pnwCreateDb(phoenixDatabasePath(root));
    try {
      const rows = db.all<{ detail_json: string; target_repo_rel_path: string }>("SELECT detail_json,target_repo_rel_path FROM phoenix_cad_bom_xref");
      expect(rows).toHaveLength(1);
      expect(rows[0].target_repo_rel_path).toBe("100.001-S-Bracket.FCStd");
      expect(JSON.parse(rows[0].detail_json)).toMatchObject({ basic_bom: false, reference_role: "drawing_source" });
      expect(JSON.parse(rows[0].detail_json)).not.toHaveProperty("quantity");
      expect(db.all("SELECT * FROM phoenix_cad_bom_line")).toEqual([]);
      expect(db.all("SELECT * FROM phoenix_cad_xref_flat")).toHaveLength(1);
    } finally { db.close(); }
    expect([fs.readFileSync(part), fs.readFileSync(drawing)]).toEqual(before);
    const index = readRows(root);
    fs.writeFileSync(path.join(root, "Array.Drawing.FCStd"), zipSync({ "Document.xml": strToU8(
      `<Document><Objects><Object name="Page" type="TechDraw::DrawPage"/><Object name="Array" type="App::Link"/></Objects><ObjectData>
      <Object name="Array"><Properties><Property name="LinkedObject" type="App::PropertyXLinkList"><XLink file="100.001-S-Bracket.FCStd" name="Body"/></Property></Properties></Object></ObjectData></Document>`,
    ) }));
    await expect(scanCadWorkspaceIndex(root, { continueOnParseError: false })).rejects.toThrow(/multi-target.*unsupported/);
    expect(readRows(root)).toEqual(index);
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
