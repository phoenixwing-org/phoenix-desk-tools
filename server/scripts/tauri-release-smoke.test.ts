import fs from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// These are AST wiring regressions only. They do not execute an installation,
// a native binary, GUI, HTTP request or process-exit operation.
const entryText = fs.readFileSync(new URL("smoke-tauri-release-app.mjs", import.meta.url), "utf8");
const journeyText = fs.readFileSync(new URL("workspace-recovery-journey.mjs", import.meta.url), "utf8");
const parse = (text: string) => ts.createSourceFile("installed-smoke.mjs", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const tree = parse(entryText);

function find<T extends ts.Node>(root: ts.Node, guard: (node: ts.Node) => node is T): T[] {
  const result: T[] = [];
  const visit = (node: ts.Node) => { if (guard(node)) result.push(node); ts.forEachChild(node, visit); };
  visit(root); return result;
}
function calls(root: ts.Node, name: string) {
  return find(root, ts.isCallExpression).filter(call => call.expression.getText() === name);
}
function fn(source: ts.SourceFile, name: string): ts.FunctionDeclaration {
  const found = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!found?.body) throw new Error(`missing function ${name}`);
  return found;
}
function variable(root: ts.Node, name: string): ts.VariableDeclaration {
  const found = find(root, ts.isVariableDeclaration).find(node => ts.isIdentifier(node.name) && node.name.text === name);
  if (!found?.initializer) throw new Error(`missing initialized variable ${name}`);
  return found;
}
function onlyCall(root: ts.Node, name: string) {
  const result = calls(root, name); expect(result, name).toHaveLength(1); return result[0];
}
function string(node: ts.Node): string {
  if (!ts.isStringLiteralLike(node)) throw new Error("literal string required");
  return node.text;
}
function properties(node: ts.Node) {
  if (!ts.isObjectLiteralExpression(node)) throw new Error("object literal required");
  const result = new Map<string, ts.Expression>();
  for (const property of node.properties) {
    if (ts.isShorthandPropertyAssignment(property)) result.set(property.name.text, property.name);
    else if (ts.isPropertyAssignment(property)) result.set(ts.isStringLiteralLike(property.name) ? property.name.text : property.name.getText(), property.initializer);
    else throw new Error("spread or nonliteral object properties are not allowed here");
  }
  return result;
}
function expressionCall(statement: ts.Statement) {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const expression = ts.isAwaitExpression(statement.expression) ? statement.expression.expression : statement.expression;
  return ts.isCallExpression(expression) ? expression : undefined;
}
function mainTry(source: ts.SourceFile): ts.TryStatement {
  const found = source.statements.find(ts.isTryStatement);
  if (!found) throw new Error("missing main try/finally");
  return found;
}
function expectStartGuards(source: ts.SourceFile) {
  const start = fn(source, "start"), spawn = onlyCall(start, "spawn");
  for (const name of ["verifyInstalledInputs", "verifyBuildProof"]) {
    const guard = onlyCall(start, name);
    expect(guard.getStart(), `${name} before native spawn`).toBeLessThan(spawn.getStart());
  }
  expect(calls(start, "verifyInstalledInputs")[0].arguments[0].getText()).toBe("snapshot");
  const proof = properties(calls(start, "verifyBuildProof")[0].arguments[0]);
  expect(proof.get("snapshot")?.getText()).toBe("snapshot");
  expect(proof.get("proofPath")?.getText()).toBe("proofPath");
}
function expectHttpGuards(source: ts.SourceFile) {
  const all = calls(source, "fetch"); expect(all).toHaveLength(2);
  for (const name of ["request", "verifyRetiredCodeRoutes"]) {
    const body = fn(source, name), fetch = onlyCall(body, "fetch");
    const identity = variable(body, "identity");
    expect(identity.initializer!.getText()).toBe("readOwnedHandoff(launch, child, expectedVersion)");
    expect(identity.getStart()).toBeLessThan(fetch.getStart());
    expect(fetch.arguments[0].getText()).toBe("identity.api_origin + route");
    const options = properties(fetch.arguments[1]);
    expect(string(options.get("redirect")!)).toBe("error");
    expect(options.get("signal")?.getText()).toBe("AbortSignal.timeout(10000)");
  }
}
function expectStopGuard(source: ts.SourceFile) {
  const stop = fn(source, "stop"), quit = onlyCall(stop, "writeOwnedQuit"), wait = onlyCall(stop, "waitForExit");
  expect(quit.arguments.map(argument => argument.getText())).toEqual(["launch", "stopped", "expectedVersion"]);
  expect(wait.arguments[0].getText()).toBe("stopped"); expect(quit.getStart()).toBeLessThan(wait.getStart());
  expect(onlyCall(stop, "prepareOwnedRestart").getStart()).toBeGreaterThan(wait.getStart());
  expect(calls(stop, "fetch")).toHaveLength(0);
}
function expectRetainedCleanup(source: ts.SourceFile) {
  expect(calls(source, "fs.rmSync")).toHaveLength(0);
  expect(calls(source, "fs.rmdirSync")).toHaveLength(0);
  const cleanup = fn(source, "cleanup");
  expect(calls(cleanup, "fetch")).toHaveLength(0);
  expect(calls(cleanup, "request")).toHaveLength(0);
  expect(onlyCall(cleanup, "writeOwnedQuit").arguments.map(argument => argument.getText())).toEqual(["launch", "owned", "expectedVersion"]);
  expect(onlyCall(cleanup, "owned.kill").arguments).toHaveLength(0);
  expect(onlyCall(cleanup, "verifyIsolatedLaunch").arguments[0].getText()).toBe("launch");
  expect(find(source, ts.isCallExpression).filter(call => call.expression.getText().endsWith(".kill")).map(call => call.expression.getText())).toEqual(["owned.kill"]);
}
function expectReceipt(source: ts.SourceFile) {
  const main = mainTry(source).tryBlock, open = onlyCall(main, "fs.openSync");
  expect(string(open.arguments[1])).toBe("wx"); expect(Number(open.arguments[2].getText())).toBe(0o600);
  let block: ts.Node = open;
  while (!ts.isBlock(block) && block.parent) block = block.parent;
  expect(variable(block, "receiptParent").initializer!.getText()).toBe("path.dirname(receiptPath)");
  const canonical = calls(block, "assert.equal").find(call => call.arguments[0]?.getText() === "fs.realpathSync(receiptParent)");
  expect(canonical).toBeDefined(); expect(canonical!.arguments[1].getText()).toBe("receiptParent");
  expect(canonical!.getStart()).toBeLessThan(open.getStart());
  const outside = onlyCall(block, "isUnder");
  expect(outside.arguments.map(argument => argument.getText())).toEqual(["repoRoot", "receiptPath"]);
  expect(outside.getStart()).toBeLessThan(open.getStart());
  expect(calls(block, "fs.mkdirSync")).toHaveLength(0);
}
function expectPostStopByteGuard(source: ts.SourceFile) {
  const main = mainTry(source).tryBlock;
  const finalStop = main.statements.map(expressionCall).find(call => call?.expression.getText() === "stop");
  expect(finalStop).toBeDefined();
  const receipt = variable(main, "receipt");
  expect(calls(main, "fixture.unchanged").some(call => call.getStart() > finalStop!.getStart() && call.getStart() < receipt.getStart())).toBe(true);
}

