import type { CodeIndexCatDlgEntry } from "../api";
import type { CaaDialogListGroup, CaaDialogListItem } from "../types/caaDialogList";
import {
  caaDialogGroupKey,
  caaDialogGroupLabel,
  dialogNameFromCatDlgRel,
} from "./caaDialogDisplay";

export function catDlgEntryToListItem(entry: CodeIndexCatDlgEntry): CaaDialogListItem {
  const catDlgRel = entry.repo_rel_path.replace(/\\/g, "/");
  const groupKey = caaDialogGroupKey(catDlgRel);
  return {
    catDlgRel,
    dialogName: dialogNameFromCatDlgRel(catDlgRel),
    fileName: entry.filename,
    groupKey,
    groupLabel: caaDialogGroupLabel(groupKey),
  };
}

export function groupCatDlgListItems(items: CaaDialogListItem[]): CaaDialogListGroup[] {
  const byGroup = new Map<string, CaaDialogListItem[]>();
  for (const item of items) {
    const list = byGroup.get(item.groupKey) ?? [];
    list.push(item);
    byGroup.set(item.groupKey, list);
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([groupKey, groupItems]) => ({
      groupKey,
      label: caaDialogGroupLabel(groupKey),
      items: groupItems.sort((a, b) =>
        a.fileName.localeCompare(b.fileName, undefined, { sensitivity: "base" }),
      ),
    }));
}

export function buildCatDlgGroupsFromIndex(entries: CodeIndexCatDlgEntry[]): CaaDialogListGroup[] {
  return groupCatDlgListItems(entries.map(catDlgEntryToListItem));
}
