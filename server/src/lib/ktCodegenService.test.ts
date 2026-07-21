import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { afterEach, describe, expect, it, vi } from "vitest";
import contractFixtureJson from "@phoenix-wing/kt-codegen/fixtures/apply-projection-v1.json" with { type: "json" };
import {
  KtCodegenController,
  KtCodegenItem,
  KtCodegenParam,
  ktCodegenProjectApply,
  type KtCodegenPlan,
} from "@phoenix-wing/kt-codegen";
import {
  applyKtCodegen,
  discoverKtCodegenDocuments,
  inspectKtCodegenDocumentState,
  inspectKtCodegenSourceState,
  inspectKtCodegenSourceStates,
  loadKtCodegenDocument,
  previewKtCodegenSource,
  preflightKtCodegen,
  saveKtCodegenDocument,
} from "./ktCodegenService.js";
import { encodeSourceText } from "./sourceTextCodec.js";

const contractFixture = contractFixtureJson as unknown as {
  plan: KtCodegenPlan;
  source: { path: string; text: string; fingerprint: string };
  expected: {
    after: string;
    utf8Hex: string;
    regionCount: number;
    regionIds: string[];
    conflictFingerprint: string;
    conflictCode: string;
  };
};

const tempRoots: string[] = [];

function makeTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function sampleParam(): KtCodegenParam {
  return new KtCodegenParam({
    namePrefix: "Kt",
    nameMiddle: "Widget",
    nameSpace: "demo",
    appendFunction: "Append",
    items: [new KtCodegenItem({
      nameSuffix: "Base",
      id: 1,
      name: "Length",
      paramString: "length",
      dataType: "double",
      defaultValue: "10",
    })],
  });
}

