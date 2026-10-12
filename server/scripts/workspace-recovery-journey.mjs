import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PNW_WORKSPACE_SCHEMA_V13_DDL } from "@phoenix-wing/workspace-schema";

const databaseRelative = ".phoenix/phoenix-workspace.sqlite";
const manifestName = "phoenix-workspace-backup.v1.json";
const markerRelative = ".phoenix/workspace-recovery.complete.v1.json";

/** The caller owns a fresh, canonical temporary root; no engineering input is read. */
export function createRecoveryFixture(ownedRoot) {
  assert(path.isAbsolute(ownedRoot) && fs.realpathSync(ownedRoot) === ownedRoot, "fixture root must be absolute and canonical");
  assert(fs.lstatSync(ownedRoot).isDirectory(), "fixture root must be a regular directory");
  const workspace = path.join(ownedRoot, "source"), other = path.join(ownedRoot, "other");
  fs.mkdirSync(workspace, { mode: 0o700 });
  fs.mkdirSync(other, { mode: 0o700 });
  fs.mkdirSync(path.join(workspace, ".phoenix/outbox/nested/empty"), { recursive: true, mode: 0o700 });
  const database = path.join(workspace, databaseRelative), db = new DatabaseSync(database);
  try {
    db.exec(PNW_WORKSPACE_SCHEMA_V13_DDL);
    db.prepare("INSERT INTO phoenix_meta(key,value) VALUES ('schema_version','13')").run();
    // Empty worksets are validly cold-initialized before the first raw snapshot;
    // a UI read must not perform unrelated legacy JSON import bookkeeping.
    db.prepare("INSERT INTO phoenix_meta(key,value) VALUES ('node_file_worksets_json_imported','1')").run();
    // Avoid unrelated one-time Host preference initialization on activation.
    db.prepare("INSERT INTO phoenix_workspace_pref(section,value_json,updated_at) VALUES ('__meta__',?,?)")
      .run('{"storage_version":1,"initialized_at":"2000-01-01T00:00:00.000Z"}', "2000-01-01T00:00:00.000Z");
    db.exec("CREATE TABLE independent_record(id INTEGER PRIMARY KEY, note TEXT, opaque BLOB); CREATE INDEX independent_note ON independent_record(note); CREATE TABLE independent_audit(note TEXT); CREATE TRIGGER independent_trigger AFTER UPDATE ON independent_record BEGIN INSERT INTO independent_audit VALUES ('retained trigger'); END; CREATE VIEW independent_view AS SELECT note FROM independent_record;");
    db.prepare("INSERT INTO independent_record VALUES (1,?,?)").run("independent manual field", new Uint8Array([0, 255, 7]));
  } finally { db.close(); }
  const payloads = new Map([
    [databaseRelative, fs.readFileSync(database)],
    [".phoenix/outbox/opaque.bin", Buffer.from([0, 9, 255])],
    [".phoenix/outbox/.hidden.txt", Buffer.from("independent hidden value")],
    [".phoenix/outbox/nested/pending.json", Buffer.from('{"independent":"opaque record"}')],
  ]);
  for (const [relative, bytes] of payloads) if (relative !== databaseRelative) {
    fs.writeFileSync(path.join(workspace, relative), bytes, { flag: "wx", mode: 0o600 });
  }
  fs.writeFileSync(path.join(workspace, "not-in-recovery.FCStd"), "independent non-model sentinel", { flag: "wx", mode: 0o600 });
  const compare = directory => {
    for (const [relative, bytes] of payloads) assert.deepEqual(fs.readFileSync(path.join(directory, relative)), bytes);
  };
  return { root: ownedRoot, workspace, other, payloads, unchanged: () => compare(workspace), compare };
}

/**
 * Exercises the real request contract. Transport, endpoint ownership and Host
 * lifecycle are caller responsibilities; this module never starts a process.
 * Unit adapters are not evidence of an HTTP or installed-application run.
 */
