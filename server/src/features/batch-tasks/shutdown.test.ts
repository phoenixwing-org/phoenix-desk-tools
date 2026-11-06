import {afterEach, describe, expect, it, vi} from 'vitest';

// Each test gets a fresh module registry. The irreversible Host exit latch must
// never poison ordinary batch tests, and no real database/workspace is opened.
async function fixture() {
  vi.resetModules();
  const workspace = vi.fn((value: string) => value), close = vi.fn();
  vi.doMock('../../lib/fcstdBatchFiles.js', () => ({fcstdWorkspace: workspace}));
  vi.doMock('./repository.js', () => ({BatchRepository: class {close = close;}}));
  vi.doMock('./adapters.js', () => ({defaultBatchAdapters: () => [], readSubject: vi.fn(), assertActive: vi.fn()}));
  const service = await import('./service.js');
  return {...service, workspace, close};
}
afterEach(() => {
  vi.doUnmock('../../lib/fcstdBatchFiles.js'); vi.doUnmock('./repository.js'); vi.doUnmock('./adapters.js'); vi.resetModules();
});
describe('irreversible batch Host shutdown admission', () => {
  it('rejects an existing and new workspace before either lookup or construction, even after cleanup', async () => {
    const f = await fixture(), existing = f.batchTaskService('/synthetic/first');
    expect(existing).toBe(f.batchTaskService('/synthetic/first')); const lookups = f.workspace.mock.calls.length;
    f.beginBatchTaskShutdown();
    expect(() => f.batchTaskService('/synthetic/first')).toThrow('宿主正在关闭');
    expect(() => f.batchTaskService('/synthetic/second')).toThrow('宿主正在关闭');
    expect(f.workspace).toHaveBeenCalledTimes(lookups);
    const closing = f.closeBatchTaskServices();
    await expect(existing.accept('unopened', 'digest', 'request')).rejects.toThrow('服务正在关闭');
    await closing;
    expect(f.close).toHaveBeenCalledOnce(); expect(() => f.batchTaskService('/synthetic/third')).toThrow('宿主正在关闭');
  });
  it('keeps ordinary cleanup reusable, separately from the Host shutdown latch', async () => {
    const f = await fixture(); f.batchTaskService('/synthetic/ordinary'); await f.closeBatchTaskServices();
    expect(() => f.batchTaskService('/synthetic/ordinary')).not.toThrow(); await f.closeBatchTaskServices();
    expect(f.close).toHaveBeenCalledTimes(2);
    f.beginBatchTaskShutdown(); f.beginBatchTaskShutdown();
    expect(() => f.batchTaskService('/synthetic/ordinary')).toThrow('宿主正在关闭');
  });
});
