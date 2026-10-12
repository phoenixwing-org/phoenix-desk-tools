[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [string]$ReceiptPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "The Windows release gate must run on Windows"
}

# Intentionally fail closed before reads, builds, installation, cleanup, or receipts.
# The native Windows isolation profile still lacks file-ID and ACL ownership proof.
# SkipBuild/ReceiptPath do not bypass this gate. Keep the installer carry below
# unreachable until isolation and the current installed-app contract are verified.
throw "WINDOWS_ISOLATION_UNSUPPORTED: native Windows file-ID and ACL ownership checks are not implemented. Build/install/uninstall and passed receipts are disabled; no installer or application will be started."

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Package = Get-Content (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
$TauriConfig = Get-Content (Join-Path $RepoRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$CargoToml = Get-Content (Join-Path $RepoRoot "src-tauri\Cargo.toml") -Raw
$Version = [string]$Package.version
$CargoVersionMatch = [regex]::Match($CargoToml, '(?ms)^\[package\].*?^version\s*=\s*"([^"]+)"')

function Assert-Condition([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Invoke-Checked([string]$File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$File exited with code $LASTEXITCODE"
    }
}

function Get-PhoenixUninstallEntries {
    $Roots = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
    )
    $Entries = @()
    foreach ($Root in $Roots) {
        if (-not (Test-Path $Root)) { continue }
        $Entries += Get-ChildItem $Root -ErrorAction SilentlyContinue |
            ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
            Where-Object { [string]$_.DisplayName -like "Phoenix Desktop Tools*" }
    }
    return @($Entries)
}

function Get-PhoenixShortcuts {
    $Roots = @(
        [Environment]::GetFolderPath("StartMenu"),
        [Environment]::GetFolderPath("CommonStartMenu")
    ) | Where-Object { $_ } | Select-Object -Unique
    $Shortcuts = @()
    foreach ($Root in $Roots) {
        if (-not (Test-Path $Root)) { continue }
        $Shortcuts += Get-ChildItem $Root -Filter "*.lnk" -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.BaseName -like "Phoenix Desktop Tools*" }
    }
    return @($Shortcuts)
}

function Wait-Until([scriptblock]$Predicate, [int]$TimeoutSeconds, [string]$FailureMessage) {
    $Deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $Deadline) {
        if (& $Predicate) { return }
        Start-Sleep -Milliseconds 250
    }
    throw $FailureMessage
}

Assert-Condition ($Version -eq [string]$TauriConfig.version) "package.json and tauri.conf.json versions differ"
Assert-Condition $CargoVersionMatch.Success "cannot read the Cargo package version"
Assert-Condition ($Version -eq $CargoVersionMatch.Groups[1].Value) "package.json and Cargo.toml versions differ"
Assert-Condition ($Version -eq "0.5.0") "this gate expects the current Desk Tools 0.5.0 candidate"

$BundleDir = Join-Path $RepoRoot "src-tauri\target\release\bundle\nsis"
$TempRoot = Join-Path ([IO.Path]::GetTempPath()) ("phoenix-nsis-smoke-" + [Guid]::NewGuid().ToString("N"))
$InstallRoot = Join-Path $TempRoot "app"
$SmokeReceipt = Join-Path $TempRoot "installed-app-smoke.json"
$Installer = $null
$Uninstaller = $null
$Uninstalled = $false

