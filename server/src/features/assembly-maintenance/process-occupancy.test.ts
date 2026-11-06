import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { inspectFreecadProcessOccupancy } from './process-occupancy.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const inspect = (output: string) => inspectFreecadProcessOccupancy({ platform: 'darwin', snapshot: () => output });

describe('bounded current-macOS process occupancy observation', () => {
  it('uses only a fixed executable and arguments without a shell', () => {
    vi.mocked(execFileSync).mockReturnValue(' 1 /sbin/launchd\n 90 /usr/bin/node\n');
    expect(inspectFreecadProcessOccupancy({ platform: 'darwin' })).toMatchObject({ state: 'clear', scope: 'current_macos_host_process_snapshot' });
    expect(execFileSync).toHaveBeenCalledWith('/bin/ps', ['-ww', '-axo', 'pid=,comm='], expect.objectContaining({ timeout: 5000, maxBuffer: 4 * 1024 * 1024 }));
  });
  it.each(['/Applications/FreeCAD.app/Contents/MacOS/FreeCAD', '/opt/bin/freecadcmd', '/tmp/Free-CAD-1', '/tmp/FreeCA'])('blocks known or suspected process %s', command => {
    const result = inspect('1 /sbin/launchd\n999 ' + command + '\n');
    expect(result.state).toBe('busy');
    expect(JSON.stringify(result)).not.toContain(command);
    expect(result).not.toHaveProperty('pid');
  });
  it.each(['', '1 /sbin/launchd', 'not a process\n', '1 /a\n1 /b\n', '0 /a\n', '1 /truncated...\n', '1 /a\n\n', '1 /bad\0name\n', '1 /bad\ufffdname\n'])('fails closed on malformed or incomplete output', output => {
    expect(inspect(output).state).toBe('unknown');
  });
  it('fails closed on snapshot failures and unknown platforms', () => {
    expect(inspectFreecadProcessOccupancy({ platform: 'darwin', snapshot: () => { throw new Error('opaque private diagnostic'); } }).state).toBe('unknown');
    const snapshot = vi.fn();
    expect(inspectFreecadProcessOccupancy({ platform: 'linux', snapshot })).toMatchObject({ state: 'unknown', reason: 'unsupported_platform' });
    expect(snapshot).not.toHaveBeenCalled();
  });
  it('fails closed on max-buffer-sized output instead of accepting a partial process list', () => {
    expect(inspect('1 ' + 'x'.repeat(4 * 1024 * 1024) + '\n').state).toBe('unknown');
  });
});
