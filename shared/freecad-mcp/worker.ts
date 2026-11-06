/** Read-only observations. These records never restore a process capability. */
export type OwnedWorkerPhase = 'idle' | 'starting' | 'ready' | 'leased' | 'stopping' | 'stopped' | 'failed' | 'unknown';
export type OwnedWorkerReason = 'not_started' | 'launching' | 'worker_ready' | 'session_leased' | 'stop_requested'
  | 'stopped_after_owned_close' | 'startup_failed' | 'session_lost' | 'session_not_reusable' | 'cleanup_failed';
export interface OwnedWorkerObservation {
  schema_version: 1;
  /** Manager UUID, not a Native PID, URL, worker ID, or transport session ID. */
  id: string | null;
  phase: OwnedWorkerPhase;
  reason_code: OwnedWorkerReason;
  message: string;
  /** The manager still owns responsibility for its reservation/lifetime. This
   * does not attest Native readiness (it is also true while starting/stopping). */
  owned: boolean;
  configuration_revision: string | null;
}
