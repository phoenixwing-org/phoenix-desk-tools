import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyBomLabelFormula,
  fillBomFromEmbedded,
  fillBomFromFilename,
  fillRecommendedValues,
  inferBomDocumentKinds,
  inferBomFieldsFromFilename,
  loadBomApplyPrefs,
  loadBomPreview,
  readBomDocumentKinds,
  recommendBomField,
  recommendBomFieldsAll,
  recommendBomFilename,
  rememberBomApplyPrefs,
  renameBomFcstdFile,
} from "./bomAttributeService.js";
import {
  runFcstdMapScan,
  searchFcstdMapEntries,
} from "./pnwFcstdMapService.js";

const tempRoots: string[] = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bom-attrs-"));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, rel: string, text: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("bomAttributeService", () => {
  it("infers BOM fields and document kinds from FreeCAD filenames", () => {
    const fields = inferBomFieldsFromFilename("parts/100003.002-S-M6X12Bolt.FCStd");

    expect(fields).toMatchObject({
      repo_rel_path: "parts/100003.002-S-M6X12Bolt.FCStd",
      filename: "100003.002-S-M6X12Bolt.FCStd",
      PartNumber: "100003",
      PartVersion: "002",
      TypeCode: "S",
      ModelSeries: "",
      PartName: "M6X12Bolt",
      label: "100003.002-M6X12Bolt",
    });

    expect(inferBomDocumentKinds("asm/100010.001-H-MDL-Widget.ASSY.FCStd")).toMatchObject({
      part: false,
      assembly: true,
      drawing: false,
      recommended_suffix: ".ASSY.FCStd",
    });
    expect(inferBomDocumentKinds("draw/100010.001-H-MDL-Widget.Drawing.FCStd")).toMatchObject({
      drawing: true,
      recommended_suffix: ".Drawing.FCStd",
    });
  });

  it("loads a front-end compatible preview without Python", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "parts/100003.002-S-M6X12Bolt.FCStd", "not a real fcstd zip\n");

    const preview = loadBomPreview(workspace, "parts/100003.002-S-M6X12Bolt.FCStd");

    expect(preview.rel_path).toBe("parts/100003.002-S-M6X12Bolt.FCStd");
    expect(preview.is_fcstd).toBe(true);
    expect(preview.fields.PartNumber).toBe("100003");
    expect(preview.fields.PartName).toBe("M6X12Bolt");
    expect(preview.document_kinds).toMatchObject({ part: true, recommended_suffix: ".FCStd" });
    expect(preview.abs_path_display).toBe("./parts/100003.002-S-M6X12Bolt.FCStd");
    expect(preview.file_size_bytes).toBeGreaterThan(0);
    expect(preview.file_size_display).toContain("B");
  });

  it("remembers workspace fill values and recommends individual or all fields", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "parts/100003.002-S-M6X12Bolt.FCStd", "not a real fcstd zip\n");
    rememberBomApplyPrefs(workspace, {
      PartNumber: "000099",
      PartVersion: "003",
      TypeCode: "H",
      ModelSeries: "MDL",
    });

    const prefs = loadBomApplyPrefs(workspace);
    expect(prefs.recommended_fill).toEqual({
      PartNumber: "000100",
      PartVersion: "003",
      TypeCode: "H",
      ModelSeries: "MDL",
    });

    const filled = fillRecommendedValues(workspace, "parts/blank.FCStd", { PartName: "Bracket" });
    expect(filled.filled_keys).toEqual(["PartNumber", "PartVersion", "TypeCode", "ModelSeries"]);
    expect(filled.fields.PartNumber).toBe("000100");
    expect(filled.fields.PartName).toBe("Bracket");

    expect(recommendBomField(workspace, "parts/100003.002-S-M6X12Bolt.FCStd", "PartNumber", {}).value)
      .toBe("100003");
    expect(recommendBomField(
      workspace,
      "parts/100003.002-S-M6X12Bolt.FCStd",
      "ModelSeries",
      { TypeCode: "S" },
    )).toMatchObject({ filled: true, value: "" });

    const all = recommendBomFieldsAll(workspace, "parts/100003.002-S-M6X12Bolt.FCStd", {});
    expect(all.filled_keys).toEqual([
      "PartNumber",
      "PartVersion",
      "TypeCode",
      "ModelSeries",
      "PartName",
      "label",
      "filename",
    ]);
    expect(all.results.label.value).toBe("100003.002-M6X12Bolt");
    expect(all.results.filename.value).toBe("100003.002-S-M6X12Bolt.FCStd");
  });

  it("fills from filename/embedded preview and composes labels and filenames", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "asm/200001.001-H-MDL-Cover.ASSY.FCStd", "not a real fcstd zip\n");

    expect(fillBomFromFilename(workspace, "asm/200001.001-H-MDL-Cover.ASSY.FCStd").fields)
      .toMatchObject({ PartNumber: "200001", ModelSeries: "MDL", PartName: "Cover" });

    const embedded = fillBomFromEmbedded(workspace, "asm/200001.001-H-MDL-Cover.ASSY.FCStd", {
      PartName: "KeepOnlyIfNoPreview",
    });
    expect(embedded.fields.PartName).toBe("Cover");
    expect(embedded.document_kinds).toMatchObject({ assembly: true });

    expect(applyBomLabelFormula(workspace, "asm/custom.FCStd", {
      PartNumber: "200001",
      PartVersion: "001",
      PartName: "Cover",
    }, false)).toMatchObject({ label: "200001.001-Cover" });

    const recommended = recommendBomFilename(workspace, "asm/custom.ASSY.FCStd", {
      PartNumber: "200001",
      PartVersion: "001",
      TypeCode: "H",
      ModelSeries: "MDL",
      PartName: "Cover",
    });
    expect(recommended.recommended_filename).toBe("200001.001-H-MDL-Cover.ASSY.FCStd");
    expect(recommended.matches_disk_name).toBe(false);

    expect(readBomDocumentKinds(workspace, "asm/custom.ASSY.FCStd").document_kinds)
      .toMatchObject({ assembly: true, recommended_suffix: ".ASSY.FCStd" });
  });

  it("renames FCStd files, records the rename, and updates the fcstd map when present", async () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "parts/OldPart.FCStd", "not a real fcstd zip\n");
    runFcstdMapScan(workspace);

    await expect(renameBomFcstdFile(workspace, "parts/OldPart.FCStd", {
      filename: "Blocked.FCStd",
      baseline: { PartName: "OldPart" },
      PartName: "Changed",
    })).rejects.toThrow(/unsaved changes/);
    expect(fs.existsSync(path.join(workspace, "parts/OldPart.FCStd"))).toBe(true);

    const renamed = await renameBomFcstdFile(workspace, "parts/OldPart.FCStd", {
      filename: "NewPart.FCStd",
      baseline: { PartName: "OldPart" },
      PartName: "OldPart",
    });

    expect(renamed).toMatchObject({
      rel_path: "parts/NewPart.FCStd",
      filename: "NewPart.FCStd",
      map_updated: true,
      attrs_saved: false,
    });
    expect(fs.existsSync(path.join(workspace, "parts/NewPart.FCStd"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "parts/OldPart.FCStd"))).toBe(false);

    const entries = searchFcstdMapEntries(workspace, { kind: "fcstd", limit: 10 });
    expect(entries.entries[0].repo_rel_path).toBe("./parts/NewPart.FCStd");
  });
});
