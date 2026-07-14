import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { afterEach, describe, expect, it } from "vitest";
import {
  getReorderMembersPrefs,
  listReorderTopLevelEntries,
  resolveReorderMembersScope,
  runReorderMembersBatch,
  runReorderMembersSelfTest,
  saveReorderMembersPrefs,
} from "./reorderMembersService.js";

const tempRoots: string[] = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reorder-members-service-"));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, rel: string, text: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
}

function sampleCpp() {
  return [
    "#include \"Foo.h\"",
    "",
    "Foo::Foo() {",
    "}",
    "",
    "Foo::~Foo() {",
    "}",
    "",
    "void Foo::zeta() {",
    "}",
    "",
    "void Foo::alpha() {",
    "}",
    "",
  ].join("\n");
}

function sampleHeader() {
  return [
    "class Foo {",
    "public:",
    "    void zeta();",
    "    // clang-format off",
    "    int WizardZ;",
    "    int WizardA;",
    "    // clang-format on",
    "    void alpha();",
    "    Foo();",
    "};",
    "",
  ].join("\n");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("reorderMembersService", () => {
  it("persists preferences and reports top-level source entries", () => {
    const workspace = makeTempRoot();
    const prefsDir = makeTempRoot();
    writeFile(workspace, "src/Foo.cpp", sampleCpp());
    writeFile(workspace, "src/Foo.h", "class Foo {};\n");
    writeFile(workspace, "README.md", "# nope\n");

    const saved = saveReorderMembersPrefs(workspace, { include_cpp: true, include_header: false, verbose: true }, { prefsDir });
    expect(saved.include_header).toBe(false);
    expect(saved.verbose).toBe(true);

    const prefs = getReorderMembersPrefs(workspace, { prefsDir });
    expect(prefs.include_header).toBe(false);
    expect(prefs.workspace_path).toBe(workspace);

    const top = listReorderTopLevelEntries(workspace, { prefsDir });
    expect(top.entries.some((entry: any) => entry.name === "src" && entry.source_file_count === 2)).toBe(true);
  });

  it("resolves workset paths and reorders cpp files in dry-run and write modes", () => {
    const workspace = makeTempRoot();
    const prefsDir = makeTempRoot();
    writeFile(workspace, "src/Foo.cpp", sampleCpp());
    writeFile(workspace, "src/Foo.h", "class Foo {};\n");

    const resolved = resolveReorderMembersScope(workspace, { repo_rel_paths: ["src"] }, { prefsDir });
    expect(resolved.resolved_files).toEqual(["src/Foo.cpp", "src/Foo.h"]);

    const before = fs.readFileSync(path.join(workspace, "src/Foo.cpp"), "utf8");
    const dry = runReorderMembersBatch(workspace, {
      repo_rel_paths: ["src/Foo.cpp"],
      include_cpp: true,
      include_header: false,
      dry_run: true,
    }, { prefsDir });
    expect(dry.ok).toBe(true);
    expect(dry.cpp_changed).toBe(1);
    expect(fs.readFileSync(path.join(workspace, "src/Foo.cpp"), "utf8")).toBe(before);

    const written = runReorderMembersBatch(workspace, {
      repo_rel_paths: ["src/Foo.cpp"],
      include_cpp: true,
      include_header: false,
      dry_run: false,
    }, { prefsDir });
    expect(written.cpp_changed).toBe(1);
    const after = fs.readFileSync(path.join(workspace, "src/Foo.cpp"), "utf8");
    expect(after.indexOf("Foo::Foo()")).toBeLessThan(after.indexOf("~Foo"));
    expect(after.indexOf("Foo::alpha()")).toBeLessThan(after.indexOf("Foo::zeta()"));
  });

  it("reorders headers in dry-run and write modes without changing locked regions", () => {
    const workspace = makeTempRoot();
    const prefsDir = makeTempRoot();
    writeFile(workspace, "src/Foo.h", sampleHeader());

    const before = fs.readFileSync(path.join(workspace, "src/Foo.h"), "utf8");
    const dry = runReorderMembersBatch(workspace, {
      repo_rel_paths: ["src/Foo.h"],
      include_cpp: false,
      include_header: true,
      dry_run: true,
    }, { prefsDir });
    expect(dry.hdr_changed).toBe(1);
    expect(fs.readFileSync(path.join(workspace, "src/Foo.h"), "utf8")).toBe(before);

    const written = runReorderMembersBatch(workspace, {
      repo_rel_paths: ["src/Foo.h"],
      include_cpp: false,
      include_header: true,
      dry_run: false,
    }, { prefsDir });
    expect(written.hdr_changed).toBe(1);
    const after = fs.readFileSync(path.join(workspace, "src/Foo.h"), "utf8");
    expect(after.indexOf("Foo();")).toBeLessThan(after.indexOf("alpha"));
    expect(after.indexOf("alpha")).toBeLessThan(after.indexOf("zeta"));
    expect(after.slice(after.indexOf("// clang-format off"), after.indexOf("// clang-format on") + "// clang-format on".length))
      .toBe(before.slice(before.indexOf("// clang-format off"), before.indexOf("// clang-format on") + "// clang-format on".length));
  });

  it("reorders a GBK header without corrupting its Chinese comments or CRLF", () => {
    const workspace = makeTempRoot();
    const prefsDir = makeTempRoot();
    const source = [
      "// 中文注释",
      "class Foo {",
      "public:",
      "    void zeta();",
      "    void alpha();",
      "    Foo();",
      "};",
      "",
    ].join("\r\n");
    const filename = path.join(workspace, "Foo.h");
    fs.writeFileSync(filename, iconv.encode(source, "gbk"));

    const result = runReorderMembersBatch(workspace, {
      repo_rel_paths: ["Foo.h"],
      include_cpp: false,
      include_header: true,
      dry_run: false,
    }, { prefsDir });
    expect(result.hdr_changed).toBe(1);
    const afterBytes = fs.readFileSync(filename);
    const after = iconv.decode(afterBytes, "gbk");
    expect(after).toContain("// 中文注释\r\n");
    expect(after.replace(/\r\n/g, "")).not.toContain("\n");
    expect(after.indexOf("Foo();")).toBeLessThan(after.indexOf("alpha"));
    expect(after.indexOf("alpha")).toBeLessThan(after.indexOf("zeta"));
    expect(Buffer.from(afterBytes).equals(Buffer.from(after, "utf8"))).toBe(false);
  });

  it("runs the built-in reorder self-test", () => {
    const out = runReorderMembersSelfTest();
    expect(out.ok).toBe(true);
    expect(out.failed).toBe(0);
  });
});
