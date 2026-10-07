import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { analyzeFcstdProperties, applyFcstdPropertyRepairs } from "./fcstdPropertyRepairService.js";
const roots: string[] = [];
function root() { const value = fs.mkdtempSync(path.join(os.tmpdir(), "fcstd-repair-")); roots.push(value); return value; }
const xml = '<Document><ObjectData><Object name="Body"><Properties Count="0" TransientCount="2"><Property name="PartNumber" type="App::PropertyString" group="CustomDefine"><String value="123456"/></Property></Properties></Object></ObjectData></Document>';
function fixture(dir: string, rel = "part.FCStd", contents = xml) {
  const file = path.join(dir, rel); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zipSync({ "Document.xml": strToU8(contents), "shape.brp": strToU8("preserve shape"), "GuiDocument.xml": strToU8("preserve gui") }));
  return file;
}
afterEach(() => { vi.useRealTimers(); for (const dir of roots.splice(0)) fs.rmSync(dir, { force: true, recursive: true }); });

describe("FCStd property repair plans", () => {
  it("analyzes without any disk writes, then repairs only selected files without changing values or ZIP entries", async () => {
    const dir = root(); const a = fixture(dir); const b = fixture(dir, "sub/b.FCStd");
    fixture(dir, "good.FCStd", xml.replace('Count="0"', 'Count="1"'));
    const beforeA = fs.readFileSync(a); const beforeB = fs.readFileSync(b);
    const plan = await analyzeFcstdProperties(dir);
    expect(plan.scanned).toBe(3); expect(plan.files).toHaveLength(2); expect(plan.errors).toEqual([]);
    expect(fs.existsSync(path.join(dir, ".phoenix"))).toBe(false);
    expect(fs.readFileSync(a)).toEqual(beforeA); expect(fs.readFileSync(b)).toEqual(beforeB);
    expect(applyFcstdPropertyRepairs(dir, { plan_id: plan.plan_id, files: ["part.FCStd"] }).results[0].status).toBe("fixed");
    const after = unzipSync(fs.readFileSync(a)); const before = unzipSync(beforeA);
    expect(strFromU8(after["Document.xml"])).toBe(xml.replace('Count="0"', 'Count="1"'));
    expect(after["shape.brp"]).toEqual(before["shape.brp"]); expect(after["GuiDocument.xml"]).toEqual(before["GuiDocument.xml"]);
    expect(fs.readFileSync(b)).toEqual(beforeB);
    expect((await analyzeFcstdProperties(dir)).files.map(file => file.rel)).toEqual(["sub/b.FCStd"]);
    expect(fs.readdirSync(dir).some(name => name.includes(".phoenix-"))).toBe(false);
  });
  it("reports a changed file as failed but permits another independently confirmed file", async () => {
    const dir = root(); const a = fixture(dir); fixture(dir, "b.FCStd");
    const plan = await analyzeFcstdProperties(dir);
    fs.appendFileSync(a, "new edit"); const changed = fs.readFileSync(a);
    const result = applyFcstdPropertyRepairs(dir, { plan_id: plan.plan_id, files: ["part.FCStd", "b.FCStd"] });
    expect(result.results.map(row => row.status)).toEqual(["failed", "fixed"]);
    expect(result.results[0].message).toMatch(/变化/); expect(fs.readFileSync(a)).toEqual(changed);
    expect(() => applyFcstdPropertyRepairs(dir, { plan_id: plan.plan_id, files: ["b.FCStd"] })).toThrow(/失效/);
  });
  it("binds plans to workspace and only permits paths present in the analysis", async () => {
    const dir = root(); fixture(dir); const plan = await analyzeFcstdProperties(dir);
    expect(() => applyFcstdPropertyRepairs(root(), { plan_id: plan.plan_id, files: ["part.FCStd"] })).toThrow(/失效/);
    for (const files of [[], ["../outside.FCStd"], ["not-scanned.FCStd"]]) {
      expect(() => applyFcstdPropertyRepairs(dir, { plan_id: plan.plan_id, files })).toThrow(/勾选/);
    }
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(() => applyFcstdPropertyRepairs(dir, { plan_id: plan.plan_id, files: ["part.FCStd"] })).toThrow(/失效/);
  });
  it("does not follow symlinks, rejects escape paths, and refuses a symlink swapped in after analysis", async () => {
    const dir = root(); const external = root(); fixture(external);
    fs.symlinkSync(external, path.join(dir, "linked"), "dir");
    const local = fixture(dir, "sub/local.FCStd");
    const plan = await analyzeFcstdProperties(dir);
    expect(plan.errors).toEqual([{ rel: "linked", message: "已跳过符号链接" }]);
    await expect(analyzeFcstdProperties(dir, { batch_dir: external })).rejects.toThrow(/超出/);
    fs.unlinkSync(local); fs.symlinkSync(path.join(external, "part.FCStd"), local);
    const before = fs.readFileSync(path.join(external, "part.FCStd"));
    const result = applyFcstdPropertyRepairs(dir, { plan_id: plan.plan_id, files: ["sub/local.FCStd"] });
    expect(result.results[0].status).toBe("failed"); expect(fs.readFileSync(path.join(external, "part.FCStd"))).toEqual(before);
  });
  it("reports malformed ZIP/XML as incomplete and limits scope to the requested directory", async () => {
    const dir = root(); fixture(dir, "other/untouched.FCStd");
    fixture(dir, "scope/bad.FCStd", "<Document><broken>");
    fs.writeFileSync(path.join(dir, "scope/invalid.FCStd"), "invalid");
    const plan = await analyzeFcstdProperties(dir, { batch_dir: "scope" });
    expect(plan.scanned).toBe(2); expect(plan.files).toEqual([]); expect(plan.errors).toHaveLength(2);
  });
  it("restores original bytes on atomic write failure and reports failure", async () => {
    const dir = root(); const file = fixture(dir); const original = fs.readFileSync(file);
    const plan = await analyzeFcstdProperties(dir);
    const rename = fs.renameSync.bind(fs); let calls = 0;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (++calls === 2) throw new Error("injected"); rename(from, to); });
    try { expect(applyFcstdPropertyRepairs(dir, { plan_id: plan.plan_id, files: ["part.FCStd"] }).results[0].status).toBe("failed"); }
    finally { spy.mockRestore(); }
    expect(fs.readFileSync(file)).toEqual(original); expect(fs.readdirSync(dir)).toEqual(["part.FCStd"]);
  });
});
