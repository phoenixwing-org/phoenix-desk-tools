#!/usr/bin/env bash
# 手动验收 freecadcmd 批量链路（必须把变量 export / 前缀到同一进程中）。
# macOS：
#   chmod +x scripts/example_run_step_batch.sh
#   编辑下面的路径后：
#   ./scripts/example_run_step_batch.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FCBIN="${FREECADCMD:-/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd}"

STEP_DIR="${STEP_DIR:?请设置 STEP_DIR}"
OUT_DIR="${OUT_DIR:?请设置 OUT_DIR}"

export FCD_BATCH_STEP_DIR="$STEP_DIR"
export FCD_BATCH_OUT_DIR="$OUT_DIR"
export FCD_BATCH_SKIP_EXISTING="${FCD_BATCH_SKIP_EXISTING:-1}"
export FCD_BATCH_VIEW_FIT_ALL="${FCD_BATCH_VIEW_FIT_ALL:-0}"
export FCD_BATCH_VIEW_FIT_LAST="${FCD_BATCH_VIEW_FIT_LAST:-0}"
export FCD_BATCH_REPORT_NAME="${FCD_BATCH_REPORT_NAME:-batch_step_convert_report.md}"
export FCD_BATCH_PROJECT_TAG="${FCD_BATCH_PROJECT_TAG:-}"

echo "—— 环境变量已注入当前 shell，将由 freecadcmd 子进程继承 ——"
declare -p FCD_BATCH_STEP_DIR FCD_BATCH_OUT_DIR FCD_BATCH_SKIP_EXISTING

exec "$FCBIN" "$ROOT/scripts/freecad_batch_step_runner.py"
