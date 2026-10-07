import fs from "node:fs";
import path from "node:path";
import { pnwCadXlinkRuleLabel } from "@phoenix-wing/cad-core";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").trim().replace(/^\.\//, "");
}

function pathKeyCandidates(value: string): string[] {
  const normalized = normalizeRelativePath(value);
  return normalized ? [normalized, `./${normalized}`] : [];
}

export type CadIndexBomFields = {
  PartNumber?: string;
  PartVersion?: string;
  TypeCode?: string;
  ModelSeries?: string;
  PartName?: string;
  label?: string;
};

/**
 * Keep the existing Auto CAD-owned asset/xref projection coherent after an
 * explicit Desk BOM write. This never creates an index, changes scan
 * freshness (`bom_json`/mtime), or rewrites user-maintained PartKey rows.
 */
export function updateCadIndexEntryAfterBomWrite(
  workspace: string,
  relativePath: string,
  fields: CadIndexBomFields,
  selectedFields?: readonly (keyof CadIndexBomFields)[],
): boolean {
  if (!workspace) return false;
  const filename = phoenixDatabasePath(workspace);
  if (!fs.existsSync(filename)) return false;
  const keys = pathKeyCandidates(relativePath);
  if (!keys.length) return false;

  const db = pnwCreateDb(filename);
  try {
    const row = db.get<{
      id: number;
      repo_rel_path: string;
      filename: string;
      part_number?: string | null;
      part_version?: string | null;
      type_code?: string | null;
      model_series?: string | null;
      part_name?: string | null;
      label?: string | null;
    }>(
      `SELECT id, repo_rel_path, filename${selectedFields ? ", part_number, part_version, type_code, model_series, part_name, label" : ""}
       FROM phoenix_cad_file_asset
       WHERE repo_rel_path IN (${keys.map(() => "?").join(", ")})
       LIMIT 1`,
      keys,
    );
    if (!row) return false;

    if (selectedFields) {
      const patch = Object.fromEntries(Object.entries(fields).filter(([key]) => selectedFields.includes(key as keyof CadIndexBomFields)));
      fields = { PartNumber: row.part_number || "", PartVersion: row.part_version || "", TypeCode: row.type_code || "", ModelSeries: row.model_series || "", PartName: row.part_name || "", label: row.label || "", ...patch };
    }
    const values = {
      part_number: String(fields.PartNumber ?? "").trim() || null,
      part_version: String(fields.PartVersion ?? "").trim() || null,
      type_code: String(fields.TypeCode ?? "").trim().toUpperCase() || null,
      model_series: String(fields.ModelSeries ?? "").trim().toUpperCase() || null,
      part_name: String(fields.PartName ?? "").trim() || null,
      label: String(fields.label ?? "").trim() || null,
    };
    if (selectedFields) {
      const columns = { PartNumber: "part_number", PartVersion: "part_version", TypeCode: "type_code", ModelSeries: "model_series", PartName: "part_name", label: "label" } as const;
      for (const field of Object.keys(columns) as (keyof typeof columns)[]) {
        // A partial write must not normalize or clear another indexed field.
        if (!selectedFields.includes(field)) values[columns[field]] = row[columns[field]] ?? null;
      }
    }
    const ruleLabel = pnwCadXlinkRuleLabel(values, row.filename, row.repo_rel_path);

    db.exec("BEGIN TRANSACTION");
    try {
      db.run(
        `UPDATE phoenix_cad_file_asset
         SET part_number = ?, part_version = ?, type_code = ?, model_series = ?,
             part_name = ?, label = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [
          values.part_number,
          values.part_version,
          values.type_code,
          values.model_series,
          values.part_name,
          values.label,
          row.id,
        ],
      );
      const hasXrefs = Boolean(db.get(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'phoenix_cad_bom_xref'",
      ));
      if (hasXrefs) {
        db.run(
          `UPDATE phoenix_cad_bom_xref
           SET target_part_number = ?, target_part_version = ?, target_type_code = ?,
               target_model_series = ?, target_part_name = ?, target_asset_label = ?,
               rule_label = ?
           WHERE target_file_asset_id = ?`,
          [
            values.part_number || "",
            values.part_version || "",
            values.type_code || "",
            values.model_series || "",
            values.part_name || "",
            values.label || "",
            ruleLabel,
            row.id,
          ],
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      throw error;
    }
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/** Keep an existing Auto CAD-owned index coherent after a Desk file rename. */
export function updateCadIndexEntryAfterRename(
  workspace: string,
  oldRelativePath: string,
  newRelativePath: string,
): boolean {
  if (!workspace) return false;
  const filename = phoenixDatabasePath(workspace);
  if (!fs.existsSync(filename)) return false;
  const oldKeys = pathKeyCandidates(oldRelativePath);
  const newKeys = pathKeyCandidates(newRelativePath);
  if (!oldKeys.length || !newKeys.length) return false;

  const db = pnwCreateDb(filename);
  try {
    const row = db.get<{ id: number; repo_rel_path: string }>(
      `SELECT id, repo_rel_path
       FROM phoenix_cad_file_asset
       WHERE repo_rel_path IN (${oldKeys.map(() => "?").join(", ")})
       LIMIT 1`,
      oldKeys,
    );
    if (!row) return false;
    const conflict = db.get<{ id: number }>(
      `SELECT id
       FROM phoenix_cad_file_asset
       WHERE repo_rel_path IN (${newKeys.map(() => "?").join(", ")}) AND id != ?
       LIMIT 1`,
      [...newKeys, row.id],
    );
    if (conflict) return false;

    const newNormalized = normalizeRelativePath(newRelativePath);
    const newKey = row.repo_rel_path.startsWith("./") ? `./${newNormalized}` : newNormalized;
    const newFilename = path.posix.basename(newNormalized);
    db.exec("BEGIN TRANSACTION");
    try {
      db.run(
        `UPDATE phoenix_cad_file_asset
         SET repo_rel_path = ?, filename = ?, file_status = 'present', updated_at = datetime('now')
         WHERE id = ?`,
        [newKey, newFilename, row.id],
      );
      const hasXrefs = Boolean(db.get(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'phoenix_cad_bom_xref'",
      ));
      if (hasXrefs) {
        db.run(
          "UPDATE phoenix_cad_bom_xref SET host_repo_rel_path = ? WHERE host_file_asset_id = ?",
          [newKey, row.id],
        );
        db.run(
          `UPDATE phoenix_cad_bom_xref
           SET target_repo_rel_path = ?, target_basename = ?, resolve_status = 'missing'
           WHERE target_file_asset_id = ?`,
          [newKey, newFilename, row.id],
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      throw error;
    }
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}
