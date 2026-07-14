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

function sampleCpp() {
  return [
    "#include \"Foo.h\"",
    "",
    "Foo::Foo() {",
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
    "    void alpha();",
    "    Foo();",
    "};",
    "",
  ].join("\n");
}

async function importShellRoutes(home: string, workspace: string) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const prefsDir = path.join(home, ".phoenix");
  fs.mkdirSync(prefsDir, { recursive: true });
  fs.writeFileSync(
    path.join(prefsDir, "launcher-prefs.json"),
    JSON.stringify({ recent_workspaces: [workspace], freecad_dir: "", workspace }, null, 2),
    "utf8",
  );
  vi.resetModules();
  return import("./shell.js");
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("shell reorder members routes", () => {
  it("serves prefs, resolves scope, runs dry-run/write, and self-tests", async () => {
    const home = makeTempRoot("shell-reorder-home-");
    const workspace = makeTempRoot("shell-reorder-ws-");
    writeFile(workspace, "src/Foo.cpp", sampleCpp());
    writeFile(workspace, "src/Foo.h", sampleHeader());

    const { shellRoutes } = await importShellRoutes(home, workspace);

    const prefsRes = await shellRoutes.request("/api/code/reorder-members/prefs");
    expect(prefsRes.status).toBe(200);
    const prefs = await prefsRes.json();
    expect(prefs.workspace_path).toBe(workspace);
    expect(prefs.include_cpp).toBe(true);

    const topRes = await shellRoutes.request("/api/code/reorder-members/top-level");
    const top = await topRes.json();
    expect(top.entries.some((entry: any) => entry.name === "src" && entry.source_file_count === 2)).toBe(true);

    const resolveRes = await shellRoutes.request("/api/code/reorder-members/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo_rel_paths: ["src"] }),
    });
    const resolved = await resolveRes.json();
    expect(resolved.total).toBe(2);

    const dryRes = await shellRoutes.request("/api/code/reorder-members/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo_rel_paths: ["src/Foo.cpp"], include_header: false, dry_run: true }),
    });
    const dry = await dryRes.json();
    expect(dry.ok).toBe(true);
    expect(dry.dry_run).toBe(true);
    expect(dry.cpp_changed).toBe(1);

    const writeRes = await shellRoutes.request("/api/code/reorder-members/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo_rel_paths: ["src/Foo.cpp"], include_header: false, dry_run: false }),
    });
    const written = await writeRes.json();
    expect(written.cpp_changed).toBe(1);
    const text = fs.readFileSync(path.join(workspace, "src/Foo.cpp"), "utf8");
    expect(text.indexOf("Foo::Foo()")).toBeLessThan(text.indexOf("Foo::alpha()"));
    expect(text.indexOf("Foo::alpha()")).toBeLessThan(text.indexOf("Foo::zeta()"));

    const headerRes = await shellRoutes.request("/api/code/reorder-members/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo_rel_paths: ["src/Foo.h"], include_cpp: false, include_header: true, dry_run: false }),
    });
    const header = await headerRes.json();
    expect(header.hdr_changed).toBe(1);
    const headerText = fs.readFileSync(path.join(workspace, "src/Foo.h"), "utf8");
    expect(headerText.indexOf("Foo();")).toBeLessThan(headerText.indexOf("alpha"));
    expect(headerText.indexOf("alpha")).toBeLessThan(headerText.indexOf("zeta"));

    const selfRes = await shellRoutes.request("/api/code/reorder-members/self-test", { method: "POST" });
    const self = await selfRes.json();
    expect(self.ok).toBe(true);
    expect(self.failed).toBe(0);
  }, 15_000);
});
