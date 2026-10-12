import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, it } from "vitest";
import { cadRoutes } from "./cad.js";
import { scanCadWorkspaceIndex } from "../lib/cadIndexScanService.js";
import { phoenixDatabasePath } from "../lib/phoenixDatabaseService.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-migration-routes-")); roots.push(root);
  const rel = "probe.FCStd";
  const xml = '<Document><Objects><Object name="Probe" type="PartDesign::Body"/></Objects><ObjectData><Object name="Probe"><Properties Count="2"><Property name="Label"><String value="Probe bracket"/></Property><Property name="PartName"><String value="Probe bracket"/></Property></Properties></Object></ObjectData></Document>';
  fs.writeFileSync(path.join(root, rel), zipSync({ "Document.xml": strToU8(xml) }));
  return { root, rel };
}
it("mounts file search and static objects through canonical CAD routes without writing", async () => {
  const { root, rel } = fixture();
  await scanCadWorkspaceIndex(root);
  const model = fs.readFileSync(path.join(root, rel)); const database = fs.readFileSync(phoenixDatabasePath(root));
  const search = await cadRoutes.request(`/index/search?workspace=${encodeURIComponent(root)}&q=bracket`);
  expect(search.status).toBe(200);
  expect(await search.json()).toMatchObject({ source: "sqlite", rows: [{ repo_rel_path: rel, part_name: "Probe bracket" }] });
  const objects = await cadRoutes.request("/object-info", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspacePath: root, filePath: rel }) });
  expect(objects.status).toBe(200);
  expect(await objects.json()).toMatchObject({ success: true, data: { document: { objects: [{ name: "Probe", label: "Probe bracket", type_id: "PartDesign::Body" }] } } });
  expect(fs.readFileSync(path.join(root, rel))).toEqual(model);
  expect(fs.readFileSync(phoenixDatabasePath(root))).toEqual(database);
});
it("reports missing search index and invalid object input rather than placeholder success", async () => {
  const { root } = fixture();
  const response = await cadRoutes.request(`/index/search?workspace=${encodeURIComponent(root)}&q=none`);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "index_missing" });
  const objects = await cadRoutes.request("/object-info", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  expect(objects.status).toBe(400);
  expect(await objects.json()).toMatchObject({ success: false, code: "invalid_arguments" });
  expect(fs.readdirSync(root)).toEqual(["probe.FCStd"]);
});
