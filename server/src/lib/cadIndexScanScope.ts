/** Default CAD discovery scope. Only directory segments are excluded, not dot-prefixed files. */
export function cadDirectoryExcludedFromDiscovery(name: string): boolean {
  return (name !== "." && name !== ".." && name.startsWith(".")) || name === "node_modules" || name === "__pycache__";
}

function directorySegments(value: string): string[] {
  return value.replace(/\\/g, "/").split("/").slice(0, -1).filter(segment => segment && segment !== ".");
}

export function cadPathHasHiddenDirectory(value: string): boolean {
  return directorySegments(value).some(segment => segment.startsWith(".") && segment !== "..");
}

export function cadPathExcludedFromDiscovery(value: string): boolean {
  return directorySegments(value).some(cadDirectoryExcludedFromDiscovery);
}
