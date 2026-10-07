import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("readable product Main/Primary actions", () => {
  it.each([
    ["./caa/CaaDialogIndexPanel.vue", ["列表", "分组", "刷新", "扫描"]],
    ["./caa/CaaControlPalette.vue", ["横排", "竖排", "单行", "双列", "工具箱", "收起"]],
    ["./caa/CaaUnsavedDraftsPanel.vue", ["删除"]],
    ["./caa/CaaNlsTreeEditor.vue", ["关闭"]],
    ["./caa/CaaGridSettingsPopover.vue", ["关闭"]],
    ["./git/GitChangeRowActions.vue", ["暂存", "取消暂存"]],
    ["./git/GitDiffPreviewButton.vue", ["差异"]],
    ["./git/GitRevertWorktreeButton.vue", ["放弃"]],
    ["./git/GitSectionHead.vue", ["全部暂存", "全部撤存", "全部放弃"]],
    ["./git/GitPathFilterChips.vue", ["历史", "清空"]],
    ["./primary/PrimaryDirectoryControl.vue", ["选目录", "刷新"]],
    ["./PageHelpButton.vue", ["帮助"]],
    ["./XlinkReplaceDialog.vue", ["关闭"]],
  ] as const)("%s renders short visible action text, not only an accessible title", (file, words) => {
    const template = source(file).split("<template>")[1].split("<style")[0];
    for (const word of words) expect(template.replace(/<[^>]*>/g, "")).toContain(word);
  });

  it("keeps events/loading guards and Wing structural carets, without square icon widths", () => {
    const caa = source("./caa/CaaDialogIndexPanel.vue");
    expect(caa).toContain('@click.stop="loadIndex()"');
    expect(caa).toContain('@click.stop="rescan"');
    expect(caa).toContain(':loading="scanning"');
    const git = source("./git/GitSectionHead.vue");
    expect(git).toContain('<ExpandCaret :expanded="expanded"');
    expect(git).toContain("emit('primary')");
    expect(git).toContain("emit('revert')");
    expect(source("./git/git-row-actions.css")).toContain("width: auto");
    expect(source("./git/git-row-actions.css")).not.toContain(".git-icon-btn");
  });
});
