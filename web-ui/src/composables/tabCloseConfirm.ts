import { promptChoice } from "./choiceDialog";

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

/** 关闭全部 Tab：弹窗确认；有未保存时说明将丢弃（批量关闭不逐条 flush）。 */
export async function confirmCloseAllTabs(
  total: number,
  dirtyTitles: string[],
): Promise<boolean> {
  if (total < 1) return false;

  let message = `将关闭 ${total} 个 Tab，并回到首页。`;
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

  const choice = await promptChoice({
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
  return choice === "confirm";
}
