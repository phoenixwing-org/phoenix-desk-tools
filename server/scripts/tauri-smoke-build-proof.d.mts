import type { InstalledInputsSnapshot, InstalledPayloadFile } from "./tauri-smoke-inputs.mjs";
export interface BuildInputs {
  readonly root: string;
  readonly version: string;
  readonly productName: string;
  readonly files: readonly InstalledPayloadFile[];
  readonly digestSha256: string;
  readonly sourceDirtyAllowed: true;
}
export interface ControlledBuild {
  readonly command: "cargo";
  readonly args: readonly string[];
  readonly exitCode: 0;
  readonly outputDirectory: string;
  readonly installRoot: string;
  readonly executable: string;
  readonly appVersion: string;
}
export interface BuildProofEvidence {
  readonly proofSha256: string;
  readonly profileVersion: 1;
  readonly isolatedLaunchVersion: 1;
  readonly appVersion: string;
  readonly platform: "darwin";
  readonly arch: "arm64" | "x64";
  readonly sourceDigestSha256: string;
}
export const CONTROLLED_CARGO_ARGS: readonly string[];
export const CONTROLLED_TAURI_CONFIG: string;
export function captureBuildInputs(repoRoot: string): BuildInputs;
export function verifyBuildInputs(inputs: BuildInputs): void;
export function runControlledCargoBuild(inputs: BuildInputs, ownedOutputDirectory: string): ControlledBuild;
export function recordBuildProof(options: { repoRoot: string; proofPath: string; snapshot: InstalledInputsSnapshot; inputs: BuildInputs; build: ControlledBuild }): BuildProofEvidence;
export function verifyBuildProof(options: { repoRoot: string; proofPath: string; snapshot: InstalledInputsSnapshot }): BuildProofEvidence;
