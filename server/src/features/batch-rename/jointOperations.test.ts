import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { applyRenameTask, previewRenameTask } from "./service.js";
import { saveRenameTask, type RenameTaskDraft } from "./tasks.js";
import { activeRoots, previewFileChanges } from "./fileOperations.js";
import { previewDirectoryChanges } from "./directoryOperations.js";
import { resolveTaskRules } from "./rules.js";

const roots: string[] = [];
function temp() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "joint-rename-")); roots.push(root); return root; }
function fixture() {
  const workspace = temp(), root = temp();
  fs.mkdirSync(path.join(root, "Draft-parent/Draft-child"), { recursive: true });
  fs.writeFileSync(path.join(root, "Draft-parent/Draft-child/Draft.md"), "Draft\r\n", { mode: 0o640 });
  const draft: RenameTaskDraft = { name: "合成联合任务", roots: [root], mappings: [{ old: "Draft", target: "Released", enabled: true }], directories: true, filenames: true, contents: true, include_stem: false };
  return { workspace, root, draft };
}
async function plan(f: ReturnType<typeof fixture>, draft = f.draft) {
  const task = saveRenameTask(f.workspace, { draft });
  const query = { task_id: task.id, revision: task.revision };
  const preview = await previewRenameTask(f.workspace, query);
  return { preview, apply: (ids = preview.rows.filter(row => row.eligible).map(row => row.id)) => applyRenameTask(f.workspace, { ...query, plan_id: preview.plan_id, ids, confirmed: true }) };
}
afterEach(() => { vi.restoreAllMocks(); expect(activeRoots.size).toBe(0); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it.each([1, 2, 3, 4, 5, 6, 7])("supports scope combination %s without expanding a disabled scope", async mask => {
  const f = fixture(), directories = Boolean(mask & 1), filenames = Boolean(mask & 2), contents = Boolean(mask & 4);
  const p = await plan(f, { ...f.draft, directories, filenames, contents });
  const result = await p.apply();
  expect(result.failed).toBe(0);
  const rel = `${directories ? "Released" : "Draft"}-parent/${directories ? "Released" : "Draft"}-child/${filenames ? "Released" : "Draft"}.md`;
  expect(fs.readFileSync(path.join(f.root, rel), "utf8")).toBe(`${contents ? "Released" : "Draft"}\r\n`);
  expect(fs.statSync(path.join(f.root, rel)).mode & 0o777).toBe(0o640);
  if (filenames || contents) expect(result.results.find(row => row.rel.endsWith("Draft.md"))?.target).toBe(rel);
  expect(fs.existsSync(path.join(f.root, ".phoenix"))).toBe(false);
  await expect(p.apply()).rejects.toThrow("失效");
});

it.each(["parent", "child", "file"])("moves only the selected %s row", async selected => {
  const f = fixture(), p = await plan(f);
  const rel = selected === "parent" ? "Draft-parent" : selected === "child" ? "Draft-parent/Draft-child" : "Draft-parent/Draft-child/Draft.md";
  const result = await p.apply([p.preview.rows.find(row => row.rel === rel)!.id]);
  expect(result.applied).toBe(1); expect(result.failed).toBe(0);
  const final = `${selected === "parent" ? "Released" : "Draft"}-parent/${selected === "child" ? "Released" : "Draft"}-child/${selected === "file" ? "Released" : "Draft"}.md`;
  expect(fs.readFileSync(path.join(f.root, final), "utf8")).toBe(`${selected === "file" ? "Released" : "Draft"}\r\n`);
  expect(fs.existsSync(f.root)).toBe(true);
});

it("does not absorb an external edit after a successful content write into an ancestor snapshot", async () => {
  const f = fixture(); fs.writeFileSync(path.join(f.root, "Draft-parent/keep.txt"), "before");
  const p = await plan(f), rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
    rename(source, target);
    if (String(source).includes(".document-sync-") && String(target).endsWith("Draft.md")) fs.writeFileSync(path.join(f.root, "Draft-parent/keep.txt"), "external edit");
  });
  const result = await p.apply();
  expect(result.applied).toBe(2); expect(result.failed).toBe(1);
  expect(result.results.find(row => row.rel === "Draft-parent")?.message).toContain("变化");
  expect(fs.existsSync(path.join(f.root, "Released-parent"))).toBe(false);
  expect(fs.readFileSync(path.join(f.root, "Draft-parent/keep.txt"), "utf8")).toBe("external edit");
});

