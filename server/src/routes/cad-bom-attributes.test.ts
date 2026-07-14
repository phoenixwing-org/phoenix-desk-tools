import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

function makeTempRoot(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, rel: string, text: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
}

function configurePrefs(home: string, workspace: string) {
  const prefsDir = path.join(home, ".phoenix");
  fs.mkdirSync(prefsDir, { recursive: true });
  fs.writeFileSync(
    path.join(prefsDir, "launcher-prefs.json"),
    JSON.stringify({ recent_workspaces: [workspace], freecad_dir: "", workspace }, null, 2),
    "utf8",
  );
}

async function importCadRoutes(home: string, workspace: string) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  configurePrefs(home, workspace);
  vi.resetModules();
  return import("./cad.js");
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("cad BOM attribute routes", () => {
  it("serves preview, prefs, recommendations, fills, document kinds, and filename recommendation natively", async () => {
    const home = makeTempRoot("cad-bom-attrs-home-");
    const workspace = makeTempRoot("cad-bom-attrs-ws-");
    const rel = "parts/100003.002-S-M6X12Bolt.FCStd";
    writeFile(workspace, rel, "not a real fcstd zip\n");
    writeFile(workspace, "parts/OldPart.FCStd", "not a real fcstd zip\n");

    const { cadRoutes } = await importCadRoutes(home, workspace);

    const previewRes = await cadRoutes.request(`/bom/file?rel=${encodeURIComponent(rel)}`);
    expect(previewRes.status).toBe(200);
    const preview = await previewRes.json();
    expect(preview.fields.PartNumber).toBe("100003");
    expect(preview.fields.PartName).toBe("M6X12Bolt");
    expect(preview.document_kinds.part).toBe(true);
    expect(preview).not.toHaveProperty("_proxy");
    expect(preview).not.toHaveProperty("_stub");

    const prefsRes = await cadRoutes.request("/bom/prefs");
    expect(prefsRes.status).toBe(200);
    await expect(prefsRes.json()).resolves.toMatchObject({
      recommended_fill: { PartVersion: "001", TypeCode: "H" },
    });

    const recommendOneRes = await cadRoutes.request(
      `/bom/recommend-field?rel=${encodeURIComponent(rel)}&field=PartNumber`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(recommendOneRes.status).toBe(200);
    await expect(recommendOneRes.json()).resolves.toMatchObject({
      field: "PartNumber",
      value: "100003",
      filled: true,
    });

    const recommendAllRes = await cadRoutes.request(`/bom/recommend-all-fields?rel=${encodeURIComponent(rel)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(recommendAllRes.status).toBe(200);
    const recommendAll = await recommendAllRes.json();
    expect(recommendAll.filled_keys).toContain("label");
    expect(recommendAll.results.filename.value).toBe("100003.002-S-M6X12Bolt.FCStd");

    const fillRecommendedRes = await cadRoutes.request(`/bom/fill-recommended-values?rel=${encodeURIComponent(rel)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ PartName: "Bolt" }),
    });
    expect(fillRecommendedRes.status).toBe(200);
    const fillRecommended = await fillRecommendedRes.json();
    expect(fillRecommended.filled_keys).toEqual(["PartVersion", "TypeCode"]);
    expect(fillRecommended.fields.PartName).toBe("Bolt");

    const fillFilenameRes = await cadRoutes.request(`/bom/fill-from-filename?rel=${encodeURIComponent(rel)}`, {
      method: "POST",
    });
    expect(fillFilenameRes.status).toBe(200);
    await expect(fillFilenameRes.json()).resolves.toMatchObject({
      fields: { TypeCode: "S", PartName: "M6X12Bolt" },
    });

    const labelRes = await cadRoutes.request(`/bom/apply-label-formula?rel=${encodeURIComponent(rel)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        PartNumber: "100003",
        PartVersion: "002",
        PartName: "M6X12Bolt",
        fill_empty_from_prefs: false,
      }),
    });
    expect(labelRes.status).toBe(200);
    await expect(labelRes.json()).resolves.toMatchObject({ label: "100003.002-M6X12Bolt" });

    const kindsRes = await cadRoutes.request(`/bom/document-kinds?rel=${encodeURIComponent("asm/Asm.ASSY.FCStd")}`);
    expect(kindsRes.status).toBe(200);
    await expect(kindsRes.json()).resolves.toMatchObject({
      document_kinds: { assembly: true, recommended_suffix: ".ASSY.FCStd" },
    });

    const filenameRes = await cadRoutes.request(`/bom/recommend-filename?rel=${encodeURIComponent("asm/custom.ASSY.FCStd")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        PartNumber: "200001",
        PartVersion: "001",
        TypeCode: "H",
        ModelSeries: "MDL",
        PartName: "Cover",
      }),
    });
    expect(filenameRes.status).toBe(200);
    await expect(filenameRes.json()).resolves.toMatchObject({
      recommended_filename: "200001.001-H-MDL-Cover.ASSY.FCStd",
      matches_disk_name: false,
    });

    const renameRes = await cadRoutes.request("/bom/rename?rel=parts%2FOldPart.FCStd", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "NewPart.FCStd",
        baseline: { PartName: "OldPart" },
        PartName: "OldPart",
      }),
    });
    expect(renameRes.status).toBe(200);
    const renamed = await renameRes.json();
    expect(renamed).toMatchObject({
      rel_path: "parts/NewPart.FCStd",
      filename: "NewPart.FCStd",
      attrs_saved: false,
    });
    expect(renamed).not.toHaveProperty("_proxy");
    expect(renamed).not.toHaveProperty("_stub");
    expect(fs.existsSync(path.join(workspace, "parts/NewPart.FCStd"))).toBe(true);
  });
});
