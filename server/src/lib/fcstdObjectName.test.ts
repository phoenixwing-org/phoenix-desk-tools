import { describe, expect, it } from "vitest";
import { isFcstdObjectName } from "./fcstdLinkIdentity.js";

describe("saved FreeCAD object identifiers", () => {
  it.each(["Assembly", "_Root2", "装配示例", "部件_２", "Élément", "E\u0301lement", "ⅣRoot", "A\u203FB"])("accepts Unicode identifier %s without changing it", name => {
    expect(isFcstdObjectName(name)).toBe(true);
  });

  it.each(["", "2Root", "\u0301Root", "Has space", "Root.Link", "A/B", "A\\B", 'A"B', "A&B", "<Root>", "A\u0000B", "A\u200DB", "Root😀", "A\u20DDB", "\ud800"])("rejects malformed identifier [case %#]", name => {
    expect(isFcstdObjectName(name)).toBe(false);
  });
});
