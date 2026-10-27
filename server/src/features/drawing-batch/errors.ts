/** Queue rejection happens before job registration and ticket consumption. */
export class DrawingBatchQueueError extends Error {
  readonly plan_consumed = false;
  constructor(readonly code: 'queue_busy' | 'queue_full', message: string) {
    super(message);
    this.name = 'DrawingBatchQueueError';
  }
}