function writeSampleConfig(root: string): string {
  const controller = new KtCodegenController({ param: sampleParam() });
  const written = controller.writeJson();
  if (!written.ok || written.value === null) throw new Error("fixture write failed");
  const filename = path.join(root, "config", "widget.codegen.json");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${written.value}\n`, "utf8");
  return filename;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ktCodegenService", () => {
  it("与 Wing/Auto 使用同一 v1 fixture 锁定投影、冲突和 Desk 最终字节", () => {
    const result = ktCodegenProjectApply(contractFixture.plan, [contractFixture.source]);
    expect(result.diagnostics).toEqual([]);
    expect(result.changes[0]).toMatchObject({
      after: contractFixture.expected.after,
      regionCount: contractFixture.expected.regionCount,
    });
    expect(result.changes[0]?.regions.map((region) => region.id)).toEqual(contractFixture.expected.regionIds);
    const finalBytes = encodeSourceText(
      { text: contractFixture.source.text, encoding: "utf8", hadBom: false },
      result.changes[0]!.after,
    );
    expect(finalBytes.toString("hex")).toBe(contractFixture.expected.utf8Hex);

    const conflict = ktCodegenProjectApply(contractFixture.plan, [{
      ...contractFixture.source,
      fingerprint: contractFixture.expected.conflictFingerprint,
    }]);
    expect(conflict.changes).toEqual([]);
    expect(conflict.diagnostics.map((item) => item.code)).toEqual([contractFixture.expected.conflictCode]);
  });

  it("discovers and opens only Wing-compatible Codegen documents", () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const prefsDir = makeTempRoot("kt-codegen-prefs-");
    writeSampleConfig(workspace);
    fs.writeFileSync(path.join(workspace, "ordinary.json"), "{\"hello\":true}\n", "utf8");

    const found = discoverKtCodegenDocuments(workspace, prefsDir);
    expect(found.documents).toHaveLength(1);
    expect(found.documents[0]).toMatchObject({
      path: "config/widget.codegen.json",
      class_name: "KtWidget",
      item_count: 1,
    });
    expect(found).toMatchObject({ cache_hit_count: 0, files_read: 2 });

    const reusedDiscovery = discoverKtCodegenDocuments(workspace, prefsDir);
    expect(reusedDiscovery).toMatchObject({ cache_hit_count: 2, files_read: 0 });
    expect(reusedDiscovery.documents).toHaveLength(1);

    const opened = loadKtCodegenDocument(workspace, "config/widget.codegen.json");
    expect(opened.table.items[0]?.paramString).toBe("length");
    expect(opened.fingerprint).toMatch(/^sha256:/);
    expect(opened.file_signature).toBeTruthy();
    expect(inspectKtCodegenDocumentState(workspace, {
      path: opened.path,
      expected_file_signature: opened.file_signature,
      expected_fingerprint: opened.fingerprint,
    }).changed).toBe(false);
  });

  it("does not negative-cache a transient stable-read failure", () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const prefsDir = makeTempRoot("kt-codegen-prefs-");
    const filename = writeSampleConfig(workspace);
    const originalOpen = fs.openSync.bind(fs);
    let failures = 2;
    vi.spyOn(fs, "openSync").mockImplementation(((target: fs.PathLike, ...args: unknown[]) => {
      if (String(target) === filename && failures > 0) {
        failures -= 1;
        throw Object.assign(new Error("temporarily unreadable"), { code: "EACCES" });
      }
      return originalOpen(
        target,
        ...(args as Parameters<typeof fs.openSync> extends [unknown, ...infer Rest] ? Rest : never),
      );
    }) as typeof fs.openSync);

    expect(discoverKtCodegenDocuments(workspace, prefsDir)).toMatchObject({
      documents: [],
      cache_hit_count: 0,
      files_read: 0,
    });
    expect(discoverKtCodegenDocuments(workspace, prefsDir)).toMatchObject({
      documents: [expect.objectContaining({ path: "config/widget.codegen.json" })],
      cache_hit_count: 0,
      files_read: 1,
    });
  });

  it("bounds cold configuration parsing and lets warm refreshes progressively fill the cache", () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const prefsDir = makeTempRoot("kt-codegen-prefs-");
    const seed = writeSampleConfig(workspace);
    const configDir = path.dirname(seed);
    const baseRaw = fs.readFileSync(seed);
    const raw = Buffer.concat([
      baseRaw,
      Buffer.alloc(4 * 1024 * 1024 - baseRaw.length, 0x20),
    ]);
    fs.writeFileSync(seed, raw);
    for (let index = 1; index < 17; index += 1) {
      const filename = path.join(configDir, `widget-${String(index).padStart(2, "0")}.codegen.json`);
      fs.writeFileSync(filename, raw);
    }

    const bounded = discoverKtCodegenDocuments(workspace, prefsDir);
    expect(bounded).toMatchObject({
      config_snapshot_bytes: 64 * 1024 * 1024,
      config_scan_byte_limit_reached: true,
      files_read: 16,
    });
    expect(bounded.documents).toHaveLength(16);

    const completed = discoverKtCodegenDocuments(workspace, prefsDir);
    expect(completed).toMatchObject({
      config_scan_byte_limit_reached: false,
      cache_hit_count: 16,
      files_read: 1,
    });
    expect(completed.documents).toHaveLength(17);
  });

  it("retries a config read when content changes between read and stat", () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const filename = writeSampleConfig(workspace);
    const replacement = new KtCodegenController({
      param: new KtCodegenParam({ namePrefix: "Kt", nameMiddle: "Replacement", items: [] }),
    }).writeJson();
    if (!replacement.ok || replacement.value === null) throw new Error("replacement fixture failed");
    const originalOpen = fs.openSync.bind(fs);
    let replaced = false;
    vi.spyOn(fs, "openSync").mockImplementation(((target: fs.PathLike, ...args: unknown[]) => {
      const handle = originalOpen(target, ...(args as Parameters<typeof fs.openSync> extends [unknown, ...infer Rest] ? Rest : never));
      if (String(target) === filename && !replaced) {
        replaced = true;
        fs.writeFileSync(filename, replacement.value!, "utf8");
      }
      return handle;
    }) as typeof fs.openSync);

    const opened = loadKtCodegenDocument(workspace, "config/widget.codegen.json");

    expect(opened.class_name).toBe("KtReplacement");
    expect(opened.fingerprint).toBe(`sha256:${createHash("sha256").update(fs.readFileSync(filename)).digest("hex")}`);
  });

  it.skipIf(process.platform === "win32")("skips a symbolic link without abandoning the rest of its directory", () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const prefsDir = makeTempRoot("kt-codegen-prefs-");
    const config = writeSampleConfig(workspace);
    fs.symlinkSync(config, path.join(workspace, "00-linked-config"));

    const found = discoverKtCodegenDocuments(workspace, prefsDir);

    expect(found.documents.map((document) => document.path)).toEqual(["config/widget.codegen.json"]);
  });

  it.skipIf(process.platform === "win32")("rejects a direct Codegen path that links outside the workspace", () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const outside = makeTempRoot("kt-codegen-outside-");
    const externalConfig = writeSampleConfig(outside);
    fs.symlinkSync(externalConfig, path.join(workspace, "linked.codegen.json"));

    expect(() => loadKtCodegenDocument(workspace, "linked.codegen.json")).toThrow(/符号链接越出工作空间/);
  });

  it("saves through Wing with optimistic fingerprint protection", () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const filename = writeSampleConfig(workspace);
    if (process.platform !== "win32") fs.chmodSync(filename, 0o640);
    const opened = loadKtCodegenDocument(workspace, "config/widget.codegen.json");
    const table = {
      ...opened.table,
      items: opened.table.items.map((item) => ({ ...item, defaultValue: "25" })),
    };
    const saved = saveKtCodegenDocument(workspace, {
      path: opened.path,
      fingerprint: opened.fingerprint,
      param: opened.param,
      table,
    });
    expect(saved.table.items[0]?.defaultValue).toBe("25");
    expect(saved.fingerprint).not.toBe(opened.fingerprint);
    if (process.platform !== "win32") expect(fs.statSync(filename).mode & 0o777).toBe(0o640);

    expect(() => saveKtCodegenDocument(workspace, {
      path: opened.path,
      fingerprint: opened.fingerprint,
      param: opened.param,
      table,
    })).toThrow(/已变化/);
  });

  it("restricts save targets and rechecks the checkpoint immediately before replace", () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const filename = writeSampleConfig(workspace);
    const opened = loadKtCodegenDocument(workspace, "config/widget.codegen.json");
    fs.writeFileSync(path.join(workspace, "notes.txt"), "do not replace\n", "utf8");

    expect(() => saveKtCodegenDocument(workspace, {
      path: "notes.txt",
      fingerprint: opened.fingerprint,
      param: opened.param,
      table: opened.table,
    })).toThrow(/只支持保存/);

    expect(() => saveKtCodegenDocument(workspace, {
      path: opened.path,
      fingerprint: opened.fingerprint,
      param: { ...opened.param, nameSpace: "x".repeat(4 * 1024 * 1024) },
      table: opened.table,
    })).toThrow(/保存结果超过 4 MiB/);

    const originalOpen = fs.openSync.bind(fs);
    let targetOpens = 0;
    vi.spyOn(fs, "openSync").mockImplementation(((target: fs.PathLike, ...args: unknown[]) => {
      const handle = originalOpen(target, ...(args as Parameters<typeof fs.openSync> extends [unknown, ...infer Rest] ? Rest : never));
      if (String(target) === filename && ++targetOpens === 2) {
        fs.writeFileSync(filename, "external change\n", "utf8");
      }
      return handle;
    }) as typeof fs.openSync);

    expect(() => saveKtCodegenDocument(workspace, {
      path: opened.path,
      fingerprint: opened.fingerprint,
      param: opened.param,
      table: opened.table,
    })).toThrow(/保存过程中已再次变化/);
    expect(fs.readFileSync(filename, "utf8")).toBe("external change\n");
  });

  it.skipIf(process.platform === "win32")("does not overwrite a same-content file whose identity metadata changed during save", () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const filename = writeSampleConfig(workspace);
    fs.chmodSync(filename, 0o640);
    const opened = loadKtCodegenDocument(workspace, "config/widget.codegen.json");
    const originalRaw = fs.readFileSync(filename);
    const originalOpen = fs.openSync.bind(fs);
    let targetOpens = 0;
    vi.spyOn(fs, "openSync").mockImplementation(((target: fs.PathLike, ...args: unknown[]) => {
      const handle = originalOpen(target, ...(args as Parameters<typeof fs.openSync> extends [unknown, ...infer Rest] ? Rest : never));
      if (String(target) === filename && ++targetOpens === 2) fs.chmodSync(filename, 0o600);
      return handle;
    }) as typeof fs.openSync);

    expect(() => saveKtCodegenDocument(workspace, {
      path: opened.path,
      fingerprint: opened.fingerprint,
      param: opened.param,
      table: {
        ...opened.table,
        items: opened.table.items.map((item) => ({ ...item, defaultValue: "99" })),
      },
    })).toThrow(/保存过程中已再次变化/);
    expect(fs.readFileSync(filename)).toEqual(originalRaw);
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
  });

  it("treats missing checkpoints conservatively and validates batch state input", () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    writeSampleConfig(workspace);
    fs.writeFileSync(path.join(workspace, "Widget.h"), "// source\n", "utf8");

    expect(inspectKtCodegenSourceState(workspace, {
      path: "Widget.h",
      expected_file_signature: "",
      expected_fingerprint: "",
    }).changed).toBe(true);
    expect(() => inspectKtCodegenSourceStates(workspace, {})).toThrow(/files 数组/);
    expect(() => inspectKtCodegenSourceStates(workspace, { files: [null] })).toThrow(/第 1 项/);
    expect(() => inspectKtCodegenSourceStates(workspace, {
      files: Array.from({ length: 5_001 }, () => ({ path: "Widget.h" })),
    })).toThrow(/最多支持 5000/);
    expect(inspectKtCodegenSourceStates(workspace, {
      files: [
        { path: "Widget.h", expected_fingerprint: "sha256:old" },
        { path: "Widget.h", expected_fingerprint: "sha256:old" },
      ],
    }).files).toHaveLength(1);
  });

  it("preserves GBK, CRLF, final newline, and UTF-8 BOM while saving", () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const controller = new KtCodegenController({
      param: new KtCodegenParam({
        namePrefix: "Kt",
        nameMiddle: "编码",
        items: [new KtCodegenItem({
          nameSuffix: "Base",
          id: 1,
          name: "长度",
          paramString: "length",
          dataType: "double",
        })],
      }),
    });
    const written = controller.writeJson();
    if (!written.ok || written.value === null) throw new Error("fixture write failed");

    const gbkFilename = path.join(workspace, "gbk.codegen.json");
    fs.writeFileSync(gbkFilename, iconv.encode(`${written.value.replace(/\n/g, "\r\n")}\r\n`, "gbk"));
    const gbkOpened = loadKtCodegenDocument(workspace, "gbk.codegen.json");
    expect(gbkOpened.encoding).toBe("gbk");
    saveKtCodegenDocument(workspace, {
      path: gbkOpened.path,
      fingerprint: gbkOpened.fingerprint,
      param: gbkOpened.param,
      table: gbkOpened.table,
    });
    const gbkText = iconv.decode(fs.readFileSync(gbkFilename), "gbk");
    expect(gbkText).toContain("编码");
    expect(gbkText.endsWith("\r\n")).toBe(true);
    expect(gbkText.replace(/\r\n/g, "")).not.toContain("\n");

    const bomFilename = path.join(workspace, "bom.codegen.json");
    fs.writeFileSync(bomFilename, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(written.value, "utf8"),
    ]));
    const bomOpened = loadKtCodegenDocument(workspace, "bom.codegen.json");
    expect(bomOpened.encoding).toBe("utf8-bom");
    saveKtCodegenDocument(workspace, {
      path: bomOpened.path,
      fingerprint: bomOpened.fingerprint,
      param: bomOpened.param,
      table: bomOpened.table,
    });
    expect(fs.readFileSync(bomFilename).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it("builds a dry-run plan from workspace marker snapshots without changing source", () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const prefsDir = makeTempRoot("kt-codegen-prefs-");
    const source = [
      "class KtWidgetBase {",
      "// START KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
      "double oldLength;",
      "// END KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
      "};",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(workspace, "Widget.h"), source, "utf8");

    const out = preflightKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION", "PARAM DECLARATION"],
    }, prefsDir);

    expect(out.candidate_file_count).toBe(1);
    expect(out.source_scan_truncated).toBe(false);
    expect(out.source_scan_byte_limit_reached).toBe(false);
    expect(out.source_snapshot_bytes).toBe(Buffer.byteLength(source));
    expect(out.source_cache_hits).toBe(0);
    expect(out.source_files_read).toBe(1);
    expect(out.plan_fingerprint).toMatch(/^sha256:/);
    expect(out.source_file_fingerprints).toEqual({
      "Widget.h": `sha256:${createHash("sha256").update(Buffer.from(source)).digest("hex")}`,
    });
    expect(out.source_candidates).toEqual([expect.objectContaining({
      path: "Widget.h",
      encoding: "utf8",
      eol: "lf",
      marker_line: 1,
    })]);
    expect(out.source_candidates_truncated).toBe(false);
    expect(out.reused).toBe(false);
    expect(out.plan.markerRegions).toHaveLength(1);
    expect(out.plan.blockKeys).toEqual(["PARAM DECLARATION"]);
    expect(out.plan.artifacts).toHaveLength(1);
    expect(out.plan.canApply).toBe(true);
    expect(out.safe_to_apply).toBe(true);
    expect(fs.readFileSync(path.join(workspace, "Widget.h"), "utf8")).toBe(source);

    const region = out.plan.markerRegions[0]!;
    const preview = previewKtCodegenSource(workspace, {
      path: region.path,
      start_line: region.start.line,
      end_line: region.end.line,
      expected_fingerprint: region.sourceFingerprint,
      context_lines: 1,
    });
    expect(preview.stale).toBe(false);
    expect(preview.file_signature).toBeTruthy();
    expect(inspectKtCodegenSourceState(workspace, {
      path: region.path,
      expected_file_signature: preview.file_signature,
      expected_fingerprint: preview.fingerprint,
    }).changed).toBe(false);
    expect(inspectKtCodegenSourceStates(workspace, {
      files: [{
        path: region.path,
        expected_file_signature: preview.file_signature,
        expected_fingerprint: preview.fingerprint,
      }],
    })).toMatchObject({ changed_count: 0, files: [{ path: region.path, changed: false }] });
    expect(preview.lines.filter((line) => line.focus)).toHaveLength(3);
    expect(preview.lines.some((line) => line.text.includes("oldLength"))).toBe(true);

    const reused = preflightKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
    }, prefsDir);
    expect(reused.reused).toBe(true);
    expect(reused.source_cache_hits).toBe(1);
    expect(reused.source_files_read).toBe(0);
    expect(reused.created_at).toBe(out.created_at);

    fs.appendFileSync(path.join(workspace, "Widget.h"), "// external change\n", "utf8");
    expect(inspectKtCodegenSourceState(workspace, {
      path: region.path,
      expected_file_signature: preview.file_signature,
      expected_fingerprint: preview.fingerprint,
    }).changed).toBe(true);
    expect(previewKtCodegenSource(workspace, {
      path: region.path,
      start_line: region.start.line,
      end_line: region.end.line,
      expected_fingerprint: region.sourceFingerprint,
    }).stale).toBe(true);
    const invalidated = preflightKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
    }, prefsDir);
    expect(invalidated.reused).toBe(false);
    expect(invalidated.source_files_read).toBe(1);
  });

  it("preserves paired non-generated Kevin blocks and applies Wing artifacts with source formatting", async () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const prefsDir = makeTempRoot("kt-codegen-prefs-");
    const source = [
      "// 中文注释用于锁定 GBK 检测",
      "class KtWidgetBase {",
      "// START KEVIN CAA WIZARD SECTION KtWidgetBase IID_INTERFACE_CPP",
      "int untouchedInterfaceBody;",
      "// END KEVIN CAA WIZARD SECTION KtWidgetBase IID_INTERFACE_CPP",
      "// START KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
      "double oldLength;",
      "// END KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
      "};",
      "",
    ].join("\r\n");
    const filename = path.join(workspace, "Widget.h");
    fs.writeFileSync(filename, iconv.encode(source, "gbk"));

    const preflight = preflightKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
    }, prefsDir);

    expect(preflight.plan.markerRegions).toHaveLength(1);
    expect(preflight.plan.diagnostics).toEqual([]);
    expect(preflight.safe_to_apply).toBe(true);
    const artifact = preflight.plan.artifacts[0]!;
    expect(fs.readFileSync(filename).equals(iconv.encode(source, "gbk"))).toBe(true);

    const applied = await applyKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
      expected_plan_fingerprint: preflight.plan_fingerprint,
    }, prefsDir);

    const changedRaw = fs.readFileSync(filename);
    const changed = iconv.decode(changedRaw, "gbk");
    expect(applied).toMatchObject({
      kind: "kt.codegen.apply-result",
      schema_version: 1,
      region_count: 1,
      verified: true,
      files: [{ path: "Widget.h", encoding: "gbk", eol: "crlf", region_count: 1 }],
    });
    expect(changed).toContain("untouchedInterfaceBody");
    expect(changed).not.toContain("double oldLength;");
    expect(changed).toContain(artifact.content.replace(/\r\n|\r|\n/g, "\r\n").trim());
    expect(changed.replace(/\r\n/g, "")).not.toContain("\n");
    await expect(applyKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
      expected_plan_fingerprint: preflight.plan_fingerprint,
    }, prefsDir)).rejects.toThrow(/已变化/);

    const idempotentPreflight = preflightKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
    }, prefsDir);
    const statBeforeNoop = fs.statSync(filename);
    const noOp = await applyKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
      expected_plan_fingerprint: idempotentPreflight.plan_fingerprint,
    }, prefsDir);
    const statAfterNoop = fs.statSync(filename);
    expect(noOp).toMatchObject({ files: [], region_count: 0, verified: true });
    expect({
      dev: statAfterNoop.dev,
      ino: statAfterNoop.ino,
      mtimeMs: statAfterNoop.mtimeMs,
      ctimeMs: statAfterNoop.ctimeMs,
    }).toEqual({
      dev: statBeforeNoop.dev,
      ino: statBeforeNoop.ino,
      mtimeMs: statBeforeNoop.mtimeMs,
      ctimeMs: statBeforeNoop.ctimeMs,
    });
  });

  it.each([
    {
      name: "缺失 END",
      diagnosticCode: "marker.missing-end",
      markerKind: "start" as const,
      boundary: { kind: "start", line: 3 } as const,
      preservedText: "double keepBrokenStartBody;",
      damaged: [
        "// START KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
        "double keepBrokenStartBody;",
      ],
    },
    {
      name: "孤立 END",
      diagnosticCode: "marker.orphan-end",
      markerKind: "end" as const,
      boundary: null,
      preservedText: "double keepOrphanEndBody;",
      damaged: [
        "double keepOrphanEndBody;",
        "// END KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
      ],
    },
  ])("$name 只隔离损坏区并安全 Apply 后续完整区域", async ({
    diagnosticCode,
    markerKind,
    boundary,
    preservedText,
    damaged,
  }) => {
    const workspace = makeTempRoot("kt-codegen-service-partial-");
    const prefsDir = makeTempRoot("kt-codegen-prefs-");
    const filename = path.join(workspace, "Widget.h");
    const source = [
      ...damaged,
      "// START KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
      "double replaceValidRegion;",
      "// END KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
      "",
    ].join("\n");
    fs.writeFileSync(filename, source, "utf8");

    const preflight = preflightKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
    }, prefsDir);

    expect(preflight.plan.canApply).toBe(false);
    const diagnostic = preflight.plan.diagnostics.find((item) => item.code === diagnosticCode);
    expect(diagnostic).toMatchObject({
      code: diagnosticCode,
      severity: "error",
      marker: {
        kind: markerKind,
        classId: "KtWidgetBase",
        blockKey: "PARAM DECLARATION",
      },
    });
    if (boundary) expect(diagnostic?.marker?.boundary).toEqual(boundary);
    expect(preflight.plan.markerRegions).toHaveLength(1);
    expect(preflight.plan.artifacts).toHaveLength(1);
    expect(preflight.safe_to_apply).toBe(true);

    const applied = await applyKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
      expected_plan_fingerprint: preflight.plan_fingerprint,
    }, prefsDir);
    const changed = fs.readFileSync(filename, "utf8");

    expect(applied).toMatchObject({ region_count: 1, verified: true });
    expect(applied.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: diagnosticCode,
        marker: expect.objectContaining({ kind: markerKind }),
      }),
    ]));
    expect(changed).toContain(preservedText);
    expect(changed).not.toContain("double replaceValidRegion;");
    expect(changed).toContain(preflight.plan.artifacts[0]!.content.trim());
  });

  it("does not overwrite a source that changes at the final Apply checkpoint", async () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const prefsDir = makeTempRoot("kt-codegen-prefs-");
    const filename = path.join(workspace, "Widget.h");
    fs.writeFileSync(filename, [
      "// START KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
      "double oldLength;",
      "// END KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
      "",
    ].join("\n"), "utf8");
    const preflight = preflightKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
    }, prefsDir);
    const originalOpen = fs.openSync.bind(fs);
    let sourceOpens = 0;
    vi.spyOn(fs, "openSync").mockImplementation(((target: fs.PathLike, ...args: unknown[]) => {
      const handle = originalOpen(
        target,
        ...(args as Parameters<typeof fs.openSync> extends [unknown, ...infer Rest] ? Rest : never),
      );
      if (String(target) === filename && ++sourceOpens === 2) {
        fs.writeFileSync(filename, "external source change\n", "utf8");
      }
      return handle;
    }) as typeof fs.openSync);

    await expect(applyKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
      expected_plan_fingerprint: preflight.plan_fingerprint,
    }, prefsDir)).rejects.toThrow(/源码.*变化/);
    expect(fs.readFileSync(filename, "utf8")).toBe("external source change\n");
    expect(fs.readdirSync(workspace).some((name) => name.includes("kt-codegen-apply"))).toBe(false);
  });

  it("rolls back earlier files when a later atomic Apply replacement fails", async () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const prefsDir = makeTempRoot("kt-codegen-prefs-");
    const original = [
      "// START KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
      "double oldLength;",
      "// END KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
      "",
    ].join("\n");
    const first = path.join(workspace, "A-Widget.h");
    const second = path.join(workspace, "B-Widget.h");
    fs.writeFileSync(first, original, "utf8");
    fs.writeFileSync(second, original, "utf8");
    const preflight = preflightKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
    }, prefsDir);
    const originalRename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(from).includes(".kt-codegen-apply-") && String(to) === second) {
        throw new Error("fixture rejects second commit");
      }
      originalRename(from, to);
    }) as typeof fs.renameSync);

    await expect(applyKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
      expected_plan_fingerprint: preflight.plan_fingerprint,
    }, prefsDir)).rejects.toThrow(/fixture rejects second commit/);
    expect(fs.readFileSync(first, "utf8")).toBe(original);
    expect(fs.readFileSync(second, "utf8")).toBe(original);
    expect(fs.readdirSync(workspace).some((name) => name.includes("kt-codegen-apply"))).toBe(false);
    expect(fs.readdirSync(workspace).some((name) => name.includes("kt-codegen-rollback"))).toBe(false);
  });

  it("fails the host Apply gate closed when the source file scan is incomplete", () => {
    const workspace = makeTempRoot("kt-codegen-service-");
    const prefsDir = makeTempRoot("kt-codegen-prefs-");
    const sourceDir = path.join(workspace, "src");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "000-Widget.h"), [
      "class KtWidgetBase {",
      "// START KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
      "double oldLength;",
      "// END KEVIN CAA WIZARD SECTION KtWidgetBase PARAM DECLARATION",
      "};",
    ].join("\n"), "utf8");
    for (let index = 0; index < 5_000; index += 1) {
      fs.writeFileSync(
        path.join(sourceDir, `source-${String(index).padStart(4, "0")}.h`),
        "",
        "utf8",
      );
    }

    const out = preflightKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
    }, prefsDir);

    expect(out.indexed_file_count).toBe(5_000);
    expect(out.source_scan_truncated).toBe(true);
    expect(out.plan.canApply).toBe(true);
    expect(out.safe_to_apply).toBe(false);

    fs.rmSync(path.join(sourceDir, "source-4999.h"));
    const exactLimit = preflightKtCodegen(workspace, {
      param: sampleParam(),
      block_keys: ["PARAM DECLARATION"],
    }, prefsDir);
    expect(exactLimit.indexed_file_count).toBe(5_000);
    expect(exactLimit.source_scan_truncated).toBe(false);
    expect(exactLimit.plan.canApply).toBe(true);
    expect(exactLimit.safe_to_apply).toBe(true);
  });
});
