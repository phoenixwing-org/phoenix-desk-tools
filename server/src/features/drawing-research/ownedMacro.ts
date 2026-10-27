/** Run before importing a native bridge which closes documents or its window.
 * A forwarded macro in a user's existing GUI must stop without touching it. */
export const ownedDrawingMacroGuard = String.raw`
import json as _owner_json, os as _owner_os, time as _owner_time
from pathlib import Path as _OwnerPath
_owner_started = _owner_time.monotonic()
_owner_spec = None
while _owner_time.monotonic() - _owner_started < 10:
    try:
        _owner_spec = _owner_json.loads(_OwnerPath(JOB_PATH).read_text(encoding='utf-8'))
        if isinstance(_owner_spec.get('expected_pid'), int):
            break
    except (OSError, ValueError):
        pass
    _owner_time.sleep(0.02)
if not _owner_spec or _owner_spec.get('expected_pid') != _owner_os.getpid():
    if _owner_spec and _owner_spec.get('report'):
        _OwnerPath(_owner_spec['report']).write_text(_owner_json.dumps({'status':'failed','error':'宏不属于本任务子进程，未操作用户 FreeCAD'}), encoding='utf-8')
    raise RuntimeError('宏不属于本任务子进程，未操作用户 FreeCAD')
`;
