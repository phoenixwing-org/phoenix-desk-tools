import { afterEach, describe, expect, it } from "vitest";
import {
  pnwChoiceDialogOpen as rootOpen,
  pnwChoiceDialogRequest as rootRequest,
  pnwPromptChoice,
  pnwResolveChoice,
} from "phoenix-wing";
import {
  pnwChoiceDialogOpen as subpathOpen,
  pnwChoiceDialogRequest as subpathRequest,
} from "phoenix-wing/composables/pnwChoiceDialog";

afterEach(() => {
  if (rootOpen.value) pnwResolveChoice(null);
});

describe("Wing 0.4.2 Registry aggregate singleton", () => {
  it("根入口与 composable 子路径共享同一对响应式引用", () => {
    expect(rootOpen).toBe(subpathOpen);
    expect(rootRequest).toBe(subpathRequest);
  });

  it("真实 prompt/resolve 流程不产生第二个对话框状态", async () => {
    const pending = pnwPromptChoice({
      title: "Registry singleton",
      message: "Desk consumer",
      choices: [{ id: "ok", label: "确认" }],
    });
    expect(subpathOpen.value).toBe(true);
    expect(subpathRequest.value?.title).toBe("Registry singleton");
    pnwResolveChoice("ok");
    await expect(pending).resolves.toEqual({ choiceId: "ok", checkedIds: [] });
    expect(rootOpen.value).toBe(false);
  });
});
