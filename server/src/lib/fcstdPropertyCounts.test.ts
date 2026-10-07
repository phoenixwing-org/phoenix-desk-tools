import { describe, expect, it } from "vitest";
import { reconcileFcstdPropertyCounts } from "./fcstdPropertyCounts.js";

const wrap = (body: string) => `<Document><Objects><Object name="Body"/></Objects><ObjectData><Object name="Body">${body}</Object></ObjectData></Document>`;
describe("FCStd count-only XML patch", () => {
  it("counts direct Property children, ignores comments/CDATA and keeps every other byte", () => {
    const xml = wrap(`<Properties TransientCount="2" Count = '0'>
      <!-- <Property/> --><Property name="Data"><![CDATA[<Property/>]]><Nested><Property/></Nested></Property>
      <Property name="Label"><String value="value > 1 &amp; 2"/></Property></Properties>`);
    const result = reconcileFcstdPropertyCounts(xml);
    expect(result.issues).toEqual([{ object_name: "Body", declared_count: "0", actual_count: 2 }]);
    expect(result.xml).toBe(xml.replace("Count = '0'", "Count = '2'"));
    expect(reconcileFcstdPropertyCounts(result.xml).issues).toEqual([]);
  });
  it("supports missing Count and empty containers without touching document counts", () => {
    const xml = wrap('<Properties/>').replace('<Document>', '<Document><Properties Count="99"/>');
    expect(reconcileFcstdPropertyCounts(xml).xml).toBe(xml.replace('<Properties/>', '<Properties Count="0"/>'));
  });
  it("can restrict the writer compatibility fix to one object", () => {
    const xml = '<Document><ObjectData><Object name="A"><Properties Count="9"/></Object><Object name="B"><Properties Count="9"/></Object></ObjectData></Document>';
    const result = reconcileFcstdPropertyCounts(xml, "B");
    expect(result.issues.map(row => row.object_name)).toEqual(["B"]);
    expect(result.xml).toContain('<Object name="A"><Properties Count="9"/>');
  });
  it.each([
    '<Document><ObjectData></Document>', '<Document/><Document/>',
    '<!DOCTYPE Document><Document/>', '<Document><ObjectData>',
    '<Document><Object name="a" name="b"/></Document>',
    '<Document></Document attr="bad">', '<Document></Document/>',
  ])("refuses unsupported/malformed XML rather than writing a partial repair: %s", (xml) => {
    expect(() => reconcileFcstdPropertyCounts(xml)).toThrow(/结构/);
  });
});
