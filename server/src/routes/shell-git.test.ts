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

function git(root: string, args: string[]): void {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "git failed").trim());
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe.skipIf(!gitAvailable)("shell Git routes", () => {
  it("runs the page workflow through init, status, diff, stage, commit, and restore", async () => {
    const home = tempRoot("shell-git-home-");
    const workspace = tempRoot("shell-git-workspace-");
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    vi.resetModules();
    const { shellRoutes } = await import("./shell.js");

    const activated = await shellRoutes.request("/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: workspace }),
    });
    expect(activated.status).toBe(200);
    await expect((await shellRoutes.request("/api/git/info")).json()).resolves.toMatchObject({
      git_installed: true,
      repo_initialized: false,
    });

    const initialized = await shellRoutes.request("/api/git/init", { method: "POST" });
    expect(initialized.status).toBe(200);
    git(workspace, ["config", "user.name", "Route Test"]);
    git(workspace, ["config", "user.email", "route-test@example.invalid"]);

    const rel = "目录/a b.txt";
    const target = path.join(workspace, "目录", "a b.txt");
    fs.mkdirSync(path.dirname(target));
    fs.writeFileSync(target, "one\n", "utf8");
    await expect((await shellRoutes.request("/api/git/changes")).json()).resolves.toMatchObject({
      untracked: [expect.objectContaining({ path: rel })],
      untracked_count: 1,
    });
    const untrackedDiff = await shellRoutes.request(
      "/api/git/diff?path=" + encodeURIComponent(rel) + "&scope=worktree",
    );
    expect(untrackedDiff.status).toBe(200);
    await expect(untrackedDiff.json()).resolves.toMatchObject({
      path: rel,
      has_diff: true,
      unified_diff: expect.stringContaining("+one"),
    });

    const staged = await shellRoutes.request("/api/git/stage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: [rel] }),
    });
    expect(staged.status).toBe(200);
    const committed = await shellRoutes.request("/api/git/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "route commit" }),
    });
    expect(committed.status).toBe(200);
    await expect(committed.json()).resolves.toMatchObject({
      committed_paths: [rel],
      message: "route commit",
    });

    fs.writeFileSync(target, "two\n", "utf8");
    const trackedDiff = await shellRoutes.request(
      "/api/git/diff?path=" + encodeURIComponent(rel) + "&scope=worktree",
    );
    await expect(trackedDiff.json()).resolves.toMatchObject({
      has_diff: true,
      unified_diff: expect.stringContaining("+two"),
    });
    const restored = await shellRoutes.request("/api/git/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: [rel], scope: "worktree" }),
    });
    expect(restored.status).toBe(200);
    expect(fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n")).toBe("one\n");

    const traversal = await shellRoutes.request("/api/git/stage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: ["../outside.txt"] }),
    });
    expect(traversal.status).toBe(400);
  }, 20_000);
});
