import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { listXlinkFixCandidates } from "./pnwXlinkFixService.js";

const roots: string[] = [];

// Independently constructed index rows only: no CAD files or project inventory.
function syntheticIndex() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xlink-candidate-index-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, ".phoenix"));
  const db = pnwCreateDb(path.join(root, ".phoenix", "phoenix-workspace.sqlite"));
  db.exec(`
    CREATE TABLE phoenix_cad_file_asset (
      id INTEGER PRIMARY KEY, repo_rel_path TEXT, filename TEXT,
      part_number TEXT, part_version TEXT, file_status TEXT
    );
    CREATE TABLE phoenix_cad_bom_xref (id INTEGER PRIMARY KEY);
  `);
  const insert = (id: number, rel: string, filename: string, number: string, version: string, status = "present") =>
    db.run("INSERT INTO phoenix_cad_file_asset VALUES (?, ?, ?, ?, ?, ?)", [id, rel, filename, number, version, status]);
  for (let index = 0; index < 83; index++) {
    const version = String(index % 3 + 1).padStart(3, "0");
    const name = `DEMO.${version}-Sample.FCStd`;
    insert(index + 1, `./synthetic/copy-${index}/${name}`, name, "DEMO", version);
  }
  insert(100, "./synthetic/host.FCStd", "Host.FCStd", "DEMO", "001");
  insert(101, "./synthetic/missing.FCStd", "Missing.FCStd", "DEMO", "001", "missing");
  insert(102, "./synthetic/export.step", "Export.step", "DEMO", "001");
  insert(103, "./synthetic/unrelated.FCStd", "DEMO.001-Sample.FCStd", "OTHER", "001");
  insert(104, "./synthetic/Plain.FCStd", "Plain.FCStd", "", "");
  db.close();
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("manual XLink candidate selection", () => {
  it("lists every present FCStd with the inferred part number across revisions and directories", () => {
    const root = syntheticIndex();
    for (const part_version of [undefined, "", "   "]) {
      const result = listXlinkFixCandidates(root, {
        basename: "DEMO.001-Sample.FCStd", part_version, exclude_repo_rel: "synthetic/host.FCStd",
      });
      expect(result).toMatchObject({ part_number: "DEMO", part_version: "", part_key: "" });
      expect(result.files).toHaveLength(83);
      expect(new Set(result.files.map((file: any) => file.repo_rel_path)).size).toBe(83);
      expect(new Set(result.files.map((file: any) => file.part_version))).toEqual(new Set(["001", "002", "003"]));
      expect(result.files.every((file: any) => file.part_number === "DEMO" && file.file_status === "present")).toBe(true);
    }
  });

  it("applies an explicit version exactly without re-adding the old basename or another part", () => {
    const root = syntheticIndex();
    const result = listXlinkFixCandidates(root, {
      basename: "DEMO.001-Sample.FCStd", part_number: " DEMO ", part_version: " 002 ",
    });
    expect(result).toMatchObject({ part_number: "DEMO", part_version: "002", part_key: "DEMO.002" });
    expect(result.files).toHaveLength(28);
    expect(result.files.every((file: any) => file.part_number === "DEMO" && file.part_version === "002")).toBe(true);
    expect(listXlinkFixCandidates(root, {
      basename: "DEMO.001-Sample.FCStd", part_number: "NO_MATCH", part_version: "001",
    }).files).toEqual([]);
  });

  it("retains basename search when no part number can be inferred", () => {
    const result = listXlinkFixCandidates(syntheticIndex(), { basename: "Plain.FCStd" });
    expect(result.files).toEqual([expect.objectContaining({ repo_rel_path: "./synthetic/Plain.FCStd" })]);
  });
});