try {
    New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
    if (-not $SkipBuild) {
        Push-Location $RepoRoot
        try {
            Invoke-Checked "cargo" @("tauri", "build", "--bundles", "nsis", "--ci")
        }
        finally {
            Pop-Location
        }
    }

    $Installers = @(Get-ChildItem $BundleDir -Filter "*.exe" -File -ErrorAction Stop |
        Where-Object { $_.Name -like "*$Version*setup.exe" })
    Assert-Condition ($Installers.Count -eq 1) "expected exactly one current $Version NSIS setup, found $($Installers.Count)"
    $Installer = $Installers[0]
    Assert-Condition ($Installer.Name -notlike "*0.1.0*") "historical 0.1.0 installer cannot satisfy the current gate"

    $InstallerHash = (Get-FileHash $Installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $InstallerSignature = Get-AuthenticodeSignature $Installer.FullName
    $InstallProcess = Start-Process -FilePath $Installer.FullName -ArgumentList @("/S", "/D=$InstallRoot") -Wait -PassThru
    Assert-Condition ($InstallProcess.ExitCode -eq 0) "NSIS install exited with code $($InstallProcess.ExitCode)"
    Assert-Condition (Test-Path $InstallRoot -PathType Container) "NSIS did not create the requested install directory"

    $ExecutableCandidates = @(Get-ChildItem $InstallRoot -Filter "*.exe" -File -Recurse |
        Where-Object { $_.Name -match '^(phoenix-desktop|Phoenix Desktop Tools)\.exe$' })
    Assert-Condition ($ExecutableCandidates.Count -eq 1) "expected one installed Phoenix executable, found $($ExecutableCandidates.Count)"
    $Executable = $ExecutableCandidates[0]
    $ExecutableProductVersion = $Executable.VersionInfo.ProductVersion
    Assert-Condition ($ExecutableProductVersion -like "$Version*") "installed executable version is not $Version"
    $ExecutableHash = (Get-FileHash $Executable.FullName -Algorithm SHA256).Hash.ToLowerInvariant()

    $UninstallCandidates = @(Get-ChildItem $InstallRoot -Filter "*.exe" -File -Recurse |
        Where-Object { $_.Name -match '(?i)uninstall' })
    Assert-Condition ($UninstallCandidates.Count -eq 1) "expected one NSIS uninstaller, found $($UninstallCandidates.Count)"
    $Uninstaller = $UninstallCandidates[0]

    $RegistryEntries = @(Get-PhoenixUninstallEntries |
        Where-Object { [string]$_.DisplayVersion -like "$Version*" })
    Assert-Condition ($RegistryEntries.Count -ge 1) "current $Version uninstall registration is missing"
    $Shortcuts = @(Get-PhoenixShortcuts)
    Assert-Condition ($Shortcuts.Count -ge 1) "Phoenix Desktop Tools Start Menu shortcut is missing"

    $env:PHOENIX_TAURI_EXECUTABLE = $Executable.FullName
    $env:PHOENIX_TAURI_INSTALL_ROOT = $InstallRoot
    $env:PHOENIX_TAURI_EXPECTED_VERSION = $Version
    $env:PHOENIX_TAURI_RECEIPT_PATH = $SmokeReceipt
    Push-Location $RepoRoot
    try {
        Invoke-Checked "node" @("server/scripts/smoke-tauri-release-app.mjs")
    }
    finally {
        Pop-Location
    }
    Assert-Condition (Test-Path $SmokeReceipt -PathType Leaf) "installed app smoke did not write its receipt"
    $AppSmoke = Get-Content $SmokeReceipt -Raw | ConvertFrom-Json
    Assert-Condition ($AppSmoke.kind -eq "phoenix.desk.tauri-release-app-smoke" -and $AppSmoke.schemaVersion -eq 2) "installed app smoke receipt is not the current schema"
    Assert-Condition ($AppSmoke.platform -like "win32-*") "installed app smoke did not run on Windows"
    Assert-Condition ($AppSmoke.appVersion -eq $Version) "installed app smoke version does not match the release"
    Assert-Condition ($AppSmoke.binarySha256 -eq $ExecutableHash) "installed app smoke executable does not match the installed binary"
    Assert-Condition ($AppSmoke.health.status -eq "ok" -and $AppSmoke.health.service -eq "phoenix-node" -and $AppSmoke.health.protocol_version -eq 1) "installed app health check did not pass"
    Assert-Condition ($AppSmoke.userDataIsolated -eq $true) "installed app user data was not isolated"
    Assert-Condition ($AppSmoke.cadRuntime -eq "typescript") "installed CAD runtime is not TypeScript"
    foreach ($Flow in @("launch", "workspaceActivation", "runtimeResources", "retiredCodeRoutes404", "realFcstdRead", "gracefulExit", "sidecarReleased")) {
        Assert-Condition ($AppSmoke.flows.$Flow -eq $true) "installed app smoke flow did not pass: $Flow"
    }
    $RetiredRouteChecks = @($AppSmoke.retiredCodeRoutes)
    Assert-Condition ($RetiredRouteChecks.Count -eq 30) "installed app smoke did not check all 30 retired Code routes"
    Assert-Condition (@($RetiredRouteChecks | Where-Object { $_.status -ne 404 }).Count -eq 0) "a retired Code route did not return HTTP 404"
    $RetiredRouteKeys = @($RetiredRouteChecks | ForEach-Object { "$($_.method) $($_.path)" } | Select-Object -Unique)
    Assert-Condition ($RetiredRouteKeys.Count -eq 30) "installed app smoke contains duplicate retired Code route checks"

    $UninstallProcess = Start-Process -FilePath $Uninstaller.FullName -ArgumentList @("/S") -Wait -PassThru
    Assert-Condition ($UninstallProcess.ExitCode -eq 0) "NSIS uninstall exited with code $($UninstallProcess.ExitCode)"
    Wait-Until { -not (Test-Path $InstallRoot) } 30 "NSIS uninstall left the installation directory behind"
    Wait-Until { @(Get-PhoenixUninstallEntries | Where-Object { [string]$_.DisplayVersion -like "$Version*" }).Count -eq 0 } 15 "NSIS uninstall registration remains"
    Wait-Until { @(Get-PhoenixShortcuts).Count -eq 0 } 15 "NSIS Start Menu shortcut remains after uninstall"
    $Uninstalled = $true

    if (-not $ReceiptPath) {
        $ReceiptPath = Join-Path $BundleDir "phoenix-desk-tools-$Version-windows-release-receipt.json"
    }
    $Receipt = [ordered]@{
        kind = "phoenix.desk.windows-nsis-release"
        schemaVersion = 2
        generatedAt = [DateTime]::UtcNow.ToString("o")
        version = $Version
        platform = "$([Environment]::OSVersion.Platform)-$env:PROCESSOR_ARCHITECTURE"
        installer = [ordered]@{
            filename = $Installer.Name
            sha256 = $InstallerHash
            signatureStatus = $InstallerSignature.Status.ToString()
        }
        executable = [ordered]@{
            filename = $Executable.Name
            sha256 = $ExecutableHash
            productVersion = $ExecutableProductVersion
        }
        registration = [ordered]@{
            uninstallEntry = $true
            startMenuShortcut = $true
        }
        appSmoke = $AppSmoke
        flows = [ordered]@{
            build = (-not $SkipBuild)
            install = $true
            launch = $AppSmoke.flows.launch
            workspaceActivation = $AppSmoke.flows.workspaceActivation
            runtimeResources = $AppSmoke.flows.runtimeResources
            retiredCodeRoutes404 = $AppSmoke.flows.retiredCodeRoutes404
            realFcstdRead = $AppSmoke.flows.realFcstdRead
            gracefulExit = $AppSmoke.flows.gracefulExit
            sidecarReleased = $AppSmoke.flows.sidecarReleased
            uninstall = $true
            registrationRemoved = $true
            installDirectoryRemoved = $true
        }
    }
    $ReceiptJson = $Receipt | ConvertTo-Json -Depth 12
    $ReceiptFullPath = [IO.Path]::GetFullPath($ReceiptPath)
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($ReceiptFullPath)) -Force | Out-Null
    [IO.File]::WriteAllText($ReceiptFullPath, "$ReceiptJson`n", [Text.UTF8Encoding]::new($false))
    Write-Host $ReceiptJson
    Write-Host "[q2] Windows NSIS $Version build/install/app/uninstall gate passed"
    Write-Host "[q2] receipt: $ReceiptFullPath"
}
finally {
    if (-not $Uninstalled -and $null -ne $Uninstaller -and (Test-Path $Uninstaller.FullName)) {
        try { Start-Process -FilePath $Uninstaller.FullName -ArgumentList @("/S") -Wait | Out-Null } catch { }
    }
    if (Test-Path $TempRoot) {
        Remove-Item $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