it("continues independent files but refuses ancestors containing a stale selected file", async () => {
  const f = fixture(); fs.writeFileSync(path.join(f.root, "other.txt"), "Draft");
  const p = await plan(f); fs.writeFileSync(path.join(f.root, "Draft-parent/Draft-child/Draft.md"), "external edit");
  const result = await p.apply();
  expect(result.applied).toBe(1); expect(result.failed).toBe(3);
  expect(fs.readFileSync(path.join(f.root, "other.txt"), "utf8")).toBe("Released");
  expect(fs.readFileSync(path.join(f.root, "Draft-parent/Draft-child/Draft.md"), "utf8")).toBe("external edit");
});

it("does not absorb a partially created file when removing its old source fails", async () => {
  const f = fixture(), p = await plan(f), unlink = fs.unlinkSync, source = fs.realpathSync(path.join(f.root, "Draft-parent/Draft-child/Draft.md"));
  vi.spyOn(fs, "unlinkSync").mockImplementation(file => {
    if (String(file) === source) throw new Error("synthetic remove failure");
    unlink(file);
  });
  const result = await p.apply();
  expect(result.failed).toBe(3); expect(result.applied).toBe(0);
  expect(result.results.find(row => row.rel.endsWith("Draft.md"))?.message).toContain("新文件已生成");
  expect(fs.existsSync(path.join(f.root, "Draft-parent/Draft-child/Released.md"))).toBe(true);
  expect(fs.existsSync(path.join(f.root, "Released-parent"))).toBe(false);
});

it("pins both accepted plans through runtime TTL expiry and unrelated preview cache turnover", async () => {
  const f = fixture(), p = await plan(f), other = temp();
  fs.mkdirSync(path.join(other, "Draft-folder")); fs.writeFileSync(path.join(other, "Draft.txt"), "Draft");
  const rules = resolveTaskRules(f.draft), rename = fs.renameSync, now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const pending: Array<ReturnType<typeof previewFileChanges>> = [];
  let injected = false;
  vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
    rename(source, target);
    if (!injected && String(source).includes(".document-sync-")) {
      injected = true; clock.mockReturnValue(now + 31 * 60_000);
      for (let index = 0; index < 9; index++) {
        previewDirectoryChanges(f.workspace, { roots: [other], filenames: false, contents: false }, rules, `extra:${index}`);
        pending.push(previewFileChanges(f.workspace, { roots: [other], filenames: true, contents: true }, rules, `extra:${index}`));
      }
    }
  });
  const result = await p.apply(); await Promise.all(pending);
  expect(injected).toBe(true); expect(result.applied).toBe(3); expect(result.failed).toBe(0);
  expect(fs.readFileSync(path.join(f.root, "Released-parent/Released-child/Released.md"), "utf8")).toBe("Released\r\n");
  await expect(p.apply()).rejects.toThrow("失效");
});

it("rejects cross-kind destination collisions before writing any item", async () => {
  const f = fixture(); fs.writeFileSync(path.join(f.root, "Alpha"), "keep"); fs.mkdirSync(path.join(f.root, "Beta"));
  const p = await plan(f, { ...f.draft, contents: false, mappings: [{ old: "Alpha", target: "Shared", enabled: true }, { old: "Beta", target: "Shared", enabled: true }] });
  expect(p.preview.rows).toHaveLength(2); expect(p.preview.rows.every(row => !row.eligible)).toBe(true);
  await expect(p.apply(p.preview.rows.map(row => row.id))).rejects.toThrow("无效");
  expect(fs.readFileSync(path.join(f.root, "Alpha"), "utf8")).toBe("keep");
});

it("preserves UTF8 BOM, GBK bytes, STEP and CATDrawing contents during joint directory moves", async () => {
  const f = fixture();
  const bom = Buffer.from("\ufeffDraft\r\n", "utf8"), gbk = Buffer.concat([Buffer.from("Draft "), Buffer.from([0xd6, 0xd0]), Buffer.from("\r\n")]);
  fs.writeFileSync(path.join(f.root, "Draft-parent/Draft-utf8.txt"), bom);
  fs.writeFileSync(path.join(f.root, "Draft-parent/Draft-gbk.txt"), gbk);
  for (const extension of ["stp", "CATDrawing"]) fs.writeFileSync(path.join(f.root, `Draft-parent/Draft.${extension}`), "Draft original");
  const p = await plan(f), result = await p.apply(); expect(result.failed).toBe(0);
  expect(fs.readFileSync(path.join(f.root, "Released-parent/Released-utf8.txt"))).toEqual(Buffer.from("\ufeffReleased\r\n", "utf8"));
  expect(fs.readFileSync(path.join(f.root, "Released-parent/Released-gbk.txt"))).toEqual(Buffer.concat([Buffer.from("Released "), gbk.subarray(6)]));
  for (const extension of ["stp", "CATDrawing"]) expect(fs.readFileSync(path.join(f.root, `Released-parent/Released.${extension}`), "utf8")).toBe("Draft original");
});
