import { CAA_HOME_PAGE_ID } from "./caaPages";

/** Historical IDs are kept only to safely migrate links and persisted workspace state. */
export const RETIRED_CODE_PAGE_IDS: ReadonlySet<string> = new Set([
  "code_index",
  "reorder_members",
  "code_rename",
  "code_uuid",
  "kt_codegen",
]);

export const CODE_PAGE_FALLBACK = CAA_HOME_PAGE_ID;

export function resolveRetiredCodePage(pageId: string): string {
  return RETIRED_CODE_PAGE_IDS.has(pageId) ? CODE_PAGE_FALLBACK : pageId;
}
