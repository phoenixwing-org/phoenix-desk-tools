import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./CaaDialogEditorPage.vue", import.meta.url), "utf8");

function section(start: string, end: string): string {
  const from = page.indexOf(start);
  const to = page.indexOf(end, from + start.length);
  expect(from, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `missing section end: ${end}`).toBeGreaterThan(from);
  return page.slice(from, to);
}

describe("CAA dialog editor NLS page contract", () => {
  it("切换 active locale 时仍把对应 flat 翻译到 canvas IR 并同步 sidebar", () => {
    const localeWatch = section(
      "/** 切换语言时把对应 locale",
      "watch([localIr",
    );
    expect(localeWatch).toContain("watch(nlsEditorLocale");
    expect(localeWatch).toContain('locale === "default"');
    expect(localeWatch).toContain("localeNlsFlats.value[locale]");
    expect(localeWatch).toContain("applyNlsKeyToRoot(ir.root, key, value)");
    expect(localeWatch).toContain("syncToSidebar()");
  });

  it("树编辑 setNlsFlatKey 继续 trim 且不记 history，画布 commit 保留原值且记 history", () => {
    const flatEdit = section("function setNlsFlatKey(", "function resolveLocaleIdForRel(");
    const commitEdit = section("function commitNlsEdit(", "const canEditNls");

    expect(flatEdit).toContain("value.trim()");
    expect(flatEdit).not.toContain("recordHistorySnapshot");
    expect(commitEdit).toContain("recordHistorySnapshot()");
    expect(commitEdit).not.toContain("value.trim()");
  });

  it("创建 locale 仍由 Page 调用 Host API 并把磁盘/current 投影交给纯 ViewModel", () => {
    const createLocale = section("async function createChineseLocale()", "function openSupplementDialog()");
    expect(createLocale).toContain("createCaaDialogLocaleNls({");
    expect(createLocale).toContain("addCaaDialogNlsLocale(readNlsSessionValue()");
    expect(createLocale).toContain("diskNlsFlat: result.nlsKeys");
    expect(createLocale).toContain("ir.sources.nlsLocales[id] = result.catNlsRel");
    expect(createLocale).toContain('setNlsEditorLocale(id, "cn")');
  });

  it("API 草稿重载保持旧语义：刷新主 current/baseline，不顺手清空 locale 会话", () => {
    const primaryDraftAssign = section(
      "function assignDraftPrimaryNlsValue(",
      "function clonePlain<",
    );
    const draftLoad = section(
      "// ── 新建草稿：从 API 加载 IR ──",
      "restoreNlsCurrentFromSnapshot(restoredState)",
    );

    expect(primaryDraftAssign).toContain("baselineNlsFlat.value = session.baselineNlsFlat");
    expect(primaryDraftAssign).toContain("currentNlsFlat.value = session.currentNlsFlat");
    expect(primaryDraftAssign).not.toMatch(/localeNlsFlats|localeBaselineFlats|localeSourceTexts/);
    expect(draftLoad.match(/assignDraftPrimaryNlsValue\(/g)).toHaveLength(3);
    expect(draftLoad).not.toContain("assignNlsSessionValue(");
  });

  it("draft snapshot 未序列化 locale source text 时继续沿用 Page 现值", () => {
    const hydrateDraft = section(
      "function hydrateDraftSnapshot(",
      "async function parseDialog()",
    );
    expect(hydrateDraft).toContain("localeSourceTexts: localeSourceTexts.value");
  });
});
