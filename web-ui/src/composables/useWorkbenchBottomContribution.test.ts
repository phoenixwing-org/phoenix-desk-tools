import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import {
  activateWorkbenchBottomContribution,
  setWorkbenchBottomContribution,
  useGlobalWorkbenchBottomContribution,
  useWorkbenchBottomPanelState,
  type WorkbenchBottomContribution,
} from "./useWorkbenchBottomContribution";

const Content = defineComponent({ template: "<div />" });

function contribution(label: string): WorkbenchBottomContribution {
  return {
    sourceLabel: label,
    tabs: [
      { id: "preflight", label: "预检", count: 1 },
      { id: "problems", label: "问题", count: 0 },
    ],
    component: Content,
  };
}

describe("global workbench bottom contribution", () => {
  it("keeps the most recently activated contribution independent of unrelated page switches", () => {
    const first = contribution("first");
    const second = contribution("second");
    setWorkbenchBottomContribution("kt_codegen", "tab-1", first, true);
    setWorkbenchBottomContribution("kt_codegen", "tab-2", second, false);
    const active = useGlobalWorkbenchBottomContribution();

    expect(active.value).toBe(first);
    activateWorkbenchBottomContribution("kt_codegen", "tab-2");
    expect(active.value).toBe(second);

    setWorkbenchBottomContribution("kt_codegen", "tab-1", null);
    setWorkbenchBottomContribution("kt_codegen", "tab-2", null);
  });

  it("keeps the selected global panel tab", () => {
    const state = useWorkbenchBottomPanelState();
    state.setActiveTab("output");
    expect(state.activeTab.value).toBe("output");
    state.setActiveTab("preflight");
  });
});
