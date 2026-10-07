import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("AppShell async View boundary", () => {
  it("preloads with the same page loader used by Vue async components", () => {
    const registry = source("./pageRegistry.ts");
    expect(registry).toContain("createRetryableSharedLoader");
    expect(registry).toContain("preloadPageComponent");
    expect(registry).toContain("loader: sharedLoader");
  });

  it("renders the last ready tab only while it is still open, never a replaced preview or pending target", () => {
    const shell = source("./AppShell.vue");
    expect(shell).toContain("createAsyncViewSwitchController");
    expect(shell).toContain("displayedTab.value = state.displayed");
    expect(shell).toContain("displayedTab.value && shell.getTab(displayedTab.value.id)");
    expect(shell).toContain('v-if="visibleTab"');
    expect(shell).toContain(':key="visibleTab.id"');
    expect(shell).toContain(':include="cachedViewNames"');
    expect(shell).toContain('viewCache.componentFor(visibleTab)');
    expect(shell).not.toContain(':key="activeTab.id"');
    expect(shell).toContain("viewSwitch.cancel()");
  });
});
