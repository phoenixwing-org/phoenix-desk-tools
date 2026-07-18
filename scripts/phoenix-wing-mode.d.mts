export interface PhoenixWingContext {
  mode: "local" | "registry";
  root: string | null;
  configuredBy: string;
}

export interface PhoenixWingAlias {
  find: string | RegExp;
  replacement: string;
}

export const LOCAL_WING_PACKAGE_NAMES: readonly string[];
export function assertLocalWingRoot(wingRoot: string): string;
export function resolvePhoenixWingContext(
  deskRoot: string,
  env?: NodeJS.ProcessEnv,
): PhoenixWingContext;
export function createPhoenixWingSourceAliases(wingRoot: string): PhoenixWingAlias[];
export function resolveLocalWingExport(wingRoot: string, specifier: string): string | null;
