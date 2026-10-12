import type { Buffer } from "node:buffer";

export interface RecoveryFixture {
  readonly root: string;
  readonly workspace: string;
  readonly other: string;
  readonly payloads: ReadonlyMap<string, Buffer>;
  unchanged(): void;
  compare(directory: string): void;
}
export interface RecoveryJourneyResponse {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}
export interface RecoveryJourneyAdapters {
  readonly fixture: RecoveryFixture;
  readonly request: (route: string, body?: Readonly<Record<string, unknown>>, headers?: Readonly<Record<string, string>>) => Promise<RecoveryJourneyResponse>;
  readonly setWorkspace: (workspace: string) => Promise<void>;
  readonly restart: () => Promise<void>;
}
export function createRecoveryFixture(ownedRoot: string): RecoveryFixture;
/** Thirteen checks; the caller adds its separately proven owned shutdown check. */
export function runRecoveryJourney(adapters: RecoveryJourneyAdapters): Promise<string[]>;
