import { describe, expect, it } from "vitest";
import { CAA_NLS_LOCALE_SIMPLIFIED_CHINESE } from "@desk-tools/catdlg-core";
import type { CaaDialogIr } from "../types/caaDialogIr";
import {
  addCaaDialogNlsLocale,
  buildCaaDialogNlsSessionFromDraft,
  buildCaaDialogNlsSessionFromIr,
  isCaaDialogNlsSessionDirty,
  overlayCaaDialogNlsSnapshot,
  projectCaaNlsKeyCountMismatch,
} from "./caaDialogNlsSessionViewModel";

function createIr(): CaaDialogIr {
  return {
    schemaVersion: 1,
    dialogName: "Demo",
    root: { id: "Demo", type: "CATDlg", children: [] },
    sources: {
      catDlg: "Demo.CATDlg",
      catNls: "Demo.CATNls",
      nlsLocales: {
        [CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]: "msgcatalog/Simplified_Chinese/Demo.CATNls",
      },
    },
    localeNls: {
      Japanese: { Title: "デモ" },
      Empty: {},
    },
    parseMeta: {
      locales: [
        { id: "default", catNlsRel: "Demo.CATNls", keyCount: 2 },
        {
          id: CAA_NLS_LOCALE_SIMPLIFIED_CHINESE,
          catNlsRel: "msgcatalog/Simplified_Chinese/Demo.CATNls",
          keyCount: 2,
        },
      ],
      primaryLocale: "default",
      rscKeyCount: 0,
      bitmapDirs: [],
      bitmapFileCount: 0,
      imageRefs: [],
      warnings: [],
      catNlsSourceText: 'Title = "Demo";\nHelp = "English help";',
      localeNlsSourceTexts: {
        [CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]: 'Title = "演示";\nHelp = "中文帮助";',
      },
    },
  };
}

describe("CAA dialog NLS session characterization", () => {
  it("从 IR 的主 source、locale source 与 localeNls fallback 构建六项会话值", () => {
    const session = buildCaaDialogNlsSessionFromIr(createIr());

    expect(session).toEqual({
      baselineNlsFlat: { Title: "Demo", Help: "English help" },
      currentNlsFlat: { Title: "Demo", Help: "English help" },
      nlsSourceText: 'Title = "Demo";\nHelp = "English help";',
      localeNlsFlats: {
        [CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]: { Title: "演示", Help: "中文帮助" },
        Japanese: { Title: "デモ" },
      },
      localeBaselineFlats: {
        [CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]: { Title: "演示", Help: "中文帮助" },
        Japanese: { Title: "デモ" },
      },
      localeSourceTexts: {
        [CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]: 'Title = "演示";\nHelp = "中文帮助";',
      },
    });
    expect(isCaaDialogNlsSessionDirty(session)).toBe(false);
  });

  it("从草稿构建时把当前主语言和 locale 同时作为干净 baseline，并隔离输入引用", () => {
    const nlsFlat = { Title: "Draft" };
    const localeNlsFlats = { Japanese: { Title: "草稿" } };
    const session = buildCaaDialogNlsSessionFromDraft({
      nlsFlat,
      nlsSourceText: "draft-source",
      localeNlsFlats,
    });

    nlsFlat.Title = "mutated";
    localeNlsFlats.Japanese.Title = "mutated";
    expect(session).toMatchObject({
      baselineNlsFlat: { Title: "Draft" },
      currentNlsFlat: { Title: "Draft" },
      nlsSourceText: "draft-source",
      localeNlsFlats: { Japanese: { Title: "草稿" } },
      localeBaselineFlats: { Japanese: { Title: "草稿" } },
      localeSourceTexts: {},
    });
    expect(isCaaDialogNlsSessionDirty(session)).toBe(false);
  });

  it("snapshot 恢复主 current/source，保留 baseline 与 locale source metadata 并合并 locale", () => {
    const parsed = buildCaaDialogNlsSessionFromIr(createIr());
    const restored = overlayCaaDialogNlsSnapshot(parsed, {
      currentNlsFlat: { Title: "Edited", Help: "English help" },
      nlsSourceText: "session-source",
      localeNlsFlats: {
        [CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]: { Title: "已编辑", Help: "中文帮助" },
        French: { Title: "Démo" },
      },
    });

    expect(restored.baselineNlsFlat).toEqual({ Title: "Demo", Help: "English help" });
    expect(restored.currentNlsFlat.Title).toBe("Edited");
    expect(restored.nlsSourceText).toBe("session-source");
    expect(restored.localeNlsFlats).toEqual({
      [CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]: { Title: "已编辑", Help: "中文帮助" },
      Japanese: { Title: "デモ" },
      French: { Title: "Démo" },
    });
    expect(restored.localeBaselineFlats).toEqual(parsed.localeBaselineFlats);
    expect(restored.localeSourceTexts).toEqual(parsed.localeSourceTexts);
    expect(isCaaDialogNlsSessionDirty(restored)).toBe(true);
  });

  it("创建 locale 时保持磁盘空值为 baseline，以当前英文值初始化并呈现 dirty", () => {
    const parsed = buildCaaDialogNlsSessionFromIr(createIr());
    const created = addCaaDialogNlsLocale(parsed, {
      localeId: "French",
      diskNlsFlat: { Title: "", Help: "" },
      sourceText: 'Title = "";\nHelp = "";',
    });

    expect(created.localeBaselineFlats.French).toEqual({ Title: "", Help: "" });
    expect(created.localeNlsFlats.French).toEqual({ Title: "Demo", Help: "English help" });
    expect(created.localeSourceTexts.French).toBe('Title = "";\nHelp = "";');
    expect(isCaaDialogNlsSessionDirty(created)).toBe(true);
  });

  it("count mismatch 维持现状：数量相等但 key 不同不提示，数量不同时才投影缺失键", () => {
    expect(projectCaaNlsKeyCountMismatch({
      hasChineseLocale: true,
      currentNlsFlat: { Title: "Demo", Help: "Help" },
      localeNlsFlats: {
        [CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]: { Title: "演示", Different: "不同" },
      },
    })).toBeNull();

    expect(projectCaaNlsKeyCountMismatch({
      hasChineseLocale: true,
      currentNlsFlat: { Title: "Demo", Help: "Help" },
      localeNlsFlats: {
        [CAA_NLS_LOCALE_SIMPLIFIED_CHINESE]: { Title: "演示" },
      },
    })).toEqual({
      en: 2,
      cn: 1,
      missingInCn: ["Help"],
      missingInEn: [],
    });

    expect(projectCaaNlsKeyCountMismatch({
      hasChineseLocale: false,
      currentNlsFlat: { Title: "Demo" },
      localeNlsFlats: {},
    })).toBeNull();
  });
});
