import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("KT Codegen workbench boundary", () => {
  it("keeps the VS Code Primary/View/Properties/Panel composition in host contributions", () => {
    const page = source("./KtCodegenPage.vue");
    expect(page).toContain("usePagePrimaryContribution");
    expect(page).toContain("useKtCodegenPagePropertySheet");
    expect(page).toContain("useWorkbenchBottomContribution");
    expect(page).toContain("component: KtCodegenBottomContent");
    expect(page).toContain('layout="page"');
    expect(page).toMatch(/<kt-codegen-table[\s\S]*?\scollapsible(?:\s|>)/u);
    expect(page).not.toContain("KT_CODEGEN_BLOCK_PRESENTATIONS");
  });

  it("uses host safe_to_apply and structured Wing diagnostics without parsing messages", () => {
    const page = source("./KtCodegenPage.vue");
    const sidebar = source("../components/codegen/KtCodegenSidebar.vue");
    const bottom = source("../components/codegen/KtCodegenBottomContent.vue");
    const diagnostic = source("../utils/ktCodegenDiagnosticPresentation.ts");

    expect(page).toContain("deriveKtCodegenPlanPresentation");
    expect(sidebar).toContain("planPresentation.partial");
    expect(sidebar).not.toContain("!preflight.plan.canApply");
    expect(bottom).toContain("ktCodegenDiagnosticMarkerContext");
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
