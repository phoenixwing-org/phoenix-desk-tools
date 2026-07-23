import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fixture from "@phoenix-wing/kt-codegen/fixtures/codegen-host-contract-v1.json";

type BuildPrimaryModel = typeof import("./ktCodegenControlUi")["buildKtCodegenPrimaryUiModel"];

let buildKtCodegenPrimaryUiModel: BuildPrimaryModel;

const baseInput: Parameters<BuildPrimaryModel>[0] = {
  documents: [{
    path: "Demo.json",
    file_name: "Demo.json",
    format: "legacy-v4-json",
    class_name: "Demo",
    item_count: 1,
    diagnostic_count: 0,
  }],
  active: null,
  dirty: false,
  externalChange: null,
  selectedBlockKeys: [],
  preflight: null,
  state: null,
  message: "",
  lastApply: null,
  loadingDocuments: false,
  applying: false,
  opening: false,
  saving: false,
  batchApplying: false,
  hostBlocked: false,
};

describe("Desk Codegen Primary Host capabilities", () => {
  beforeAll(async () => {
    vi.stubGlobal("HTMLElement", class {});
    ({ buildKtCodegenPrimaryUiModel } = await import("./ktCodegenControlUi"));
  });

  afterAll(() => vi.unstubAllGlobals());

  it("只开启 Desk 已实现的批量动作，并把批次投影给 Wing overlay", () => {
    const idle = buildKtCodegenPrimaryUiModel(baseInput);
    expect(idle.capabilities).toMatchObject({
      openJson: false,
      importCsv: false,
      applyAll: true,
      scanCandidates: false,
      openReportDirectory: false,
    });

    const batch = buildKtCodegenPrimaryUiModel({
      ...baseInput,
      batchApplying: true,
      batchProgress: { current: 1, total: 2, fileName: "Demo.json" },
    });
    expect(batch).toMatchObject({
      operation: "batch-apply",
      batch: { current: 1, total: 2, fileName: "Demo.json" },
      running: true,
    });
  });

  it("草稿、外部变化或恢复冲突会关闭全部应用", () => {
    expect(buildKtCodegenPrimaryUiModel({ ...baseInput, dirty: true }).capabilities.applyAll).toBe(false);
    expect(buildKtCodegenPrimaryUiModel({ ...baseInput, hostBlocked: true }).capabilities.applyAll).toBe(false);
  });

  it("把三库共用的 Wing Host fixture 投影为 Primary 文档摘要", () => {
    const documentId = "fixture://codegen-host-contract-v1.json";
    const fileName = "CodegenHostContractParam.json";
    const className = `${fixture.input.legacyJson.NamePrefix}${fixture.input.legacyJson.NameMiddle}`;
    const model = buildKtCodegenPrimaryUiModel({
      ...baseInput,
      documents: [{
        path: documentId,
        file_name: fileName,
        format: "legacy-v4-json" as const,
        class_name: className,
        item_count: fixture.input.legacyJson.data.length,
        diagnostic_count: 0,
      }],
      loadingDocuments: true,
    });

    expect(model.documents[0]).toMatchObject({
      id: documentId,
      fileName,
      itemCount: 2,
      className: "KtCourseGuard",
    });
    expect(model.operation).toBe("discovery");
  });
});
