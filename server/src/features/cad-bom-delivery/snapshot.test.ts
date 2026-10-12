import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { scanCadWorkspaceIndex } from "../../lib/cadIndexScanService.js";
import { phoenixDatabasePath } from "../../lib/phoenixDatabaseService.js";
import { prepareCadBomTransfer, revalidateCadBomTransfer, type PreparedCadBomTransfer } from "./snapshot.js";

// Independently constructed metadata-only archives. No real geometry, project
// tree, engineering numbering or renamed private assembly is copied here.
const PART = "Plate.FCStd", HOST = "Frame.FCStd";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function rootDir() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-bom-snapshot-")); roots.push(root); return root; }
function archive(partNo: string, name: string, links = "") {
  const fields = { PartNumber: partNo, PartVersion: "A", TypeCode: "S", PartName: name };
  const properties = Object.entries(fields).map(([key, value]) => `<Property name="${key}" type="App::PropertyString" group="CustomDefine"><String value="${value}"/></Property>`).join("");
  return zipSync({ "Document.xml": strToU8(`<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties Count="4">${properties}</Properties></Object></ObjectData>${links}</Document>`) });
}
async function fixture(extra?: (root: string) => void) {
  const root = rootDir();
  fs.writeFileSync(path.join(root, PART), archive("PART-P", "Synthetic plate"));
  fs.writeFileSync(path.join(root, HOST), archive("PART-F", "Synthetic frame", `<XLink file="${PART}" label="First"/><XLink file="${PART}" label="Second"/><XLink file="${PART}" label="Third"/>`));
  extra?.(root);
  const scan = await scanCadWorkspaceIndex(root);
  expect(scan.partial).toBe(false);
  return { root, filename: phoenixDatabasePath(root), scan };
}
function edit(filename: string, action: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(filename);
  try { action(db); } finally { db.close(); }
}
function modifyMetadata(filename: string, action: (metadata: Record<string, unknown>) => void) {
  edit(filename, db => {
    const rows = db.prepare("SELECT id,bom_json FROM phoenix_cad_file_asset").all() as { id: number; bom_json: string }[];
    for (const row of rows) {
      const metadata = JSON.parse(row.bom_json); action(metadata);
      db.prepare("UPDATE phoenix_cad_file_asset SET bom_json=? WHERE id=?").run(JSON.stringify(metadata), row.id);
    }
  });
}
function syntheticEntry(name: string, directory = false): fs.Dirent {
  return { name, isSymbolicLink: () => false, isDirectory: () => directory, isFile: () => !directory } as fs.Dirent;
}
const options = { producerVersion: "0.5.0" };

// Compile-only contract evidence; never invoke an asynchronous publisher.
function rejectsAsyncPublicationAtCompileTime(root: string, prepared: PreparedCadBomTransfer) {
  // @ts-expect-error Publication callbacks must return synchronously.
  void revalidateCadBomTransfer(root, prepared, async () => "unsupported");
}

function competingWasmWriter(filename: string) {
  const loader = fileURLToPath(new URL("../../../../scripts/register-local-wing.mjs", import.meta.url));
  const args = process.env.PHOENIX_WING_MODE === "local" ? ["--import", loader] : [];
  const source = `
import { pnwCreateDb } from "@phoenix-wing/db-node";
let db;
try {
  db=pnwCreateDb(${JSON.stringify(filename)}); db.exec("BEGIN IMMEDIATE");
  db.run("INSERT INTO phoenix_cad_scan(scan_uuid,scanned_at,scan_root,stats_json,status,phase) SELECT '00000000-0000-4000-8000-000000000003',scanned_at,scan_root,stats_json,status,phase FROM phoenix_cad_scan ORDER BY id DESC LIMIT 1");
  db.run("UPDATE phoenix_cad_file_asset SET part_name='interleaved'");
  db.exec("COMMIT"); process.stdout.write(JSON.stringify({committed:true,driver:import.meta.resolve("@phoenix-wing/db-node")}));
} catch(error) {
  if(db?.inTransaction) db.exec("ROLLBACK");
  process.stdout.write(JSON.stringify({committed:false,error:String(error.message||error),driver:import.meta.resolve("@phoenix-wing/db-node")}));
} finally {db?.close();}
`;
  return JSON.parse(execFileSync(process.execPath, [...args, "--input-type=module", "--eval", source], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)), env: process.env, encoding: "utf8", timeout: 5000,
  })) as { committed: boolean; error?: string; driver: string };
}

