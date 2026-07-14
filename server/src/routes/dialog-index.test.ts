import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCaaApp } from "./dialog.js";

const roots: string[] = [];

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dialog-index-route-"));
  roots.push(root);
  const filename = path.join(root, "SampleUI.m", "Sample.CATDlg");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(
    filename,
    "CATDlgDialog RouteDialog {\nCATDlgPushButton ApplyButton;\n}\n",
    "utf8",
  );
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("CAA index routes", () => {
  it("persists scan results and serves filtered groups", async () => {
    const root = workspace();
    const app = createCaaApp();

    const before = await app.request(
      "/api/caa/index/groups?workspaceRoot=" + encodeURIComponent(root),
    );
    expect(before.status).toBe(200);
    await expect(before.json()).resolves.toMatchObject({ indexed: false, count: 0 });

    const scan = await app.request("/api/caa/index/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceRoot: root }),
    });
    expect(scan.status).toBe(200);
    await expect(scan.json()).resolves.toMatchObject({
      indexed: true,
      count: 1,
      stats: { changed: 1, reused: 0 },
    });

    const filtered = await app.request(
      "/api/caa/index/groups?workspaceRoot="
        + encodeURIComponent(root)
        + "&q="
        + encodeURIComponent("RouteDialog"),
    );
    await expect(filtered.json()).resolves.toMatchObject({
      indexed: true,
      count: 1,
      groups: [{
        groupKey: "SampleUI.m",
        items: [expect.objectContaining({ dialogName: "RouteDialog" })],
      }],
    });

    const missing = await app.request("/api/caa/index/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceRoot: path.join(root, "missing") }),
    });
    expect(missing.status).toBe(400);
  });
});
