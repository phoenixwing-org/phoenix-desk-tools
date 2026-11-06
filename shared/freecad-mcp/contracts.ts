/** Settings observations and explicit host operations, never CAD write authority. */
import type {OwnedWorkerObservation} from './worker.js';
export const FREECAD_MCP_SETTINGS_VERSION = 1 as const;
export type FreecadMcpSettings = {
  mode: 'owned_batch' | 'existing';
  mod_directory: string;
  /** User has checked this exact directory in FreeCAD; not a runtime attestation. */
  mod_directory_confirmed: boolean;
  existing_port: number;
};
export type FreecadMcpConnection = {
  state: 'not_checked' | 'blocked' | 'failed' | 'ready';
  phase: 'none' | 'bridge' | 'mcp';
  reason: string;
  bridge_version: string | null;
  supported_methods: string[];
  /** A JSON bridge observation alone never establishes MCP readiness. */
  mcp_verified: boolean;
};
export type FreecadMcpStatus = {
  schema_version: 1;
  revision: string;
  settings: FreecadMcpSettings;
  freecad: { state: 'available' | 'unavailable'; executable: string | null; reason: string };
  mod_directory: { state: 'unselected' | 'unsafe' | 'missing' | 'filesystem_checked'; evidence: 'none' | 'user_confirmed'; reason: string };
  installation: { state: 'not_checked' | 'absent' | 'managed' | 'unmanaged' | 'modified' | 'invalid'; version: string | null; reason: string };
  resource: { state: 'missing' | 'invalid' | 'ready'; version: string | null; reason: string };
  connection: FreecadMcpConnection;
  batch: { state: 'blocked'; reason: string };
  /** Explicit host-gated candidate control only; not batch-task authority. */
  owned_worker?: {enabled: boolean; reason: string; observation: OwnedWorkerObservation};
};
export type FreecadMcpInstallPlan = {
  state: 'blocked' | 'ready';
  reason: string;
  plan_id?: string;
  expires_at?: string;
  operation?: 'install' | 'update' | 'unchanged';
  source_version?: string;
  source_digest?: string;
  target?: string;
  backup_parent?: string;
  changes?: { path: string; kind: 'add' | 'change' | 'remove' }[];
};
export type FreecadMcpInstallResult = {
  state: 'installed' | 'unchanged';
  backup: string | null;
  restart_required: boolean;
  status: FreecadMcpStatus;
};
