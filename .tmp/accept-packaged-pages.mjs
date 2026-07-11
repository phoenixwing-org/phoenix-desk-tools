import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const base = "http://127.0.0.1:5190";
const workspace = path.resolve(".tmp/tauri-acceptance-workspace");
const evidence = {};

async function api(url, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers };
  const response = await fetch(`${base}${url}`, { ...options, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${url} -> ${response.status}: ${text}`);
  }
  return body;
}

function json(value) {
  return JSON.stringify(value);
}

const boltRel = "Cad/parts/100003.001-H-Bolt.FCStd";
const boltPath = path.join(workspace, ...boltRel.split("/"));
const nlsRel = "CAA/Dialog/PNXBomAnalysisDlg.CATNls";
const dlgRel = "CAA/Dialog/PNXBomAnalysisDlg.CATDlg";
const nlsPath = path.join(workspace, ...nlsRel.split("/"));
const gitProbeRel = "release-api-acceptance.txt";
const gitProbePath = path.join(workspace, gitProbeRel);
const stepInput = path.join(workspace, "StepInput");
const stepOutput = path.join(workspace, "StepOutput");
const swOutput = path.join(workspace, "SwOutput");
const boltBackup = fs.readFileSync(boltPath);
const nlsBackup = fs.readFileSync(nlsPath);
let originalWorksets = null;
let originalSession = null;
let originalPartNotes = "";

try {
  const health = await api("/api/health");
  assert.equal(health.service, "phoenix-node");
  assert.equal(health.protocol_version, 1);
  evidence.runtime = health;

  const selected = await api("/api/workspace", { method: "POST", body: json({ path: workspace }) });
  assert.equal(path.resolve(selected.path), workspace);
  const native = await api("/api/native-tools/status");
  assert.equal(native.tools.length, 2);
  assert.ok(native.tools.every((tool) => tool.available && tool.path.includes("target\\release\\runtime\\bin")));
  const tree = await api("/api/tree?fcstd=true&sw=true&cpp=true&header=true");
  evidence.shell = { workspace: selected.name, native: native.tools.map((tool) => tool.path), tree_count: tree.count };

  originalSession = await api("/api/workbench/session");
  const savedSession = await api("/api/workbench/session", {
    method: "PUT",
    body: json({ version: 1, active_tab_id: "code_index", tabs: [{ id: "code_index", title: "Code Index" }] }),
  });
  assert.equal(savedSession.session.active_tab_id ?? savedSession.session.activeTabId, "code_index");

  originalWorksets = await api("/api/file-worksets");
  const probeWorkset = {
    id: "release-api-acceptance",
    name: "Release API Acceptance",
    source: "packaged-runtime",
    entries: [{ path: "Code", type: "dir" }],
  };
  const worksetsWrite = await api("/api/file-worksets", {
    method: "PUT",
    body: json({ worksets: [...originalWorksets.worksets, probeWorkset] }),
  });
  assert.ok(worksetsWrite.worksets.some((item) => item.id === probeWorkset.id));
  evidence.worksets = { storage: worksetsWrite.storage, count: worksetsWrite.worksets.length };

  fs.writeFileSync(gitProbePath, "Phoenix packaged Git acceptance\n", "utf8");
  const gitInfo = await api("/api/git/info");
  assert.equal(gitInfo.repo_initialized, true);
  const staged = await api("/api/git/stage", { method: "POST", body: json({ paths: [gitProbeRel] }) });
  assert.ok(staged.staged.some((item) => item.endsWith(gitProbeRel)));
  await api("/api/git/restore", { method: "POST", body: json({ paths: [gitProbeRel], scope: "staged" }) });
  await api("/api/git/restore", { method: "POST", body: json({ paths: [gitProbeRel], scope: "untracked" }) });
  assert.equal(fs.existsSync(gitProbePath), false);
  evidence.git = { git_root: gitInfo.git_root, staged_then_removed: true };

  const codeIndex = await api("/api/code/index/scan", { method: "POST", body: "{}" });
  assert.ok((codeIndex.stats?.total ?? codeIndex.count ?? 0) >= 4);
  const codeSearch = await api("/api/code/index/entries?q=SampleWidget.cpp&search_mode=filename&limit=20");
  assert.ok(codeSearch.entries.some((item) => item.filename === "SampleWidget.cpp"));
  const codeExport = await api("/api/code/index/export-json", { method: "POST" });
  assert.ok(fs.existsSync(path.resolve(workspace, codeExport.path)));

  const ignorePrefs = await api("/api/code/ignore/prefs");
  const ignoreSaved = await api("/api/code/ignore/prefs", { method: "PUT", body: json(ignorePrefs) });
  assert.ok(Array.isArray(ignoreSaved.ignore_patterns));

  const reorder = await api("/api/code/reorder-members/run", {
    method: "POST",
    body: json({ repo_rel_paths: ["Code"], dry_run: true }),
  });
  assert.ok(reorder.files_scanned >= 2);
  assert.equal(reorder.dry_run, true);

  const renamePreview = await api("/api/code/rename/preview", {
    method: "POST",
    body: json({
      old: "SampleWidget",
      new: "ReleaseWidget",
      levels: ["file", "text"],
      scope: "Code",
      target_encoding: "utf-8",
      include_ignored: false,
      rescan_index: false,
    }),
  });
  assert.equal(renamePreview.dry_run, true);
  assert.ok(renamePreview.summary.total_hits > 0);

  const uuidScan = await api("/api/code/uuid/scan", {
    method: "POST",
    body: json({ scope: "Code", kinds: ["uuid", "guid32"], include_ignored: false }),
  });
  assert.ok(uuidScan.hits.length >= 2);
  const uuidDryRun = await api("/api/code/uuid/apply", {
    method: "POST",
    body: json({ hit_ids: uuidScan.hits.slice(0, 2).map((item) => item.hit_id), strategy: "map_per_value", dry_run: true }),
  });
  assert.equal(uuidDryRun.dry_run, true);
  assert.equal(uuidDryRun.mappings.length, 2);
  evidence.code = {
    index_total: codeIndex.stats?.total ?? codeIndex.count,
    filename_hits: codeSearch.count,
    reorder_files: reorder.files_scanned,
    rename_hits: renamePreview.summary.total_hits,
    uuid_hits: uuidScan.hits.length,
  };

  const caaScan = await api("/api/caa/index/scan", { method: "POST", body: json({ workspaceRoot: workspace }) });
  assert.equal(caaScan.count, 2);
  const parsed = await api("/api/caa/dialog/parse", {
    method: "POST",
    body: json({ workspaceRoot: workspace, catDlgRel: dlgRel, catNlsRel: nlsRel }),
  });
  assert.equal(parsed.dialogName, "PNXBomAnalysisDlg");
  const dryWrite = await api("/api/caa/dialog/write", {
    method: "POST",
    body: json({ workspaceRoot: workspace, catDlgRel: dlgRel, ir: parsed, dryRun: true }),
  });
  assert.equal(dryWrite.dryRun, true);
  const nlsSource = nlsBackup.toString("utf8");
  await api("/api/caa/dialog/save-nls", {
    method: "POST",
    body: json({
      workspaceRoot: workspace,
      catNlsRel: nlsRel,
      entries: [{ key: "Title", value: "Release API Acceptance" }],
      sourceText: nlsSource,
    }),
  });
  const parsedChanged = await api("/api/caa/dialog/parse", {
    method: "POST",
    body: json({ workspaceRoot: workspace, catDlgRel: dlgRel, catNlsRel: nlsRel }),
  });
  assert.equal(parsedChanged.title, "Release API Acceptance");
  fs.writeFileSync(nlsPath, nlsBackup);
  const parsedRestored = await api("/api/caa/dialog/parse", {
    method: "POST",
    body: json({ workspaceRoot: workspace, catDlgRel: dlgRel, catNlsRel: nlsRel }),
  });
  assert.equal(parsedRestored.title, "PNX Bom Analysis");
  evidence.caa = { dialogs: caaScan.count, controls: caaScan.stats?.control_type_coverage?.total_controls, nls_round_trip: true };

  const cadScan = await api("/api/cad/fcstd-map/scan", { method: "POST", body: json({ force_update_part_name: false }) });
  assert.equal(cadScan.stats.present, 3);
  const cadEntries = await api("/api/cad/fcstd-map/entries?status=present&limit=20");
  assert.equal(cadEntries.total, 3);
  const cadExport = await api("/api/cad/fcstd-map/export-json", { method: "POST" });
  assert.ok(fs.existsSync(path.resolve(workspace, cadExport.path)));

  const bomBefore = await api(`/api/cad/bom/file?rel=${encodeURIComponent(boltRel)}`);
  await api(`/api/cad/bom/file?rel=${encodeURIComponent(boltRel)}`, {
    method: "PUT",
    body: json({ ...bomBefore.fields, PartName: "Release D Acceptance", label: "Release D Acceptance" }),
  });
  const bomChanged = await api(`/api/cad/bom/file?rel=${encodeURIComponent(boltRel)}`);
  assert.equal(bomChanged.fields.PartName, "Release D Acceptance");
  fs.writeFileSync(boltPath, boltBackup);
  await api("/api/cad/fcstd-map/scan", { method: "POST", body: json({ force_update_part_name: false }) });
  const bomRestored = await api(`/api/cad/bom/file?rel=${encodeURIComponent(boltRel)}`);
  assert.equal(bomRestored.fields.PartName, "Bolt");

  const assembly = await api(`/api/cad/bom/xref/assembly-tree?host_rel=${encodeURIComponent("Cad/asm/100001.001-A-Root.ASSY.FCStd")}&full=true`);
  assert.ok(assembly.node_count >= 2);
  const parts = await api("/api/cad/parts");
  assert.equal(parts.stats.total_keys, 3);
  const boltPart = parts.entries.find((item) => item.part_key === "100003.001");
  originalPartNotes = boltPart.notes ?? "";
  const partChanged = await api("/api/cad/parts/100003/001", {
    method: "PATCH",
    body: json({ notes: "Release API Acceptance" }),
  });
  assert.equal(partChanged.notes, "Release API Acceptance");
  await api("/api/cad/parts/100003/001", { method: "PATCH", body: json({ notes: originalPartNotes }) });

  const xlink = await api("/api/cad/xlink-fix/analyze", {
    method: "POST",
    body: json({ batch_dir: "Cad", all_in_dir: true }),
  });
  assert.ok(xlink.stats.host_count >= 2);
  assert.equal(xlink.stats.issue_count, 0);
  const dedup = await api("/api/cad/part-dedup/scan", {
    method: "POST",
    body: json({ scan_dir: "Dedup", extension: ".SLDPRT", code_len: 6, ver_len: 3, check_code: true, check_version: true, code_must_be_digit: true }),
  });
  assert.equal(dedup.file_count, 4);
  assert.ok(dedup.stats.name_dup >= 1);
  const dedupExport = await api("/api/cad/part-dedup/export-csv", { method: "POST", body: json({ results: dedup.results }) });
  assert.ok(fs.existsSync(path.resolve(workspace, dedupExport.path)));

  fs.mkdirSync(stepInput, { recursive: true });
  fs.writeFileSync(path.join(stepInput, "sample.step"), "ISO-10303-21;\nEND-ISO-10303-21;\n", "utf8");
  const stepPreview = await api("/api/cad/step-batch/preview", {
    method: "POST",
    body: json({ step_dir: "StepInput", out_dir: "StepOutput", skip_existing: true, recursive: false, flatten_output: false, overwrite: false }),
  });
  assert.equal(stepPreview.batch_count, 1);
  const swPrefs = await api("/api/cad/sw-step/prefs");
  const swPreview = await api("/api/cad/sw-step/preview", {
    method: "POST",
    body: json({ source_dir: "Dedup/models", out_step_dir: "SwOutput", recursive_scan: true }),
  });
  assert.equal(swPreview.model_count, 3);
  evidence.cad = {
    indexed: cadEntries.total,
    assembly_nodes: assembly.node_count,
    bom_round_trip: true,
    partkey_round_trip: true,
    xlink_hosts: xlink.stats.host_count,
    duplicate_files: dedup.file_count,
  };
  evidence.external_adapters = {
    step_preview_count: stepPreview.batch_count,
    solidworks_preview_count: swPreview.model_count,
    solidworks_availability: swPrefs.availability_code,
  };

  const fixtures = await api("/api/test-fixtures");
  const suitesPayload = await api("/api/unit-tests/suites");
  const suiteIds = suitesPayload.suites.map((suite) => suite.id);
  const runtimeChecks = await api("/api/unit-tests/run", { method: "POST", body: json({ suites: suiteIds }) });
  assert.equal(runtimeChecks.summary.failed, 0);
  assert.equal(runtimeChecks.summary.errors, 0);
  assert.equal(runtimeChecks.summary.passed, 14);
  evidence.platform = { fixture_catalog: fixtures.items?.length ?? fixtures.fixtures?.length, runtime_checks: runtimeChecks.summary };

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  fs.writeFileSync(boltPath, boltBackup);
  fs.writeFileSync(nlsPath, nlsBackup);
  fs.rmSync(gitProbePath, { force: true });
  fs.rmSync(stepInput, { recursive: true, force: true });
  fs.rmSync(stepOutput, { recursive: true, force: true });
  fs.rmSync(swOutput, { recursive: true, force: true });
  if (originalWorksets) {
    await api("/api/file-worksets", { method: "PUT", body: json({ worksets: originalWorksets.worksets }) }).catch(() => {});
  }
  if (originalSession) {
    const session = originalSession.session;
    await api("/api/workbench/session", {
      method: "PUT",
      body: json(session
        ? {
            version: session.version ?? originalSession.version ?? 1,
            active_tab_id: session.active_tab_id ?? session.activeTabId ?? "home",
            tabs: session.tabs ?? [],
          }
        : { version: 1, active_tab_id: "home", tabs: [] }),
    }).catch(() => {});
  }
  await api("/api/cad/fcstd-map/scan", { method: "POST", body: json({ force_update_part_name: false }) }).catch(() => {});
}
