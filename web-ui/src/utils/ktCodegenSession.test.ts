import { describe, expect, it } from "vitest";
import {
  KT_CODEGEN_TABLE_DATA_KIND,
  KT_CODEGEN_TABLE_DATA_SCHEMA_VERSION,
  KtCodegenParam,
} from "@phoenix-wing/kt-codegen";
import type { KtCodegenHostDocument } from "../api";
import {
  buildKtCodegenSessionSnapshot,
  decideKtCodegenDraftRestore,
  parseKtCodegenSessionSnapshot,
} from "./ktCodegenSession";

function document(): KtCodegenHostDocument {
  const param = new KtCodegenParam({ namePrefix: "Kt", nameMiddle: "Draft" });
  return {
    kind: "kt.codegen.host-document",
    schema_version: 1,
    path: "draft.codegen.json",
    file_name: "draft.codegen.json",
    format: "legacy-v4-json",
    class_name: "KtDraft",
    item_count: 0,
    diagnostic_count: 0,
    fingerprint: "sha256:base",
    file_signature: "signature:base",
    document_revision: 7,
    encoding: "utf8",
    param,
    table: {
      kind: KT_CODEGEN_TABLE_DATA_KIND,
      schemaVersion: KT_CODEGEN_TABLE_DATA_SCHEMA_VERSION,
      documentRevision: 7,
      selectedRow: null,
      items: [],
    },
    diagnostics: [],
  };
}

describe("KT Codegen session snapshot", () => {
  it("keeps a detached dirty draft and valid Wing block keys", () => {
    const active = document();
    const snapshot = buildKtCodegenSessionSnapshot({
      active,
      dirty: true,
      selectedBlockKeys: ["PARAM DECLARATION"],
      table: active.table,
    });
    active.param.nameMiddle = "MutatedLater";

    const parsed = parseKtCodegenSessionSnapshot(snapshot);
    expect(parsed?.draft?.param.nameMiddle).toBe("Draft");
    expect(parsed?.selectedBlockKeys).toEqual(["PARAM DECLARATION"]);
    expect(decideKtCodegenDraftRestore(parsed!, "sha256:base")).toBe("restore");
    expect(decideKtCodegenDraftRestore(parsed!, "sha256:external")).toBe("conflict");
  });

  it("rejects malformed dirty drafts and strips unknown block keys", () => {
    expect(parseKtCodegenSessionSnapshot({
      v: 1,
      path: "draft.codegen.json",
      dirty: true,
      selectedBlockKeys: ["PARAM DECLARATION"],
      draft: { param: {}, table: {} },
    })).toBeNull();

    expect(parseKtCodegenSessionSnapshot({
      v: 1,
      path: "",
      dirty: false,
      selectedBlockKeys: ["PARAM DECLARATION", "unknown"],
    })?.selectedBlockKeys).toEqual(["PARAM DECLARATION"]);
  });

  it("keeps an unresolved fingerprint conflict across another session save", () => {
    const active = document();
    const snapshot = buildKtCodegenSessionSnapshot({
      active,
      dirty: false,
      selectedBlockKeys: [],
      table: active.table,
      recoveryConflict: {
        path: active.path,
        snapshotFingerprint: "sha256:old",
        param: { ...active.param, nameMiddle: "Recovered" },
        table: active.table,
      },
    });

    expect(snapshot).toMatchObject({ dirty: true, fingerprint: "sha256:old" });
    expect(snapshot.draft?.param.nameMiddle).toBe("Recovered");
  });
});
