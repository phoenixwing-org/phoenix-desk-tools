param(
    [Parameter(Mandatory = $true)]
    [string]$JobPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Add-Log {
    param([System.Collections.ArrayList]$Logs, [string]$Message)
    [void]$Logs.Add($Message)
}

function Save-StepDocument {
    param(
        $Document,
        [string]$Destination,
        [int]$SaveVersion,
        [int]$SilentOptions,
        [System.Collections.ArrayList]$Logs
    )

    $parent = Split-Path -Parent $Destination
    [void](New-Item -ItemType Directory -Force -Path $parent)
    $extension = $Document.Extension
    $lastError = ""

    try {
        $saveErrors = 0
        $saveWarnings = 0
        $saved = $extension.SaveAs3(
            $Destination,
            $SaveVersion,
            $SilentOptions,
            $null,
            [ref]$saveErrors,
            [ref]$saveWarnings
        )
        if ($saved) {
            if (Test-Path -LiteralPath $Destination -PathType Leaf) {
                return [pscustomobject]@{ success = $true; error = "" }
            }
            $lastError = "SaveAs3 returned success but did not create the STEP file"
        }
        else {
            $lastError = "SaveAs3 returned $saved, errors=$saveErrors, warnings=$saveWarnings"
        }
    }
    catch {
        $lastError = $_.Exception.Message
        Add-Log $Logs "[SaveAs3] $lastError"
    }

    try {
        $saved = $extension.SaveAs2($Destination, $SaveVersion, $SilentOptions)
        if ($saved) {
            if (Test-Path -LiteralPath $Destination -PathType Leaf) {
                return [pscustomobject]@{ success = $true; error = "" }
            }
            $lastError = "SaveAs2 returned success but did not create the STEP file"
        }
        else {
            $lastError = "SaveAs2 returned $saved"
        }
    }
    catch {
        $lastError = $_.Exception.Message
        Add-Log $Logs "[SaveAs2] $lastError"
    }

    try {
        $saved = $Document.SaveAs($Destination)
        if ($saved -and (Test-Path -LiteralPath $Destination -PathType Leaf)) {
            return [pscustomobject]@{ success = $true; error = "" }
        }
        $lastError = "SaveAs returned $saved"
    }
    catch {
        $lastError = $_.Exception.Message
        Add-Log $Logs "[SaveAs] $lastError"
    }

    if (-not $lastError) {
        $lastError = "STEP export failed"
    }
    return [pscustomobject]@{ success = $false; error = $lastError }
}

$logs = [System.Collections.ArrayList]::new()
$ok = [System.Collections.ArrayList]::new()
$failed = [System.Collections.ArrayList]::new()

try {
    $job = Get-Content -LiteralPath $JobPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $outDir = [System.IO.Path]::GetFullPath([string]$job.out_step_dir)
    [void](New-Item -ItemType Directory -Force -Path $outDir)

    try {
        $solidWorks = [System.Runtime.InteropServices.Marshal]::GetActiveObject("SldWorks.Application")
        Add-Log $logs "Attached to the active SolidWorks session"
    }
    catch {
        $solidWorks = New-Object -ComObject "SldWorks.Application"
        Add-Log $logs "Started a SolidWorks COM session"
    }
    if ($null -eq $solidWorks) {
        throw "SldWorks.Application returned null"
    }
    $solidWorks.Visible = $true

    $openOptions = [int]$job.open_options
    $saveVersion = [int]$job.save_version
    $silentOptions = [int]$job.silent_options

    foreach ($modelPathValue in @($job.models)) {
        $source = [System.IO.Path]::GetFullPath([string]$modelPathValue)
        $suffix = [System.IO.Path]::GetExtension($source).ToLowerInvariant()
        $docType = if ($suffix -eq ".sldprt") { 1 } elseif ($suffix -eq ".sldasm") { 2 } else { 0 }
        if ($docType -eq 0) {
            [void]$failed.Add([ordered]@{ path = $source; error = "Not a .sldprt/.sldasm model" })
            continue
        }
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            [void]$failed.Add([ordered]@{ path = $source; error = "Model file does not exist" })
            continue
        }

        $document = $null
        $openedByAdapter = $false
        $title = ""
        try {
            try {
                $document = $solidWorks.GetOpenDocumentByName($source)
            }
            catch {
                $document = $null
            }

            if ($null -eq $document) {
                $openErrors = 0
                $openWarnings = 0
                Add-Log $logs "Opening: $source"
                $document = $solidWorks.OpenDoc6(
                    $source,
                    $docType,
                    $openOptions,
                    "",
                    [ref]$openErrors,
                    [ref]$openWarnings
                )
                $openedByAdapter = $true
                if ($null -eq $document) {
                    $document = $solidWorks.ActiveDoc
                }
                if ($null -eq $document) {
                    throw "OpenDoc6 returned null (errors=$openErrors, warnings=$openWarnings)"
                }
            }
            else {
                Add-Log $logs "Using already-open document: $source"
            }

            try {
                $title = [string]$document.GetTitle()
            }
            catch {
                try { $title = [string]$document.Title } catch { $title = [System.IO.Path]::GetFileName($source) }
            }

            $destination = Join-Path $outDir ([System.IO.Path]::GetFileNameWithoutExtension($source) + ".step")
            $saved = Save-StepDocument $document $destination $saveVersion $silentOptions $logs
            if ($saved.success -and (Test-Path -LiteralPath $destination -PathType Leaf)) {
                [void]$ok.Add($destination)
                Add-Log $logs "Exported: $destination"
            }
            else {
                [void]$failed.Add([ordered]@{ path = $source; error = [string]$saved.error })
            }
        }
        catch {
            [void]$failed.Add([ordered]@{ path = $source; error = $_.Exception.Message })
        }
        finally {
            if ($openedByAdapter -and $title) {
                try { $solidWorks.CloseDoc($title) } catch { Add-Log $logs "CloseDoc failed for $title" }
            }
        }
    }

    [ordered]@{
        ok = @($ok)
        failed = @($failed)
        logs = @($logs)
        fatal_error = $null
    } | ConvertTo-Json -Depth 8 -Compress
}
catch {
    [ordered]@{
        ok = @($ok)
        failed = @($failed)
        logs = @($logs)
        fatal_error = $_.Exception.Message
    } | ConvertTo-Json -Depth 8 -Compress
    exit 1
}

