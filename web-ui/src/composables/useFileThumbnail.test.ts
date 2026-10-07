import { effectScope, nextTick, ref } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { jsonFetch } from "../api";
import { useFileThumbnail } from "./useFileThumbnail";
vi.mock("../api", () => ({ jsonFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it("ignores late images, hides missing images, and reloads on request", async () => {
  const pending: Array<(value: unknown) => void> = [];
  vi.mocked(jsonFetch).mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const scope = effectScope(), rel = ref("A.FCStd"), revision = ref(0);
  const image = scope.run(() => useFileThumbnail(ref("/demo"), rel, revision))!;
  rel.value = "B.FCStd"; await nextTick();
  pending[1]({ thumbnail: { data_url: "data:image/png;base64,Qg==" } }); await nextTick();
  expect(image.value?.alt).toContain("B.FCStd");
  pending[0]({ thumbnail: { data_url: "data:image/png;base64,QQ==" } }); await nextTick();
  expect(image.value?.alt).toContain("B.FCStd");
  revision.value++; await nextTick(); expect(image.value).toBeNull();
  pending[2]({ thumbnail: null }); await nextTick(); expect(image.value?.src).toBe("");
  rel.value = "C.step"; await nextTick(); expect(pending).toHaveLength(3);
  scope.stop();
});
it("rejects non-PNG image URLs", async () => {
  vi.mocked(jsonFetch).mockResolvedValue({ thumbnail: { data_url: "https://external.invalid/image" } });
  const scope = effectScope(); const image = scope.run(() => useFileThumbnail(ref("/demo"), ref("A.FCStd"), ref(0)))!;
  await nextTick(); expect(image.value?.src).toBe(""); scope.stop();
});
