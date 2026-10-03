import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  extractDocumentXmlFromFcstdBytes,
  readFcstdEmbeddedBomFields,
  readFcstdEmbeddedBomFieldsAsync,
  writeFcstdEmbeddedBomFields,
} from "./fcstdDocumentXmlService.js";

const DOCUMENT_XML = `<Document>
  <Objects><Object type="PartDesign::Body" name="Body"/></Objects>
  <ObjectData><Object name="Body"><Properties>
    <Property name="Label" type="App::PropertyString"><String value="测试零件"/></Property>
    <Property name="PartNumber" type="App::PropertyString"><String value="800001"/></Property>
    <Property name="PartVersion" type="App::PropertyString"><String value="001"/></Property>
    <Property name="TypeCode" type="App::PropertyString"><String value="h"/></Property>
    <Property name="ModelSeries" type="App::PropertyString"><String value="px"/></Property>
    <Property name="PartName" type="App::PropertyString"><String value="滑轨"/></Property>
  </Properties></Object></ObjectData>
</Document>`;

describe("FCStd Document.xml Node adapter", () => {
  it("extracts only Document.xml and delegates BOM projection to Wing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fcstd-ts-read-"));
    const filename = path.join(root, "part.FCStd");
    fs.writeFileSync(filename, zipSync({
      "Document.xml": strToU8(DOCUMENT_XML),
      "GuiDocument.xml": strToU8("not parsed"),
    }));
    const expected = {
      PartNumber: "800001",
      PartVersion: "001",
      TypeCode: "H",
      ModelSeries: "PX",
      PartName: "滑轨",
      label: "测试零件",
    };

    expect(readFcstdEmbeddedBomFields(filename)).toEqual(expected);
    await expect(readFcstdEmbeddedBomFieldsAsync(filename)).resolves.toEqual(expected);
  });

  it("fails closed for invalid archives and missing Document.xml", () => {
    expect(extractDocumentXmlFromFcstdBytes(strToU8("not a zip"))).toBeNull();
    expect(extractDocumentXmlFromFcstdBytes(zipSync({ "GuiDocument.xml": strToU8("x") }))).toBeNull();
  });

  it("updates BOM fields through Wing and preserves other archive entries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fcstd-ts-write-"));
    const filename = path.join(root, "part.FCStd");
    fs.writeFileSync(filename, zipSync({
      "Document.xml": strToU8(DOCUMENT_XML),
      "GuiDocument.xml": strToU8("keep me"),
    }));

    expect(writeFcstdEmbeddedBomFields(filename, {
      PartNumber: "900&002",
      PartName: "支架 <左>",
      label: "新标签",
    })).toEqual({ changed: true, objectName: "Body" });
    expect(readFcstdEmbeddedBomFields(filename)).toMatchObject({
      PartNumber: "900&002",
      PartName: "支架 <左>",
      label: "新标签",
    });
    const archive = unzipSync(new Uint8Array(fs.readFileSync(filename)));
    expect(strFromU8(archive["GuiDocument.xml"])).toBe("keep me");
    expect(strFromU8(archive["Document.xml"]))
      .toMatch(/<Property name="PartNumber" type="App::PropertyString" group="CustomDefine" doc="零件号" attr="0" ro="0" hide="0" status="2097152">/);
    expect(fs.readdirSync(root).sort()).toEqual(["part.FCStd"]);

    expect(writeFcstdEmbeddedBomFields(filename, {
      PartNumber: "900&002",
      PartName: "支架 <左>",
      label: "新标签",
    }).changed).toBe(false);
  });

  it("restores the original bytes and removes temp files when atomic replacement fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fcstd-ts-rollback-"));
    const filename = path.join(root, "part.FCStd");
    const original = zipSync({ "Document.xml": strToU8(DOCUMENT_XML) });
    fs.writeFileSync(filename, original);
    const realRename = fs.renameSync.bind(fs);
    let calls = 0;
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      calls += 1;
      if (calls === 2) throw new Error("injected atomic replacement failure");
      return realRename(source, target);
    });

    try {
      expect(() => writeFcstdEmbeddedBomFields(filename, { PartName: "Should rollback" }))
        .toThrow("injected atomic replacement failure");
    } finally {
      rename.mockRestore();
    }

    expect(fs.readFileSync(filename)).toEqual(Buffer.from(original));
    expect(fs.readdirSync(root)).toEqual(["part.FCStd"]);
  });
});
