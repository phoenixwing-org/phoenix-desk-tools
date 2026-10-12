import { pnwCadIndexIncludesPath, pnwCadIndexRelativePath, pnwCadXlinkRuleLabel, pnwInferBomFieldsFromFilename, type PnwCadWorkspaceIndexPlan } from "@phoenix-wing/cad-core";
import { PNW_CAD_INDEX_WRITE_PROTOCOL, pnwReadCadIndexRevisionV1, type PnwCadIndexDatabaseV1 } from "@phoenix-wing/cad-contracts";

export type CadPartialIndexWriteOptions = {
  scanUuid: string;
  scanRoot: string;
  scannedAt: string;
  expectedScanId: number;
  /** File discovery succeeded completely, including the failed file snapshots. */
  inventoryComplete: true;
  assertCurrent?: () => void;
};

export type CadPartialIndexWriteResult = {
  scanId: number;
  files: number;
  parsedFiles: number;
  references: number;
  bomLines: number;
  partial: true;
  failed_count: number;
  failures: Array<{ rel: string; message: string }>;
};

type AssetIdentity = {
  id: number; repo_rel_path: string;
  part_number?: string | null; part_version?: string | null; type_code?: string | null;
  model_series?: string | null; part_name?: string | null; label?: string | null;
  file_status?: string | null; bom_json?: string | null;
};
const ASSET_IDENTITY_COLUMNS = "id,repo_rel_path,part_number,part_version,type_code,model_series,part_name,label,file_status,bom_json";

/**
 * Explicit partial parsing projection. Unlike the shared complete-scan writer,
 * this never establishes a completed BOM snapshot. A fully discovered stable
 * inventory is still mandatory; traversal or snapshot errors must abort before
 * calling this function. This adapter owns no filesystem or schema migration.
 */
