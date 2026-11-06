import fs from "node:fs";
import { effectScope, nextTick, ref, toValue, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GalleryResult } from "./api";
import type { PageSessionApi } from "../../composables/usePageSession";

const state = vi.hoisted(() => ({
  shell: {} as any,
  gallery: {} as any,
  session: undefined as PageSessionApi | undefined,
  galleryDocument: vi.fn(),
  archiveGallery: vi.fn(),
  collectionAdd: vi.fn(),
  activated: undefined as (() => void) | undefined,
  primary: undefined as any,
}));
vi.mock("vue", async importOriginal => ({
  ...await importOriginal<typeof import("vue")>(),
  useSSRContext: () => ({ modules: new Set<string>() }),
  onActivated: (callback: () => void) => { state.activated = callback; },
  onBeforeUnmount: () => undefined,
}));
vi.mock("../../composables/useAppShell", () => ({ useAppShell: () => state.shell }));
vi.mock("../../composables/usePagePrimaryContribution", () => ({ usePagePrimaryContribution: (_page: string, _tab: string, primary: unknown) => { state.primary = primary; } }));
vi.mock("../../composables/usePageSession", () => ({
  usePageSession: (_tab: string, api: PageSessionApi) => { state.session = api; },
}));
vi.mock("../../composables/cadBatchTools", () => ({ cadBatchToolsSection: () => ({ id: "synthetic-tools" }) }));
vi.mock("./usePartGallery", () => ({ usePartGallery: () => state.gallery }));
vi.mock("./api", () => ({
  galleryDocument: state.galleryDocument, archiveGallery: state.archiveGallery, thumbnailUrl: () => "synthetic-image",
}));
vi.mock("../batch-tasks/collection", () => ({ useBatchTaskCollection: () => ({ pathsFor: () => [], add: state.collectionAdd }) }));
vi.mock("phoenix-wing/layout/PnwPageLayout.vue", () => ({ default: {} }));
vi.mock("phoenix-wing/layout/PnwPageHeader.vue", () => ({ default: {} }));

import PartGalleryPage from "./PartGalleryPage.vue";

// Independent UI metadata, not a real CAD model or part inventory.
const result: GalleryResult = {
  product: "", updated_at: "synthetic", issues: [],
  rows: [{
    rel: "synthetic/Example.FCStd", part_number: "DEMO", part_version: "V1", part_name: "Example",
    type_code: "H", role: "part", status: "ready", width: 1, height: 1, image_hash: "synthetic", message: "",
    bounding_box: { x_mm: 1, y_mm: 2, z_mm: 3 },
  }],
};
let scope: EffectScope | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  state.session = undefined;
  state.activated = undefined; state.primary = undefined;
  state.shell = {
    workspacePath: ref("synthetic workspace"), consumeTabPayload: vi.fn(),
    appendLog: vi.fn(), openFileDetailForRel: vi.fn(), setStatus: vi.fn(),
  };
  state.gallery = {
    result: ref(result), options: ref([]), busy: ref(false), requesting: ref(false),
    error: ref(""), job: ref(null), jobKind: ref(null),
    update: vi.fn(), updateDimensions: vi.fn(), load: vi.fn(), cancel: vi.fn(), canCancel: ref(false), cancelling: ref(false),
  };
  state.galleryDocument.mockResolvedValue({ html: "<html></html>" });
});
afterEach(() => { scope?.stop(); });

function setup(): Record<string, any> {
  scope = effectScope();
  return scope.run(() => (PartGalleryPage as any).setup({ workbenchTabId: "synthetic-tab" }, { expose: () => undefined }));
}

