import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractLockedRegionContents,
  findLockedRegions,
  reorderHeaderText,
} from "./reorderHeaderEngine.js";

const fixtureRoot = path.resolve(process.cwd(), "..", "tests", "fixtures", "reorder_members");

function fixture(name: string): string {
  return fs.readFileSync(path.join(fixtureRoot, name), "utf8");
}

describe("reorderHeaderEngine", () => {
  it("orders special members and methods while keeping member slots stable", () => {
    const source = [
      "class ExportedByModule Sample final {",
      "public:",
      "    void zeta();",
      "    int zebraMember;",
      "    Sample(int value);",
      "    ~Sample();",
      "    Sample();",
      "    void alpha();",
      "    int appleMember;",
      "};",
      "",
    ].join("\n");

    const result = reorderHeaderText(source);
    expect(result.changed).toBe(true);
    expect(result.text.indexOf("Sample();")).toBeLessThan(result.text.indexOf("Sample(int value)"));
    expect(result.text.indexOf("Sample(int value)")).toBeLessThan(result.text.indexOf("~Sample()"));
    expect(result.text.indexOf("alpha()")).toBeLessThan(result.text.indexOf("zeta()"));
    expect(result.text.indexOf("zebraMember")).toBeLessThan(result.text.indexOf("appleMember"));
    expect(reorderHeaderText(result.text).changed).toBe(false);

    const sortedMembers = reorderHeaderText(source, { sortMembers: true });
    expect(sortedMembers.text.indexOf("appleMember")).toBeLessThan(sortedMembers.text.indexOf("zebraMember"));
  });

  it.each([
    "clang_format_off_on.h",
    "kevin_wizard_section.h",
    "caa2_wizard_section.h",
    "pragma_region.h",
    "clang_format_nested_markers.h",
    "clang_format_doubled.h",
    "pnx_caa2_widget_decl.h",
  ])("preserves locked regions and remains idempotent for %s", (name) => {
    const source = fixture(name);
    const before = extractLockedRegionContents(source);
    expect(before.length).toBeGreaterThan(0);
    const result = reorderHeaderText(source);
    expect(extractLockedRegionContents(result.text)).toEqual(before);
    expect(reorderHeaderText(result.text).changed).toBe(false);
  });

  it("merges nested locked regions under the outer clang-format rule", () => {
    const nested = findLockedRegions(fixture("clang_format_nested_markers.h"));
    expect(nested).toHaveLength(1);
    expect(nested[0].ruleId).toBe("clang-format");
    expect(nested[0].content).toContain("START KEVIN CAA WIZARD SECTION");
    expect(nested[0].content).toContain("CAA2 WIZARD");

    const doubled = findLockedRegions(fixture("clang_format_doubled.h"));
    expect(doubled).toHaveLength(1);
    expect(doubled[0].ruleId).toBe("clang-format");
  });

  it("sorts declarations outside locked regions", () => {
    const wizard = reorderHeaderText(fixture("kevin_wizard_section.h"));
    expect(wizard.text.indexOf("getApple")).toBeLessThan(wizard.text.indexOf("setZebra"));
    expect(wizard.text.indexOf("ZebraField")).toBeLessThan(wizard.text.indexOf("AppleField"));

    const pragma = reorderHeaderText(fixture("pragma_region.h"));
    expect(pragma.text.indexOf("apple")).toBeLessThan(pragma.text.indexOf("beta"));
    expect(pragma.text.indexOf("field_z_first")).toBeLessThan(pragma.text.indexOf("field_a_second"));
  });

  it("strips and merges Kevin system-code declarations like the Python engine", () => {
    const basic = reorderHeaderText(fixture("pnx_bom_analysis_param_min.h"));
    expect(basic.text).not.toContain("KEVIN_SYSTEM_CODE START");
    expect(basic.text).not.toContain("KEVIN_SYSTEM_CODE END");
    const basicSection = basic.text.slice(basic.text.indexOf("public: // KEVIN_SYSTEM_CODE"));
    expect(basicSection.indexOf("ConvertErrorListToString")).toBeLessThan(basicSection.indexOf("convertJson"));
    expect(basicSection.indexOf("convertJson")).toBeLessThan(basicSection.indexOf("GetSoftwareVersion"));
    expect(reorderHeaderText(basic.text).changed).toBe(false);

    const split = reorderHeaderText(fixture("pnx_bom_param_system_split.h"));
    const systemStart = split.text.indexOf("public: // KEVIN_SYSTEM_CODE");
    const functionsStart = split.text.indexOf("public: // functions", systemStart);
    const systemBlock = split.text.slice(systemStart, functionsStart);
    const functionsBlock = split.text.slice(functionsStart, split.text.indexOf("};", functionsStart));
    expect(systemBlock).toContain("ConvertErrorListToString");
    expect(systemBlock).toContain("convertJson");
    expect(systemBlock).toContain("GetSoftwareVersion");
    expect(functionsBlock).toContain("CheckoutAxis");
    expect(functionsBlock).not.toContain("convertJson");
    expect(reorderHeaderText(split.text).changed).toBe(false);
  });

  it.each(["keep_markers", "off"] as const)("matches the alternate %s system-code mode", (mode) => {
    const source = fixture("pnx_bom_analysis_param_min.h");
    const result = reorderHeaderText(source, { kevinSystemCodeMode: mode });
    expect(result.text).toContain("KEVIN_SYSTEM_CODE START");
    expect(result.text).toContain("KEVIN_SYSTEM_CODE END");
    expect(reorderHeaderText(result.text, { kevinSystemCodeMode: mode }).changed).toBe(false);
  });

  it("converges for every local header fixture", () => {
    const headers = fs.readdirSync(fixtureRoot).filter((name) => /\.h(pp)?$/i.test(name));
    expect(headers.length).toBeGreaterThanOrEqual(15);
    for (const name of headers) {
      const once = reorderHeaderText(fixture(name));
      expect(reorderHeaderText(once.text).changed, name).toBe(false);
    }
  });

  it("preserves CRLF and locked bytes", () => {
    const source = fixture("kevin_wizard_section.h").replace(/\r?\n/g, "\r\n");
    const before = extractLockedRegionContents(source);
    const result = reorderHeaderText(source);
    expect(result.text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(extractLockedRegionContents(result.text)).toEqual(before);
    expect(reorderHeaderText(result.text).changed).toBe(false);
  });

  it("preserves numbered Doxygen sequences and reports why", () => {
    const source = [
      "class Numbered {",
      "public:",
      "    /** 1. zeta */",
      "    void zeta();",
      "    /** 2. alpha */",
      "    void alpha();",
      "};",
      "",
    ].join("\n");
    const result = reorderHeaderText(source);
    expect(result.text.indexOf("zeta")).toBeLessThan(result.text.indexOf("alpha"));
    expect(result.warnings.some((warning) => warning.includes("numbered Doxygen"))).toBe(true);
  });
});