export function writePartialCadWorkspaceIndex(
  db: PnwCadIndexDatabaseV1, plan: PnwCadWorkspaceIndexPlan, options: CadPartialIndexWriteOptions,
): CadPartialIndexWriteResult {
  if (options.inventoryComplete !== true) throw new Error("A complete stable file inventory is required for partial indexing");
  if (!options.scanUuid.trim() || !options.scanRoot.trim() || !Number.isFinite(Date.parse(options.scannedAt))
    || !Number.isSafeInteger(options.expectedScanId) || options.expectedScanId < 0) throw new Error("Invalid partial CAD scan metadata");
  const failures = plan.assets.filter(asset => asset.parseError).map(asset => ({ rel: asset.relativePath, message: asset.parseError! }));
  if (!failures.length || failures.length !== plan.parseFailures) throw new Error("Partial indexing requires explicit per-file parse failures");
  const failedKeys = new Set(failures.map(failure => failure.rel.toLowerCase()));
  const planned = new Set<string>();
  for (const asset of plan.assets) {
    const relative = pnwCadIndexRelativePath(asset.relativePath);
    if (relative !== asset.relativePath || !pnwCadIndexIncludesPath(relative) || planned.has(relative.toLowerCase())) {
      throw new Error("Unsafe or duplicate partial CAD index asset");
    }
    if (![asset.sizeBytes, asset.modifiedAtMs, asset.objectCount].every(value => Number.isFinite(value) && value >= 0)) {
      throw new Error("Invalid partial CAD file snapshot");
    }
    planned.add(relative.toLowerCase());
  }
  for (const reference of plan.references) {
    if (!planned.has(reference.hostRelativePath.toLowerCase()) || failedKeys.has(reference.hostRelativePath.toLowerCase())) {
      throw new Error("A failed or unknown file cannot supply parsed references");
    }
    if (!Number.isSafeInteger(reference.quantity) || reference.quantity < 1) throw new Error("Invalid partial CAD reference quantity");
  }
  for (const line of plan.bomLines) {
    if (!planned.has(line.assemblyRelativePath.toLowerCase()) || failedKeys.has(line.assemblyRelativePath.toLowerCase())
      || !planned.has(line.hostRelativePath.toLowerCase()) || failedKeys.has(line.hostRelativePath.toLowerCase())) {
      throw new Error("A failed or unknown file cannot supply parsed BOM rows");
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) throw new Error("Invalid partial CAD BOM quantity");
  }
  const assertCurrent = options.assertCurrent || (() => {});
  assertCurrent();
  db.exec("BEGIN IMMEDIATE");
  try {
    const schema = db.get<{ value: string }>("SELECT value FROM phoenix_meta WHERE key='schema_version'");
    if (String(schema?.value) !== "13") throw new Error("Partial CAD index requires workspace Schema v13; no automatic migration");
    if (pnwReadCadIndexRevisionV1(db) !== options.expectedScanId) throw new Error("CAD index changed during discovery; rescan required");
    assertCurrent();
    const byKey = new Map<string, AssetIdentity>();
    for (const row of db.all<AssetIdentity>(`SELECT ${ASSET_IDENTITY_COLUMNS} FROM phoenix_cad_file_asset`)) {
      if (!pnwCadIndexIncludesPath(row.repo_rel_path)) continue;
      const key = pnwCadIndexRelativePath(row.repo_rel_path).toLowerCase();
      if (byKey.has(key)) throw new Error(`Duplicate legacy CAD paths; resolve explicitly before scanning: ${byKey.get(key)!.repo_rel_path} | ${row.repo_rel_path}`);
      byKey.set(key, row);
    }
    const savedFailedPartKeys = new Map<string, string>();
    for (const key of failedKeys) {
      const previous = byKey.get(key);
      let snapshot: { protocol?: unknown; version?: unknown; saved_part_key?: unknown; parse_error?: unknown } | null = null;
      try { snapshot = JSON.parse(previous?.bom_json || "null"); } catch { /* Saved field values can still be preserved. */ }
      const number = previous?.part_number?.trim(), version = previous?.part_version?.trim();
      // A prior partial scan's filename fallback is display-only, including on
      // subsequent failed scans. Never promote it into a manufacturing identity.
      const savedKey = snapshot && Object.hasOwn(snapshot, "saved_part_key")
        ? (typeof snapshot.saved_part_key === "string" && snapshot.protocol === PNW_CAD_INDEX_WRITE_PROTOCOL && snapshot.version === 1 && number && version
          && snapshot.saved_part_key === `${number}.${version}` ? snapshot.saved_part_key : "")
        : previous && previous.file_status !== "error" && !snapshot?.parse_error && number && version ? `${number}.${version}` : "";
      savedFailedPartKeys.set(key, savedKey);
    }
    const storedPath = (relative: string) => byKey.get(relative.toLowerCase())?.repo_rel_path || relative;
    const now = options.scannedAt;
    const stats = JSON.stringify({ source: "phoenix-desk-tools-cad-partial-index", complete: false, inventory_complete: true,
      bom_complete: false, files: plan.assets.length, parsed_files: plan.assets.length - failures.length,
      parse_failures: failures.length, failed_count: failures.length, failures,
      references: plan.references.length, bom_lines: plan.bomLines.length });
    db.run(`INSERT INTO phoenix_cad_scan
      (scan_uuid,scanned_at,scan_root,stats_json,status,phase,started_at,finished_at)
      VALUES (?,?,?,?,'partial','ts-light-index-partial',?,?)`, [options.scanUuid, now, options.scanRoot, stats, now, now]);
    const scanId = pnwReadCadIndexRevisionV1(db);
    // Only a complete inventory proves disappearance. Manual identities and
    // associations remain; failed-but-present files are changed to error below.
    for (const row of byKey.values()) db.run("UPDATE phoenix_cad_file_asset SET file_status='missing',updated_at=? WHERE id=?", [now, row.id]);
    for (const asset of plan.assets) {
      const relative = storedPath(asset.relativePath), kind = asset.documentKind.toLowerCase();
      const failed = Boolean(asset.parseError);
      const fields = failed ? pnwInferBomFieldsFromFilename(asset.relativePath) : asset.fields;
      const snapshot = JSON.stringify({ protocol: PNW_CAD_INDEX_WRITE_PROTOCOL, version: 1, complete: !failed,
        size_bytes: asset.sizeBytes, mtime_ms: Math.trunc(asset.modifiedAtMs), document_xml_objects: asset.objectCount,
        xlinks: failed ? [] : asset.xlinks, ...(failed ? { parse_error: asset.parseError,
          saved_part_key: savedFailedPartKeys.get(asset.relativePath.toLowerCase()) || null } : {}) });
      if (failed) {
        // Existing saved CAD values stay intact. Filename inference is only the
        // display fallback for a newly discovered failed file, never Part truth.
        db.run(`INSERT INTO phoenix_cad_file_asset
          (repo_rel_path,filename,asset_kind,part_number,part_version,type_code,model_series,part_name,label,file_status,last_seen_at,bom_json,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,'error',?,?,?) ON CONFLICT(repo_rel_path) DO UPDATE SET
          file_status='error',last_seen_at=excluded.last_seen_at,bom_json=excluded.bom_json,updated_at=excluded.updated_at`,
        [relative, asset.filename, kind, fields.PartNumber, fields.PartVersion, fields.TypeCode, fields.ModelSeries, fields.PartName, fields.label, now, snapshot, now]);
      } else {
        db.run(`INSERT INTO phoenix_cad_file_asset
          (repo_rel_path,filename,asset_kind,part_number,part_version,type_code,model_series,part_name,label,file_status,last_seen_at,bom_json,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,'present',?,?,?) ON CONFLICT(repo_rel_path) DO UPDATE SET
          filename=excluded.filename,asset_kind=excluded.asset_kind,part_number=excluded.part_number,
          part_version=excluded.part_version,type_code=excluded.type_code,model_series=excluded.model_series,
          part_name=excluded.part_name,label=excluded.label,file_status='present',last_seen_at=excluded.last_seen_at,
          bom_json=excluded.bom_json,updated_at=excluded.updated_at`,
        [relative, asset.filename, kind, fields.PartNumber, fields.PartVersion, fields.TypeCode, fields.ModelSeries, fields.PartName, fields.label, now, snapshot, now]);
      }
      const row = db.get<AssetIdentity>(`SELECT ${ASSET_IDENTITY_COLUMNS} FROM phoenix_cad_file_asset WHERE repo_rel_path=?`, [relative]);
      if (!row) throw new Error("Partial CAD asset insertion failed");
      byKey.set(asset.relativePath.toLowerCase(), row);
      if (failed || !fields.PartNumber || !fields.PartVersion) continue;
      db.run(`INSERT INTO phoenix_cad_part_key
        (part_number,part_version,type_code,model_series,part_name,label,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'active',?,?) ON CONFLICT(part_number,part_version) DO NOTHING`,
      [fields.PartNumber, fields.PartVersion, fields.TypeCode, fields.ModelSeries, fields.PartName, fields.label, now, now]);
      const part = db.get<{ id: number }>("SELECT id FROM phoenix_cad_part_key WHERE part_number=? AND part_version=?", [fields.PartNumber, fields.PartVersion]);
      if (!part) throw new Error("Partial CAD PartKey insertion failed");
      db.run(`INSERT INTO phoenix_cad_part_file_link (part_key_id,file_asset_id,file_role,link_status,linked_at)
        VALUES (?,?,?,'active',?) ON CONFLICT(file_asset_id) DO NOTHING`, [part.id, row.id, kind, now]);
    }
    const hosts = new Set<string>();
    for (const row of byKey.values()) {
      const key = pnwCadIndexRelativePath(row.repo_rel_path);
      hosts.add(row.repo_rel_path); hosts.add(key); hosts.add(`./${key}`);
    }
    // Clear old successful-looking graphs for failed and disappeared hosts too;
    // they must not survive as if supplied by this partial parse.
    for (const host of hosts) for (const [table, column] of [
      ["phoenix_cad_bom_xref", "host_repo_rel_path"], ["phoenix_cad_xref_flat", "host_rel"],
      ["phoenix_cad_bom_line", "assembly_rel"], ["phoenix_cad_bom_tree_occurrence", "root_host_repo_rel_path"],
      ["phoenix_cad_bom_assembly_cache", "host_repo_rel_path"],
    ]) db.run(`DELETE FROM ${table} WHERE ${column}=?`, [host]);
    for (const reference of plan.references) {
      const host = byKey.get(reference.hostRelativePath.toLowerCase());
      const target = reference.targetRelativePath ? byKey.get(reference.targetRelativePath.toLowerCase()) : undefined;
      if (!host || (reference.targetRelativePath && !target)) throw new Error("Unknown partial CAD reference identity");
      const failedTarget = Boolean(reference.targetRelativePath && failedKeys.has(reference.targetRelativePath.toLowerCase()));
      const savedTargetKey = reference.targetRelativePath ? savedFailedPartKeys.get(reference.targetRelativePath.toLowerCase()) : "";
      const fields = failedTarget && target ? { PartNumber: savedTargetKey ? target.part_number?.trim() || "" : "", PartVersion: savedTargetKey ? target.part_version?.trim() || "" : "",
        TypeCode: target.type_code || "", ModelSeries: target.model_series || "", PartName: target.part_name || "", label: target.label || "" } : reference.targetFields;
      const targetBasename = reference.file.split("/").at(-1) || "";
      const ruleLabel = pnwCadXlinkRuleLabel({ part_number: fields.PartNumber, part_version: fields.PartVersion,
        part_name: fields.PartName, label: fields.label }, targetBasename, target?.repo_rel_path ?? null);
      db.run(`INSERT INTO phoenix_cad_bom_xref
        (scan_id,host_file_asset_id,host_repo_rel_path,xlink_file_attr,link_label,rule_label,target_basename,
        target_file_asset_id,target_repo_rel_path,target_part_number,target_part_version,target_type_code,
        target_model_series,target_part_name,target_asset_label,resolve_status,detail_json,last_seen_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [scanId, host.id, host.repo_rel_path, reference.file, reference.label, ruleLabel, targetBasename, target?.id ?? null,
        target?.repo_rel_path ?? null, fields.PartNumber, fields.PartVersion, fields.TypeCode, fields.ModelSeries, fields.PartName,
        fields.label, reference.status, JSON.stringify({ source: "phoenix-desk-tools-cad-partial-index", complete: false,
          basic_bom: true, quantity: reference.quantity, ...(failedTarget ? { target_parse_error: true } : {}) }), now]);
      if (reference.status === "resolved" && target) db.run(`INSERT INTO phoenix_cad_xref_flat
        (scan_id,host_rel,target_rel,link_label,is_direct,built_at) VALUES (?,?,?,?,1,?)`,
      [scanId, host.repo_rel_path, target.repo_rel_path, reference.label, now]);
    }
    for (const line of plan.bomLines) {
      const root = storedPath(line.assemblyRelativePath);
      const targetKey = line.partRelativePath.toLowerCase();
      const partKey = failedKeys.has(targetKey) ? savedFailedPartKeys.get(targetKey) || "" : line.partKey;
      db.run(`INSERT INTO phoenix_cad_bom_line
        (scan_id,assembly_rel,part_rel,depth,bom_path,part_key,quantity,cycle_detected,built_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      [scanId, root, storedPath(line.partRelativePath), line.depth, line.bomPath, partKey, line.quantity, line.cycleDetected ? 1 : 0, now]);
      db.run(`INSERT INTO phoenix_cad_bom_tree_occurrence
        (root_host_repo_rel_path,tree_path,depth,host_repo_rel_path,target_repo_rel_path,xlink_file_attr,link_label,built_at)
        VALUES (?,?,?,?,?,?,?,?)`, [root, line.treePath, line.depth, storedPath(line.hostRelativePath), storedPath(line.partRelativePath), line.file, line.label, now]);
    }
    assertCurrent();
    db.exec("COMMIT");
    return { scanId, files: plan.assets.length, parsedFiles: plan.assets.length - failures.length,
      references: plan.references.length, bomLines: plan.bomLines.length, partial: true, failed_count: failures.length, failures };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
