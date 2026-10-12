import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonFetch } from "../../api";
import { galleryDocument } from "./api";

vi.mock("../../api", () => ({ jsonFetch: vi.fn() }));
vi.mock("../../utils/runtimeBridge", () => ({ apiUrl: (value: string) => value }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(jsonFetch).mockResolvedValue({ html: "<html></html>" });
});

describe("gallery print display options", () => {
  it("defaults to category, dimensions and part number, but no filename", async () => {
    await galleryDocument("synthetic workspace", "Example.ASSY.FCStd", ["Example.FCStd"]);
    expect(jsonFetch).toHaveBeenCalledWith(
      "/api/cad/part-gallery/document?workspace=synthetic%20workspace",
      { method: "POST", body: JSON.stringify({
        product: "Example.ASSY.FCStd", rels: ["Example.FCStd"],
        show_category: true, show_dimensions: true, show_part_number: true, show_filenames: false,
      }) },
    );
  });

  it("passes explicitly disabled metadata and enabled filename without changing the selected files", async () => {
    const rels = ["synthetic/Example.FCStd", "synthetic/Other.FCStd"];
    const result = await galleryDocument("synthetic", "", rels, {
      showCategory: false, showDimensions: false, showPartNumber: false, showFilenames: true,
    });
    expect(result).toEqual({ html: "<html></html>" });
    const [, init] = vi.mocked(jsonFetch).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      product: "", rels,
      show_category: false, show_dimensions: false, show_part_number: false, show_filenames: true,
    });
    expect(rels).toEqual(["synthetic/Example.FCStd", "synthetic/Other.FCStd"]);
  });

  it("keeps defaults for omitted options in a partial preference", async () => {
    await galleryDocument("synthetic", "", ["Example.FCStd"], { showDimensions: false });
    const [, init] = vi.mocked(jsonFetch).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      show_category: true, show_dimensions: false, show_part_number: true, show_filenames: false,
    });
  });
});
