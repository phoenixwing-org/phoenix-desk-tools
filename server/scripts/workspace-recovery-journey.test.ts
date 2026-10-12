import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceRecoveryService, workspaceRecoveryFailure } from "../src/features/workspace-recovery/service.js";
import { loadFileWorksets } from "../src/lib/fileWorksetService.js";
import { createRecoveryFixture, runRecoveryJourney, type RecoveryFixture, type RecoveryJourneyResponse } from "./workspace-recovery-journey.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function ownedRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "recovery-journey-contract-"))); roots.push(root); return root;
}

// Deliberately in-process: this adapter proves the helper assertions against
// real domain IO, not TCP, the app Origin guard, or an installed Tauri process.
function domainAdapter(fixture: RecoveryFixture) {
  let workspace = "", service = createWorkspaceRecoveryService({ currentWorkspace: () => workspace });
  const activations: string[] = [];
  let restarts = 0;
  const field = (body: Readonly<Record<string, unknown>> | undefined, key: string) => {
    const value = body?.[key]; if (typeof value !== "string") throw new Error(`missing ${key}`); return value;
  };
  const request = async (route: string, body?: Readonly<Record<string, unknown>>, headers?: Readonly<Record<string, string>>): Promise<RecoveryJourneyResponse> => {
    if (headers?.origin === "https://untrusted.invalid") return { status: 403, body: { code: "origin_forbidden" } };
    if (route === "/api/workspace") {
      if (body) { workspace = field(body, "path"); activations.push(workspace); }
      return { status: 200, body: { path: workspace } };
    }
    if (route === "/api/phoenix/database/recreate") return { status: 409, body: { code: "recovery_required" } };
    try {
      switch (route) {
        case "/api/workspace-recovery/backup": return { status: 200, body: await service.backup(field(body, "workspace"), field(body, "target_directory"), body?.confirmed === true) };
        case "/api/workspace-recovery/inspect": return { status: 200, body: { ...await service.inspect(field(body, "workspace"), field(body, "backup_directory")) } };
        case "/api/workspace-recovery/restore": return { status: 200, body: await service.restore(field(body, "workspace"), field(body, "inspection_id"), field(body, "target_directory"), body?.confirmed === true) };
        case "/api/workspace-recovery/release": return { status: 200, body: service.release(field(body, "workspace"), field(body, "inspection_id")) };
        default: throw new Error("unexpected adapter route");
      }
    } catch (error) {
      const failure = workspaceRecoveryFailure(error); return { status: failure.status, body: { code: failure.code } };
    }
  };
  return {
    fixture, request,
    setWorkspace: async (selected: string) => { const result = await request("/api/workspace", { path: selected }); expect(result.status).toBe(200); expect(result.body.path).toBe(selected); },
    restart: async () => { service.dispose(); service = createWorkspaceRecoveryService({ currentWorkspace: () => workspace }); restarts += 1; },
    dispose: () => service.dispose(), activations, restarts: () => restarts,
  };
}

