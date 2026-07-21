import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("KT Codegen workbench boundary", () => {
  it("keeps the VS Code Primary/View/Properties/Panel composition in host contributions", () => {
    const page = source("./KtCodegenPage.vue");
    const sidebar = source("../components/codegen/KtCodegenSidebar.vue");
    const bottom = source("../components/codegen/KtCodegenBottomContent.vue");
    expect(page).toContain("usePagePrimaryContribution");
    expect(page).toContain("useKtCodegenPagePropertySheet");
    expect(page).toContain("useWorkbenchBottomContribution");
    expect(page).toContain("component: KtCodegenBottomContent");
    expect(page).toContain("KtCodegenPreflightBlock");
    expect(page).toContain('v-model="preflightBlockOpen"');
    expect(page).toContain('layout="page"');
    expect(page).toMatch(/<kt-codegen-table[\s\S]*?\scollapsible(?:\s|>)/u);
    expect(page).not.toContain("KT_CODEGEN_BLOCK_PRESENTATIONS");
    expect(sidebar).toContain("ktCodegenDefinePrimaryPanelElement");
    expect(sidebar).toContain("buildKtCodegenPrimaryUiModel");
    expect(sidebar).toContain("<kt-codegen-primary-panel");
    expect(sidebar).not.toContain("KT_CODEGEN_BLOCK_PRESENTATIONS");
    expect(sidebar).not.toContain("v-for");
    expect(bottom).toContain("问题");
    expect(bottom).not.toContain('panelTab?: "preflight"');
    expect(bottom).not.toContain("kt-codegen-control-panel");
  });

  it("uses host safe_to_apply and structured Wing diagnostics without parsing messages", () => {
    const page = source("./KtCodegenPage.vue");
    const sidebar = source("../components/codegen/KtCodegenSidebar.vue");
    const bottom = source("../components/codegen/KtCodegenBottomContent.vue");
    const preflightBlock = source("../components/codegen/KtCodegenPreflightBlock.vue");
    const diagnostic = source("../utils/ktCodegenDiagnosticPresentation.ts");

    expect(page).toContain("deriveKtCodegenPlanPresentation");
    expect(page).not.toContain('{ id: "preflight", label: "预检"');
    expect(sidebar).toContain("preflightViewState");
    expect(sidebar).not.toContain("!preflight.plan.canApply");
    expect(bottom).toContain("ktCodegenDiagnosticMarkerContext");
    expect(bottom).not.toContain("Wing 生成候选");
    expect(preflightBlock).toContain("ktCodegenDefineControlPanelElement");
    expect(preflightBlock).toContain("buildKtCodegenControlUiModel");
    expect(preflightBlock).toContain("<kt-codegen-control-panel");
    expect(preflightBlock).toContain("预检结果");
    expect(preflightBlock).toContain("preflightViewState");
    expect(diagnostic).toContain("diagnostic.marker");
    expect(diagnostic).not.toMatch(/message\.(match|includes)|diagnostic\.message/u);
  });

  it("keeps pure presentation models free of Vue, API and host state", () => {
    const planPresentation = source("../models/ktCodegenPlanPresentation.ts");
    expect(planPresentation).not.toMatch(
      /from ["']vue["']|from ["']\.\.\/api["']|useAppShell|localStorage|window\.|document\.|fetch\(/u,
    );
  });
});
