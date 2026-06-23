import { describe, expect, it } from "vitest";
import { buildCaaDialogRelatedFiles } from "./caaDialogRelatedFiles";
import type { CaaDialogIr } from "../types/caaDialogIr";

function minimalIr(overrides: Partial<CaaDialogIr> = {}): CaaDialogIr {
  return {
    schemaVersion: 1,
    dialogName: "TestDlg",
    root: { type: "Dialog", id: "TestDlg", children: [] },
    sources: {
      catDlg: "Pkg/TestDlg.CATDlg",
      catNls: "Pkg/CNext/resources/msgcatalog/TestDlg.CATNls",
    },
    parseMeta: {
      locales: [],
      primaryLocale: "default",
      rscKeyCount: 0,
      bitmapDirs: ["Pkg/CNext/resources/graphic"],
      bitmapFileCount: 2,
      bitmapFiles: [
        {
          repoRelPath: "Pkg/CNext/resources/graphic/icons/normal/I_Test.bmp",
          filename: "I_Test.bmp",
          sizeBytes: 1024,
        },
        {
          repoRelPath: "Pkg/CNext/resources/graphic/I_Test.bmp",
          filename: "I_Test.bmp",
          sizeBytes: 512,
        },
      ],
      imageRefs: [],
      warnings: [],
    },
    ...overrides,
  };
}

describe("buildCaaDialogRelatedFiles", () => {
  it("lists concrete bitmap files, not graphic directories", () => {
    const rows = buildCaaDialogRelatedFiles(minimalIr());
    const paths = rows.map((r) => r.repoRelPath);
    expect(paths).toContain("Pkg/CNext/resources/graphic/icons/normal/I_Test.bmp");
    expect(paths).toContain("Pkg/CNext/resources/graphic/I_Test.bmp");
    expect(paths).not.toContain("Pkg/CNext/resources/graphic");
    expect(rows.find((r) => r.repoRelPath.endsWith("/graphic"))).toBeUndefined();
  });

  it("labels bitmap rows by file extension", () => {
    const rows = buildCaaDialogRelatedFiles(minimalIr());
    const bmp = rows.find((r) => r.filename === "I_Test.bmp");
    expect(bmp?.kindLabel).toBe("位图 .bmp");
  });
});
