import { describe, expect, it } from "vitest";
import { buildCaaDialogRscPreviewRows } from "./caaDialogRscPreview";
import type { CaaDialogIr } from "../types/caaDialogIr";

function irWithRsc(): CaaDialogIr {
  return {
    schemaVersion: 1,
    dialogName: "TestDlg",
    root: { id: "TestDlg", type: "CATDlgDialog", children: [] },
    sources: {
      catDlg: "Pkg/TestDlg.CATDlg",
      catRsc: "Pkg/CNext/resources/msgcatalog/TestDlg.CATRsc",
    },
    rsc: {
      "TestDlg.Push.Icon": "I_Run.bmp",
      "TestDlg.Stop.Icon": "I_Stop",
    },
    parseMeta: {
      locales: [],
      primaryLocale: "default",
      rscKeyCount: 2,
      bitmapDirs: ["Pkg/CNext/resources/graphic"],
      bitmapFileCount: 2,
      bitmapFiles: [
        {
          repoRelPath: "Pkg/CNext/resources/graphic/icons/normal/I_Run.bmp",
          filename: "I_Run.bmp",
        },
        {
          repoRelPath: "Pkg/CNext/resources/graphic/I_Stop.png",
          filename: "I_Stop.png",
        },
      ],
      imageRefs: ["I_Run.bmp", "I_Stop"],
      warnings: [],
    },
  };
}

describe("buildCaaDialogRscPreviewRows", () => {
  it("matches CATRsc resource names to concrete bitmap files", () => {
    const rows = buildCaaDialogRscPreviewRows(irWithRsc());

    expect(rows.find((r) => r.key === "TestDlg.Push.Icon")).toMatchObject({
      resourceName: "I_Run.bmp",
      bitmapRel: "Pkg/CNext/resources/graphic/icons/normal/I_Run.bmp",
    });
    expect(rows.find((r) => r.key === "TestDlg.Stop.Icon")).toMatchObject({
      resourceName: "I_Stop",
      bitmapRel: "Pkg/CNext/resources/graphic/I_Stop.png",
    });
  });
});