describe("gallery display options", () => {
  it("starts with labels, dimensions and part numbers selected, and filenames hidden", async () => {
    const page = setup();
    expect(state.session?.serialize()).toMatchObject({
      categories: true, dimensions: true, partNumbers: true, filenames: false,
    });
    await page.preparePrint();
    expect(state.galleryDocument).toHaveBeenCalledWith(
      "synthetic workspace", "", [result.rows[0].rel],
      { showCategory: true, showDimensions: true, showPartNumber: true, showFilenames: false },
    );
  });

  it("remembers each display selection and sends it to the A4 preview", async () => {
    const page = setup();
    page.categories.value = false; page.dimensions.value = false;
    page.partNumbers.value = false; page.filenames.value = true;
    const saved = state.session!.serialize();
    expect(saved).toMatchObject({ categories: false, dimensions: false, partNumbers: false, filenames: true });
    page.categories.value = true; page.dimensions.value = true;
    page.partNumbers.value = true; page.filenames.value = false;
    expect(state.session!.hydrate(saved)).toBe(true);
    expect(state.session!.serialize()).toEqual(saved);
    await page.preparePrint();
    expect(state.galleryDocument).toHaveBeenLastCalledWith(
      "synthetic workspace", "", [result.rows[0].rel],
      { showCategory: false, showDimensions: false, showPartNumber: false, showFilenames: true },
    );
  });

  it("restores an older session without display preferences using the new defaults", () => {
    const page = setup();
    page.categories.value = false; page.dimensions.value = false;
    page.partNumbers.value = false; page.filenames.value = true;
    expect(state.session!.hydrate({ product: "", query: "", type: "", assemblies: false })).toBe(true);
    expect(state.session!.serialize()).toMatchObject({
      categories: true, dimensions: true, partNumbers: true, filenames: false,
    });
  });

  it("binds separate display controls to the corresponding card metadata", () => {
    const source = fs.readFileSync(new URL("./PartGalleryPage.vue", import.meta.url), "utf8");
    for (const [model, label, cssClass] of [
      ["categories", "显示标签", "card-badges"],
      ["dimensions", "显示尺寸", "dimensions"],
      ["partNumbers", "显示零件号", "number"],
      ["filenames", "显示文件名", "file"],
    ]) {
      expect(source).toContain(`<el-checkbox v-model="${model}">${label}</el-checkbox>`);
      expect(source).toContain(`v-if="${model}" class="${cssClass}"`);
    }
  });

  it("blocks output and collection while changed scope is pending, but keeps explicit cache update enabled", async () => {
    state.gallery.result.value = { ...result, scope_pending: true, removed_count: 3 };
    const page = setup();
    expect(page.scopeNotice.value).toBe("当前范围待确认，已隐藏3个旧成员；请更新图片缓存");
    await page.preparePrint(); await page.archive(); page.addVisibleToBatch();
    expect(state.galleryDocument).not.toHaveBeenCalled(); expect(state.archiveGallery).not.toHaveBeenCalled(); expect(state.collectionAdd).not.toHaveBeenCalled();
    const sections = state.primary.sections;
    const output = sections.find((section: any) => section.id === "gallery-output");
    for (const action of output.actions) expect(toValue(action.disabled)).toBe(true);
    const scope = sections.find((section: any) => section.id === "gallery-product");
    expect(toValue(scope.actions.find((action: any) => action.id === "update").disabled)).toBe(false);
    expect(toValue(scope.description)).toContain("当前范围待确认，已隐藏3个旧成员");
  });

  it("reloads only cached metadata when reactivated, not a cache job or Native measurement", () => {
    setup(); state.activated!();
    expect(state.gallery.load).toHaveBeenCalledTimes(1); expect(state.gallery.update).not.toHaveBeenCalled(); expect(state.gallery.updateDimensions).not.toHaveBeenCalled();
  });

  it("labels cache extraction accurately and provides current-cache cancellation in header and Primary", () => {
    setup(); const source = fs.readFileSync(new URL("./PartGalleryPage.vue", import.meta.url), "utf8");
    expect(source).not.toContain("更新缩略图"); expect(source).toContain('@click="gallery.cancel">取消当前缓存任务</el-button>');
    const scope = state.primary.sections.find((section: any) => section.id === "gallery-product");
    expect(scope.actions.find((action: any) => action.id === "update").label).toBe("更新图片缓存");
    const cancel = scope.actions.find((action: any) => action.id === "cancel-cache");
    expect(toValue(cancel.disabled)).toBe(true); state.gallery.canCancel.value = true; expect(toValue(cancel.disabled)).toBe(false);
    cancel.run(); expect(state.gallery.cancel).toHaveBeenCalledTimes(1);
    const help = state.primary.sections.find((section: any) => section.id === "gallery-help").description;
    expect(help).toContain("FCStd ZIP 内嵌缩略图，不启动 FreeCAD"); expect(help).toContain("先备份，再写入 FCStd 缩略图");
  });

  it.each(["missing", "pending"] as const)("closes stale output dialogs and clears prepared printing when scope becomes %s", async invalid => {
    const page = setup();
    page.archiveOpen.value = true; page.printOpen.value = true; page.printReady.value = true; page.printHtml.value = "<html>previous snapshot</html>";
    state.gallery.result.value = invalid === "missing" ? null : { ...result, scope_pending: true, removed_count: 1 };
    await nextTick();
    expect(page.archiveOpen.value).toBe(false); expect(page.printOpen.value).toBe(false); expect(page.printReady.value).toBe(false); expect(page.printHtml.value).toBe("");
  });

  it.each(["missing", "pending", "error"] as const)("refuses direct printing for %s scope even before dialog watchers settle", invalid => {
    const page = setup(), focus = vi.fn(), print = vi.fn(); page.printFrame.value = { contentWindow: { focus, print } };
    if (invalid === "missing") state.gallery.result.value = null;
    if (invalid === "pending") state.gallery.result.value = { ...result, scope_pending: true };
    if (invalid === "error") state.gallery.error.value = "范围核验失败";
    page.print(); expect(focus).not.toHaveBeenCalled(); expect(print).not.toHaveBeenCalled();
  });

  it("keeps a normal verified output snapshot open when current metadata reloads successfully", async () => {
    const page = setup();
    page.archiveOpen.value = true; page.printOpen.value = true; page.printReady.value = true; page.printHtml.value = "<html>verified snapshot</html>";
    state.gallery.result.value = { ...result, updated_at: "new verified cache" }; await nextTick();
    expect(page.archiveOpen.value).toBe(true); expect(page.printOpen.value).toBe(true); expect(page.printReady.value).toBe(true); expect(page.printHtml.value).toBe("<html>verified snapshot</html>");
  });

  it("does not reopen an invalidated preview when its earlier document response arrives late", async () => {
    let resolve!: (value: { html: string }) => void;
    state.galleryDocument.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const page = setup(), pending = page.preparePrint();
    state.gallery.result.value = null; state.gallery.error.value = "范围核验失败"; await nextTick();
    resolve({ html: "<html>old response</html>" }); await pending;
    expect(page.printOpen.value).toBe(false); expect(page.printReady.value).toBe(false); expect(page.printHtml.value).toBe("");
  });
});
