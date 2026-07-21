import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  patchFcstdReferenceLabels,
  patchFcstdXlinkAttributes,
  patchReferenceLabelsInDocumentXml,
  patchXlinkAttributesInDocumentXml,
} from "./fcstdReferenceLabelService.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const XML = `<Document><ObjectData>
<Object name="Outer"><Property name="Label" type="App::PropertyString"><String value="Outer"/></Property>
  <Object name="Inner"><Property name="Label" type="App::PropertyString"><String value="Old"/></Property><XLink file="part.FCStd"/></Object>
</Object>
<Object name="Other"><Property name="Label" type="App::PropertyString"><String value="Keep"/></Property><Other file="part.FCStd"/></Object>
</ObjectData></Document>`;

describe("FCStd reference label patching", () => {
  it("patches only the innermost object containing the selected XLink", () => {
    const result = patchReferenceLabelsInDocumentXml(XML, { "part.FCStd": 'A&B "Part"' });
    expect(result.changes).toEqual([{
      xlink_file_attr: "part.FCStd",
      old_label: "Old",
      new_label: 'A&B "Part"',
    }]);
    expect(result.xml).toContain('value="A&amp;B &quot;Part&quot;"');
    expect(result.xml).toContain('value="Outer"');
    expect(result.xml).toContain('value="Keep"');
  });

  it("writes Document.xml back to a real FCStd and preserves other entries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fcstd-label-patch-"));
    roots.push(root);
    const filename = path.join(root, "host.FCStd");
    fs.writeFileSync(filename, zipSync({
      "Document.xml": strToU8(XML),
      "GuiDocument.xml": strToU8("keep me"),
    }));

    expect(patchFcstdReferenceLabels(filename, { "part.FCStd": "New" }))
      .toMatchObject({ count: 1, engine: "typescript" });
    const files = unzipSync(new Uint8Array(fs.readFileSync(filename)));
    expect(strFromU8(files["Document.xml"])).toContain('value="New"');
    expect(strFromU8(files["GuiDocument.xml"])).toBe("keep me");
  });

  it("patches only XLink file attributes in XML and FCStd archives", () => {
    const xml = '<Document><Other file="old.FCStd"/><XLink file="old.FCStd"/></Document>';
    expect(patchXlinkAttributesInDocumentXml(xml, { "old.FCStd": "new.FCStd" })).toEqual({
      xml: '<Document><Other file="old.FCStd"/><XLink file="new.FCStd"/></Document>',
      count: 1,
    });

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fcstd-xlink-patch-"));
    roots.push(root);
    const filename = path.join(root, "host.FCStd");
    fs.writeFileSync(filename, zipSync({ "Document.xml": strToU8(xml) }));
    expect(patchFcstdXlinkAttributes(filename, { "old.FCStd": "new.FCStd" }))
      .toEqual({ count: 1, engine: "typescript" });
    const files = unzipSync(new Uint8Array(fs.readFileSync(filename)));
    expect(strFromU8(files["Document.xml"])).toContain('<XLink file="new.FCStd"/>');
  });
});