describe("independent recovery journey fixtures and caller-owned adapters", () => {
  it("constructs real Schema13 with independent manual fields, BLOB, unknown table/index/trigger/view and opaque outbox", () => {
    const fixture = createRecoveryFixture(ownedRoot()), filename = path.join(fixture.workspace, ".phoenix/phoenix-workspace.sqlite");
    const db = new DatabaseSync(filename, { readOnly: true });
    try {
      expect(db.prepare("SELECT value FROM phoenix_meta WHERE key='schema_version'").get()).toEqual({ value: "13" });
      expect(db.prepare("SELECT note,opaque FROM independent_record").get()).toEqual({ note: "independent manual field", opaque: new Uint8Array([0, 255, 7]) });
      expect(db.prepare("SELECT type FROM sqlite_master WHERE name IN ('independent_note','independent_trigger','independent_view') ORDER BY type").all()).toEqual([{ type: "index" }, { type: "trigger" }, { type: "view" }]);
    } finally { db.close(); }
    expect(fixture.payloads.size).toBe(4);
    expect(fs.readFileSync(path.join(fixture.workspace, ".phoenix/outbox/.hidden.txt"), "utf8")).toBe("independent hidden value");
    expect(fs.readdirSync(path.join(fixture.workspace, ".phoenix/outbox/nested/empty"))).toEqual([]);
    fixture.unchanged();
  });

  it("cold-reads the initialized empty worksets through the real loader without changing the original database bytes", () => {
    const fixture = createRecoveryFixture(ownedRoot()), filename = path.join(fixture.workspace, ".phoenix/phoenix-workspace.sqlite");
    const original = fs.readFileSync(filename);
    expect(original).toEqual(fixture.payloads.get(".phoenix/phoenix-workspace.sqlite"));
    const db = new DatabaseSync(filename, { readOnly: true });
    try {
      expect(db.prepare("SELECT value FROM phoenix_meta WHERE key='node_file_worksets_json_imported'").get()).toEqual({ value: "1" });
    } finally { db.close(); }
    expect(loadFileWorksets(fixture.workspace)).toMatchObject({ version: 1, storage: "sqlite", workspace_path: fixture.workspace, worksets: [] });
    expect(fs.readFileSync(filename)).toEqual(original);
    fixture.unchanged();
  });

  it.each(["relative", "noncanonical"] as const)("refuses a %s fixture root before creating source directories", kind => {
    const root = ownedRoot(); expect(() => createRecoveryFixture(kind === "relative" ? "relative-root" : `${root}/.`)).toThrow(/absolute and canonical/);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("does not overwrite a caller's existing source directory or sentinel", () => {
    const root = ownedRoot(); fs.mkdirSync(path.join(root, "source")); fs.writeFileSync(path.join(root, "source/sentinel.txt"), "keep existing");
    expect(() => createRecoveryFixture(root)).toThrow();
    expect(fs.readFileSync(path.join(root, "source/sentinel.txt"), "utf8")).toBe("keep existing");
    expect(fs.existsSync(path.join(root, "other"))).toBe(false);
  });

  it("detects database-byte mutation rather than accepting schema/count equivalence", () => {
    const fixture = createRecoveryFixture(ownedRoot()), filename = path.join(fixture.workspace, ".phoenix/phoenix-workspace.sqlite");
    const original = fs.readFileSync(filename), changed = Buffer.from(original); changed[changed.length - 1] ^= 1; fs.writeFileSync(filename, changed);
    expect(() => fixture.unchanged()).toThrow(); fs.writeFileSync(filename, original); fixture.unchanged();
  });

  it("runs the thirteen preserved journey assertions using a deterministic domain adapter, not an HTTP/app claim", async () => {
    const fixture = createRecoveryFixture(ownedRoot()), adapters = domainAdapter(fixture);
    try {
      expect(await runRecoveryJourney(adapters)).toEqual([
        "real-origin-guard", "active-workspace-bound", "explicit-confirmation-required", "original-recreate-disabled",
        "real-schema13-raw-backup", "bounded-plain-inspection-dto", "existing-target-kept", "new-directory-restore-without-activation",
        "single-attempt-handle", "valid-replacement-package-rejected", "explicit-release", "workspace-switch-invalidates-and-releases", "restart-invalidates-inspections",
      ]);
      expect(adapters.activations).toEqual([fixture.workspace, fixture.other, fixture.workspace]); expect(adapters.restarts()).toBe(1);
      fixture.unchanged(); fixture.compare(path.join(fixture.root, "restored"));
      expect(fs.existsSync(path.join(fixture.root, "occupied/.phoenix/workspace-recovery.complete.v1.json"))).toBe(false);
    } finally { adapters.dispose(); }
  });

  it.each(["fileCount", "totalBytes", "warnings"] as const)("rejects malformed backup receipt %s instead of marking raw backup successful", async key => {
    const fixture = createRecoveryFixture(ownedRoot()), adapters = domainAdapter(fixture);
    const request: typeof adapters.request = async (...args) => {
      const response = await adapters.request(...args);
      if (args[0] === "/api/workspace-recovery/backup" && response.status === 200) {
        const receipt = response.body.receipt as Record<string, unknown>;
        return { status: 200, body: { receipt: { ...receipt, [key]: key === "warnings" ? [1] : -1 } } };
      }
      return response;
    };
    try { await expect(runRecoveryJourney({ ...adapters, request })).rejects.toThrow(); fixture.unchanged(); }
    finally { adapters.dispose(); }
  });

  it.each(["manifest", "files"] as const)("rejects an inspection DTO exposing %s", async key => {
    const fixture = createRecoveryFixture(ownedRoot()), adapters = domainAdapter(fixture);
    const request: typeof adapters.request = async (...args) => {
      const response = await adapters.request(...args); return args[0] === "/api/workspace-recovery/inspect" && response.status === 200
        ? { status: 200, body: { ...response.body, [key]: [] } } : response;
    };
    try { await expect(runRecoveryJourney({ ...adapters, request })).rejects.toThrow(/must not return manifest or files/); fixture.unchanged(); }
    finally { adapters.dispose(); }
  });

  it("restores the independent source bytes when the equal-count replacement package request fails", async () => {
    const fixture = createRecoveryFixture(ownedRoot()), adapters = domainAdapter(fixture);
    const request: typeof adapters.request = async (...args) => {
      if (args[0] === "/api/workspace-recovery/backup" && args[1]?.target_directory === path.join(fixture.root, "second-package")) throw new Error("transport failed on synthetic second package");
      return adapters.request(...args);
    };
    try { await expect(runRecoveryJourney({ ...adapters, request })).rejects.toThrow(/synthetic second package/); fixture.unchanged(); }
    finally { adapters.dispose(); }
  });
});
