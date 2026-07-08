/** pdtCodeService 测试 — 对应 Python code/kinds + ignore + process_dirs + binary */
import { describe, it, expect } from "vitest";
import { codeAssetKind, isCodeIndexFilename, isIgnoredName, isProcessDirName, isBinarySuffix, isScannableDir, normalizeWorksetPaths } from "./pdtCodeService";

describe("pdtCodeService — code/kinds", () => {
  it("codeAssetKind 源文件", () => {
    expect(codeAssetKind("main.cpp")).toBe("source");
    expect(codeAssetKind("header.h")).toBe("source");
    expect(codeAssetKind("CMakeLists.txt")).toBe("config");
    expect(codeAssetKind("readme.md")).toBe("doc");
    expect(codeAssetKind("icon.png")).toBe("resource");
    expect(codeAssetKind("unknown.xyz")).toBeNull();
  });
  it("isCodeIndexFilename", () => {
    expect(isCodeIndexFilename("main.cpp")).toBe(true);
    expect(isCodeIndexFilename("x.xyz")).toBe(false);
  });
});

describe("pdtCodeService — code/ignore", () => {
  it("isIgnoredName 通配", () => {
    expect(isIgnoredName("build-debug", ["build-*"])).toBe(true);
    expect(isIgnoredName("src", ["build-*"])).toBe(false);
  });
});

describe("pdtCodeService — code/process_dirs", () => {
  it("isProcessDirName", () => {
    expect(isProcessDirName("build")).toBe(true);
    expect(isProcessDirName("build-release")).toBe(true);
    expect(isProcessDirName(".cache")).toBe(true);
    expect(isProcessDirName("src")).toBe(false);
  });
});

describe("pdtCodeService — code/rename", () => {
  it("isBinarySuffix", () => {
    expect(isBinarySuffix("a.exe")).toBe(true);
    expect(isBinarySuffix("a.png")).toBe(true);
    expect(isBinarySuffix("a.cpp")).toBe(false);
    expect(isBinarySuffix("a.txt")).toBe(false);
  });
  it("isScannableDir", () => {
    expect(isScannableDir("src")).toBe(true);
    expect(isScannableDir(".git")).toBe(false);
    expect(isScannableDir("node_modules")).toBe(false);
  });
  it("normalizeWorksetPaths", () => {
    expect(normalizeWorksetPaths(["a\\b", "a/b", ""])).toEqual(["a/b"]);
  });
});
