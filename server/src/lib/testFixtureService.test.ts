import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncTestFixtureCheckouts } from "./testFixtureService.js";

const roots: string[] = [];
const gitAvailable = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;

function tempRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label));
  roots.push(root);
  return root;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "git command failed").trim());
  }
}

function makeSourceRepository(root: string): string {
  const source = path.join(root, "source repo");
  fs.mkdirSync(source);
  git(source, ["init"]);
  git(source, ["config", "user.name", "Fixture Test"]);
  git(source, ["config", "user.email", "fixture@example.invalid"]);
  fs.writeFileSync(path.join(source, "README.md"), "fixture\n", "utf8");
  git(source, ["add", "README.md"]);
  git(source, ["commit", "-m", "fixture"]);
  return source;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe.skipIf(!gitAvailable)("test fixture checkout service", () => {
  it("clones a selected catalog repository and recognizes the existing checkout", () => {
    const root = tempRoot("test-fixture-service-");
    const source = makeSourceRepository(root);
    const checkoutRoot = path.join(root, "checkouts");
    fs.mkdirSync(checkoutRoot);
    const catalog = [{ name: "LocalFixture", clone_url: source }];

    expect(syncTestFixtureCheckouts({
      checkoutRoot,
      enabled: ["LocalFixture"],
      catalog,
    })).toEqual([{
      name: "LocalFixture",
      status: "cloned",
      detail: "Cloned to " + path.join(checkoutRoot, "LocalFixture"),
    }]);
    expect(
      fs.readFileSync(path.join(checkoutRoot, "LocalFixture", "README.md"), "utf8").replace(/\r\n/g, "\n"),
    ).toBe("fixture\n");

    expect(syncTestFixtureCheckouts({
      checkoutRoot,
      enabled: ["LocalFixture"],
      catalog,
    })).toEqual([{
      name: "LocalFixture",
      status: "existing",
      detail: "Already checked out at " + path.join(checkoutRoot, "LocalFixture"),
    }]);
  }, 20_000);

  it("does not treat a conflicting ordinary directory as a completed checkout", () => {
    const root = tempRoot("test-fixture-conflict-");
    const checkoutRoot = path.join(root, "checkouts");
    fs.mkdirSync(path.join(checkoutRoot, "LocalFixture"), { recursive: true });

    const [result] = syncTestFixtureCheckouts({
      checkoutRoot,
      enabled: ["LocalFixture"],
      catalog: [{ name: "LocalFixture", clone_url: path.join(root, "source") }],
    });
    expect(result).toMatchObject({ name: "LocalFixture", status: "error" });
    expect(result?.detail).toContain("not a Git worktree");
  });

  it("reports unknown or unsafe catalog entries without escaping the checkout root", () => {
    const root = tempRoot("test-fixture-safety-");
    const checkoutRoot = path.join(root, "checkouts");
    fs.mkdirSync(checkoutRoot);

    const results = syncTestFixtureCheckouts({
      checkoutRoot,
      enabled: ["Unknown", "../escape"],
      catalog: [{ name: "../escape", clone_url: path.join(root, "source") }],
    });
    expect(results).toEqual([
      { name: "Unknown", status: "error", detail: "Fixture is not present in the built-in catalog" },
      { name: "../escape", status: "error", detail: "Unsafe fixture name: ../escape" },
    ]);
    expect(fs.existsSync(path.join(root, "escape"))).toBe(false);
  });

  it("cleans a failed temporary clone and leaves the final target absent", () => {
    const root = tempRoot("test-fixture-failed-");
    const checkoutRoot = path.join(root, "checkouts");
    fs.mkdirSync(checkoutRoot);

    const [result] = syncTestFixtureCheckouts({
      checkoutRoot,
      enabled: ["MissingFixture"],
      catalog: [{ name: "MissingFixture", clone_url: path.join(root, "missing-source") }],
    });
    expect(result).toMatchObject({ name: "MissingFixture", status: "error" });
    expect(fs.existsSync(path.join(checkoutRoot, "MissingFixture"))).toBe(false);
    expect(fs.readdirSync(checkoutRoot).filter((name) => name.startsWith(".phoenix-fixture-"))).toEqual([]);
  });

  it("rejects an empty selection before invoking clone", () => {
    const checkoutRoot = tempRoot("test-fixture-empty-");
    expect(() => syncTestFixtureCheckouts({
      checkoutRoot,
      enabled: [],
      catalog: [],
    })).toThrow("Please select at least one test fixture");
  });
});