// Carry every original method/path, including mutating methods; not a private
// project fixture and not a new production route registry.
const carriedRoutes = [
  ["GET", "/api/code/index"], ["GET", "/api/code/index/catdlg"], ["POST", "/api/code/index/scan"],
  ["GET", "/api/code/index/entries"], ["GET", "/api/code/index/extension-discovery"],
  ["GET", "/api/code/index/extra-extensions"], ["PUT", "/api/code/index/extra-extensions"],
  ["POST", "/api/code/index/purge-missing"], ["POST", "/api/code/index/export-json"],
  ["GET", "/api/code/codegen/documents"], ["POST", "/api/code/codegen/open"],
  ["POST", "/api/code/codegen/document-state"], ["PUT", "/api/code/codegen/document"],
  ["POST", "/api/code/codegen/preflight"], ["POST", "/api/code/codegen/apply"],
  ["POST", "/api/code/codegen/source-preview"], ["POST", "/api/code/codegen/source-states"],
  ["GET", "/api/code/rename/prefs"], ["PUT", "/api/code/rename/prefs"],
  ["POST", "/api/code/rename/preview"], ["POST", "/api/code/rename/apply"],
  ["POST", "/api/code/uuid/scan"], ["POST", "/api/code/uuid/apply"],
  ["GET", "/api/code/reorder-members/prefs"], ["PUT", "/api/code/reorder-members/prefs"],
  ["POST", "/api/code/reorder-members/resolve"], ["POST", "/api/code/reorder-members/run"],
  ["POST", "/api/code/reorder-members/self-test"], ["GET", "/api/code/reorder-members/top-level"],
  ["GET", "/api/code/reorder-members/top-dirs"],
];
function expectRouteCarry(source: ts.SourceFile) {
  const list = variable(fn(source, "verifyRetiredCodeRoutes"), "routes").initializer!;
  if (!ts.isArrayLiteralExpression(list)) throw new Error("routes must remain an explicit method/path list");
  const values = list.elements.map(element => {
    if (!ts.isArrayLiteralExpression(element)) throw new Error("route tuple required");
    return element.elements.map(string);
  });
  expect(values).toEqual(carriedRoutes);
  expect(values).toHaveLength(30);
}
function replace(node: ts.Node, value: string) { return entryText.slice(0, node.getStart()) + value + entryText.slice(node.end); }

