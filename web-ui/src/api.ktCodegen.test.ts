import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchKtCodegenDocumentState,
  fetchKtCodegenDocuments,
  fetchKtCodegenSourcePreview,
  fetchKtCodegenSourceStates,
  openKtCodegenDocument,
  runKtCodegenPreflight,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KT Codegen API errors", () => {
  it("keeps HTTP status and payload for fingerprint-conflict handling", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: "磁盘上的 Codegen 配置已变化" }),
      { status: 409, headers: { "content-type": "application/json" } },
    )));

    const request = openKtCodegenDocument("widget.codegen.json");

    await expect(request).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      message: "磁盘上的 Codegen 配置已变化",
      payload: { detail: "磁盘上的 Codegen 配置已变化" },
    });
  });

  it("forwards AbortSignal to cancellable discovery and preflight requests", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const discovery = new AbortController();
    const preflight = new AbortController();
    const state = new AbortController();
    const preview = new AbortController();
    const sourceStates = new AbortController();

    await fetchKtCodegenDocuments({ signal: discovery.signal });
    await runKtCodegenPreflight({
      param: {} as Parameters<typeof runKtCodegenPreflight>[0]["param"],
      table: {} as Parameters<typeof runKtCodegenPreflight>[0]["table"],
      block_keys: [],
    }, { signal: preflight.signal });
    await fetchKtCodegenDocumentState({
      path: "widget.codegen.json",
      expected_file_signature: "signature:1",
      expected_fingerprint: "sha256:1",
    }, { signal: state.signal });
    await fetchKtCodegenSourcePreview({
      path: "Widget.h",
      start_line: 0,
      end_line: 0,
      expected_fingerprint: "sha256:source",
    }, { signal: preview.signal });
    await fetchKtCodegenSourceStates([], { signal: sourceStates.signal });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({ signal: discovery.signal }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({ method: "POST", signal: preflight.signal }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.any(String),
      expect.objectContaining({ method: "POST", signal: state.signal }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      expect.any(String),
      expect.objectContaining({ method: "POST", signal: preview.signal }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      expect.any(String),
      expect.objectContaining({ method: "POST", signal: sourceStates.signal }),
    );
  });
});
