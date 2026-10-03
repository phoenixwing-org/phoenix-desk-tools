# Server engine adapters

This directory contains platform engine adapters launched and supervised by Node services. They do
not implement HTTP routes or workspace preference logic.

## `sw-step-export.ps1`

`server/src/lib/pnwSwStepExportService.ts` writes a JSON job and launches this PowerShell adapter on
Windows. The adapter attaches to or starts `SldWorks.Application`, exports `.sldprt` and `.sldasm`
models to STEP, and returns a JSON result. Documents that were already open before the job are left
open; documents opened by the adapter are closed after export.

STEP Batch uses `scripts/freecad_batch_step_runner.py` and `scripts/freecad_batch_step_fc.py` at the
repository root. Those files execute inside FreeCADCmd because FreeCAD exposes STEP import and FCStd
creation through its Python API. Node still owns the corresponding HTTP, preferences, validation,
preview, launch, and result parsing behavior. Node resolves the internal command by real path, rejects
the macOS GUI launcher, starts it with a system/adapter environment allowlist, redacts child output,
and caps retained logs. Run `pnpm verify:freecad-security` at the repository root after changing this
boundary.
