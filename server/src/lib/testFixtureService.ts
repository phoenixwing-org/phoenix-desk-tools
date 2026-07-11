import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface TestFixtureCatalogEntry {
  name: string;
  description?: string;
  clone_url: string;
}

export interface TestFixtureSyncResult {
  name: string;
  status: "cloned" | "existing" | "error";
  detail: string;
}

type GitResult = {
  status: number;
  stdout: string;
  stderr: string;
};

export type TestFixtureGitRunner = (args: string[]) => GitResult;

function runGit(args: string[]): GitResult {
  const proc = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    status: proc.status ?? 1,
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
  };
}

function resultDetail(result: GitResult, fallback: string): string {
  return (result.stderr || result.stdout || fallback).trim();
}

function isSafeFixtureName(name: string): boolean {
  return Boolean(name)
    && name !== "."
    && name !== ".."
    && path.basename(name) === name
    && /^[A-Za-z0-9._-]+$/.test(name);
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function removeTemporaryCheckout(root: string, candidate: string): void {
  if (!isInside(root, candidate) || !path.basename(candidate).startsWith(".phoenix-fixture-")) return;
  fs.rmSync(candidate, { recursive: true, force: true });
}

export function syncTestFixtureCheckouts(options: {
  checkoutRoot: string;
  enabled: string[];
  catalog: TestFixtureCatalogEntry[];
  runGit?: TestFixtureGitRunner;
}): TestFixtureSyncResult[] {
  const checkoutRoot = path.resolve(options.checkoutRoot);
  const stat = fs.statSync(checkoutRoot);
  if (!stat.isDirectory()) throw new Error(`Not a valid checkout root: ${checkoutRoot}`);
  fs.accessSync(checkoutRoot, fs.constants.R_OK | fs.constants.W_OK);

  const names = [...new Set(options.enabled.map((name) => String(name || "").trim()).filter(Boolean))];
  if (!names.length) throw new Error("Please select at least one test fixture");

  const git = options.runGit ?? runGit;
  const version = git(["--version"]);
  if (version.status !== 0) throw new Error(resultDetail(version, "Git is not installed or is not available on PATH"));

  const catalog = new Map(
    options.catalog
      .map((entry) => ({ ...entry, name: String(entry?.name || "").trim() }))
      .filter((entry) => entry.name)
      .map((entry) => [entry.name, entry] as const),
  );
  const results: TestFixtureSyncResult[] = [];

  for (const name of names) {
    const entry = catalog.get(name);
    if (!entry) {
      results.push({ name, status: "error", detail: "Fixture is not present in the built-in catalog" });
      continue;
    }
    if (!isSafeFixtureName(name)) {
      results.push({ name, status: "error", detail: `Unsafe fixture name: ${name}` });
      continue;
    }
    const cloneUrl = String(entry.clone_url || "").trim();
    if (!cloneUrl) {
      results.push({ name, status: "error", detail: "Built-in fixture has no clone URL" });
      continue;
    }

    const target = path.resolve(checkoutRoot, name);
    if (!isInside(checkoutRoot, target)) {
      results.push({ name, status: "error", detail: "Fixture target escapes the checkout root" });
      continue;
    }

    if (fs.existsSync(target)) {
      let isDirectory = false;
      try {
        isDirectory = fs.statSync(target).isDirectory();
      } catch {
        isDirectory = false;
      }
      if (!isDirectory) {
        results.push({ name, status: "error", detail: `Checkout target exists and is not a directory: ${target}` });
        continue;
      }
      const repo = git(["-C", target, "rev-parse", "--is-inside-work-tree"]);
      if (repo.status === 0 && repo.stdout.trim() === "true") {
        results.push({ name, status: "existing", detail: `Already checked out at ${target}` });
      } else {
        results.push({
          name,
          status: "error",
          detail: `Checkout target exists but is not a Git worktree: ${target}`,
        });
      }
      continue;
    }

    const temporary = path.join(
      checkoutRoot,
      `.phoenix-fixture-${name}-${randomUUID()}`,
    );
    const cloned = git(["clone", "--depth", "1", cloneUrl, temporary]);
    if (cloned.status !== 0) {
      removeTemporaryCheckout(checkoutRoot, temporary);
      results.push({ name, status: "error", detail: resultDetail(cloned, `git clone failed for ${name}`) });
      continue;
    }
    try {
      if (fs.existsSync(target)) throw new Error(`Checkout target appeared while cloning: ${target}`);
      fs.renameSync(temporary, target);
      results.push({ name, status: "cloned", detail: `Cloned to ${target}` });
    } catch (error) {
      removeTemporaryCheckout(checkoutRoot, temporary);
      results.push({ name, status: "error", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  return results;
}
