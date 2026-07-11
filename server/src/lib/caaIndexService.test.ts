import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "phoenix-wing/db/pnwDbAdapter";
import {
  loadCaaDialogIndex,
  scanCaaDialogIndex,
} from "./caaIndexService.js";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";

const roots: string[] = [];

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caa-index-service-"));
  roots.push(root);
  return root;
}

function write(root: string, rel: string, text: string): void {
  const filename = path.join(root, rel);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, text, "utf8");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("CAA dialog SQLite index", () => {
  it("persists groups and coverage, reuses unchanged files, and marks removed dialogs missing", async () => {
    const root = workspace();
    write(
      root,
      "ModuleUI.m/dialog/First.CATDlg",
      "CATDlgDialog FirstDialog {\nCATDlgPushButton RunButton;\nCATDlgUnknownWidget Mystery;\n}\n",
    );
    write(
      root,
      "OtherUI.m/dialog/Second.CATDlg",
      "CATDlgDialog SecondDialog {\nCATDlgLabel TitleLabel;\n}\n",
    );

    const firstPromise = scanCaaDialogIndex(root);
    expect(scanCaaDialogIndex(root)).toBe(firstPromise);
    const first = await firstPromise;
    expect(first).toMatchObject({
      indexed: true,
      count: 2,
      stats: {
        dialogs: 2,
        changed: 2,
        reused: 0,
        missing: 0,
        control_type_coverage: {
          total_controls: 5,
          unknown_types: 1,
        },
      },
    });
    expect(first.last_scan_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(loadCaaDialogIndex(root, "First")).toMatchObject({
      indexed: true,
      count: 1,
      groups: [{
        groupKey: "ModuleUI.m",
        items: [expect.objectContaining({
          catDlgRel: "ModuleUI.m/dialog/First.CATDlg",
          dialogName: "FirstDialog",
        })],
      }],
    });

    const second = await scanCaaDialogIndex(root);
    expect(second.stats).toMatchObject({ changed: 0, reused: 2, missing: 0 });

    write(
      root,
      "ModuleUI.m/dialog/First.CATDlg",
      "CATDlgDialog RenamedDialog {\nCATDlgPushButton RunButton;\nCATDlgLabel MoreText;\n}\n",
    );
    fs.unlinkSync(path.join(root, "OtherUI.m", "dialog", "Second.CATDlg"));
    const third = await scanCaaDialogIndex(root);
    expect(third).toMatchObject({
      count: 1,
      stats: { changed: 1, reused: 0, missing: 1 },
    });
    expect(loadCaaDialogIndex(root).groups[0]?.items[0]).toMatchObject({
      dialogName: "RenamedDialog",
    });

    const db = pnwCreateDb(phoenixDatabasePath(root));
    try {
      expect(db.get<{ file_status: string }>(
        "SELECT file_status FROM phoenix_caa_dialog WHERE repo_rel_catdlg = ?",
        ["OtherUI.m/dialog/Second.CATDlg"],
      )?.file_status).toBe("missing");
      expect(Number(db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM phoenix_caa_scan",
      )?.count)).toBe(3);
    } finally {
      db.close();
    }
  });

  it("returns a stable empty payload before scanning and rejects invalid scan roots", async () => {
    const root = workspace();
    expect(loadCaaDialogIndex(root)).toMatchObject({
      workspaceRoot: root,
      count: 0,
      indexed: false,
      last_scan_at: null,
    });
    expect(() => scanCaaDialogIndex(path.join(root, "missing")))
      .toThrow("not a valid directory");
  });
});
