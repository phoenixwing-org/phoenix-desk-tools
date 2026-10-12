import { beforeEach, expect, it, vi } from "vitest";
import { jsonFetch } from "../../api";
import { fetchCadIndexSearch } from "./api";
vi.mock("../../api", () => ({ jsonFetch: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
it("encodes workspace and one complete term in the read-only endpoint", async () => {
  await fetchCadIndexSearch("/synthetic space", "alpha beta_%&");
  expect(jsonFetch).toHaveBeenCalledExactlyOnceWith("/api/cad/index/search?workspace=%2Fsynthetic%20space&q=alpha%20beta_%25%26");
});
