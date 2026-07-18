import { describe, expect, it } from "vitest";
import {
  buildCaaDialogPageSnapshot,
  caaHistoryStackForSession,
  caaHistoryStackFromSession,
  caaLocaleMapsFromSession,
  isCaaDialogIr,
  normalizeCaaIrWriteMode,
  type CaaIrHistoryEntry,
} from "./caaDialogSessionViewModel";
import type { CaaDialogIr } from "../types/caaDialogIr";

function createIr(id: string): CaaDialogIr {
  return {
    schemaVersion: 1,
    dialogName: id,
    root: { id, type: "CATDlg", children: [] },
    sources: { catDlg: `${id}.CATDlg`, catNls: `${id}.CATNls` },
    parseMeta: {
      locales: [{ id: "default", catNlsRel: `${id}.CATNls`, keyCount: 1, sourceText: "locale-source" }],
      primaryLocale: "default",
      rscKeyCount: 0,
      bitmapDirs: [],
      bitmapFileCount: 0,
      imageRefs: [],
      warnings: [],
      catNlsSourceText: "primary-source",
      localeNlsSourceTexts: { default: "locale-source" },
    },
  };
}

function history(index: number): CaaIrHistoryEntry {
  return {
    ir: createIr(`Dlg${index}`),
    selectedId: `Node${index}`,
    irWriteMode: "full",
    nlsFlat: { Title: `Title ${index}` },
  };
}

describe("CAA dialog session view model", () => {
  it("校验 IR 并归一化写回模式", () => {
    expect(isCaaDialogIr(createIr("Demo"))).toBe(true);
    expect(isCaaDialogIr({ schemaVersion: 1, dialogName: "Bad", sources: {}, root: {} })).toBe(false);
    expect(normalizeCaaIrWriteMode("patch", "none")).toBe("patch");
    expect(normalizeCaaIrWriteMode("invalid", "full")).toBe("full");
  });

  it("清洗 NLS locale map，忽略非字符串值", () => {
    expect(caaLocaleMapsFromSession({
      default: { Title: "Demo", Count: 3 },
      "Simplified_Chinese": { Title: "演示" },
      invalid: null,
    })).toEqual({
      default: { Title: "Demo" },
      "Simplified_Chinese": { Title: "演示" },
    });
  });

  it("会话历史只保留最后 12 条并删除大体积 NLS source text", () => {
    const serialized = caaHistoryStackForSession(Array.from({ length: 15 }, (_, index) => history(index)));
    expect(serialized).toHaveLength(12);
    expect(serialized[0].ir.dialogName).toBe("Dlg3");
    expect(serialized[0].ir.parseMeta?.catNlsSourceText).toBeUndefined();
    expect(serialized[0].ir.parseMeta?.locales[0].sourceText).toBeUndefined();
    expect(caaHistoryStackFromSession([...serialized, { ir: { bad: true } }])).toHaveLength(12);
  });

  it("草稿 snapshot 携带 IR，干净磁盘会话不携带 IR", () => {
    const common = {
      nlsFlat: { Title: "Demo" },
      nlsSourceText: "source",
      localeNlsFlats: {},
      selectedId: "Demo",
      irWriteMode: "none" as const,
      editMode: false,
      undoStack: [],
      redoStack: [],
      draftId: "draft-1",
      ir: createIr("Demo"),
    };
    const draft = buildCaaDialogPageSnapshot({ ...common, isNewDraft: true, irDirty: false });
    expect(draft).toMatchObject({ isNewDraft: true, draftId: "draft-1", ir: { dialogName: "Demo" } });
    expect(draft.ir?.parseMeta?.catNlsSourceText).toBeUndefined();
    const clean = buildCaaDialogPageSnapshot({ ...common, isNewDraft: false, irDirty: false });
    expect(clean.ir).toBeUndefined();
    const dirty = buildCaaDialogPageSnapshot({ ...common, isNewDraft: false, irDirty: true });
    expect(dirty.ir?.dialogName).toBe("Demo");
  });
});
