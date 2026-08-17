import { pnwPromptChoice } from "phoenix-wing";

export type TabCloseChoice = "flush" | "discard" | "cancel";

/** Tab 关闭 / 换上下文：写入并关闭 → 放弃 → 取消 */
export async function confirmDirtyTabClose(
  title: string,
  canFlush: boolean,
): Promise<TabCloseChoice> {
  if (canFlush) {
    if (
      window.confirm(
        `Tab「${title}」有未保存的更改（●）。\n\n确定 = 先写入文件，再关闭 Tab\n取消 = 下一步选择…`,
      )
    ) {
      return "flush";
    }
  } else if (
    !window.confirm(
      `Tab「${title}」有未保存的更改。\n\n确定 = 关闭并丢弃\n取消 = 留在 Tab`,
    )
  ) {
    return "cancel";
  } else {
    return "discard";
  }

  if (
    window.confirm(
      `放弃未保存的更改并关闭 Tab「${title}」？\n\n确定 = 放弃并关闭\n取消 = 留在 Tab`,
    )
  ) {
    return "discard";
  }
  return "cancel";
}

function formatDirtyTabList(dirtyTitles: string[]): string {
  const dirty = dirtyTitles.length;
  if (dirty <= 0) return "";
  const list =
    dirty <= 8
      ? dirtyTitles.map((t) => `· ${t}`).join("\n")
      : dirtyTitles
          .slice(0, 6)
          .map((t) => `· ${t}`)
          .join("\n") + `\n· … 另有 ${dirty - 6} 个`;
  return `\n\n其中 ${dirty} 个 Tab 有未保存更改（●），一并关闭时将丢弃未写入内容：\n\n${list}`;
}

/** 关闭工作空间：无 Tab 时直接关；有未关工具 Tab 时可选择「关闭全部 Tab 并关闭工作空间」。 */
export async function confirmCloseWorkspace(
  toolTabCount: number,
  dirtyTitles: string[],
): Promise<"close" | "close_all" | null> {
  const base = "不会删除磁盘上的项目文件；可稍后在配置中重新打开。";
  if (toolTabCount <= 0) {
    const choice = await pnwPromptChoice({
      title: "关闭工作空间",
      message: `关闭工作空间？\n\n${base}`,
      choices: [
        { id: "close", label: "关闭工作空间", variant: "danger" },
        { id: "cancel", label: "取消", variant: "default" },
      ],
      defaultChoiceId: "cancel",
    });
    return choice.choiceId === "close" ? "close" : null;
  }

  const dirtyNote = formatDirtyTabList(dirtyTitles);
  const choice = await pnwPromptChoice({
    title: "关闭工作空间",
    message:
      `当前还有 ${toolTabCount} 个工具 Tab 未关闭（「主页」可保留）。\n\n`
      + `可先手动关闭各 Tab，或一次性关闭全部 Tab 并关闭工作空间。\n\n${base}${dirtyNote}`,
    choices: [
      { id: "close_all", label: "关闭全部 Tab 并关闭工作空间", variant: "danger" },
      { id: "cancel", label: "取消", variant: "default" },
    ],
    defaultChoiceId: "cancel",
  });
  return choice.choiceId === "close_all" ? "close_all" : null;
}

function formatOpenTabList(tabTitles: string[]): string {
  const total = tabTitles.length;
  if (total < 1) return "";
  return total <= 8
    ? tabTitles.map((t) => `· ${t}`).join("\n")
    : tabTitles
        .slice(0, 6)
        .map((t) => `· ${t}`)
        .join("\n") + `\n· … 另有 ${total - 6} 个`;
}

/** 打开/切换工作空间（选目录）前：有未关页面时确认，默认取消。 */
export async function confirmCloseTabsBeforeWorkspacePick(
  tabTitles: string[],
  dirtyTitles: string[],
): Promise<boolean> {
  const total = tabTitles.length;
  if (total < 1) return true;

  let message =
    `当前有 ${total} 个页面未关闭：\n\n${formatOpenTabList(tabTitles)}\n\n`
    + "继续选择目录后，将关闭全部页面并进入所选工作空间。";

  const dirtyNote = formatDirtyTabList(dirtyTitles);
  if (dirtyNote) {
    message += dirtyNote;
  }

  const choice = await pnwPromptChoice({
    title: "打开工作空间",
    message,
    choices: [
      { id: "confirm", label: "继续并关闭全部页面", variant: "danger" },
      { id: "cancel", label: "取消", variant: "default" },
    ],
    defaultChoiceId: "cancel",
  });
  return choice.choiceId === "confirm";
}

/** 切换工作空间前：有未关页面时系统确认，默认取消。 */
export function confirmCloseTabsForWorkspaceSwitch(
  tabTitles: string[],
  dirtyTitles: string[],
  targetPath: string,
): boolean {
  const total = tabTitles.length;
  if (total < 1) return true;

  let message =
    `当前有 ${total} 个页面未关闭：\n\n${formatOpenTabList(tabTitles)}\n\n`
    + `切换到以下工作空间将关闭全部页面：\n${targetPath}\n\n`
    + "确定 = 全部关闭并切换\n取消 = 取消";

  const dirtyNote = formatDirtyTabList(dirtyTitles);
  if (dirtyNote) {
    message += dirtyNote;
  }

  return window.confirm(message);
}

/** 关闭全部 Tab：弹窗确认；有未保存时说明将丢弃（批量关闭不逐条 flush）。 */
export async function confirmCloseAllTabs(
  total: number,
  dirtyTitles: string[],
): Promise<boolean> {
  if (total < 1) return false;

  let message = `将关闭 ${total} 个 Tab，并回到欢迎页。`;
  const dirty = dirtyTitles.length;
  if (dirty > 0) {
    const list =
      dirty <= 8
        ? dirtyTitles.map((t) => `· ${t}`).join("\n")
        : dirtyTitles
            .slice(0, 6)
            .map((t) => `· ${t}`)
            .join("\n") + `\n· … 另有 ${dirty - 6} 个`;
    message += `\n\n其中 ${dirty} 个有未保存更改（●），关闭后将丢弃未写入内容：\n\n${list}`;
  }

  const choice = await pnwPromptChoice({
    title: "关闭全部 Tab",
    message,
    choices: [
      {
        id: "confirm",
        label: dirty > 0 ? "全部关闭并丢弃" : "全部关闭",
        variant: "danger",
      },
      { id: "cancel", label: "取消", variant: "default" },
    ],
  });
  return choice.choiceId === "confirm";
}