describe("installed Tauri smoke entry safety wiring (AST only, not native GUI evidence)", () => {
  it("refuses unsupported platforms before inspecting or launching an installation", () => {
    const platform = calls(tree, "assert.equal").find(call => call.arguments[0]?.getText() === "process.platform")!;
    expect(platform).toBeDefined(); expect(string(platform.arguments[1])).toBe("darwin");
    expect(platform.getStart()).toBeLessThan(onlyCall(tree, "spawnSync").getStart());
    expect(platform.getStart()).toBeLessThan(onlyCall(tree, "fs.mkdtempSync").getStart());
  });
  it("reads version from the selected installation's own plist", () => {
    expect(variable(tree, "infoPlist").initializer!.getText()).toBe('path.join(installRoot, "Contents/Info.plist")');
    const plutil = onlyCall(tree, "spawnSync"); expect(string(plutil.arguments[0])).toBe("/usr/bin/plutil");
    expect(plutil.arguments[1].getText()).toBe('["-extract", "CFBundleShortVersionString", "raw", "-o", "-", infoPlist]');
    expect(properties(plutil.arguments[2]).get("shell")?.kind).toBe(ts.SyntaxKind.FalseKeyword);
    const snapshot = properties(onlyCall(tree, "freezeInstalledInputs").arguments[0]);
    expect(snapshot.get("installRoot")?.getText()).toBe("installRoot");
    expect(snapshot.get("appVersion")?.getText()).toBe("appVersion");
    expect(snapshot.get("expectedVersion")?.getText()).toBe("expectedVersion");
  });
  it("freezes and validates installed inputs and native source proof before the first start", () => {
    const initialTry = mainTry(tree), frozen = onlyCall(tree, "freezeInstalledInputs");
    expect(frozen.getStart()).toBeLessThan(initialTry.getStart());
    for (const name of ["verifyInstalledInputs", "verifyBuildProof"]) {
      const initial = calls(tree, name).find(call => call.getStart() < initialTry.getStart());
      expect(initial, `initial ${name}`).toBeDefined();
      expect(initial!.getStart()).toBeGreaterThan(frozen.getStart());
    }
    expectStartGuards(tree);
  });
  it("spawns only the selected executable with isolated environment and tracks its handle", () => {
    const start = fn(tree, "start"), spawn = onlyCall(tree, "spawn");
    expect(spawn.arguments[0].getText()).toBe("executable"); expect(spawn.arguments[1].getText()).toBe("[]");
    const options = properties(spawn.arguments[2]);
    expect(options.get("env")?.getText()).toBe("launch.environment");
    expect(options.get("cwd")?.getText()).toBe("fixture.workspace");
    expect(options.get("shell")?.kind).toBe(ts.SyntaxKind.FalseKeyword);
    const tracked = onlyCall(start, "ownedChildren.push");
    expect(tracked.arguments[0].getText()).toBe("child"); expect(tracked.getStart()).toBeGreaterThan(spawn.getStart());
    expect(onlyCall(start, "readOwnedHandoff").arguments.map(argument => argument.getText())).toEqual(["launch", "child", "expectedVersion"]);
  });
  it("authorizes every HTTP request and retired-route check using a live owned handoff", () => { expectHttpGuards(tree); });
  it("uses a validated owned quit request, then verifies actual child and sidecar release", () => {
    expectStopGuard(tree);
    const stop = fn(tree, "stop");
    const zeroExit = calls(stop, "assert.equal").find(call => call.arguments[0]?.getText() === "stopped.exitCode");
    expect(zeroExit).toBeDefined(); expect(zeroExit!.arguments[1].getText()).toBe("0");
    expect(calls(stop, "canConnect").length).toBeGreaterThan(0);
  });
  it("never invokes global GUI quit or forwards a fake home/inherited environment", () => {
    const literals = find(tree, ts.isStringLiteralLike).map(node => node.text);
    expect(literals.some(value => value.includes("osascript") || value.includes("tell application") || value.includes("com.phoenix.desktools"))).toBe(false);
    for (const call of find(tree, ts.isCallExpression)) {
      expect(["exec", "execSync", "execFile", "execFileSync"].includes(call.expression.getText().split(".").at(-1)!)).toBe(false);
    }
    const assignments = find(tree, ts.isPropertyAssignment).map(node => ts.isStringLiteralLike(node.name) ? node.name.text : node.name.getText());
    for (const key of ["HOME", "home", "USERPROFILE", "CFFIXED_USER_HOME"]) expect(assignments).not.toContain(key);
    expect(find(tree, ts.isSpreadAssignment).some(node => node.expression.getText() === "process.env")).toBe(false);
  });
  it("keeps temporary evidence and only falls back to the runner's own Child handle", () => { expectRetainedCleanup(tree); });
  it("carries all thirty original Code route method/path checks", () => { expectRouteCarry(tree); });
  it("runs thirteen request checks and appends the fourteenth only after stop and final input revalidation", () => {
    expectPostStopByteGuard(tree);
    const journey = parse(journeyText), marks = calls(fn(journey, "runRecoveryJourney"), "mark");
    expect(marks).toHaveLength(13); expect(new Set(marks.map(call => string(call.arguments[0]))).size).toBe(13);
    const main = mainTry(tree).tryBlock;
    const journeyCall = onlyCall(main, "runRecoveryJourney"), parameters = properties(journeyCall.arguments[0]);
    expect(parameters.get("request")?.getText()).toBe("request"); expect(parameters.get("setWorkspace")?.getText()).toBe("setWorkspace");
    const restart = parameters.get("restart")!; expect(calls(restart, "stop")).toHaveLength(1); expect(calls(restart, "start")).toHaveLength(1);
    const finalStop = main.statements.map(expressionCall).find(call => call?.expression.getText() === "stop")!;
    const added = onlyCall(main, "recoveryChecks.push"); expect(string(added.arguments[0])).toBe("owned-native-host-and-sidecar-shutdown");
    expect(finalStop.getStart()).toBeLessThan(added.getStart());
    for (const name of ["verifyInstalledInputs", "verifyBuildProof"]) {
      expect(calls(main, name).some(call => call.getStart() > finalStop.getStart() && call.getStart() < added.getStart())).toBe(true);
    }
    expect(variable(main, "receipt").getStart()).toBeGreaterThan(added.getStart());
  });
  it("writes evidence with exclusive creation only to a canonical outside-repository location", () => {
    expectReceipt(tree);
  });
  it("compares every later native proof's exact bytes with the frozen receipt fingerprint", () => {
    const initial = variable(tree, "buildProof").initializer!;
    const later = calls(tree, "verifyBuildProof").filter(call => call !== initial);
    expect(later).toHaveLength(3);
    for (const call of later) {
      expect(ts.isPropertyAccessExpression(call.parent) && call.parent.name.text).toBe("proofSha256");
      const comparison = call.parent.parent;
      expect(ts.isCallExpression(comparison)).toBe(true);
      if (!ts.isCallExpression(comparison)) throw new Error("later proof must be compared");
      expect(comparison.expression.getText()).toBe("assert.equal");
      expect(comparison.arguments[0]).toBe(call.parent);
      expect(comparison.arguments[1].getText()).toBe("buildProof.proofSha256");
    }
  });

  const mutations = [
    { name: "post-exit source byte guard", node: () => calls(mainTry(tree).tryBlock, "fixture.unchanged").at(-1)!, value: "void 0", check: expectPostStopByteGuard },
    { name: "per-start installed input guard", node: () => onlyCall(fn(tree, "start"), "verifyInstalledInputs"), value: "void 0", check: expectStartGuards },
    { name: "per-start native proof guard", node: () => onlyCall(fn(tree, "start"), "verifyBuildProof"), value: "void 0", check: expectStartGuards },
    { name: "HTTP owned origin", node: () => onlyCall(fn(tree, "request"), "fetch").arguments[0], value: "handoff.api_origin + route", check: expectHttpGuards },
    { name: "owned quit authorization", node: () => onlyCall(fn(tree, "stop"), "writeOwnedQuit").expression, value: "unverifiedQuit", check: expectStopGuard },
    { name: "recursive cleanup", node: () => onlyCall(fn(tree, "cleanup"), "verifyIsolatedLaunch"), value: "fs.rmSync(tempRoot, { recursive: true })", check: expectRetainedCleanup },
    { name: "retired route original method", node: () => (variable(fn(tree, "verifyRetiredCodeRoutes"), "routes").initializer as ts.ArrayLiteralExpression).elements[0], value: '["POST", "/api/code/index"]', check: expectRouteCarry },
    { name: "receipt canonical-parent guard", node: () => calls(mainTry(tree).tryBlock, "fs.realpathSync")[0].expression, value: "path.resolve", check: expectReceipt },
  ];
  it.each(mutations)("detects a wiring regression in $name without executing it", mutation => {
    expect(() => mutation.check(parse(replace(mutation.node(), mutation.value)))).toThrow();
  });
});
