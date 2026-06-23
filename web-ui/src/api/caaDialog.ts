import type { CaaDialogIr } from "../types/caaDialogIr";

export async function fetchCaaHealth(): Promise<{ ok: boolean }> {
  const res = await fetch("/api/caa/health");
  if (!res.ok) throw new Error(`CAA health ${res.status}`);
  return res.json();
}

export async function parseCaaDialogDemo(): Promise<CaaDialogIr> {
  const res = await fetch("/api/caa/dialog/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ demo: true }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? `parse failed ${res.status}`);
  }
  return data as CaaDialogIr;
}
