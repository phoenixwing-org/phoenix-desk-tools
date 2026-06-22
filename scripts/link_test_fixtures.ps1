# 一键：按 launcher 勾选 + catalog，git 检出（若需要）并链接 tests/fixtures/
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

Push-Location $RepoRoot
try {
    python "$ScriptDir\link_test_fixtures.py" @args
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
