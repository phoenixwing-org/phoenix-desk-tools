import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {OwnedWorkerObservation, OwnedWorkerPhase, OwnedWorkerReason} from '../../../../shared/freecad-mcp/worker.js';
import {checkedDirectory, type PinnedResource} from './resource.js';
import {ThumbnailWorkerClientError, type ThumbnailWorkerClient} from './worker-client.js';
import {OwnedThumbnailWorkerError, withOwnedThumbnailWorker, type OwnedThumbnailWorkerSession} from './worker-session.js';

export type {OwnedWorkerObservation} from '../../../../shared/freecad-mcp/worker.js';
/** Host-only, already-resolved inputs; never use this as an HTTP request DTO. */
export interface OwnedWorkerStartInput {
  resource: PinnedResource;
  executable: string;
  configurationRevision: string;
}
/** Construction/test seams only. No execution gate, namespace, launch arguments,
 * process adoption, URL, or resource path can be supplied by a request. The
 * factory has the same actual-close contract as withOwnedThumbnailWorker. */
export interface OwnedWorkerManagerHost {
  withOwned?: typeof withOwnedThumbnailWorker;
  createProfileParent?: () => string | Promise<string>;
}
export type OwnedWorkerManagerErrorCode = 'manager_busy' | 'manager_uncertain' | 'invalid_start' | 'invalid_session_id' | 'session_not_current'
  | 'session_not_ready' | 'session_busy' | 'session_lost' | 'session_not_reusable' | 'session_cancelled';
export class OwnedWorkerManagerError extends Error {
  constructor(readonly code: OwnedWorkerManagerErrorCode) {
    super('自有缩略图会话未能执行该操作：' + code + '；未接管其他实例、排入新队列或自动重启');
    this.name = 'OwnedWorkerManagerError';
  }
}
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const messages: Record<OwnedWorkerReason, string> = {
  not_started: '尚未显式启动自有缩略图会话。',
  launching: '正在启动独立自有会话；尚未证明 worker 就绪。',
  worker_ready: '自有会话已就绪；尚未租用，不代表任何 CAD 任务已完成。',
  session_leased: '现有调度器正在独占租用此会话；不会另行排队。',
  stop_requested: '正在停止；等待租用回调收口与底层自有会话实际关闭。',
  stopped_after_owned_close: '本次自有 lifetime 已结束；未恢复任何历史会话能力。',
  startup_failed: '本次启动失败，底层 lifetime 已结束；不会自动重启。',
  session_lost: '自有会话意外失联；不再接受租用，正在或已完成清理。',
  session_not_reusable: 'worker 未能证明已回到同身份空闲状态；不再接受租用。',
  cleanup_failed: '本次 lifetime 的结束结果未确认；不会假称停止或自动重放。',
};
const fail = (code: OwnedWorkerManagerErrorCode): never => { throw new OwnedWorkerManagerError(code); };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return {promise, resolve};
};
type Completion = ReturnType<typeof deferred>;
type Active = {
  id: string;
  revision: string;
  controller: AbortController;
  wake: Completion;
  completion: Promise<void>;
  session?: OwnedThumbnailWorkerSession;
  lease?: Completion;
  stopRequested: boolean;
  reachedReady: boolean;
  fault?: 'session_lost' | 'session_not_reusable';
  observation: OwnedWorkerObservation;
};
const observation = (id: string | null, revision: string | null, phase: OwnedWorkerPhase, reason: OwnedWorkerReason, owned: boolean): OwnedWorkerObservation =>
  Object.freeze({schema_version: 1, id, phase, reason_code: reason, message: messages[reason], owned, configuration_revision: revision});
