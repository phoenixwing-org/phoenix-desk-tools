import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { afterEach, describe, expect, it } from "vitest";
import { scanCadWorkspaceIndex } from "./cadIndexScanService.js";
import { FCSTD_LIGHT_XML_BYTES } from "./fcstdBatchFiles.js";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-index-light-budget-")); roots.push(root); return root; }
function save(root: string, rel: string, xml: string, member = "Document.xml") { fs.writeFileSync(path.join(root, rel), zipSync({ [member]: strToU8(xml) })); }
describe("index read-only 32 MiB profile without quantity/role regression", () => {
  it("indexes an exact 32 MiB model and retains two physical instances and drawing dependency-only roles", async () => {
    const root = fixture(); save(root, "Leaf.FCStd", "<Document/>");
    const prefix = `<Document><Objects><Object name="Carrier" type="App::Part"/><Object name="Left" type="App::Link"/><Object name="Right" type="App::Link"/></Objects><ObjectData>
      <Object name="Carrier"><Properties><Property name="Group"><Link value="Left"/><Link value="Right"/></Property></Properties></Object>
      ${["Left", "Right"].map(name => `<Object name="${name}"><Properties><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="Leaf.FCStd" name="Body"/></Property></Properties></Object>`).join("")}</ObjectData>`;
    const suffix = "</Document>", xml = prefix + " ".repeat(FCSTD_LIGHT_XML_BYTES - Buffer.byteLength(prefix + suffix)) + suffix;
    save(root, "Carrier.ASSY.FCStd", xml, "document.XML");
    save(root, "Sheet.Drawing.FCStd", `<Document><Objects><Object name="View" type="TechDraw::DrawViewPart"/></Objects><ObjectData><Object name="View"><Properties><Property name="Source" type="App::PropertyXLinkList"><XLink file="Leaf.FCStd" name="Body"/><XLink file="Leaf.FCStd" name="Body"/></Property></Properties></Object></ObjectData></Document>`);
    const result = await scanCadWorkspaceIndex(root); expect(result).toMatchObject({ parsedFiles: 3, partial: false });
    const db = pnwCreateDb(phoenixDatabasePath(root));
    try {
      expect(db.all("SELECT quantity FROM phoenix_cad_bom_line WHERE assembly_rel='Carrier.ASSY.FCStd'")).toEqual([{ quantity: 2 }]);
      expect(db.all("SELECT quantity FROM phoenix_cad_bom_line WHERE assembly_rel='Sheet.Drawing.FCStd'")).toEqual([]);
      const rows = db.all<{ host_repo_rel_path: string; detail_json: string }>("SELECT host_repo_rel_path,detail_json FROM phoenix_cad_bom_xref");
      expect(rows.filter(row => row.host_repo_rel_path === "Carrier.ASSY.FCStd").map(row => JSON.parse(row.detail_json))).toEqual([expect.objectContaining({ quantity: 2 })]);
      expect(rows.filter(row => row.host_repo_rel_path === "Sheet.Drawing.FCStd").map(row => JSON.parse(row.detail_json))).toEqual([expect.objectContaining({ basic_bom: false, reference_role: "drawing_source" })]);
    } finally { db.close(); }
  });
  it("marks +1 XML as an explicit parse failure while healthy assets remain usable", async () => {
    const root = fixture(); save(root, "Healthy.FCStd", "<Document/>");
    save(root, "TooLarge.FCStd", `<Document>${" ".repeat(FCSTD_LIGHT_XML_BYTES - "<Document></Document>".length + 1)}</Document>`);
    const result = await scanCadWorkspaceIndex(root); expect(result).toMatchObject({ parsedFiles: 1, partial: true, failed_count: 1 });
    expect(result.failures).toMatchObject([{ rel: "TooLarge.FCStd", message: expect.stringContaining("32 MiB") }]);
  });
});
