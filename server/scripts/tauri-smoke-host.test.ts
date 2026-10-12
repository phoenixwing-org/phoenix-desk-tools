import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createIsolatedLaunch, prepareOwnedRestart, readOwnedHandoff, writeOwnedQuit, verifyIsolatedLaunch } from "./tauri-smoke-host.mjs";

const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-isolated-host-unit-"))); roots.push(root);
  const config = createIsolatedLaunch(root, randomUUID());
  const child = { pid: 70001, exitCode: null as number | null, signalCode: null as string | null, killed: false };
  const instance = randomUUID();
  const handoff = { kind: "phoenix.desk.isolated-host-handoff", schema_version: 1, profile_version: 1, isolated_launch_version: 1,
    run_id: config.runId, host_pid: child.pid, sidecar_pid: 70002, instance_id: instance,
    api_origin: "http://127.0.0.1:48001", api_source: "managed", runtime_user_data_dir: config.userData,
    registration_dir: config.registrationDirectory, quit_request_file: "host-recovery-smoke.quit.v1.json" };
  const registration = { schema_version: 1, service: "phoenix-desk-tools", protocol_version: 1,
    app_version: "1.2.3", host: "127.0.0.1", port: 48001, pid: 70002, instance_id: instance };
  const write = () => { fs.writeFileSync(config.handoffFile, JSON.stringify(handoff));
    fs.writeFileSync(path.join(config.registrationDirectory, "service.v1.json"), JSON.stringify(registration)); };
  write(); return { root, config, child, handoff, registration, write };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("isolated installed-smoke launch and ownership adapter", () => {
  it("allowlists system environment while retaining genuine home and isolating all data entries", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-isolated-env-unit-"))); roots.push(root);
    const parent = { HOME: "unchanged-home", USERPROFILE: "unchanged-profile", CFFIXED_USER_HOME: "unchanged-cf", PATH: "system-path",
      PHOENIX_LEGACY_USER_DATA_DIR: "outside-old-data", PHOENIX_APP_CONFIG_PATH: "outside-config", PHOENIX_WING_ROOT: "outside-source",
      PHOENIX_RUNTIME_CATALOG_PATH: "outside-db", NODE_OPTIONS: "--require=outside-code", NODE_PATH: "outside-modules", PRIVATE_TOKEN: "not-forwarded" };
    const before = { ...parent }, config = createIsolatedLaunch(root, randomUUID(), parent);
    expect(parent).toEqual(before);
    for (const key of ["HOME", "USERPROFILE", "CFFIXED_USER_HOME"] as const) expect(config.environment[key]).toBe(parent[key]);
    expect(config.environment.PHOENIX_LEGACY_USER_DATA_DIR).toBe(config.userData);
    expect(config.environment.PHOENIX_USER_DATA_DIR).toBe(config.userData);
    expect(config.environment.PHOENIX_TAURI_USER_DATA_DIR).toBe(config.userData);
    expect(config.environment.PHOENIX_DESK_TOOLS_REGISTRY_DIR).toBe(config.registrationDirectory);
    for (const key of ["PHOENIX_APP_CONFIG_PATH", "PHOENIX_WING_ROOT", "NODE_OPTIONS", "NODE_PATH", "PRIVATE_TOKEN"]) expect(config.environment[key]).toBeUndefined();
    expect(Object.isFrozen(config.environment)).toBe(true);
  });
  it("requires a real run id and refuses an existing launch marker", () => {
    const file = fixture(); expect(() => createIsolatedLaunch(file.root, "untrusted")).toThrow("UUID");
    expect(() => createIsolatedLaunch(file.root, randomUUID())).toThrow();
    expect(readOwnedHandoff(file.config, file.child, "1.2.3").host_pid).toBe(file.child.pid);
  });
  it("writes only a run-and-host-bound quit file after two-sided handoff validation", () => {
    const file = fixture(); writeOwnedQuit(file.config, file.child, "1.2.3");
    expect(JSON.parse(fs.readFileSync(file.config.quitFile, "utf8"))).toEqual({
      kind: "phoenix.desk.isolated-host-quit", schema_version: 1, run_id: file.config.runId, host_pid: file.child.pid });
    expect(() => writeOwnedQuit(file.config, file.child, "1.2.3")).toThrow();
  });
  it.each(["host", "sidecar", "instance", "origin", "source", "version", "root", "capability"])("rejects a different endpoint identity: %s", kind => {
    const file = fixture();
    if (kind === "host") file.handoff.host_pid++;
    if (kind === "sidecar") file.registration.pid++;
    if (kind === "instance") file.registration.instance_id = randomUUID();
    if (kind === "origin") file.handoff.api_origin = "http://127.0.0.1:48002";
    if (kind === "source") file.handoff.api_source = "reused";
    if (kind === "version") file.registration.app_version = "0.0.1";
    if (kind === "root") file.handoff.runtime_user_data_dir = path.join(file.root, "unrelated");
    if (kind === "capability") file.handoff.isolated_launch_version = 0;
    file.write(); expect(() => writeOwnedQuit(file.config, file.child, "1.2.3")).toThrow();
    expect(fs.existsSync(file.config.quitFile)).toBe(false);
  });
  it.each(["exited", "signalled", "killed"])("does not authorize a late/reused child handle: %s", state => {
    const file = fixture();
    if (state === "exited") file.child.exitCode = 0;
    if (state === "signalled") file.child.signalCode = "SIGTERM";
    if (state === "killed") file.child.killed = true;
    expect(() => readOwnedHandoff(file.config, file.child, "1.2.3")).toThrow("live child");
  });
  it("does not follow a substituted ownership-record symlink or cloned scope", () => {
    const file = fixture(); fs.unlinkSync(file.config.handoffFile);
    fs.symlinkSync(file.config.markerFile, file.config.handoffFile);
    expect(() => readOwnedHandoff(file.config, file.child, "1.2.3")).toThrow();
    expect(() => readOwnedHandoff({ ...file.config }, file.child, "1.2.3")).toThrow("unrecognized");
  });
  it("resets only matched records after actual child exit and registration release", () => {
    const file = fixture(), handoff = writeOwnedQuit(file.config, file.child, "1.2.3");
    expect(() => prepareOwnedRestart(file.config, file.child, handoff)).toThrow("live");
    file.child.exitCode = 0; fs.unlinkSync(path.join(file.config.registrationDirectory, "service.v1.json"));
    prepareOwnedRestart(file.config, file.child, handoff);
    expect(fs.existsSync(file.config.handoffFile)).toBe(false); expect(fs.existsSync(file.config.quitFile)).toBe(false);
    expect(fs.existsSync(file.config.markerFile)).toBe(true);
  });
  it("keeps a replaced quit record instead of deleting an unknown file for restart", () => {
    const file = fixture(), handoff = writeOwnedQuit(file.config, file.child, "1.2.3");
    const bytes = JSON.stringify({ kind: "unknown", run_id: file.config.runId, host_pid: file.child.pid });
    fs.writeFileSync(file.config.quitFile, bytes); file.child.exitCode = 0;
    expect(() => prepareOwnedRestart(file.config, file.child, handoff)).toThrow();
    expect(fs.readFileSync(file.config.quitFile, "utf8")).toBe(bytes);
  });
  it("rejects a replaced marker even when the run id and JSON bytes are copied", () => {
    const file = fixture(), bytes = fs.readFileSync(file.config.markerFile);
    fs.renameSync(file.config.markerFile, path.join(file.root, "old-marker.json"));
    fs.writeFileSync(file.config.markerFile, bytes, { flag: "wx", mode: 0o600 });
    expect(() => verifyIsolatedLaunch(file.config)).toThrow("marker identity changed");
  });
  it("rejects a replacement user-data directory without deleting any replacement bytes", () => {
    const file = fixture();
    fs.renameSync(file.config.userData, path.join(file.root, "old-user-data"));
    fs.mkdirSync(file.config.userData); fs.writeFileSync(path.join(file.config.userData, "sentinel.txt"), "keep replacement");
    expect(() => verifyIsolatedLaunch(file.config)).toThrow("user-data identity changed");
    expect(fs.readFileSync(path.join(file.config.userData, "sentinel.txt"), "utf8")).toBe("keep replacement");
  });
});