const defaultProfileParent = () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-owned-thumbnail-worker-')));
  fs.chmodSync(parent, 0o700);
  return parent;
};
function claimProfile(parent: string, id: string, revision: string): string {
  const canonical = checkedDirectory(parent), stat = fs.lstatSync(canonical);
  if (canonical !== parent || typeof process.getuid !== 'function' || stat.uid !== process.getuid()
    || (stat.mode & 0o777) !== 0o700 || fs.readdirSync(parent).length !== 0) throw new Error('unsafe_fresh_profile_parent');
  // Keep the private profile/claim as local evidence. Never recursively remove
  // an untrusted profile, and never reuse a previous manager's parent.
  const fd = fs.openSync(path.join(parent, '.desk-owned-worker-manager.json'), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({schema_version: 1, id, configuration_revision: revision}) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  const directory = fs.openSync(parent, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  return path.join(parent, 'profile');
}
function cancelledStartup(error: unknown): boolean {
  return error instanceof OwnedThumbnailWorkerError && ['cancelled_before_launch', 'cancelled_before_prepare', 'cancelled_before_native',
    'cancelled_during_spawn', 'startup_cancelled', 'cancelled_before_mcp', 'worker_not_ready'].includes(error.code)
    || error instanceof ThumbnailWorkerClientError && error.code === 'worker_cancelled';
}

/** Host-only primitive: one explicit owned lifetime and one immediate borrower.
 * Wrappers handle settings/HTTP/UI; this class never accepts request bodies or
 * creates a batch queue, and discovers/adopts no existing process.
 * Only withOwnedThumbnailWorker owns/kills children and acquires the existing
 * fixed shared execution gate. status() is strictly an in-memory observation. */
export class OwnedWorkerSessionManager {
  private readonly factory: typeof withOwnedThumbnailWorker;
  private readonly profileParent: () => string | Promise<string>;
  private active: Active | undefined;
  private last: OwnedWorkerObservation = observation(null, null, 'idle', 'not_started', false);

  constructor(host: OwnedWorkerManagerHost = {}) {
    if (Object.keys(host).some(key => !['withOwned', 'createProfileParent'].includes(key))
      || host.withOwned !== undefined && typeof host.withOwned !== 'function'
      || host.createProfileParent !== undefined && typeof host.createProfileParent !== 'function') fail('invalid_start');
    this.factory = host.withOwned ?? withOwnedThumbnailWorker;
    this.profileParent = host.createProfileParent ?? defaultProfileParent;
  }

  status(): OwnedWorkerObservation { return {...(this.active?.observation ?? this.last)}; }

  start(input: OwnedWorkerStartInput): OwnedWorkerObservation {
    if (this.active) return fail('manager_busy');
    // Promise settlement alone is not a successful cleanup proof. This terminal
    // unknown is irreversible for this manager: observations and same-ID stop
    // remain metadata only, and neither can clear a gate or authorize a restart.
    if (this.last.phase === 'unknown') return fail('manager_uncertain');
    if (!input || Object.keys(input).some(key => !['resource', 'executable', 'configurationRevision'].includes(key))
      || typeof input.configurationRevision !== 'string' || !HASH.test(input.configurationRevision) || typeof input.executable !== 'string' || !path.isAbsolute(input.executable)
      || path.resolve(input.executable) !== input.executable || !input.resource) return fail('invalid_start');
    let resource: PinnedResource;
    try {
      resource = structuredClone(input.resource);
      Object.freeze(resource.files); Object.freeze(resource);
    } catch { return fail('invalid_start'); }
    const id = randomUUID(), revision = input.configurationRevision;
    const active: Active = {id, revision, controller: new AbortController(), wake: deferred(), completion: Promise.resolve(),
      stopRequested: false, reachedReady: false, observation: observation(id, revision, 'starting', 'launching', true)};
    const snapshot = {resource, executable: input.executable, configurationRevision: revision};
    this.active = active;
    active.completion = Promise.resolve().then(() => this.run(active, snapshot));
    return this.status();
  }

  async stop(id: string): Promise<OwnedWorkerObservation> {
    this.assertId(id);
    const active = this.active;
    if (!active) {
      if (this.last.id === id) return this.status(); // Metadata only; no capability restored.
      return fail('session_not_current');
    }
    if (active.id !== id) return fail('session_not_current');
    if (!active.stopRequested) {
      active.stopRequested = true;
      if (!active.fault) this.update(active, 'stopping', 'stop_requested');
      active.controller.abort();
      active.wake.resolve();
    }
    await active.completion;
    return {...active.observation};
  }

  async withReadySession<T>(id: string, callback: (session: OwnedThumbnailWorkerSession) => Promise<T>): Promise<T> {
    this.assertId(id);
    const active = this.active;
    if (!active || active.id !== id) return fail('session_not_current');
    if (active.lease) return fail('session_busy');
    if (!active.session || active.observation.phase !== 'ready' || active.controller.signal.aborted) return fail('session_not_ready');
    if (typeof callback !== 'function') return fail('session_not_ready');
    const session = active.session, lease = deferred();
    active.lease = lease;
    this.update(active, 'leased', 'session_leased');
    const borrower = new AbortController(), onAbort = () => borrower.abort();
    active.controller.signal.addEventListener('abort', onAbort, {once: true});
    let leaseOpen = true;
    const assertLease = () => {
      if (!leaseOpen || active.lease !== lease || active.session !== session || borrower.signal.aborted) fail('session_not_ready');
    };
    // A retained callback reference must not bypass the next exclusive lease.
    // The raw client and its long-lived transport signal never escape here.
    const scopedClient: ThumbnailWorkerClient = {
      async status() { assertLease(); return await session.client.status(); },
      async render(input) { assertLease(); return await session.client.render(input); },
      async get(input) { assertLease(); return await session.client.get(input); },
      async cancel(input) { assertLease(); return await session.client.cancel(input); },
    };
    const borrowed: OwnedThumbnailWorkerSession = Object.freeze({identity: session.identity, signal: borrower.signal, client: Object.freeze(scopedClient)});
    let result!: T, error: unknown, rejected = false;
    try {
      result = await callback(borrowed);
    } catch (caught) { error = caught; rejected = true; }
    finally { leaseOpen = false; borrower.abort(); active.controller.signal.removeEventListener('abort', onAbort); }
    try {
      // Returning from a callback is not proof its job reached terminal/closed.
      // Keep the lease while checking the same worker before lending it again.
      if (!active.controller.signal.aborted) {
        try {
          const state = await session.client.status();
          if (state.worker_id !== session.identity.workerId || state.session_id !== session.identity.sessionId
            || state.state !== 'ready' || state.active_job_id !== null || session.signal.aborted) throw new Error('not_idle');
        } catch {
          if (!active.controller.signal.aborted) this.fault(active, 'session_not_reusable');
          if (!rejected) { rejected = true; error = new OwnedWorkerManagerError(active.fault ?? 'session_cancelled'); }
        }
      }
      if (active.fault && !rejected) { rejected = true; error = new OwnedWorkerManagerError(active.fault); }
      if (active.controller.signal.aborted && !rejected) { rejected = true; error = new OwnedWorkerManagerError('session_cancelled'); }
    } finally {
      active.lease = undefined;
      lease.resolve();
      if (!active.controller.signal.aborted && !active.fault) this.update(active, 'ready', 'worker_ready');
    }
    if (rejected) throw error;
    return result;
  }

  private assertId(id: string): void { if (typeof id !== 'string' || !UUID.test(id)) fail('invalid_session_id'); }
  private update(active: Active, phase: OwnedWorkerPhase, reason: OwnedWorkerReason): void {
    active.observation = observation(active.id, active.revision, phase, reason, true);
  }
  private fault(active: Active, reason: 'session_lost' | 'session_not_reusable'): void {
    active.fault ??= reason;
    this.update(active, 'unknown', active.fault);
    active.controller.abort();
    active.wake.resolve();
  }
  private async run(active: Active, input: OwnedWorkerStartInput): Promise<void> {
    let failed = false, error: unknown, factoryStarted = false;
    try {
      if (!active.stopRequested) {
        const parent = await this.profileParent();
        if (!active.stopRequested) {
          const profile = claimProfile(parent, active.id, active.revision);
          factoryStarted = true;
          await this.factory({resource: input.resource, executable: input.executable, profile, signal: active.controller.signal}, async owned => {
            if (active.session) throw new Error('duplicate_owned_session');
            // Private transport identity never crosses the observation boundary.
            const onLost = () => { if (!active.stopRequested) this.fault(active, 'session_lost'); };
            owned.signal.addEventListener('abort', onLost, {once: true});
            const session: OwnedThumbnailWorkerSession = Object.freeze({identity: Object.freeze({...owned.identity}),
              client: owned.client, signal: active.controller.signal});
            active.session = session;
            try {
              if (owned.signal.aborted) onLost();
              if (!active.controller.signal.aborted) {
                active.reachedReady = true;
                this.update(active, 'ready', 'worker_ready');
              }
              await active.wake.promise;
              // Abort is a request, not callback completion or child-close proof.
              await active.lease?.promise;
            } finally { owned.signal.removeEventListener('abort', onLost); }
          });
        }
      }
    } catch (caught) { failed = true; error = caught; }
    if (active.reachedReady && !active.stopRequested && !active.fault) this.fault(active, 'session_lost');
    // A bad injected factory cannot release a live borrower even if it settles
    // early. The production factory does not return until both actual closes.
    if (active.lease) {
      this.fault(active, 'session_lost');
      await active.lease.promise;
    }
    active.controller.abort();
    let phase: OwnedWorkerPhase, reason: OwnedWorkerReason;
    if (failed && active.reachedReady) { phase = 'unknown'; reason = 'cleanup_failed'; }
    else if (active.fault) { phase = 'failed'; reason = active.fault; }
    else if (active.stopRequested && (!failed || !factoryStarted || cancelledStartup(error))) { phase = 'stopped'; reason = 'stopped_after_owned_close'; }
    else if (active.stopRequested && failed) { phase = 'unknown'; reason = 'cleanup_failed'; }
    else { phase = 'failed'; reason = 'startup_failed'; }
    active.session = undefined;
    active.observation = observation(active.id, active.revision, phase, reason, false);
    this.last = active.observation;
    if (this.active === active) this.active = undefined;
  }
}
