# One-shot dev setup: Python venv + [web] deps + pnpm install
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\setup_dev.ps1
#   scripts\setup_dev.bat
# Options:
#   -SolidWorks    also install pywin32 (SolidWorks optional extra)
#   -SkipPnpm      Python only; skip Node/pnpm
#   -RecreateVenv  delete existing .venv-desktop and recreate

param(
    [switch]$SolidWorks,
    [switch]$SkipPnpm,
    [switch]$RecreateVenv
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$VenvDir = Join-Path $RepoRoot ".venv-desktop"
$PyInVenv = Join-Path $VenvDir "Scripts\python.exe"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Find-SystemPython {
    $candidates = @(
        @{ Cmd = "py"; Args = @("-3") },
        @{ Cmd = "python"; Args = @() },
        @{ Cmd = "python3"; Args = @() }
    )
    foreach ($item in $candidates) {
        $cmd = Get-Command $item.Cmd -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        try {
            $verText = & $item.Cmd @($item.Args + "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
            if ($LASTEXITCODE -ne 0 -and $item.Cmd -eq "py") { continue }
            $parts = $verText.Trim().Split(".")
            $major = [int]$parts[0]
            $minor = [int]$parts[1]
            if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 10)) {
                Write-Host "Skipping $($item.Cmd): need Python 3.10+ (got $verText)" -ForegroundColor DarkYellow
                continue
            }
            $launch = @{ Cmd = $item.Cmd; Args = @($item.Args) }
            $display = & $item.Cmd @($item.Args + "--version")
            return @{ Launch = $launch; Display = $display }
        } catch {
            continue
        }
    }
    return $null
}

function Ensure-Pnpm {
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($pnpm) { return $pnpm.Source }

    Write-Host "pnpm not found; trying corepack enable ..." -ForegroundColor DarkYellow
    $corepack = Get-Command corepack -ErrorAction SilentlyContinue
    if (-not $corepack) {
        throw @"
pnpm not found. Install Node.js LTS first, then run:
  corepack enable
  corepack prepare pnpm@latest --activate
Or: npm install -g pnpm
See README.md (install section)
"@
    }
    & corepack enable
    & corepack prepare pnpm@latest --activate
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpm) {
        throw "corepack did not enable pnpm. Try: npm install -g pnpm"
    }
    return $pnpm.Source
}

Write-Host "Phoenix dev environment setup"
Write-Host "Repo: $RepoRoot"

Write-Step "Check Python 3.10+"
$sysPy = Find-SystemPython
if (-not $sysPy) {
    throw "Python 3.10+ not found. Install from https://www.python.org/downloads/ (check Add to PATH)."
}
Write-Host "Using: $($sysPy.Display)"

Write-Step "Virtual env .venv-desktop"
if ($RecreateVenv -and (Test-Path $VenvDir)) {
    Write-Host "Removing existing $VenvDir"
    Remove-Item -Recurse -Force $VenvDir
}
if (-not (Test-Path $PyInVenv)) {
    $venvArgs = @("-m", "venv", $VenvDir)
    if ($sysPy.Launch.Cmd -eq "py") {
        & py -3 @venvArgs
    } else {
        & $sysPy.Launch.Cmd @($sysPy.Launch.Args + $venvArgs)
    }
    if (-not (Test-Path $PyInVenv)) {
        throw "Failed to create venv: $VenvDir"
    }
} else {
    Write-Host "Already exists; skip create (use -RecreateVenv to rebuild)"
}

Write-Step "Install Python deps [web]"
& $PyInVenv -m pip install -U pip
$extras = "web"
if ($SolidWorks) { $extras = "web,windows-solidworks" }
Push-Location $RepoRoot
try {
    & $PyInVenv -m pip install -e ".[$extras]"
} finally {
    Pop-Location
}
& $PyInVenv -c "import fastapi, uvicorn; print('fastapi + uvicorn OK')"

if (-not $SkipPnpm) {
    Write-Step "Check Node.js / pnpm"
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "node not found. Install Node.js LTS: https://nodejs.org/`nSee README.md (install section)"
    }
    Write-Host "Node: $(node -v)"
    $null = Ensure-Pnpm
    Write-Host "pnpm: $(pnpm -v)"

    Write-Step "pnpm install (web-ui)"
    Push-Location $RepoRoot
    try {
        & pnpm install
        if ($LASTEXITCODE -ne 0) { throw "pnpm install failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
    if (-not (Test-Path (Join-Path $RepoRoot "web-ui\node_modules\vite"))) {
        throw "web-ui/node_modules incomplete; re-run pnpm install"
    }
    Write-Host "vite OK"
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ""
Write-Host "Activate venv (PowerShell):"
Write-Host "  .\.venv-desktop\Scripts\Activate.ps1"
Write-Host ""
Write-Host "Run:"
Write-Host "  python -m phoenix.web --dev    # dev (hot reload)"
Write-Host "  python -m phoenix.web          # production static + API"
Write-Host "  python -m phoenix              # desktop launcher (needs tkinter)"
Write-Host ""
Write-Host "Docs: README.md"
