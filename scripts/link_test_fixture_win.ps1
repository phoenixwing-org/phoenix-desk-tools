# Windows：删除旧链接/残留后重建目录链接（symbolic link → mklink /D → junction）
# 供 phoenix.testing.fixture_links 与命令行调用；逻辑类似 CAA 工程的 Remove/New-SymbolicLinkList。
param(
    [Parameter(Mandatory)]
    [ValidateSet("Remove", "New")]
    [string]$Action,

    [Parameter(Mandatory)]
    [string]$LinkPath,

    [string]$TargetPath = ""
)

$ErrorActionPreference = "Stop"

function Remove-DirectoryLinkEntry {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $item = Get-Item -LiteralPath $Path -Force
    $reparse = [IO.FileAttributes]::ReparsePoint
    if ($item.Attributes -band $reparse) {
        Remove-Item -LiteralPath $Path -Force
        return
    }

    if ($item.PSIsContainer) {
        $children = @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue)
        if ($children.Count -gt 0) {
            throw "Non-empty directory blocks link: $Path"
        }
        Remove-Item -LiteralPath $Path -Force
        return
    }

    Remove-Item -LiteralPath $Path -Force
}

function New-DirectoryLinkEntry {
    param(
        [string]$Link,
        [string]$Target
    )

    if (-not $Target) {
        throw "TargetPath required for New"
    }
    if (-not (Test-Path -LiteralPath $Target)) {
        throw "Target not found: $Target"
    }

    $parent = Split-Path -Parent $Link
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    Remove-DirectoryLinkEntry -Path $Link
    $targetFull = (Resolve-Path -LiteralPath $Target).Path

    try {
        New-Item -ItemType SymbolicLink -Path $Link -Target $targetFull | Out-Null
        Write-Output "symlink"
        return
    }
    catch {
        # fall through: mklink /D then /J
    }

    $mkD = Start-Process -FilePath "cmd.exe" `
        -ArgumentList @("/c", "mklink", "/D", $Link, $targetFull) `
        -Wait -PassThru -NoNewWindow
    if ($mkD.ExitCode -eq 0) {
        Write-Output "symlink"
        return
    }

    $mkJ = Start-Process -FilePath "cmd.exe" `
        -ArgumentList @("/c", "mklink", "/J", $Link, $targetFull) `
        -Wait -PassThru -NoNewWindow
    if ($mkJ.ExitCode -ne 0) {
        throw "mklink failed for $Link -> $targetFull"
    }
    Write-Output "junction"
}

switch ($Action) {
    "Remove" { Remove-DirectoryLinkEntry -Path $LinkPath }
    "New" { New-DirectoryLinkEntry -Link $LinkPath -Target $TargetPath }
}