describe("server-owned complete CAD BOM publication snapshot", () => {
  it("builds from a real full scan, uses direct coalesced quantities and retains defensive frozen evidence", async () => {
    const { root, filename } = await fixture();
    const diskBefore = [filename, path.join(root, PART), path.join(root, HOST)].map(file => fs.readFileSync(file));
    const prepared = await prepareCadBomTransfer(root, options);
    expect(prepared.envelope.parts.map(part => part.partNo)).toEqual(["PART-F", "PART-P"]);
    expect(prepared.envelope.boms[0].items).toMatchObject([{ partNo: "PART-P", revision: "A", qty: 3 }]);
    expect(prepared.proof.files.map(file => file.relativePath)).toEqual([HOST, PART]);
    expect(prepared.proof.rawSourceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.proof.files[0])).toBe(true);
    expect(Object.isFrozen(prepared.envelope.parts[0])).toBe(true);
    const bytes = prepared.bytes; bytes.fill(0);
    expect(JSON.parse(Buffer.from(prepared.bytes).toString())).toEqual(prepared.envelope);
    expect(await revalidateCadBomTransfer(root, prepared, trusted => {
      expect(trusted.envelope).toBe(prepared.envelope);
      expect(fs.existsSync(`${filename}.lock`)).toBe(true);
      trusted.bytes.fill(0); return "published";
    })).toBe("published");
    expect(prepared.bytes[0]).toBe("{".charCodeAt(0));
    expect([filename, path.join(root, PART), path.join(root, HOST)].map(file => fs.readFileSync(file))).toEqual(diskBefore);
    expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("protects the entire read and synchronous publication from a real second-process WASM commit", async () => {
    const { root, filename } = await fixture();
    let attempted = false, checks = 0;
    const prepared = await prepareCadBomTransfer(root, { ...options, assertActive() {
      // The fourth check is the first asset iteration: schema, latest scan and
      // source bounds were already queried in the same native transaction.
      if (++checks >= 4 && !attempted && fs.existsSync(`${filename}.lock`)) {
        attempted = true;
        const result = competingWasmWriter(filename);
        expect(result.committed).toBe(false);
        expect(result.error).toMatch(/locked|busy|readonly|disk I\/O|journal/i);
        expect(result.driver).toContain(process.env.PHOENIX_WING_MODE === "local" ? "/packages/db-node/dist/" : "/@phoenix-wing/db-node/dist/");
      }
    } });
    expect(attempted).toBe(true);
    expect(prepared.proof.scan.id).toBe(1);
    await revalidateCadBomTransfer(root, prepared, () => {
      const result = competingWasmWriter(filename); expect(result.committed).toBe(false);
      return "receipt";
    });
    // A real adapter commit is permitted only after the publication lease closes.
    expect(competingWasmWriter(filename).committed).toBe(true);
    const db = pnwCreateDb(filename);
    try { expect(db.get<{ id: number }>("SELECT MAX(id) AS id FROM phoenix_cad_scan")?.id).toBe(2); }
    finally { db.close(); }
    expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("binds drawing dependencies by semantic role, not filename suffix", async () => {
    const { root } = await fixture(root => {
      fs.writeFileSync(path.join(root, "Sheet.FCStd"), zipSync({ "Document.xml": strToU8(`<Document><Objects><Object name="Page" type="TechDraw::DrawPage"/></Objects><ObjectData><Object name="Page"><Properties Count="1"><Property name="XSource" type="App::PropertyXLink"><XLink file="${PART}" name="Body"/></Property></Properties></Object></ObjectData></Document>`) }));
    });
    const prepared = await prepareCadBomTransfer(root, options);
    expect(prepared.proof.files).toHaveLength(3);
    expect(prepared.envelope.parts).toHaveLength(2);
    expect(prepared.envelope.boms[0].items[0].qty).toBe(3);
    fs.appendFileSync(path.join(root, "Sheet.FCStd"), "changed drawing");
    const publish = vi.fn(); await expect(revalidateCadBomTransfer(root, prepared, publish)).rejects.toThrow(/过期/);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects forged previews without acquiring a lease or publishing", async () => {
    const { root, filename } = await fixture(); const prepared = await prepareCadBomTransfer(root, options);
    const publish = vi.fn();
    await expect(revalidateCadBomTransfer(root, { ...prepared }, publish)).rejects.toThrow(/不是本服务/);
    expect(publish).not.toHaveBeenCalled(); expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("does not retain a caller-mutable prepare options container", async () => {
    const { root } = await fixture(); const mutable = { ...options, assertActive: () => {} };
    const pending = prepareCadBomTransfer(root, mutable);
    mutable.producerVersion = "changed-by-caller"; mutable.assertActive = () => { throw new Error("injected later callback"); };
    const prepared = await pending;
    expect(prepared.envelope.producer.version).toBe(options.producerVersion);
    await expect(revalidateCadBomTransfer(root, prepared, () => "receipt")).resolves.toBe("receipt");
  });

  it.each(["add", "remove", "rename"])("rejects a changed disk inventory (%s) before publication", async change => {
    const { root } = await fixture(); const prepared = await prepareCadBomTransfer(root, options);
    if (change === "add") fs.writeFileSync(path.join(root, "Extra.FCStd"), archive("PART-X", "Synthetic extra"));
    if (change === "remove") fs.unlinkSync(path.join(root, PART));
    if (change === "rename") fs.renameSync(path.join(root, PART), path.join(root, "Moved.FCStd"));
    const publish = vi.fn(); await expect(revalidateCadBomTransfer(root, prepared, publish)).rejects.toThrow(/清单|过期/);
    expect(publish).not.toHaveBeenCalled();
  });

  it("detects changed bytes even when file size and mtime are restored", async () => {
    const { root } = await fixture();
    // Fix an exactly representable millisecond before scanning: Date conversion
    // must not accidentally change a fractional filesystem timestamp by 1 ms.
    const fixed = new Date("2026-01-01T00:00:00.000Z"); fs.utimesSync(path.join(root, PART), fixed, fixed);
    await scanCadWorkspaceIndex(root);
    const prepared = await prepareCadBomTransfer(root, options);
    const filename = path.join(root, PART), stat = fs.statSync(filename), bytes = fs.readFileSync(filename);
    bytes[bytes.length - 1] ^= 1; fs.writeFileSync(filename, bytes); fs.utimesSync(filename, stat.atime, stat.mtime);
    expect(fs.statSync(filename).size).toBe(stat.size);
    expect(Math.trunc(fs.statSync(filename).mtimeMs)).toBe(Math.trunc(stat.mtimeMs));
    const publish = vi.fn(); await expect(revalidateCadBomTransfer(root, prepared, publish)).rejects.toThrow(/快照过期/);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects database inode replacement even if every database byte is identical", async () => {
    const { root, filename } = await fixture(); const prepared = await prepareCadBomTransfer(root, options);
    const replacement = `${filename}.replacement`; fs.copyFileSync(filename, replacement); fs.renameSync(replacement, filename);
    expect(fs.statSync(filename).ino).not.toBe(prepared.proof.database.ino);
    const publish = vi.fn(); await expect(revalidateCadBomTransfer(root, prepared, publish)).rejects.toThrow(/预览已过期/);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects raw source metadata changes despite an unchanged exported payload", async () => {
    const { root, filename } = await fixture(); const prepared = await prepareCadBomTransfer(root, options);
    modifyMetadata(filename, metadata => { metadata.document_xml_objects = Number(metadata.document_xml_objects) + 1; });
    const publish = vi.fn(); await expect(revalidateCadBomTransfer(root, prepared, publish)).rejects.toThrow(/预览已过期/);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not invalidate source proof for unrelated historical/non-CAD metadata", async () => {
    const { root, filename } = await fixture(); const prepared = await prepareCadBomTransfer(root, options);
    edit(filename, db => {
      db.prepare("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,asset_kind,file_status,bom_json,updated_at) VALUES(?,?,?,?,?,?)").run("Old.FCStd", "Old.FCStd", "part", "missing", "{}", new Date().toISOString());
      db.prepare("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,asset_kind,file_status,bom_json,updated_at) VALUES(?,?,?,?,?,?)").run("Note.txt", "Note.txt", "document", "present", "{}", new Date().toISOString());
    });
    await expect(revalidateCadBomTransfer(root, prepared, () => "receipt")).resolves.toBe("receipt");
  });

  it.each(["partial", "stale", "completed", "running"])("refuses latest %s state instead of falling back to an older done scan", async status => {
    const { root, filename } = await fixture();
    edit(filename, db => { db.prepare("INSERT INTO phoenix_cad_scan(scan_uuid,scanned_at,scan_root,stats_json,status,phase) SELECT '00000000-0000-4000-8000-000000000002',scanned_at,scan_root,stats_json,?,phase FROM phoenix_cad_scan ORDER BY id DESC LIMIT 1").run(status); });
    await expect(prepareCadBomTransfer(root, options)).rejects.toThrow(/完整.*done/);
    expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("refuses a real partial-ready scan on first use", async () => {
    const root = rootDir(); fs.writeFileSync(path.join(root, PART), archive("PART-P", "Synthetic plate"));
    fs.writeFileSync(path.join(root, "Broken.FCStd"), "not an archive");
    expect(await scanCadWorkspaceIndex(root)).toMatchObject({ partial: true });
    await expect(prepareCadBomTransfer(root, options)).rejects.toThrow(/完整.*done/);
  });

  it.each(["source_sha256", "document_role"])("requires a full rescan for old metadata without %s", async field => {
    const { root, filename } = await fixture(); modifyMetadata(filename, metadata => { delete metadata[field]; });
    await expect(prepareCadBomTransfer(root, options)).rejects.toThrow(/重新扫描/);
  });

  it("binds scan root and rejects incorrect schema without implicit DDL", async () => {
    const { root, filename } = await fixture(); const other = rootDir();
    edit(filename, db => db.prepare("UPDATE phoenix_cad_scan SET scan_root=?").run(other));
    await expect(prepareCadBomTransfer(root, options)).rejects.toThrow(/根目录不匹配/);
    edit(filename, db => db.prepare("UPDATE phoenix_meta SET value='12' WHERE key='schema_version'").run());
    const before = fs.readFileSync(filename);
    await expect(prepareCadBomTransfer(root, options)).rejects.toThrow(/Schema v13/);
    expect(fs.readFileSync(filename)).toEqual(before);
  });

  it("fails closed for an absent or corrupt database", async () => {
    const root = rootDir(); await expect(prepareCadBomTransfer(root, options)).rejects.toThrow();
    const filename = phoenixDatabasePath(root); expect(fs.existsSync(filename)).toBe(false);
    fs.mkdirSync(path.dirname(filename)); fs.writeFileSync(filename, "not sqlite"); const bytes = fs.readFileSync(filename);
    await expect(prepareCadBomTransfer(root, options)).rejects.toThrow(/not a database|malformed/i);
    expect(fs.readFileSync(filename)).toEqual(bytes); expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("preserves an existing lock and never publishes through it", async () => {
    const { root, filename } = await fixture(); const prepared = await prepareCadBomTransfer(root, options);
    fs.mkdirSync(`${filename}.lock`); const owner = fs.statSync(`${filename}.lock`).ino;
    const publish = vi.fn(); await expect(revalidateCadBomTransfer(root, prepared, publish)).rejects.toThrow(/busy/);
    expect(publish).not.toHaveBeenCalled(); expect(fs.statSync(`${filename}.lock`).ino).toBe(owner);
    fs.rmdirSync(`${filename}.lock`);
  });

  it("refuses native WAL without creating sidecars or changing journal/header bytes", async () => {
    const { root, filename } = await fixture(); const prepared = await prepareCadBomTransfer(root, options);
    edit(filename, db => db.exec("PRAGMA journal_mode=WAL"));
    const before = fs.readFileSync(filename), names = fs.readdirSync(path.dirname(filename)).sort();
    const publish = vi.fn(); await expect(revalidateCadBomTransfer(root, prepared, publish)).rejects.toThrow(/WAL/);
    expect(publish).not.toHaveBeenCalled(); expect(fs.readFileSync(filename)).toEqual(before);
    expect(fs.readdirSync(path.dirname(filename)).sort()).toEqual(names);
  });

  it("cancels during the disk read and again at publication without leaking the lease", async () => {
    const { root, filename } = await fixture(); let checks = 0;
    await expect(prepareCadBomTransfer(root, { ...options, assertActive() { if (++checks > 12) throw new Error("cancelled read"); } })).rejects.toThrow("cancelled read");
    expect(fs.existsSync(`${filename}.lock`)).toBe(false);
    const controller = new AbortController();
    const prepared = await prepareCadBomTransfer(root, { ...options, assertActive: () => controller.signal.throwIfAborted() });
    controller.abort(new Error("cancelled publish"));
    const publish = vi.fn(); await expect(revalidateCadBomTransfer(root, prepared, publish)).rejects.toThrow("cancelled publish");
    expect(publish).not.toHaveBeenCalled(); expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("rejects symlinked files and binds the canonical workspace identity", async () => {
    const { root } = await fixture(); const prepared = await prepareCadBomTransfer(root, options);
    const other = await fixture(); const publish = vi.fn();
    await expect(revalidateCadBomTransfer(other.root, prepared, publish)).rejects.toThrow(/预览已过期/);
    fs.renameSync(path.join(root, PART), path.join(root, "Moved.FCStd")); fs.symlinkSync("Moved.FCStd", path.join(root, PART));
    await expect(revalidateCadBomTransfer(root, prepared, publish)).rejects.toThrow(/符号链接/);
    expect(publish).not.toHaveBeenCalled();
  });

  it("uses the scan scope: hidden/cache directories ignored, dot-prefixed files retained", async () => {
    const { root } = await fixture(root => {
      for (const folder of [".hidden", "__pycache__", "node_modules"]) { fs.mkdirSync(path.join(root, folder)); fs.writeFileSync(path.join(root, folder, "ignored.FCStd"), "not a zip"); }
      fs.writeFileSync(path.join(root, ".Dot.FCStd"), archive("PART-D", "Synthetic dot file"));
    });
    const prepared = await prepareCadBomTransfer(root, options);
    expect(prepared.proof.files.map(file => file.relativePath)).toEqual([".Dot.FCStd", HOST, PART]);
    fs.writeFileSync(path.join(root, ".hidden", "new.FCStd"), "not a zip");
    await expect(revalidateCadBomTransfer(root, prepared, () => "receipt")).resolves.toBe("receipt");
  });

  it("rejects mixed-generation recursive rows and inconsistent source counts", async () => {
    const { root, filename } = await fixture();
    edit(filename, db => { db.exec("PRAGMA foreign_keys=OFF"); db.prepare("UPDATE phoenix_cad_bom_line SET scan_id=scan_id+1").run(); });
    await expect(prepareCadBomTransfer(root, options)).rejects.toThrow(/不同扫描代/);
    await scanCadWorkspaceIndex(root);
    edit(filename, db => {
      const row = db.prepare("SELECT id,stats_json FROM phoenix_cad_scan ORDER BY id DESC LIMIT 1").get() as { id: number; stats_json: string };
      const stats = JSON.parse(row.stats_json); stats.references += 1;
      db.prepare("UPDATE phoenix_cad_scan SET stats_json=? WHERE id=?").run(JSON.stringify(stats), row.id);
    });
    await expect(prepareCadBomTransfer(root, options)).rejects.toThrow(/引用数量/);
  });

  it.each(["changed bytes", "new file in empty directory", "rename", "database inode"])("asserts the exact synchronous publication boundary (%s)", async mutation => {
    const { root, filename } = await fixture(root => fs.mkdirSync(path.join(root, "Empty")));
    const prepared = await prepareCadBomTransfer(root, options), publication = vi.fn();
    await expect(revalidateCadBomTransfer(root, prepared, trusted => {
      if (mutation === "changed bytes") fs.appendFileSync(path.join(root, PART), "external edit");
      if (mutation === "new file in empty directory") fs.writeFileSync(path.join(root, "Empty", "Late.FCStd"), archive("PART-L", "Synthetic late file"));
      if (mutation === "rename") fs.renameSync(path.join(root, PART), path.join(root, "Late.FCStd"));
      if (mutation === "database inode") { fs.copyFileSync(filename, `${filename}.late`); fs.renameSync(`${filename}.late`, filename); }
      trusted.assertCurrent(); publication(); return "receipt";
    })).rejects.toThrow(/改变/);
    expect(publication).not.toHaveBeenCalled(); expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("allows non-CAD temporary files but refuses an assertCurrent callback after lease closure", async () => {
    const { root } = await fixture(); const prepared = await prepareCadBomTransfer(root, options);
    let retainedAssertion: (() => void) | undefined;
    await expect(revalidateCadBomTransfer(root, prepared, trusted => {
      fs.writeFileSync(path.join(root, "transfer.tmp.json"), prepared.bytes);
      trusted.assertCurrent(); retainedAssertion = trusted.assertCurrent; return "receipt";
    })).resolves.toBe("receipt");
    expect(retainedAssertion).toBeTypeOf("function"); expect(() => retainedAssertion?.()).toThrow(/边界已结束/);
  });

  it("preserves the read error and close error instead of masking either", async () => {
    const { root, filename } = await fixture();
    let captured: unknown;
    try {
      await prepareCadBomTransfer(root, { ...options, assertActive() {
        if (fs.existsSync(`${filename}.lock`)) {
          // Keep the old directory alive: inode reuse must not make this fault
          // injection timing-dependent on the filesystem allocator.
          fs.renameSync(`${filename}.lock`, `${filename}.lock.old`); fs.mkdirSync(`${filename}.lock`);
          throw new Error("primary cancellation");
        }
      } });
    } catch (error) { captured = error; }
    expect(captured).toBeInstanceOf(AggregateError);
    expect((captured as AggregateError).errors.map(error => String(error))).toEqual(expect.arrayContaining([expect.stringContaining("primary cancellation"), expect.stringContaining("lock identity changed")]));
    expect(fs.existsSync(`${filename}.lock`)).toBe(true);
    fs.rmdirSync(`${filename}.lock`); fs.rmdirSync(`${filename}.lock.old`);
  });

  it("bounds present source rows including null-heavy records before building arrays", async () => {
    const { root, filename } = await fixture();
    edit(filename, db => db.exec(`WITH RECURSIVE n(value) AS (VALUES(1) UNION ALL SELECT value+1 FROM n WHERE value<5001)
      INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,asset_kind,file_status,updated_at)
      SELECT 'Extra'||value||'.FCStd','Extra'||value||'.FCStd','part','present','2026-01-01T00:00:00.000Z' FROM n`));
    await expect(prepareCadBomTransfer(root, options)).rejects.toThrow(/5000 行安全上限/);
    expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("bounds raw SQLite string bytes before projecting oversized metadata", async () => {
    const { root, filename } = await fixture();
    // A synthetic, temporary-only 66 MiB input; not a checked-in large fixture.
    edit(filename, db => db.exec("UPDATE phoenix_cad_file_asset SET label=CAST(zeroblob(33*1024*1024) AS TEXT)"));
    await expect(prepareCadBomTransfer(root, options)).rejects.toThrow(/原始索引超过 64 MiB/);
    expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("refuses oversized FCStd before any unbounded content read", async () => {
    const { root, filename } = await fixture(); fs.truncateSync(path.join(root, PART), 65 * 1024 * 1024);
    await expect(prepareCadBomTransfer(root, options)).rejects.toThrow(/64 MiB 安全上限/);
    expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("releases its read lease when a synchronous publisher throws", async () => {
    const { root, filename } = await fixture(); const prepared = await prepareCadBomTransfer(root, options);
    await expect(revalidateCadBomTransfer(root, prepared, trusted => {
      trusted.assertCurrent(); throw new Error("publication refused");
    })).rejects.toThrow("publication refused");
    expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("reports a thenable callback as developer misuse, not a pre-invocation safety guarantee", async () => {
    const { root, filename } = await fixture(); const prepared = await prepareCadBomTransfer(root, options);
    const wrongCallback = vi.fn(() => Promise.resolve("not a publication"));
    // Deliberately bypass the static guard to cover the runtime programming error.
    await expect(revalidateCadBomTransfer(root, prepared, wrongCallback as unknown as () => never)).rejects.toThrow(/回调必须同步/);
    expect(wrongCallback).toHaveBeenCalledOnce();
    expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("stops directory enumeration at entry 20001 before invoking the shared whole-directory visitor", async () => {
    const { root, filename } = await fixture(); const actualRoot = fs.realpathSync(root);
    let reads = 0; const closeSync = vi.fn(), open = fs.opendirSync;
    vi.spyOn(fs, "opendirSync").mockImplementation(((file, settings) => String(file) === actualRoot
      ? { readSync: () => syntheticEntry(`note-${++reads}.txt`), closeSync } as unknown as fs.Dir
      : open(file, settings)) as typeof fs.opendirSync);
    const visitor = vi.spyOn(fs.promises, "readdir");
    await expect(prepareCadBomTransfer(root, options)).rejects.toThrow(/20000 个目录项安全上限/);
    expect(reads).toBe(20001); expect(closeSync).toHaveBeenCalledOnce(); expect(visitor).not.toHaveBeenCalled();
    expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("shares the directory-entry budget across directories rather than resetting it per directory", async () => {
    const { root, filename } = await fixture(root => fs.mkdirSync(path.join(root, "Child")));
    const actualRoot = fs.realpathSync(root); let rootReads = 0, childReads = 0;
    const rootClose = vi.fn(), childClose = vi.fn(), open = fs.opendirSync;
    vi.spyOn(fs, "opendirSync").mockImplementation(((file, settings) => {
      if (String(file) === actualRoot) return { readSync: () => ++rootReads === 1 ? syntheticEntry("Child", true) : null, closeSync: rootClose } as unknown as fs.Dir;
      if (String(file) === path.join(actualRoot, "Child")) return { readSync: () => syntheticEntry(`note-${++childReads}.txt`), closeSync: childClose } as unknown as fs.Dir;
      return open(file, settings);
    }) as typeof fs.opendirSync);
    await expect(prepareCadBomTransfer(root, options)).rejects.toThrow(/20000 个目录项安全上限/);
    expect(childReads).toBe(20000); expect(rootClose).toHaveBeenCalledOnce(); expect(childClose).toHaveBeenCalledOnce();
    expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("bounds final synchronous assertCurrent enumeration too", async () => {
    const { root, filename } = await fixture(); const prepared = await prepareCadBomTransfer(root, options), actualRoot = fs.realpathSync(root);
    let inject = false, reads = 0; const closeSync = vi.fn(), open = fs.opendirSync;
    vi.spyOn(fs, "opendirSync").mockImplementation(((file, settings) => inject && String(file) === actualRoot
      ? { readSync: () => syntheticEntry(`note-${++reads}.txt`), closeSync } as unknown as fs.Dir
      : open(file, settings)) as typeof fs.opendirSync);
    const publication = vi.fn();
    await expect(revalidateCadBomTransfer(root, prepared, trusted => {
      inject = true; trusted.assertCurrent(); publication(); return "receipt";
    })).rejects.toThrow(/20000 个目录项安全上限/);
    expect(reads).toBe(20001); expect(closeSync).toHaveBeenCalledOnce(); expect(publication).not.toHaveBeenCalled();
    expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });

  it("aggregates directory read and close failures while releasing the database lease", async () => {
    const { root, filename } = await fixture(); const actualRoot = fs.realpathSync(root), open = fs.opendirSync;
    const closeSync = vi.fn(() => { throw new Error("directory close failed"); });
    vi.spyOn(fs, "opendirSync").mockImplementation(((file, settings) => String(file) === actualRoot
      ? { readSync: () => { throw new Error("directory read failed"); }, closeSync } as unknown as fs.Dir
      : open(file, settings)) as typeof fs.opendirSync);
    let captured: unknown; try { await prepareCadBomTransfer(root, options); } catch (error) { captured = error; }
    expect(captured).toBeInstanceOf(AggregateError);
    expect((captured as AggregateError).errors.map(error => String(error))).toEqual([expect.stringContaining("directory read failed"), expect.stringContaining("directory close failed")]);
    expect(closeSync).toHaveBeenCalledOnce(); expect(fs.existsSync(`${filename}.lock`)).toBe(false);
  });
});
