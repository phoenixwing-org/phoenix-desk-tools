#!/usr/bin/env bash
# 手动验收 freecadcmd 批量链路（使用空环境 + 明确白名单）。
# macOS：
#   chmod +x scripts/example_run_step_batch.sh
#   编辑下面的路径后：
#   ./scripts/example_run_step_batch.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FCBIN="${FREECADCMD:-/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd}"

STEP_DIR="${STEP_DIR:?请设置 STEP_DIR}"
OUT_DIR="${OUT_DIR:?请设置 OUT_DIR}"

case "${FCBIN//\\//}" in
  */Contents/MacOS/FreeCAD)
    echo "拒绝 FreeCAD GUI launcher；请使用 FreeCAD.app/Contents/Resources/bin/freecadcmd" >&2
    exit 2
    ;;
esac
if [[ ! -f "$FCBIN" ]]; then
  echo "FreeCADCmd 不存在或不是文件：$FCBIN" >&2
  exit 2
fi
NODE_BIN="$(command -v node)"
FCBIN="$("$NODE_BIN" -e 'process.stdout.write(require("node:fs").realpathSync.native(process.argv[1]))' "$FCBIN")"
case "${FCBIN//\\//}" in
  */Contents/MacOS/FreeCAD)
    echo "拒绝 FreeCAD GUI launcher；请使用 FreeCAD.app/Contents/Resources/bin/freecadcmd" >&2
    exit 2
    ;;
esac

safe_env=()
for name in PATH HOME USER LOGNAME TMPDIR TMP TEMP LANG LC_ALL LC_CTYPE TZ __CF_USER_TEXT_ENCODING XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_RUNTIME_DIR; do
  value="${!name-}"
  if [[ -n "$value" ]]; then
    safe_env+=("$name=$value")
  fi
done

echo "—— 仅向 freecadcmd 注入系统白名单与 FCD_BATCH_* 任务变量 ——"

exec env -i \
  "${safe_env[@]}" \
  QT_QPA_PLATFORM=offscreen \
  FCD_BATCH_STEP_DIR="$STEP_DIR" \
  FCD_BATCH_OUT_DIR="$OUT_DIR" \
  FCD_BATCH_SKIP_EXISTING="${FCD_BATCH_SKIP_EXISTING:-1}" \
  FCD_BATCH_VIEW_FIT_ALL="${FCD_BATCH_VIEW_FIT_ALL:-0}" \
  FCD_BATCH_VIEW_FIT_LAST="${FCD_BATCH_VIEW_FIT_LAST:-0}" \
  FCD_BATCH_REPORT_NAME="${FCD_BATCH_REPORT_NAME:-batch_step_convert_report.md}" \
  FCD_BATCH_PROJECT_TAG="${FCD_BATCH_PROJECT_TAG:-}" \
  FCD_BATCH_STEP_RECURSIVE="${FCD_BATCH_STEP_RECURSIVE:-0}" \
  FCD_BATCH_WRITE_REPORT="${FCD_BATCH_WRITE_REPORT:-0}" \
  FCD_BATCH_VERBOSE="${FCD_BATCH_VERBOSE:-0}" \
  "$FCBIN" "$ROOT/scripts/freecad_batch_step_runner.py"
