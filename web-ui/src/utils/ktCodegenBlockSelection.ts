import type { KtCodegenBlockKey } from "@phoenix-wing/kt-codegen";

export function toggleKtCodegenBlockSelection(
  selected: readonly KtCodegenBlockKey[],
  key: KtCodegenBlockKey,
  checked: boolean,
  singleMode: boolean,
): KtCodegenBlockKey[] {
  const next = checked && singleMode
    ? new Set<KtCodegenBlockKey>()
    : new Set(selected);
  if (checked) next.add(key);
  else next.delete(key);
  return [...next];
}

export function enterKtCodegenSingleMode(
  selected: readonly KtCodegenBlockKey[],
): KtCodegenBlockKey[] {
  return selected.length > 1 ? [selected[0]!] : [...selected];
}
