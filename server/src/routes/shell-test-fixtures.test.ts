import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const gitAvailable = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;

function tempRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label));
  roots.push(root);
  return root;
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe.skipIf(!gitAvailable)("test fixture routes", () => {
  it("persists selection, recognizes a checkout, and syncs only requested enabled fixtures", async () => {
    const home = tempRoot("shell-test-fixtures-home-");
    const checkoutRoot = tempRoot("shell-test-fixtures-checkouts-");
    const fixture = path.join(checkoutRoot, "KtAlarmClock");
    fs.mkdirSync(fixture);
    expect(spawnSync("git", ["-C", fixture, "init"], { encoding: "utf8" }).status).toBe(0);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    vi.resetModules();
    const { shellRoutes } = await import("./shell.js");

    const saved = await shellRoutes.request("/api/test-fixtures", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkout_root: checkoutRoot, enabled: ["KtAlarmClock"] }),
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      checkout_root: checkoutRoot,
      enabled: ["KtAlarmClock"],
      items: expect.arrayContaining([
        expect.objectContaining({ name: "KtAlarmClock", checkout_exists: true }),
      ]),
    });

    const synced = await shellRoutes.request("/api/test-fixtures/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        checkout_root: checkoutRoot,
        enabled: ["KtAlarmClock"],
        names: ["KtAlarmClock"],
      }),
    });
    expect(synced.status).toBe(200);
    await expect(synced.json()).resolves.toMatchObject({
      sync_results: [{
        name: "KtAlarmClock",
        status: "existing",
        detail: "Already checked out at " + fixture,
      }],
    });

    const disabled = await shellRoutes.request("/api/test-fixtures/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        checkout_root: checkoutRoot,
        enabled: ["KtAlarmClock"],
        names: ["PNXCaaStudy"],
      }),
    });
    expect(disabled.status).toBe(400);
    await expect(disabled.json()).resolves.toMatchObject({
      detail: "Requested fixtures must be enabled before checkout",
    });
  });
});
