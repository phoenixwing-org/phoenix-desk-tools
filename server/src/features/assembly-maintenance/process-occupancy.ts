import { execFileSync } from 'node:child_process';

export interface FreecadProcessOccupancy {
  state: 'clear' | 'busy' | 'unknown';
  checkedAt: string;
  platform: string;
  scope: 'current_macos_host_process_snapshot';
  reason: string;
}

const MAX_PROCESS_BYTES = 4 * 1024 * 1024;
/** Internal testing seams. Neither process output nor executable selection is an API input. */
export interface ProcessOccupancyOptions {
  platform?: string;
  snapshot?: () => string;
  now?: () => Date;
}

/** A bounded observation, NOT a whole-machine lock or proof about another host.
 * Only macOS's fixed /bin/ps invocation is supported. No arguments or raw process
 * information are exposed, and errors/truncation always prohibit replacement. */
export function inspectFreecadProcessOccupancy(options: ProcessOccupancyOptions = {}): FreecadProcessOccupancy {
  const platform = options.platform ?? process.platform;
  const checkedAt = (options.now?.() ?? new Date()).toISOString();
  const result = (state: FreecadProcessOccupancy['state'], reason: string): FreecadProcessOccupancy =>
    ({ state, checkedAt, platform, scope: 'current_macos_host_process_snapshot', reason });
  if (platform !== 'darwin') return result('unknown', 'unsupported_platform');
  let output: string;
  try {
    output = options.snapshot?.() ?? execFileSync('/bin/ps', ['-ww', '-axo', 'pid=,comm='], {
      encoding: 'utf8', timeout: 5000, maxBuffer: MAX_PROCESS_BYTES,
      stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    });
  } catch { return result('unknown', 'snapshot_unavailable'); }
  if (typeof output !== 'string' || !output || Buffer.byteLength(output) >= MAX_PROCESS_BYTES
    || !output.endsWith('\n') || /[\x00-\x08\x0b-\x1f\x7f\ufffd]/.test(output)) {
    return result('unknown', 'invalid_or_truncated_snapshot');
  }
  const seen = new Set<number>();
  let busy = false;
  for (const line of output.slice(0, -1).split('\n')) {
    const parsed = /^\s*([1-9]\d*)[ \t]+(\S(?:.*\S)?)\s*$/.exec(line);
    if (!parsed) return result('unknown', 'invalid_process_record');
    const pid = Number(parsed[1]), command = parsed[2].normalize('NFKC');
    if (!Number.isSafeInteger(pid) || seen.has(pid) || /\.\.\.|…/.test(command)) return result('unknown', 'invalid_or_truncated_record');
    seen.add(pid);
    // Include GUI, CLI, version-suffixed/renamed distributions and plausible
    // FreeCAD process-name truncations; a suspicious name is never "clear".
    if (/free[\s_.-]*cad|(?:^|[\\/])freeca$/i.test(command)) busy = true;
  }
  if (!seen.size) return result('unknown', 'empty_snapshot');
  return result(busy ? 'busy' : 'clear', busy ? 'freecad_or_suspected_process' : 'no_named_freecad_process');
}
