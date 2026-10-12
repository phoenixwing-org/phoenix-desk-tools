export interface InstalledInputsOptions {
  readonly installRoot: string;
  readonly executable: string;
  readonly expectedVersion: string;
  /** Actual installation metadata; not an environment echo of expectedVersion. */
  readonly appVersion: string;
  readonly platform: "darwin" | "win32";
  readonly arch: "arm64" | "x64" | "ia32";
}
export interface InstalledPayloadFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface InstalledInputsSnapshot {
  /** Absolute paths are private in-memory evidence, not public receipt fields. */
  readonly root: string;
  readonly executable: string;
  readonly runtimeDirectory: string;
  readonly manifestPath: string;
  readonly expectedVersion: string;
  readonly appVersion: string;
  readonly platform: "darwin" | "win32";
  readonly arch: "arm64" | "x64" | "ia32";
  readonly executableSha256: string;
  readonly manifestSha256: string;
  readonly payloadInventorySha256: string;
  readonly payload: readonly InstalledPayloadFile[];
  readonly payloadBytes: number;
  readonly node: Readonly<{ version: string; filename: string; sha256: string }>;
  readonly server: Readonly<{ filename: string; sha256: string }>;
  readonly plist: Readonly<{ path: string; sha256: string }> | null;
}
export function freezeInstalledInputs(options: InstalledInputsOptions): InstalledInputsSnapshot;
export function verifyInstalledInputs(snapshot: InstalledInputsSnapshot): void;
