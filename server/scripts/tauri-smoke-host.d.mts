export interface IsolatedLaunch {
  readonly root: string; readonly runId: string; readonly userData: string; readonly registrationDirectory: string;
  readonly markerFile: string; readonly handoffFile: string; readonly quitFile: string;
  readonly environment: Readonly<Record<string, string>>;
}
export interface OwnedChild { pid?: number; exitCode: number | null; signalCode: string | null; killed: boolean }
export interface OwnedHandoff {
  readonly kind: "phoenix.desk.isolated-host-handoff"; readonly schema_version: 1; readonly profile_version: 1;
  readonly isolated_launch_version: 1;
  readonly run_id: string; readonly host_pid: number; readonly sidecar_pid: number; readonly instance_id: string;
  readonly api_origin: string; readonly api_source: "managed"; readonly runtime_user_data_dir: string;
  readonly registration_dir: string; readonly quit_request_file: "host-recovery-smoke.quit.v1.json";
}
export function createIsolatedLaunch(root: string, runId: string, parentEnvironment?: NodeJS.ProcessEnv): IsolatedLaunch;
export function verifyIsolatedLaunch(config: IsolatedLaunch): void;
export function readOwnedHandoff(config: IsolatedLaunch, child: OwnedChild, expectedVersion: string): OwnedHandoff;
export function writeOwnedQuit(config: IsolatedLaunch, child: OwnedChild, expectedVersion: string): OwnedHandoff;
export function prepareOwnedRestart(config: IsolatedLaunch, child: OwnedChild, lastHandoff: OwnedHandoff): void;
