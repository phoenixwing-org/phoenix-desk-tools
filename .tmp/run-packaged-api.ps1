$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtime = Join-Path $repoRoot "src-tauri\target\release\runtime"
$userData = Join-Path $PSScriptRoot "release-d-user-data"
New-Item -ItemType Directory -Path $userData -Force | Out-Null

$env:CAA_SERVER_PORT = "5190"
$env:PHOENIX_PACKAGED = "1"
$env:PHOENIX_REPO_ROOT = $runtime
$env:PHOENIX_RESOURCES_DIR = $runtime
$env:PHOENIX_USER_DATA_DIR = $userData
$env:PHOENIX_NATIVE_BIN_DIR = Join-Path $runtime "bin"

$node = Join-Path $runtime "node\node.exe"
$entry = Join-Path $runtime "server\server.mjs"
$log = Join-Path $userData "packaged-api.log"
& $node $entry *>> $log
exit $LASTEXITCODE
