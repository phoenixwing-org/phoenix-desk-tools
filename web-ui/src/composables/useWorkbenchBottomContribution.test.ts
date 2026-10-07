import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import {
  activateWorkbenchBottomContribution,
  setWorkbenchBottomContribution,
  useGlobalWorkbenchBottomContribution,
  useWorkbenchBottomPanelState,
  revealWorkbenchOutput,
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
    setWorkbenchBottomContribution("caa_dialog", "tab-1", first, true);
    setWorkbenchBottomContribution("caa_dialog", "tab-2", second, false);
    const active = useGlobalWorkbenchBottomContribution();

    expect(active.value).toBe(first);
    activateWorkbenchBottomContribution("caa_dialog", "tab-2");
    expect(active.value).toBe(second);

    setWorkbenchBottomContribution("caa_dialog", "tab-1", null);
    setWorkbenchBottomContribution("caa_dialog", "tab-2", null);
  });

  it("keeps the selected global panel tab", () => {
    const state = useWorkbenchBottomPanelState();
    state.setActiveTab("output");
    expect(state.activeTab.value).toBe("output");
    state.setActiveTab("preflight");
  });
  it("explicitly reveals output even after another bottom tab is selected", () => {
    const state = useWorkbenchBottomPanelState();
    const before = state.outputRevealRevision.value;
    state.setActiveTab("problems"); revealWorkbenchOutput();
    expect(state.activeTab.value).toBe("output");
    expect(state.outputRevealRevision.value).toBe(before + 1);
    revealWorkbenchOutput();
    expect(state.outputRevealRevision.value).toBe(before + 2);
  });
});
