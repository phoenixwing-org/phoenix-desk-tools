import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  acknowledgeCaaDialogOpenRequests,
  clearCaaDialogOpenRequestsForTests,
  enqueueCaaDialogOpenPayload,
  listCaaDialogOpenRequests,
} from "./caaDialogOpenRequestService.js";

const roots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caa-open-request-"));
  roots.push(root);
  const file = path.join(root, "UI.m", "Sample.CATDlg");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "CATDlgDialog Sample {}\n");
  return { root, file };
}

afterEach(() => {
  clearCaaDialogOpenRequestsForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("CAA dialog open request bridge", () => {
  it("keeps a direct executable/API payload until the UI acknowledges it", async () => {
    const { root, file } = fixture();
    await expect(enqueueCaaDialogOpenPayload({ workspaceRoot: root, file })).resolves.toMatchObject([
      { id: 1, workspaceRoot: root, catDlgRel: "UI.m/Sample.CATDlg" },
    ]);
    expect(listCaaDialogOpenRequests()).toHaveLength(1);
    expect(listCaaDialogOpenRequests()).toHaveLength(1);
    expect(acknowledgeCaaDialogOpenRequests([1, 999])).toEqual([1]);
    expect(listCaaDialogOpenRequests()).toEqual([]);
  });

  it("accepts the VS Code v1 handoff and rejects paths outside the workspace", async () => {
    const { root, file } = fixture();
    await expect(enqueueCaaDialogOpenPayload({
      protocol: "phoenix-desk-tools.caa-dialog.v1",
      workspaceUri: pathToFileURL(root).toString(),
      selectedFiles: [{ uri: pathToFileURL(file).toString(), relativePath: "ignored-display-value" }],
    })).resolves.toHaveLength(1);

    await expect(enqueueCaaDialogOpenPayload({ workspaceRoot: root, file: __filename }))
      .rejects.toThrow("必须位于工作空间内");
  });
});