export async function runRecoveryJourney({ fixture, request, setWorkspace, restart }) {
  const { root, workspace, other, payloads, unchanged, compare } = fixture;
  const checks = [], mark = name => checks.push(name), target = name => path.join(root, name);
  const totalBytes = [...payloads.values()].reduce((total, bytes) => total + bytes.byteLength, 0);
  const safeError = result => `${result.status}: ${String(result.body?.code || "unexpected response")}`;
  const warnings = receipt => {
    assert(Array.isArray(receipt.warnings) && receipt.warnings.every(value => typeof value === "string"), "receipt warnings must be strings");
  };
  const restore = (inspection_id, name) => request("/api/workspace-recovery/restore", {
    workspace, inspection_id, target_directory: target(name), confirmed: true,
  });
  const inspect = async directory => {
    const result = await request("/api/workspace-recovery/inspect", { workspace, backup_directory: directory });
    assert.equal(result.status, 200, safeError(result));
    assert.match(result.body.inspection_id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
    assert.match(result.body.manifest_sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.body.backup_directory, directory);
    assert.equal(result.body.file_count, payloads.size); assert.equal(result.body.total_bytes, totalBytes);
    assert.equal(result.body.database_schema_version, 13);
    assert(Number.isSafeInteger(result.body.directory_count) && result.body.directory_count > 0);
    assert(typeof result.body.expires_at === "string" && Number.isFinite(Date.parse(result.body.expires_at)));
    assert(!("manifest" in result.body) && !("files" in result.body), "inspection must not return manifest or files");
    return result.body.inspection_id;
  };

  await setWorkspace(workspace);
  assert.equal((await request("/api/workspace")).body.path, workspace); unchanged();
  const wrongOrigin = await request("/api/workspace-recovery/backup", {
    workspace, target_directory: target("bad-origin"), confirmed: true,
  }, { origin: "https://untrusted.invalid" });
  assert.equal(wrongOrigin.status, 403); assert(!fs.existsSync(target("bad-origin"))); mark("real-origin-guard");
  const arbitrary = await request("/api/workspace-recovery/backup", {
    workspace: other, target_directory: target("bad-workspace"), confirmed: true,
  });
  assert(arbitrary.status >= 400); assert(!fs.existsSync(target("bad-workspace"))); mark("active-workspace-bound");
  const noConsent = await request("/api/workspace-recovery/backup", { workspace, target_directory: target("no-consent") });
  assert.equal(noConsent.status, 400); assert(!fs.existsSync(target("no-consent"))); mark("explicit-confirmation-required");
  const recreate = await request("/api/phoenix/database/recreate", { confirmed: true, backup: target("forged"), proof: "forged" });
  assert.equal(recreate.status, 409); unchanged(); mark("original-recreate-disabled");

  const backup = await request("/api/workspace-recovery/backup", { workspace, target_directory: target("backup"), confirmed: true });
  assert.equal(backup.status, 200, safeError(backup));
  assert.equal(backup.body.receipt.backupDirectory, target("backup"));
  assert.equal(backup.body.receipt.databaseSchemaVersion, 13);
  assert.equal(backup.body.receipt.fileCount, payloads.size); assert.equal(backup.body.receipt.totalBytes, totalBytes); warnings(backup.body.receipt);
  assert(fs.statSync(path.join(target("backup"), manifestName)).isFile());
  compare(target("backup")); unchanged(); mark("real-schema13-raw-backup");
  let id = await inspect(target("backup")); mark("bounded-plain-inspection-dto");
  fs.mkdirSync(target("occupied")); fs.writeFileSync(path.join(target("occupied"), "sentinel.txt"), "keep competitor", { flag: "wx", mode: 0o600 });
  const occupied = await restore(id, "occupied"); assert(occupied.status >= 400);
  assert.equal(fs.readFileSync(path.join(target("occupied"), "sentinel.txt"), "utf8"), "keep competitor");
  assert(!fs.existsSync(path.join(target("occupied"), markerRelative))); mark("existing-target-kept");
  id = await inspect(target("backup"));
  const restored = await restore(id, "restored"); assert.equal(restored.status, 200, safeError(restored));
  assert.equal(restored.body.receipt.workspace, target("restored"));
  assert.equal(restored.body.receipt.fileCount, payloads.size); assert.equal(restored.body.receipt.totalBytes, totalBytes); warnings(restored.body.receipt);
  compare(target("restored"));
  assert(fs.statSync(path.join(target("restored"), markerRelative)).isFile());
  assert.deepEqual(fs.readdirSync(path.join(target("restored"), ".phoenix/outbox/nested/empty")), []);
  assert(!fs.existsSync(path.join(target("restored"), "not-in-recovery.FCStd")));
  assert.equal((await request("/api/workspace")).body.path, workspace); unchanged(); mark("new-directory-restore-without-activation");
  const replay = await restore(id, "replayed"); assert.equal(replay.status, 410); assert(!fs.existsSync(target("replayed"))); mark("single-attempt-handle");

  id = await inspect(target("backup"));
  // Change only our synthetic source, make another self-consistent package of
  // equal sizes/counts, then restore the source before testing the old handle.
  const opaqueRelative = ".phoenix/outbox/opaque.bin";
  fs.writeFileSync(path.join(workspace, opaqueRelative), Buffer.from([1, 10, 254]));
  let second;
  try { second = await request("/api/workspace-recovery/backup", { workspace, target_directory: target("second-package"), confirmed: true }); }
  finally { fs.writeFileSync(path.join(workspace, opaqueRelative), payloads.get(opaqueRelative)); }
  assert.equal(second.status, 200, safeError(second));
  assert.equal(second.body.receipt.fileCount, payloads.size); assert.equal(second.body.receipt.totalBytes, totalBytes); warnings(second.body.receipt);
  const firstManifest = fs.readFileSync(path.join(target("backup"), manifestName));
  const secondManifest = fs.readFileSync(path.join(target("second-package"), manifestName));
  assert.notDeepEqual(firstManifest, secondManifest, "independent packages must have different manifest identities");
  fs.copyFileSync(path.join(target("second-package"), opaqueRelative), path.join(target("backup"), opaqueRelative));
  fs.writeFileSync(path.join(target("backup"), manifestName), secondManifest);
  const rebound = await restore(id, "changed-after-inspection"); assert(rebound.status >= 400);
  assert(!fs.existsSync(target("changed-after-inspection"))); unchanged(); mark("valid-replacement-package-rejected");

  id = await inspect(target("backup"));
  assert.equal((await request("/api/workspace-recovery/release", { workspace, inspection_id: id })).body.released, true);
  assert.equal((await restore(id, "released")).status, 410); assert(!fs.existsSync(target("released"))); mark("explicit-release");
  id = await inspect(target("backup")); await setWorkspace(other);
  const switched = await restore(id, "old-context"); assert(switched.status >= 400); assert(!fs.existsSync(target("old-context")));
  assert.equal((await request("/api/workspace-recovery/release", { workspace, inspection_id: id })).body.released, true);
  await setWorkspace(workspace); unchanged(); mark("workspace-switch-invalidates-and-releases");
  id = await inspect(target("backup")); await restart();
  assert.equal((await restore(id, "old-process")).status, 410); assert(!fs.existsSync(target("old-process"))); mark("restart-invalidates-inspections");
  unchanged(); assert.equal((await request("/api/workspace")).body.path, workspace);
  return checks;
}
