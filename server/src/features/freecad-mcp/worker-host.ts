import {OwnedWorkerManagerError, OwnedWorkerSessionManager, type OwnedWorkerStartInput} from './worker-manager.js';

/** One host-owned capability. Requests cannot construct a manager, choose a
 * namespace, or recover a process from an observation. */
export class OwnedWorkerHost {
  private shuttingDown = false;
  private closing?: Promise<void>;
  constructor(private readonly manager: Pick<OwnedWorkerSessionManager, 'start' | 'status' | 'stop'> = new OwnedWorkerSessionManager()) {}
  get stopping(): boolean { return this.shuttingDown; }
  status() { return this.manager.status(); }
  start(input: OwnedWorkerStartInput) {
    const previous = this.manager.status();
    if (this.shuttingDown || previous.phase === 'unknown' || previous.reason_code === 'cleanup_failed') throw new OwnedWorkerManagerError('manager_busy');
    return this.manager.start(input);
  }
  stop(id: string) { return this.manager.stop(id); }
  /** Synchronously closes admission before starting any asynchronous cleanup.
   * The manager promise retains its reservation until the actual owned close. */
  close(): Promise<void> {
    this.shuttingDown = true;
    return this.closing ??= (async () => {
      const current = this.manager.status();
      if (current.owned && current.id) await this.manager.stop(current.id);
      const final = this.manager.status();
      if (final.owned || final.phase === 'unknown' || final.reason_code === 'cleanup_failed') throw new Error('owned_worker_close_unconfirmed');
    })();
  }
}

export const ownedWorkerHost = new OwnedWorkerHost();

/** Never short-circuit a sibling cleanup, and never turn a failed cleanup into
 * permission to close the HTTP server or exit. No gate files are removed here. */
export async function closeFreecadHostServices(closeBatch: () => Promise<void>, worker: OwnedWorkerHost = ownedWorkerHost): Promise<void> {
  const ownedClosing = worker.close(); // Admission is already closed below.
  let batchClosing: Promise<void>;
  try { batchClosing = closeBatch(); } catch (error) { batchClosing = Promise.reject(error); }
  const outcomes = await Promise.allSettled([ownedClosing, batchClosing]);
  if (outcomes.some(result => result.status === 'rejected')) throw new Error('host_execution_close_unconfirmed');
}
