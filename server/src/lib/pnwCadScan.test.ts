/** 对应 Python: test_fcstd_map_service.py (扫描部分) */
import { describe, it, expect } from "vitest";
import { isCadIndexFilename, scanCadBasenameMap } from "./pnwCadScan";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("pnwCadScan", () => {
  it("isCadIndexFilename", () => {
    expect(isCadIndexFilename("a.FCStd")).toBe(true);
    expect(isCadIndexFilename("a.fcstd")).toBe(true);
    expect(isCadIndexFilename("a.step")).toBe(true);
    expect(isCadIndexFilename("a.md")).toBe(true);
    expect(isCadIndexFilename("a.pdf")).toBe(true);
    expect(isCadIndexFilename("a.png")).toBe(true);
    expect(isCadIndexFilename("a.unknown")).toBe(false);
  });

  it("scanCadBasenameMap: 扫描临时目录", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pnw-test-"));
    fs.writeFileSync(path.join(dir, "test.fcstd"), "");
    fs.writeFileSync(path.join(dir, "test.md"), "");
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "sub.fcstd"), "");

    const map = scanCadBasenameMap(dir, dir);
    expect(map.has("test.fcstd")).toBe(true);
    expect(map.has("test.md")).toBe(true);
    expect(map.has("sub.fcstd")).toBe(true);

    // cleanup
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("scanCadBasenameMap: 跳过隐藏/系统目录", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pnw-test-"));
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, ".git", "a.fcstd"), "");
    fs.mkdirSync(path.join(dir, "node_modules"));
    fs.writeFileSync(path.join(dir, "node_modules", "b.fcstd"), "");
    fs.mkdirSync(path.join(dir, ".phoenix"));
    fs.writeFileSync(path.join(dir, ".phoenix", "c.fcstd"), "");
    fs.writeFileSync(path.join(dir, "visible.fcstd"), "");

    const map = scanCadBasenameMap(dir, dir);
    expect(map.has("a.fcstd")).toBe(false);
    expect(map.has("b.fcstd")).toBe(false);
    expect(map.has("c.fcstd")).toBe(false);
    expect(map.has("visible.fcstd")).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
