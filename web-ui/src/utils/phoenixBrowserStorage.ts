/** Clear Phoenix Web UI keys from browser storage (local + session). */

const PREFIXES = ["phoenix", "fcdesk"];

function collectKeys(store: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && PREFIXES.some((p) => k.startsWith(p))) {
      keys.push(k);
    }
  }
  return keys;
}

export function clearPhoenixBrowserStorage(): number {
  let removed = 0;
  for (const store of [localStorage, sessionStorage]) {
    try {
      const keys = collectKeys(store);
      for (const k of keys) {
        store.removeItem(k);
        removed += 1;
      }
    } catch {
      /* private mode */
    }
  }
  return removed;
}
