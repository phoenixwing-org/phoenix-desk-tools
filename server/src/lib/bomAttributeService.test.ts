import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
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
  writeBomToFcstd,
} from "./bomAttributeService.js";
import { ensurePhoenixDatabase } from "./phoenixDatabaseService.js";

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
  it("preserves explicitly cleared properties after save/reload despite filename, alias, memory and index hints", async () => {
    const root = makeTempRoot(); const rel = "720421.003-H-DEMO-PLATE.FCStd";
    const props = { PartNumber: "720421", PartVersion: "003", TypeCode: "H", ModelSeries: "DEMO", PartName: "测试面板", Label: "测试标签" };
    fs.writeFileSync(path.join(root, rel), zipSync({ "Document.xml": strToU8(`<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties>${Object.entries(props).map(([key, value]) => `<Property name="${key}" type="App::PropertyString"><String value="${value}"/></Property>`).join("")}</Properties></Object></ObjectData></Document>`) }));
    rememberBomApplyPrefs(root, props);
    const db = pnwCreateDb(ensurePhoenixDatabase(root));
    db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,part_number,part_version,type_code,model_series,part_name,label,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", [rel, rel, "720421", "003", "H", "STALE", "索引旧名", "索引旧标签", "today"]); db.close();
    const clear = { PartNumber: "", PartVersion: "", TypeCode: "", ModelSeries: "", PartName: "", label: "" };
    await writeBomToFcstd(root, rel, { ...clear, model_series: "legacy-stale", part_name: "legacy-stale", Label: "legacy-stale" });
    expect(loadBomPreview(root, rel).fields).toMatchObject(clear);
    const index = pnwCreateDb(ensurePhoenixDatabase(root));
    expect(index.get("SELECT part_number,part_version,type_code,model_series,part_name,label FROM phoenix_cad_file_asset WHERE repo_rel_path=?", [rel])).toEqual({ part_number: null, part_version: null, type_code: null, model_series: null, part_name: null, label: null });
    index.close();
    // A later explicit recommendation may still offer a valid filename-based value.
    expect(recommendBomField(root, rel, "PartName", { name_source: "filename" }).value).toBe("PLATE");
  });
  it.each(["Sheet.Drawing.FCStd", "Sheet.FCStd"])("protects independent %s BOM properties but allows source-derived filename and byte-preserving rename", async rel => {
    const root = makeTempRoot();
    const source = "720422.003-H-DEMO-Frame.ASSY.FCStd";
    const save = (file: string, xml: string) => fs.writeFileSync(path.join(root, file), zipSync({ "Document.xml": strToU8(xml) }));
    save(source, '<Document><Objects><Object name="Assembly" type="App::Part"/><Object name="Page" type="TechDraw::DrawPage"/></Objects><ObjectData><Object name="Assembly"><Properties><Property name="Label" type="App::PropertyString"><String value="测试框架"/></Property></Properties></Object></ObjectData></Document>');
    save(rel, `<Document><Objects><Object name="Page" type="TechDraw::DrawPage"/><Object name="Model" type="App::Link"/></Objects><ObjectData><Object name="Model"><Properties><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="${source}" name="Assembly"/></Property></Properties></Object></ObjectData></Document>`);
    const original = fs.readFileSync(path.join(root, rel));
    const preview = loadBomPreview(root, rel);
    expect(preview).toMatchObject({ bom_readonly: true, bom_source_rel: source, document_kinds: { drawing: true } });
    expect(loadBomPreview(root, source).bom_readonly).toBe(false);
    expect(readBomDocumentKinds(root, rel).document_kinds.drawing).toBe(true);
    expect(() => recommendBomField(root, rel, "PartName", {})).toThrow(/独立图纸/);
    expect(() => recommendBomFieldsAll(root, rel)).toThrow(/独立图纸/);
    await expect(writeBomToFcstd(root, rel, { PartName: "不能写入图纸" })).rejects.toThrow(/独立图纸/);
    const target = "720422.003-H-DEMO-Frame.Drawing.FCStd";
    expect(recommendBomField(root, rel, "filename").value).toBe(target);
    const result = await renameBomFcstdFile(root, rel, { filename: target, baseline: {}, PartName: "旧页面残留草稿", write_attrs_first: true });
    expect(result).toMatchObject({ filename: target, attrs_saved: false, bom_readonly: true });
    expect(fs.readFileSync(path.join(root, target))).toEqual(original);
  });
  it("keeps a drawing read-only when the source is missing instead of guessing from filenames", () => {
    const root = makeTempRoot(); const rel = "Sheet.Drawing.FCStd";
    fs.writeFileSync(path.join(root, rel), zipSync({ "Document.xml": strToU8('<Document><Objects><Object name="Page" type="TechDraw::DrawPage"/></Objects><ObjectData/></Document>') }));
    expect(loadBomPreview(root, rel)).toMatchObject({ bom_readonly: true, bom_source_rel: null, bom_readonly_reason: expect.stringContaining("未找到") });
    expect(() => recommendBomField(root, rel, "filename")).toThrow(/未找到/);
  });
  it.each(["", "S"])("blocks recommendations for an invalid root name %j without changing the file", PartName => {
    const root = makeTempRoot(); const rel = "720421.003-S-BOLT.FCStd";
    const filename = path.join(root, rel);
    fs.writeFileSync(filename, zipSync({ "Document.xml": strToU8(`<Document><Objects><Object type="PartDesign::Body" name="Body"/></Objects><ObjectData><Object name="Body"><Properties><Property name="Label" type="App::PropertyString"><String value="720421.003-S"/></Property><Property name="PartName" type="App::PropertyString"><String value="${PartName}"/></Property></Properties></Object></ObjectData></Document>`) }));
    const before = fs.readFileSync(filename); const values = loadBomPreview(root, rel).fields;
    for (const field of ["PartName", "label", "filename"]) expect(() => recommendBomField(root, rel, field, values)).toThrow(/为空或仅为一个英文字母/);
    expect(() => recommendBomFieldsAll(root, rel, values)).toThrow(/为空或仅为一个英文字母/);
    for (const name of ["", "S", " a ", "S.ASSY"]) {
      expect(() => recommendBomFilename(root, rel, { ...values, PartName: name })).toThrow(/为空或仅为一个英文字母/);
      expect(() => applyBomLabelFormula(root, rel, { ...values, PartName: name })).toThrow(/为空或仅为一个英文字母/);
    }
    // Selecting a different valid source is allowed only while the property is unset.
    if (!PartName) expect(recommendBomField(root, rel, "PartName", { ...values, name_source: "filename" }).value).toBe("BOLT");
    expect(fs.readFileSync(filename)).toEqual(before);
  });
  it.each([".FCStd", ".ASSY.FCStd"])("recommends a pure PartName and keeps one assembly Label marker for %s", suffix => {
    const workspace = makeTempRoot();
    const rel = `720422.003-H-DEMO-FRAME${suffix}`;
    const file = path.join(workspace, rel);
    fs.writeFileSync(file, zipSync({ "Document.xml": strToU8('<Document><Objects><Object type="App::Part" name="Assembly"/></Objects><ObjectData><Object name="Assembly"><Properties><Property name="Label" type="App::PropertyString"><String value="720422.003-测试框架装配.ASSY"/></Property><Property name="PartName" type="App::PropertyString"><String value="测试框架装配"/></Property></Properties></Object></ObjectData></Document>') }));
    const preview = loadBomPreview(workspace, rel);
    expect(preview.document_kinds?.assembly).toBe(true);
    for (const name_source of ["label", "filename"]) {
      const result = recommendBomFieldsAll(workspace, rel, { ...preview.fields, name_source });
      expect(result.results.PartName.value).toBe("测试框架装配");
      expect(result.results.label.value).toBe("720422.003-测试框架装配.ASSY");
      expect(result.results.filename.value).toBe("720422.003-H-DEMO-测试框架装配.ASSY.FCStd");
    }
  });
  it("preserves a Chinese node Label without PartName and supports both recommendation sources without writing", () => {
    const workspace = makeTempRoot();
    const rel = "720421.003-H-DEMO-PLATE.FCStd";
    const file = path.join(workspace, rel);
    const xml = (name = "") => `<Document><Objects><Object type="PartDesign::Body" name="Body"/></Objects><ObjectData><Object name="Body"><Properties><Property name="Label" type="App::PropertyString"><String value="720421.003-测试面板"/></Property>${name ? `<Property name="PartName" type="App::PropertyString"><String value="${name}"/></Property>` : ""}</Properties></Object></ObjectData></Document>`;
    fs.writeFileSync(file, zipSync({ "Document.xml": strToU8(xml()) }));
    const before = fs.readFileSync(file);
    const preview = loadBomPreview(workspace, rel);
    expect(preview.fields).toMatchObject({ PartName: "", label: "720421.003-测试面板" });
    for (const source of ["label", "filename"] as const) {
      const values = { ...preview.fields, name_source: source };
      const expected = source === "label" ? "测试面板" : "PLATE";
      expect(recommendBomField(workspace, rel, "PartName", values).value).toBe(expected);
      expect(recommendBomField(workspace, rel, "label", values).value).toBe(`720421.003-${expected}`);
      expect(recommendBomFieldsAll(workspace, rel, values).results.PartName.value).toBe(expected);
      expect(recommendBomFieldsAll(workspace, rel, values).results.filename.value).toBe(`720421.003-H-DEMO-${expected}.FCStd`);
    }
    expect(recommendBomFieldsAll(workspace, rel, preview.fields).results.label.value).toBe("720421.003-测试面板");
    expect(fs.readFileSync(file)).toEqual(before);
    fs.writeFileSync(file, zipSync({ "Document.xml": strToU8(xml("手工名称")) }));
    for (const name_source of ["label", "filename"]) {
      expect(recommendBomFieldsAll(workspace, rel, { name_source }).results.PartName.value).toBe("手工名称");
    }
  });
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

    const legacyValues = {
      PartNumber: "200001", PartVersion: "001", TypeCode: "H", ModelSeries: "MDL", PartName: "Cover.ASSY",
    };
    const duplicatedRel = "asm/200001.001-H-MDL-Cover.ASSY.ASSY.FCStd";
    writeFile(workspace, duplicatedRel, "not a real fcstd zip\n");
    expect(recommendBomField(workspace, duplicatedRel, "filename", legacyValues).value)
      .toBe("200001.001-H-MDL-Cover.ASSY.FCStd");
    expect(recommendBomFilename(workspace, duplicatedRel, legacyValues).recommended_filename)
      .toBe("200001.001-H-MDL-Cover.ASSY.FCStd");
    expect(legacyValues.PartName).toBe("Cover.ASSY");

    expect(readBomDocumentKinds(workspace, "asm/custom.ASSY.FCStd").document_kinds)
      .toMatchObject({ assembly: true, recommended_suffix: ".ASSY.FCStd" });
  });

  it.each([
    ["支架", "200001.001-支架.ASSY"],
    ["支架.ASSY", "200001.001-支架.ASSY"],
    ["支架.assy.ASSY", "200001.001-支架.ASSY"],
    ["支架.ASSY.Detail", "200001.001-支架.ASSY.Detail.ASSY"],
  ])("recommends exactly one terminal assembly label marker for %s", (name, expected) => {
    const workspace = makeTempRoot();
    const rel = "asm/200001.001-H-MDL-Bracket.ASSY.FCStd";
    writeFile(workspace, rel, "read-only recommendation fixture\n");
    const before = fs.readFileSync(path.join(workspace, rel));
    const fields = { PartNumber: "200001", PartVersion: "001", TypeCode: "H", ModelSeries: "MDL", PartName: name };
    expect(recommendBomField(workspace, rel, "label", fields).value).toBe(expected);
    expect(applyBomLabelFormula(workspace, rel, fields, false).label).toBe(expected);
    expect(fields.PartName).toBe(name);
    expect(fs.readFileSync(path.join(workspace, rel))).toEqual(before);
  });

  it.each([".ASSY.FCStd", ".FCStd"])("keeps PartName plain and assembly Label with %s when recommend-all receives no form values", suffix => {
    const workspace = makeTempRoot();
    const rel = `asm/200001.001-H-MDL-支架${suffix}`;
    const abs = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, zipSync({ "Document.xml": strToU8(`<Document>
      <Objects><Object type="App::Part" name="Assembly"/></Objects>
      <ObjectData><Object name="Assembly"><Properties>
        <Property name="PartName" type="App::PropertyString"><String value="支架.ASSY"/></Property>
        <Property name="Label" type="App::PropertyString"><String value="200001.001-支架.ASSY"/></Property>
      </Properties></Object></ObjectData></Document>`) }));
    const before = fs.readFileSync(abs);
    expect(recommendBomField(workspace, rel, "PartName").value).toBe("支架");
    const all = recommendBomFieldsAll(workspace, rel);
    expect(all.results.PartName.value).toBe("支架");
    expect(all.results.label.value).toBe("200001.001-支架.ASSY");
    expect(all.results.filename.value).toBe("200001.001-H-MDL-支架.ASSY.FCStd");
    expect(fs.readFileSync(abs)).toEqual(before);
  });

  it("does not infer assembly from a directory or the unsaved filename draft", () => {
    const workspace = makeTempRoot();
    const rel = "folder.ASSY/200001.001-H-MDL-支架.FCStd";
    writeFile(workspace, rel, "read-only recommendation fixture\n");
    expect(recommendBomField(workspace, rel, "label", {
      PartNumber: "200001", PartVersion: "001", PartName: "支架",
      filename: "draft.ASSY.FCStd", repo_rel_path: "draft.ASSY.FCStd",
    }).value).toBe("200001.001-支架");
  });

  it("writes embedded BOM fields with the TypeScript FCStd adapter", async () => {
    const workspace = makeTempRoot();
    const rel = "parts/Part.FCStd";
    const abs = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, zipSync({
      "Document.xml": strToU8(`<Document><Objects><Object type="PartDesign::Body" name="Body"/></Objects>
        <ObjectData><Object name="Body"><Properties>
          <Property name="Label" type="App::PropertyString"><String value="Old"/></Property>
        </Properties></Object></ObjectData></Document>`),
    }));

    await expect(writeBomToFcstd(workspace, rel, {
      PartNumber: "100001",
      PartVersion: "002",
      TypeCode: "h",
      ModelSeries: "px",
      PartName: "支架",
      label: "100001.002-支架",
    })).resolves.toMatchObject({
      status: "ok",
      rel,
      changed: true,
      object_name: "Body",
      engine: "typescript",
    });
    expect(loadBomPreview(workspace, rel).fields).toMatchObject({
      PartNumber: "100001",
      PartVersion: "002",
      TypeCode: "H",
      ModelSeries: "PX",
      PartName: "支架",
      label: "100001.002-支架",
    });
  });

  it("renames FCStd files, records the rename, and updates the fcstd map when present", async () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "parts/OldPart.FCStd", "not a real fcstd zip\n");
    const index = pnwCreateDb(ensurePhoenixDatabase(workspace));
    index.run(
      `INSERT INTO phoenix_cad_file_asset (
         repo_rel_path, filename, asset_kind, file_status, last_seen_at, updated_at
       ) VALUES (?, ?, 'fcstd', 'present', datetime('now'), datetime('now'))`,
      ["./parts/OldPart.FCStd", "OldPart.FCStd"],
    );
    index.close();

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

    const check = pnwCreateDb(ensurePhoenixDatabase(workspace));
    const entry = check.get<{ repo_rel_path: string }>(
      "SELECT repo_rel_path FROM phoenix_cad_file_asset WHERE asset_kind = 'fcstd' LIMIT 1",
    );
    check.close();
    expect(entry?.repo_rel_path).toBe("./parts/NewPart.FCStd");
  });
});
