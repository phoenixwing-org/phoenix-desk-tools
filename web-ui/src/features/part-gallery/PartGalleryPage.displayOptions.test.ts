import fs from "node:fs";
import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GalleryResult } from "./api";
import type { PageSessionApi } from "../../composables/usePageSession";

const state = vi.hoisted(() => ({
  shell: {} as any,
  gallery: {} as any,
  session: undefined as PageSessionApi | undefined,
  galleryDocument: vi.fn(),
}));
vi.mock("vue", async importOriginal => ({
  ...await importOriginal<typeof import("vue")>(),
  useSSRContext: () => ({ modules: new Set<string>() }),
  onActivated: () => undefined,
  onBeforeUnmount: () => undefined,
}));
vi.mock("../../composables/useAppShell", () => ({ useAppShell: () => state.shell }));
vi.mock("../../composables/usePagePrimaryContribution", () => ({ usePagePrimaryContribution: () => undefined }));
vi.mock("../../composables/usePageSession", () => ({
  usePageSession: (_tab: string, api: PageSessionApi) => { state.session = api; },
}));
vi.mock("../../composables/cadBatchTools", () => ({ cadBatchToolsSection: () => ({ id: "synthetic-tools" }) }));
vi.mock("./usePartGallery", () => ({ usePartGallery: () => state.gallery }));
vi.mock("./api", () => ({
  galleryDocument: state.galleryDocument, archiveGallery: vi.fn(), thumbnailUrl: () => "synthetic-image",
}));
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
  state.shell = {
    workspacePath: ref("synthetic workspace"), consumeTabPayload: vi.fn(),
    appendLog: vi.fn(), openFileDetailForRel: vi.fn(),
  };
  state.gallery = {
    result: ref(result), options: ref([]), busy: ref(false), requesting: ref(false),
    error: ref(""), job: ref(null), jobKind: ref(null),
    update: vi.fn(), updateDimensions: vi.fn(), load: vi.fn(),
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
});
