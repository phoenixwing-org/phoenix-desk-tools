import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import fixture from "@phoenix-wing/code-core/fixtures/pure-capabilities-v1.json" with { type: "json" };
import {
  pnwFindUuidOccurrences,
  pnwFormatUuidForTemplate,
  pnwMatchesWorkspacePath,
  pnwNormalizeUuid,
  pnwNormalizeWorkspacePath,
  pnwRelativeToWorkspaceRoots,
} from "@phoenix-wing/code-core";
import { normalizeWorksetEntries } from "./fileWorksetService.js";
import { applyUuidsInWorkspace, scanUuidsInWorkspace } from "./pdtCodeService.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Wing 纯能力 Registry 契约", () => {
  it("锁定 Registry fixture 字节并验证 UUID 真源", () => {
    const filename = createRequire(import.meta.url)
      .resolve("@phoenix-wing/code-core/fixtures/pure-capabilities-v1.json");
    expect(crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex"))
      .toBe("1d894c5ccffb8d8840c2fcf8a032ed34c79e7c5d2e44ad95fe1bf84665b32e8c");
    expect(pnwFindUuidOccurrences(fixture.uuid.scan.text)).toEqual(fixture.uuid.scan.expected);
    for (const item of fixture.uuid.formatCases) {
      expect(pnwFormatUuidForTemplate(item.source, item.replacement)).toBe(item.expected);
    }
  });

  it("Desk UUID 宿主只负责文件读取和返回形状", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-wing-uuid-"));
    tempRoots.push(root);
    const filename = path.join(root, "fixture.cpp");
    fs.writeFileSync(filename, fixture.uuid.scan.text, "utf8");
    const scan = scanUuidsInWorkspace(root, { kinds: ["uuid", "guid32"] });
    expect(scan.hits.map((item) => ({
      value: item.matched_text,
      normalized: item.uuid_normalized,
      kind: item.kind,
      line: item.line,
      column: item.col,
    }))).toEqual(fixture.uuid.scan.expected.map((item) => ({
      value: item.value,
      normalized: item.normalized,
      kind: item.kind,
      line: item.line,
      column: item.column,
    })));
  });

  it("Desk Apply 把 CAA GUID 投影委托给 Wing 计划", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-wing-caa-guid-"));
    tempRoots.push(root);
    const source = fixture.uuid.formatCases[1].source;
    fs.writeFileSync(path.join(root, "guid.cpp"), `${source}\n`, "utf8");
    const scan = scanUuidsInWorkspace(root);
    expect(scan.hits).toHaveLength(1);
    const applied = applyUuidsInWorkspace(root, {
      hit_ids: [scan.hits[0].hit_id],
      strategy: "fresh_per_hit",
      dry_run: true,
    });
    expect(applied.mappings).toHaveLength(1);
    expect(applied.mappings[0].new).toMatch(/^0x[0-9a-f]{8}, 0x[0-9a-f]{4}, 0x[0-9a-f]{4}, \{/i);
    expect(pnwNormalizeUuid(applied.mappings[0].new)).not.toBe(pnwNormalizeUuid(source));
    expect(fs.readFileSync(path.join(root, "guid.cpp"), "utf8")).toBe(`${source}\n`);
  });

  it("workspace path 规范、匹配与相对根由 Wing 唯一实现", () => {
    for (const item of fixture.workspacePath.normalizeCases) {
      expect(pnwNormalizeWorkspacePath(item.input)).toBe(item.expected);
    }
    for (const item of fixture.workspacePath.matchCases) {
      expect(pnwMatchesWorkspacePath(
        item.candidate,
        item.entries as Parameters<typeof pnwMatchesWorkspacePath>[1],
      )).toBe(item.expected);
    }
    for (const item of fixture.workspacePath.relativeCases) {
      expect(pnwRelativeToWorkspaceRoots(item.candidate, item.roots))
        .toBe("expected" in item ? item.expected : undefined);
    }
    expect(normalizeWorksetEntries([
      { path: fixture.workspacePath.normalizeCases[0].input, type: "file" },
      { path: "src/../outside.cpp", type: "file" },
    ])).toEqual([{ path: "src/module/a.cpp", type: "file" }]);
  });
});
