import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function source(name: string) { return fs.readFileSync(new URL(name, import.meta.url), "utf8"); }
function envFields(text: string) {
  const tree = ts.createSourceFile("smoke.mjs", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const values = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node)) values.set(node.name.getText(tree), node.initializer.getText(tree));
    ts.forEachChild(node, visit);
  }
  visit(tree); return values;
}
const cliSource = source("smoke-workspace-recovery.mjs");
const cliTree = ts.createSourceFile("recovery-smoke.mjs", cliSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function functionNode(name: string) {
  const node = cliTree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert(node?.body, `missing actual CLI function ${name}`);
  return node;
}
// Execute only the actual AST-selected pure function, not the CLI or an HTTP
// substitute. There is no filesystem/child-process/global environment in this VM.
function pureFunction<T>(name: string): T {
  return vm.runInNewContext(`(${functionNode(name).getText(cliTree)})`, { assert, path }) as T;
}
type ChildIdentity = { pid?: number; exitCode: number | null; signalCode: string | null; killed: boolean };
type RegistrationValidator = (proof: Record<string, unknown>, child: ChildIdentity, version: string, port: number, instance?: string) => string;
const validateOwnedRegistration = pureFunction<RegistrationValidator>("validateOwnedRegistration");
const instance = "8d2e5967-520b-4cf7-988e-3dfd2f20d5a1";
function registrationFixture() {
  return { proof: { schema_version: 1, service: "phoenix-desk-tools", protocol_version: 1, app_version: "1.2.3", host: "127.0.0.1", port: 48001, pid: 70002, instance_id: instance } as Record<string, unknown>,
    child: { pid: 70002, exitCode: null, signalCode: null, killed: false } as ChildIdentity };
}
describe("recovery smoke isolation and evidence boundary", () => {
  it("isolates legacy imports without replacing the user's home in the shared runner", () => {
    const fields = envFields(cliSource);
    expect(fields.get("PHOENIX_USER_DATA_DIR")).toBe("userData");
    expect(fields.get("PHOENIX_LEGACY_USER_DATA_DIR")).toBe("userData");
    for (const key of ["HOME", "home", "USERPROFILE", "CFFIXED_USER_HOME"]) expect(fields.has(key)).toBe(false);
  });
  it.each([
    ["smoke-server-bundle.mjs", "bundle"], ["smoke-tauri-runtime.mjs", "runtime"],
  ])("ordinary %s delegates only to the controlled %s journey", (name, mode) => {
    const text = source(name), tree = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const statements = tree.statements;
    expect(statements).toHaveLength(3);
    expect(statements[0].getText(tree)).toBe(`if (process.argv.length !== 2) throw new Error("usage: node scripts/${name}");`);
    expect(statements[1].getText(tree)).toBe(`process.argv.push("${mode}");`);
    expect(statements[2].getText(tree)).toBe('await import("./smoke-workspace-recovery.mjs");');
    expect(text).not.toMatch(/fetch\(|spawn\(|process\.env|fs\.|kill\(|\b(?:48598|48_598|5198)\b/u);
    // Execute the actual CLI statements in a VM with only the import expression
    // intercepted. This is adapter wiring evidence, never a real HTTP claim.
    const importCall = (statements[2] as ts.ExpressionStatement).expression as ts.AwaitExpression;
    const wire = text.slice(0, importCall.expression.getStart(tree)) + 'capture("./smoke-workspace-recovery.mjs")' + text.slice(importCall.expression.end);
    const argv = ["independent-node", name];
    const entries: string[] = [];
    return vm.runInNewContext(`(async () => { ${wire} })()`, { process: { argv }, capture: (entry: string) => entries.push(entry) }).then(() => {
      expect(argv).toEqual(["independent-node", name, mode]);
      expect(entries).toEqual(["./smoke-workspace-recovery.mjs"]);
    });
  });
  it.each([
    ["smoke-server-bundle.mjs", "runtime"], ["smoke-tauri-runtime.mjs", "bundle"],
  ])("ordinary %s rejects caller-selected target %s before importing the runner", async (name, argument) => {
    const text = source(name).replace('import("./smoke-workspace-recovery.mjs")', 'capture()');
    const argv = ["independent-node", name, argument]; let imported = false;
    await expect(vm.runInNewContext(`(async () => { ${text} })()`, { process: { argv }, capture: () => { imported = true; } })).rejects.toThrow("usage:");
    expect(argv).toEqual(["independent-node", name, argument]); expect(imported).toBe(false);
  });
  it("ordinary build chains retain both compatibility entry points and no direct endpoint operations", () => {
    const server = JSON.parse(source("../package.json"));
    const root = JSON.parse(source("../../package.json"));
    const tauri = JSON.parse(source("../../src-tauri/tauri.conf.json"));
    expect(server.scripts["smoke:bundle"]).toBe("node scripts/smoke-server-bundle.mjs");
    expect(server.scripts["smoke:tauri-runtime"]).toBe("node scripts/smoke-tauri-runtime.mjs");
    expect(server.scripts["build:tauri-runtime"]).toBe("pnpm build:bundle && pnpm smoke:bundle && pnpm prepare:tauri-runtime && pnpm smoke:tauri-runtime");
    expect(root.scripts["build:tauri-runtime"]).toBe("pnpm -C server build:tauri-runtime");
    expect(root.scripts["verify:ci"]).toContain("pnpm build:tauri-runtime");
    expect(tauri.build.beforeBuildCommand).toBe("pnpm build && pnpm build:tauri-runtime");
  });
  it("requires raw fixture bytes after owned exit and releases both registration and lease before restart", () => {
    expect(cliSource).toContain('await stop(); fixture.unchanged(); checks.push("owned-child-shutdown-and-registration-release")');
    const stop = functionNode("stop").getText(cliTree);
    expect(stop.indexOf("await wait;")).toBeLessThan(stop.indexOf('"owned service registration was not released"'));
    expect(stop).toContain('path.join(path.dirname(registration), "instance.v1.lock")');
    expect(cliSource).toContain('assert(process.argv.length <= 3, "unexpected recovery-smoke arguments")');
  });
  it("constructs its own database and opaque files, not an engineering fixture", () => {
    const text = source("workspace-recovery-journey.mjs");
    expect(text).toContain("PNW_WORKSPACE_SCHEMA_V13_DDL");
    expect(text).toContain("new DatabaseSync(database)");
    expect(text).toContain("independent manual field");
    expect(text).toContain("createRecoveryFixture(ownedRoot)");
    expect(source("smoke-workspace-recovery.mjs")).toContain("fs.mkdtempSync(");
    expect(text).not.toMatch(/tests\/fixtures|fixtureXml|process\.env\.HOME|os\.homedir\(/u);
  });
  it("uses the selected real child entry and never claims an installed app or sends data remotely", () => {
    const text = source("smoke-workspace-recovery.mjs");
    expect(text).toContain('path.join(runtime, "server/server.mjs")');
    expect(text).toContain("spawn(node, [entry]");
    expect(text).toContain("http://127.0.0.1:");
    expect(text).toContain("serverSha256: hash(fs.readFileSync(entry))");
    expect(text).toContain("not a mock router or an installed-app claim");
    expect(text).not.toContain("osascript");
  });
  it("reports cold-source readiness separately without relaxing request timeouts", () => {
    const text = source("smoke-workspace-recovery.mjs");
    expect(text).toContain('const readinessLimitMs = mode === "runtime" ? 15000 : 30000');
    expect(text).toContain("startupElapsedMs.push(Date.now() - startedAt)");
    expect(text).toContain("nodeSha256: hash(fs.readFileSync(node))");
    expect(text).toContain("AbortSignal.timeout(10000)");
  });
  it("keeps the thirteen request assertions independent of process ownership and uses HTTP for workspace switching", () => {
    const helper = source("workspace-recovery-journey.mjs"), cli = source("smoke-workspace-recovery.mjs");
    expect(helper).toContain("runRecoveryJourney({ fixture, request, setWorkspace, restart })");
    expect(helper).toContain("await setWorkspace(other)"); expect(helper).toContain("await setWorkspace(workspace)");
    expect(helper).not.toMatch(/child_process|spawn\(|process\.env|launcher-prefs|http:\/\/127/u);
    expect(cli).toContain('request("/api/workspace", { path: workspace })');
    expect(cli).toContain('checks.push("owned-child-shutdown-and-registration-release")');
    expect(cli).not.toContain("fs.writeFileSync(prefs");
  });
  it("validates the owned record before every fetch, including health and shutdown", () => {
    const request = functionNode("request");
    expect(request.body!.statements[0].getText(cliTree)).toBe("readOwn();");
    const fields = envFields(request.getText(cliTree));
    expect(fields.get("redirect")).toBe('"error"');
    expect(fields.get("signal")).toBe("AbortSignal.timeout(10000)");
    const start = functionNode("start").getText(cliTree);
    expect(start.indexOf("readOwn();")).toBeLessThan(start.indexOf('request("/api/health")'));
    const catchClause = functionNode("start").body!.statements
      .flatMap(node => ts.isWhileStatement(node) && ts.isBlock(node.statement) ? [...node.statement.statements] : [])
      .find((node): node is ts.TryStatement => ts.isTryStatement(node))?.catchClause;
    expect(catchClause?.block.statements[0].getText(cliTree)).toBe('if (error?.code !== "ENOENT") throw error;');
    expect(functionNode("stop").getText(cliTree)).toContain('request("/api/shutdown", {})');
    const own = functionNode("readOwn").getText(cliTree);
    expect(own).toContain("process.kill(child.pid, 0)");
    expect(own).toContain("validateOwnedRegistration(proof, child, version, port, registeredInstance)");
    expect(own).toContain("O_NOFOLLOW"); expect(own).toContain("O_NONBLOCK");
    expect(own).toContain("Buffer.alloc(65537)"); expect(own).toContain("fatal: true");
  });
  it("retains bounded evidence and only signals its own ChildProcess without recursive deletion", () => {
    const calls: ts.CallExpression[] = [];
    function visit(node: ts.Node) { if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, visit); }
    visit(cliTree);
    expect(calls.filter(call => /\b(?:rmSync|rmdirSync|unlinkSync)$/u.test(call.expression.getText(cliTree)))).toHaveLength(0);
    const kills = calls.filter(call => call.expression.getText(cliTree).endsWith(".kill"));
    expect(kills.map(call => call.expression.getText(cliTree))).toEqual(["child.kill", "child.kill", "process.kill"]);
    expect(kills[2].arguments.map(argument => argument.getText(cliTree))).toEqual(["child.pid", "0"]);
    expect(cliSource.match(/slice\(-18000\)/gu)).toHaveLength(2);
    expect(cliSource).toContain("owned evidence retained:");
    expect(cliSource).not.toContain("PHOENIX_KEEP_RECOVERY_SMOKE");
  });
  it.each([false, true])("uses an OS allowlist and pins public config for packaged=%s", packaged => {
    type Settings = { root: string; userData: string; registration: string; selectedRoot: string; packaged: boolean; port: number };
    const environment = pureFunction<(parent: Record<string, string>, settings: Settings) => Record<string, string>>("childEnvironment");
    const root = path.resolve("independent-smoke-root"), selectedRoot = path.join(root, packaged ? "public-runtime" : "public-source");
    const userData = path.join(root, "own-data"), registration = path.join(userData, "registration", "service.v1.json");
    const result = environment({ HOME: "genuine-system-home", PATH: "system-path", LANG: "en_US.UTF-8", LC_CTYPE: "UTF-8", SystemRoot: "system-root",
      PHOENIX_USER_DATA_DIR: "outside-data", PHOENIX_LEGACY_USER_DATA_DIR: "outside-legacy", PHOENIX_DESK_TOOLS_REGISTRY_DIR: "outside-registry",
      PHOENIX_APP_CONFIG_PATH: "outside-config", PHOENIX_TEST_FIXTURE_CATALOG_PATH: "outside-fixtures", PHOENIX_RUNTIME_CATALOG_PATH: "outside-db",
      PHOENIX_PACKAGED: "untrusted-mode", PHOENIX_RESOURCES_DIR: "outside-resources", PHOENIX_WING_ROOT: "outside-source", PHOENIX_WING_MODE: "local",
      NODE_OPTIONS: "--require=untrusted-module", NODE_PATH: "outside-node", PRIVATE_TOKEN: "not-forwarded", PHOENIX_SECRET: "not-forwarded" },
    { root, userData, registration, selectedRoot, packaged, port: 48001 });
    expect(result.HOME).toBe("genuine-system-home"); expect(result.PATH).toBe("system-path"); expect(result.LC_CTYPE).toBe("UTF-8");
    for (const key of ["NODE_OPTIONS", "NODE_PATH", "PRIVATE_TOKEN", "PHOENIX_SECRET", "PHOENIX_WING_ROOT", "PHOENIX_WING_MODE"]) expect(result[key]).toBeUndefined();
    expect(result.PHOENIX_USER_DATA_DIR).toBe(userData); expect(result.PHOENIX_LEGACY_USER_DATA_DIR).toBe(userData);
    expect(result.PHOENIX_DESK_TOOLS_REGISTRY_DIR).toBe(path.dirname(registration));
    expect(result.PHOENIX_RUNTIME_CATALOG_PATH).toBe(path.join(userData, "runtime-catalog.sqlite"));
    expect(result.PHOENIX_APP_CONFIG_PATH).toBe(path.join(selectedRoot, "phoenix/config/app_config.json"));
    expect(result.PHOENIX_TEST_FIXTURE_CATALOG_PATH).toBe(path.join(selectedRoot, "phoenix/config/test_fixture_catalog.json"));
    expect(result.PHOENIX_PACKAGED).toBe(packaged ? "1" : undefined);
    expect(result.PHOENIX_RESOURCES_DIR).toBe(packaged ? selectedRoot : undefined);
    expect(functionNode("start").getText(cliTree)).toContain("env: childEnvironment(process.env,");
    expect(functionNode("start").getText(cliTree)).not.toContain("...process.env");
  });
  it("accepts only its synthetic matching child/registration and locks the instance for subsequent requests", () => {
    const file = registrationFixture();
    expect(validateOwnedRegistration(file.proof, file.child, "1.2.3", 48001)).toBe(instance);
    expect(validateOwnedRegistration(file.proof, file.child, "1.2.3", 48001, instance)).toBe(instance);
    expect(() => validateOwnedRegistration(file.proof, file.child, "1.2.3", 48001, "e2b19ee6-53d9-4d4a-9b68-ea62e7c8147d")).toThrow();
  });
  it.each([
    { field: "schema_version", bad: 2 }, { field: "service", bad: "unrelated-service" },
    { field: "protocol_version", bad: 2 }, { field: "app_version", bad: "1.2.4" },
    { field: "pid", bad: 70003 }, { field: "host", bad: "localhost" },
    { field: "port", bad: 48002 }, { field: "instance_id", bad: "not-a-UUID" },
    { field: "instance_id", bad: "8d2e5967-520b-5cf7-988e-3dfd2f20d5a1" },
  ])("rejects wrong synthetic registration $field=$bad without authorizing a request", ({ field, bad }) => {
    const file = registrationFixture(); file.proof[field] = bad;
    expect(() => validateOwnedRegistration(file.proof, file.child, "1.2.3", 48001)).toThrow();
  });
  it.each([
    { label: "no spawned PID", change: { pid: undefined } },
    { label: "exited child", change: { exitCode: 0 } },
    { label: "signalled child", change: { signalCode: "SIGTERM" } },
    { label: "already killed child", change: { killed: true } },
  ])("rejects $label even when a synthetic port record looks valid", ({ change }) => {
    const file = registrationFixture(); Object.assign(file.child, change);
    expect(() => validateOwnedRegistration(file.proof, file.child, "1.2.3", 48001)).toThrow();
  });
});
