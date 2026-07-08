/** 对应 Python: test_cad_index_types.py + test_default_freecad_install.py */
import { describe, it, expect } from "vitest";
import { isFcstdFilename, cadAssetKind, defaultFreecadInstallDir, RenameAnalysisError } from "./pnwCadTypes";

describe("pnwCadTypes — cad_index_types", () => {
  it("isFcstdFilename", () => {
    expect(isFcstdFilename("a.FCStd")).toBe(true);
    expect(isFcstdFilename("a.fcstd")).toBe(true);
    expect(isFcstdFilename("a.step")).toBe(false);
    expect(isFcstdFilename("a.md")).toBe(false);
  });

  it("cadAssetKind", () => {
    expect(cadAssetKind("a.FCStd")).toBe("fcstd");
    expect(cadAssetKind("a.step")).toBe("step");
    expect(cadAssetKind("a.dxf")).toBe("cad_exchange");
    expect(cadAssetKind("a.md")).toBe("markdown");
    expect(cadAssetKind("a.pdf")).toBe("pdf");
    expect(cadAssetKind("a.png")).toBe("image");
    expect(cadAssetKind("a.unknown")).toBe("other");
  });

  it("defaultFreecadInstallDir", () => {
    const d = defaultFreecadInstallDir();
    if (process.platform === "darwin") expect(d).toBe("/Applications/FreeCAD.app");
    else if (process.platform === "win32") expect(d).toContain("FreeCAD");
    else expect(d).toBeNull();
  });
});

describe("pnwCadTypes — RenameAnalysisError", () => {
  it("RenameAnalysisError", () => {
    const e = new RenameAnalysisError("test");
    expect(e.message).toBe("test");
    expect(e.name).toBe("RenameAnalysisError");
  });
});
