export type ColorScheme = "light" | "dark" | "system";

export function resolveColorScheme(scheme: ColorScheme): "light" | "dark" {
  if (scheme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return scheme;
}

export function applyColorScheme(scheme: ColorScheme): "light" | "dark" {
  const resolved = resolveColorScheme(scheme);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}
