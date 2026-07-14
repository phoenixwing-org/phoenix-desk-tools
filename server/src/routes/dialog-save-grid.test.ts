import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCaaApp } from "./dialog.js";

const tempRoots: string[] = [];

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caa-grid-save-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("CAA dialog grid-only save", () => {
  it("patches ROWRES/COLRES without requiring a full IR root", async () => {
    const workspace = makeWorkspace();
    const rel = "module/Test.CATDlg";
    const filename = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, [
      "CATDlgFrame FrameParams",
      "{",
      "  ROWRES = { 1 };",
      "  COLRES = { 0, 1 };",
      "}",
      "  FATHER = TestDlg;",
      "  STYLE = CATDlgFraNoFrame|CATDlgGridLayout;",
      "  GRID = { 0, 0, 1, 1, CATGRID_4SIDES };",
      "",
    ].join("\n"));

    const response = await createCaaApp().request("/api/caa/dialog/save-dialog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceRoot: workspace,
        catDlgRel: rel,
        patches: [{ nodeId: "FrameParams", rowResizable: [0, 2], colResizable: [1] }],
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, catDlgRel: rel, absPath: filename });

    const written = fs.readFileSync(filename, "utf8");
    expect(written).toContain("ROWRES = { 0, 2 };");
    expect(written).toContain("COLRES = { 1 };");
    expect(written).toContain("FATHER = TestDlg;");
  });
});
