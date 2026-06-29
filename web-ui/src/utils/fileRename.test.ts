import { describe, it, expect } from "vitest";
import {
  validateRenameTarget,
  isFcstdFile,
  resolveRenameOptions,
  formatLogTime,
  isSameDirPathRename,
} from "./fileRename";

describe("validateRenameTarget", () => {
  it("rejects empty target", () => {
    const r = validateRenameTarget("Old.FCStd", "");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("不能为空");
  });

  it("rejects same as current", () => {
    const r = validateRenameTarget("Old.FCStd", "Old.FCStd");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("相同");
  });

  it("rejects whitespace-only same as current", () => {
    const r = validateRenameTarget("Old.FCStd", "  Old.FCStd  ");
    expect(r.valid).toBe(false);
  });

  it("rejects illegal char <", () => {
    const r = validateRenameTarget("a.fcstd", "bad<.fcstd");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("非法字符");
  });

  it("rejects illegal char :", () => {
    const r = validateRenameTarget("a.fcstd", "bad:.fcstd");
    expect(r.valid).toBe(false);
  });

  it("rejects path traversal ..", () => {
    const r = validateRenameTarget("a.fcstd", "../b.fcstd");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("路径穿越");
  });

  it("rejects names over 255 chars", () => {
    const long = "A".repeat(256) + ".fcstd";
    const r = validateRenameTarget("Old.fcstd", long);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("255");
  });

  it("accepts normal rename", () => {
    const r = validateRenameTarget("Old.FCStd", "New.FCStd");
    expect(r.valid).toBe(true);
  });

  it("accepts rename with spaces around", () => {
    const r = validateRenameTarget("Old.FCStd", " New.FCStd ");
    expect(r.valid).toBe(true);
  });
});

describe("isFcstdFile", () => {
  it("matches .FCStd extension", () => {
    expect(isFcstdFile("path/to/file.FCStd")).toBe(true);
  });

  it("matches .fcstd lower case", () => {
    expect(isFcstdFile("path/to/file.fcstd")).toBe(true);
  });

  it("matches .FcStd mixed case", () => {
    expect(isFcstdFile("path/to/file.FcStd")).toBe(true);
  });

  it("does not match .txt", () => {
    expect(isFcstdFile("path/to/file.txt")).toBe(false);
  });

  it("does not match .FCStd.bak", () => {
    expect(isFcstdFile("path/to/file.FCStd.bak")).toBe(false);
  });

  it("handles leading/trailing whitespace", () => {
    expect(isFcstdFile("  file.FCStd  ")).toBe(true);
  });
});

describe("resolveRenameOptions", () => {
  it("returns empty for non-FCStd files", () => {
    expect(resolveRenameOptions(false)).toEqual([]);
  });

  it("returns three options for FCStd files", () => {
    const opts = resolveRenameOptions(true);
    expect(opts).toHaveLength(3);
  });

  it("has fixXref as first option with default true", () => {
    const opts = resolveRenameOptions(true);
    const xref = opts.find((o) => o.id === "fixXref");
    expect(xref).toBeDefined();
    expect(xref!.default).toBe(true);
  });

  it("has syncLabels with default false", () => {
    const opts = resolveRenameOptions(true);
    const labels = opts.find((o) => o.id === "syncLabels");
    expect(labels).toBeDefined();
    expect(labels!.default).toBe(false);
  });

  it("has fixBasename with default false", () => {
    const opts = resolveRenameOptions(true);
    const bn = opts.find((o) => o.id === "fixBasename");
    expect(bn).toBeDefined();
    expect(bn!.default).toBe(false);
  });
});

describe("formatLogTime", () => {
  it("returns original string on parse failure", () => {
    expect(formatLogTime("not-a-date")).toBe("not-a-date");
  });

  it("returns locale string for valid ISO", () => {
    const result = formatLogTime("2026-06-27T10:30:00Z");
    expect(result).not.toBe("2026-06-27T10:30:00Z");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("isSameDirPathRename", () => {
  it("same path returns true", () => {
    expect(isSameDirPathRename("dir/a.FCStd", "dir/a.FCStd")).toBe(true);
  });

  it("same dir different filename returns true", () => {
    expect(isSameDirPathRename("dir/Old.FCStd", "dir/New.FCStd")).toBe(true);
  });

  it("different dir returns false", () => {
    expect(isSameDirPathRename("dir1/a.FCStd", "dir2/a.FCStd")).toBe(false);
  });

  it("root file vs subdir file returns false", () => {
    expect(isSameDirPathRename("a.FCStd", "dir/a.FCStd")).toBe(false);
  });

  it("handles backslashes", () => {
    expect(isSameDirPathRename("dir\\Old.FCStd", "dir/New.FCStd")).toBe(true);
  });
});
