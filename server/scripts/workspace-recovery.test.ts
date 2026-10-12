import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { parseWorkspaceRecoveryCommand, runWorkspaceRecoveryCommand } from "./workspace-recovery.js";

const absolute = path.resolve("synthetic-path");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe("workspace recovery CLI authorization", () => {
  it("shows help without touching any workspace", async () => {
    expect(parseWorkspaceRecoveryCommand([])).toEqual({ action: "help" });
    await expect(runWorkspaceRecoveryCommand(["--help"])).resolves.toMatchObject({ usage: expect.stringContaining("不包含 CAD") });
  });
  it("requires explicitly named absolute paths and confirmation for new targets", () => {
    expect(parseWorkspaceRecoveryCommand(["backup", "--workspace", absolute, "--destination", absolute, "--confirmed"])).toEqual({ action: "backup", workspace: absolute, destination: absolute });
    expect(parseWorkspaceRecoveryCommand(["restore", "--backup", absolute, "--destination", absolute, "--confirmed"])).toEqual({ action: "restore", backup: absolute, destination: absolute });
    expect(parseWorkspaceRecoveryCommand(["inspect", "--backup", absolute])).toEqual({ action: "inspect", backup: absolute });
  });
  it.each([
    ["recreate"], ["backup"], ["restore", "--backup", absolute, "--destination", absolute],
    ["backup", "--workspace", "relative", "--destination", absolute, "--confirmed"],
    ["inspect", "--backup", ""], ["inspect", "--backup", `${absolute}\0x`],
    ["inspect", "--backup", absolute, "--backup", absolute],
    ["inspect", "--backup", absolute, "--confirmed"],
    ["restore", "--backup", absolute, "--destination", absolute, "--confirmed", "--overwrite"],
    ["backup", "--workspace", absolute, "--destination", absolute, "--confirmed", "--confirmed"],
    ["restore", "--backup", absolute, "--destination", absolute, "--confirmed", "false"],
  ].map((args, caseId) => ({ args, caseId })))("refuses missing/unknown/duplicate arguments [case $caseId]", ({ args }) => {
    expect(() => parseWorkspaceRecoveryCommand(args)).toThrow();
  });

  it("executes the actual CLI backup/inspect/isolated restore without changing source or overwriting targets", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-recovery-cli-"))); roots.push(root);
    const workspace = path.join(root, "source"), backup = path.join(root, "backup"), restored = path.join(root, "restored");
    fs.mkdirSync(path.join(workspace, ".phoenix", "outbox", "empty"), { recursive: true });
    const database = path.join(workspace, ".phoenix", "phoenix-workspace.sqlite");
    const db = new DatabaseSync(database);
    db.exec("CREATE TABLE manual_note (value BLOB); INSERT INTO manual_note VALUES (X'00ff10'); CREATE INDEX note_value ON manual_note(value)");
    db.close();
    const bytes = fs.readFileSync(database);
    fs.writeFileSync(path.join(workspace, ".phoenix", "outbox", ".opaque"), Buffer.from([255, 0, 13]));
    const script = fileURLToPath(new URL("./workspace-recovery.ts", import.meta.url));
    const server = fileURLToPath(new URL("..", import.meta.url));
    const execute = (...args: string[]) => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", script, ...args], { cwd: server, encoding: "utf8", timeout: 10000 }));
    expect(execute("backup", "--workspace", workspace, "--destination", backup, "--confirmed")).toMatchObject({ backupDirectory: backup, fileCount: 2 });
    expect(execute("inspect", "--backup", backup)).toMatchObject({ state: "complete", fileCount: 2 });
    expect(execute("restore", "--backup", backup, "--destination", restored, "--confirmed")).toMatchObject({ workspace: restored, fileCount: 2 });
    expect(fs.readFileSync(path.join(restored, ".phoenix", "phoenix-workspace.sqlite"))).toEqual(bytes);
    expect(fs.readFileSync(path.join(restored, ".phoenix", "outbox", ".opaque"))).toEqual(Buffer.from([255, 0, 13]));
    expect(fs.statSync(path.join(restored, ".phoenix", "outbox", "empty")).isDirectory()).toBe(true);
    expect(fs.readFileSync(database)).toEqual(bytes);
    const duplicate = spawnSync(process.execPath, ["--import", "tsx", script, "restore", "--backup", backup, "--destination", restored, "--confirmed"], { cwd: server, encoding: "utf8", timeout: 10000 });
    expect(duplicate.status).toBe(1);
    expect(JSON.parse(duplicate.stderr.trim().split("\n").find(line => line.startsWith("{"))!)).toMatchObject({ code: "conflict" });
    expect(fs.readFileSync(path.join(restored, ".phoenix", "phoenix-workspace.sqlite"))).toEqual(bytes);
  });
});
