import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reorderCppText } from "./reorderCppEngine.js";
import { extractLockedRegionContents } from "./reorderHeaderEngine.js";

const fixtureRoot = path.resolve(process.cwd(), "..", "tests", "fixtures", "reorder_members");

const PYTHON_PARITY_HASHES: Record<string, string> = {
  "annotation_sep.cpp": "cb09b54c1181703e70b48ee197d50e4f91440e81b75644310d901abbcf0bc0bb",
  "internal_calls.cpp": "b8714c1ac231fc08086ee986c48140c7d80395a224d0f5cebcfcccabd955dbf0",
  "ktca_KTCAutoCodeFrm_KTCAutoCodeUI.m_src_KTCAutoDialog.cpp": "ad39a1974a7b0bab15e13066f5e5beb82b68d4039dbdbc0b536a735fea33560e",
  "ktca_KTCAutoCodeInterfaces_KTCAutoCodeItf.m_src_KTCAutoAttrAccess.cpp": "827b909e4f56915e258cfc1db57580eb57a3028d78428d44c8470a33c2392620",
  "ktca_KTCAutoCodeInterfaces_KTCAutoCodeItf.m_src_KTCAutoBuildGSM.cpp": "df96a6eb9754b844466a691bcf2c0a702e63fe9bde985ec0287addf494054bd5",
  "ktca_KTCAutoCodeInterfaces_KTCAutoCodeItf.m_src_KTCAutoPartDoc.cpp": "949e5c00b0e80bb5e033c45ce4a9bd0d8ab2a06db83d26543d4dcdd1ffa79422",
  "pnx_bom_analysis_cmd_min.cpp": "eebb5a688b7c195a8d680ca5e6696ec17f840ef8681d5f8ec6ec9057666f6941",
};

function fixture(name: string): string {
  return fs.readFileSync(path.join(fixtureRoot, name), "utf8");
}

function normalizedHash(text: string): string {
  return crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

describe("reorderCppEngine", () => {
  it("matches the archived Python output and converges for every local cpp fixture", () => {
    for (const [name, expectedHash] of Object.entries(PYTHON_PARITY_HASHES)) {
      const result = reorderCppText(fixture(name), path.parse(name).name);
      expect(normalizedHash(result.text), name).toBe(expectedHash);
      expect(reorderCppText(result.text, path.parse(name).name).changed, name).toBe(false);
    }
  });

  it("keeps annotation separators separate and sorts member definitions", () => {
    const result = reorderCppText(fixture("annotation_sep.cpp"), "annotation_sep");
    expect(result.text.indexOf("FooString::alpha()")).toBeLessThan(result.text.indexOf("FooString::compare("));
    expect(result.text).toContain("//---static---");
    expect(result.text).toContain("//---INSIDE FUNCTION---");
    const lines = result.text.split(/\r?\n/);
    expect(lines.some((line, index) => line.startsWith("//---") && lines[index + 1]?.startsWith("//---"))).toBe(false);
  });

  it("does not extract class-qualified calls from inside a function body", () => {
    const result = reorderCppText(fixture("internal_calls.cpp"), "internal_calls");
    expect(result.text.match(/FooString::init/g)).toHaveLength(2);
    expect(result.text.match(/FooString::safeDelete/g)).toHaveLength(2);
  });

  it("moves leading comments and split return types with their function", () => {
    const source = [
      "#include \"Foo.h\"",
      "",
      "Foo::Foo() {}",
      "//------------------------------",
      "// zeta documentation",
      "void Foo::zeta() {}",
      "//------------------------------",
      "const FooResult&",
      "Foo::beta() { return value_; }",
      "//------------------------------",
      "// alpha documentation",
      "void Foo::alpha() {}",
      "",
    ].join("\n");
    const result = reorderCppText(source, "Foo");
    expect(result.text.indexOf("// alpha documentation")).toBeLessThan(result.text.indexOf("// zeta documentation"));
    expect(result.text.indexOf("// zeta documentation")).toBeLessThan(result.text.indexOf("Foo::zeta()"));
    expect(result.text.indexOf("const FooResult&")).toBeLessThan(result.text.indexOf("Foo::beta()"));
  });

  it("includes member definitions that appear before the constructor", () => {
    const source = [
      "#include \"Foo.h\"",
      "",
      "void Foo::zeta() {}",
      "Foo::Foo() {}",
      "void Foo::alpha() {}",
      "",
    ].join("\n");
    const result = reorderCppText(source, "Foo");
    expect(result.text.indexOf("#include")).toBeLessThan(result.text.indexOf("Foo::Foo()"));
    expect(result.text.indexOf("Foo::Foo()")).toBeLessThan(result.text.indexOf("Foo::alpha()"));
    expect(result.text.indexOf("Foo::alpha()")).toBeLessThan(result.text.indexOf("Foo::zeta()"));
  });

  it("preserves Wizard blocks inside member function bodies", () => {
    const source = fixture("pnx_bom_analysis_cmd_min.cpp");
    const result = reorderCppText(source, "pnx_bom_analysis_cmd_min");
    expect(extractLockedRegionContents(result.text)).toEqual(extractLockedRegionContents(source));
  });

  it("detaches a separator glued to a closing brace and preserves CRLF", () => {
    const source = [
      "Foo::Foo() {",
      "}",
      "",
      "int Foo::zeta() { return 2; } //--------------------",
      "int Foo::alpha() { return 1; }",
      "",
    ].join("\r\n");
    const result = reorderCppText(source, "Foo");
    expect(result.text).not.toContain("} //");
    expect(result.text).toContain("}\r\n//");
    expect(result.text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(result.text.indexOf("Foo::alpha")).toBeLessThan(result.text.indexOf("Foo::zeta"));
  });
});
