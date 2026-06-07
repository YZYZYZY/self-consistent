param(
    [switch]$PlanOnly,
    [switch]$SkipFrontendApiBase,
    [switch]$SkipDeploy,
    [switch]$SkipRemoteAndroid,
    [switch]$SkipPhysicalAndroid,
    [string]$ReportPath,
    [string]$JavaHome,
    [string]$AndroidHome
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$StartedAt = Get-Date
$EvidenceSteps = New-Object System.Collections.Generic.List[object]
$FinalReadinessReport = "artifacts/release-readiness-external.json"

if (-not $ReportPath -and $env:EXTERNAL_EVIDENCE_REPORT) {
    $ReportPath = $env:EXTERNAL_EVIDENCE_REPORT
}
if (-not $ReportPath) {
    $ReportPath = "artifacts/external-evidence-collection.json"
}

function Get-NowUnixSeconds {
    return [int][double]::Parse((Get-Date -UFormat %s), [System.Globalization.CultureInfo]::InvariantCulture)
}

function Add-EvidenceStep {
    param(
        [string]$Name,
        [string]$Status,
        [string]$Command = "",
        [string]$Report = "",
        [int]$DurationMs = 0,
        [string]$Detail = ""
    )
    $EvidenceSteps.Add([ordered]@{
        name = $Name
        status = $Status
        command = $Command
        report = $Report
        duration_ms = $DurationMs
        detail = $Detail
    }) | Out-Null
}

function Write-EvidenceReport {
    param([string]$Status)
    $reportDir = Split-Path -Parent $ReportPath
    if ($reportDir) {
        New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
    }
    $elapsed = New-TimeSpan -Start $StartedAt -End (Get-Date)
    $readinessSummary = Get-FinalReadinessSummary
    $report = [ordered]@{
        generated_at = (Get-NowUnixSeconds)
        status = $Status
        plan_only = [bool]$PlanOnly
        duration_ms = [int]$elapsed.TotalMilliseconds
        final_readiness = $readinessSummary
        steps = $EvidenceSteps.ToArray()
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -Path $ReportPath -Encoding UTF8
    Write-Output "External evidence collection report written: $ReportPath"
}

function Write-Step {
    param([string]$Name)
    Write-Output ""
    Write-Output "==> $Name"
}

function Assert-LastExitCode {
    param([string]$Name)
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

function Invoke-EvidenceCommand {
    param(
        [string]$Name,
        [string]$CommandText,
        [string]$Report,
        [scriptblock]$Command
    )
    Write-Step $Name
    if ($PlanOnly) {
        Write-Output "Plan only: $CommandText"
        Add-EvidenceStep -Name $Name -Status "planned" -Command $CommandText -Report $Report
        return
    }

    $stepStarted = Get-Date
    try {
        & $Command
        Assert-LastExitCode $Name
        $duration = [int](New-TimeSpan -Start $stepStarted -End (Get-Date)).TotalMilliseconds
        Add-EvidenceStep -Name $Name -Status "ok" -Command $CommandText -Report $Report -DurationMs $duration
    } catch {
        $duration = [int](New-TimeSpan -Start $stepStarted -End (Get-Date)).TotalMilliseconds
        Add-EvidenceStep -Name $Name -Status "failed" -Command $CommandText -Report $Report -DurationMs $duration -Detail $_.Exception.Message
        throw
    }
}

function Add-SkippedEvidence {
    param(
        [string]$Name,
        [string]$CommandText,
        [string]$Report,
        [string]$Reason
    )
    Write-Step $Name
    Write-Output "Skipped: $Reason"
    Add-EvidenceStep -Name $Name -Status "skipped" -Command $CommandText -Report $Report -Detail $Reason
}

function Test-IsProbableEmulator {
    param([string]$Serial)
    $normalized = $Serial.ToLowerInvariant()
    return $normalized.StartsWith("emulator-") -or
        $normalized.Contains("qemu") -or
        $normalized.StartsWith("127.0.0.1:")
}

function Get-AdbDeviceSerials {
    $adb = ""
    if ($env:ANDROID_HOME) {
        $candidate = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
        if (Test-Path $candidate) {
            $adb = $candidate
        }
    }
    if (-not $adb) {
        $command = Get-Command adb -ErrorAction SilentlyContinue
        if ($command) {
            $adb = $command.Source
        }
    }
    if (-not $adb) {
        return @()
    }
    $deviceLines = @(& $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\S+\s+device$" })
    return @($deviceLines | ForEach-Object { ($_ -split "\s+")[0] })
}

function Test-HasPhysicalAdbDevice {
    $devices = @(Get-AdbDeviceSerials)
    $physicalDevices = @($devices | Where-Object { -not (Test-IsProbableEmulator -Serial $_) })
    return $physicalDevices.Count -gt 0
}

function Get-FinalReadinessSummary {
    if (-not (Test-Path $FinalReadinessReport)) {
        return [ordered]@{
            blocking = @()
            missing_external = @()
            report = $FinalReadinessReport
        }
    }
    try {
        $report = Get-Content -Path $FinalReadinessReport -Encoding UTF8 | ConvertFrom-Json
        $blocking = @()
        $missingExternal = @()
        if ($report.summary.blocking) {
            $blocking = @($report.summary.blocking)
        }
        if ($report.summary.missing_external) {
            $missingExternal = @($report.summary.missing_external)
        }
        return [ordered]@{
            blocking = $blocking
            missing_external = $missingExternal
            report = $FinalReadinessReport
        }
    } catch {
        return [ordered]@{
            blocking = @("release_readiness_report_unreadable")
            missing_external = @()
            report = $FinalReadinessReport
        }
    }
}

Push-Location $Root
try {
    $frontendApiBaseCommand = '$env:EXPECTED_FRONTEND_API_BASE=$env:SMOKE_BACKEND_URL; npm run smoke:frontend-api-base'
    if ($SkipFrontendApiBase) {
        Add-SkippedEvidence -Name "Frontend API base predeploy smoke" -CommandText $frontendApiBaseCommand -Report "" -Reason "Skipped by -SkipFrontendApiBase."
    } elseif ($env:SMOKE_BACKEND_URL) {
        Invoke-EvidenceCommand `
            -Name "Frontend API base predeploy smoke" `
            -CommandText $frontendApiBaseCommand `
            -Report "" `
            -Command {
                $previousExpected = $env:EXPECTED_FRONTEND_API_BASE
                $hadExpected = $null -ne $previousExpected
                $env:EXPECTED_FRONTEND_API_BASE = $env:SMOKE_BACKEND_URL
                try {
                    npm run smoke:frontend-api-base
                } finally {
                    if ($hadExpected) {
                        $env:EXPECTED_FRONTEND_API_BASE = $previousExpected
                    } else {
                        Remove-Item Env:\EXPECTED_FRONTEND_API_BASE -ErrorAction SilentlyContinue
                    }
                }
            }
    } else {
        Add-SkippedEvidence -Name "Frontend API base predeploy smoke" -CommandText $frontendApiBaseCommand -Report "" -Reason "SMOKE_BACKEND_URL is not set."
    }

    $deployReport = "artifacts/deploy-smoke.json"
    $deployCommand = '$env:SMOKE_DEPLOY_REPORT="artifacts/deploy-smoke.json"; npm run smoke:deploy'
    if ($SkipDeploy) {
        Add-SkippedEvidence -Name "Deployed frontend/backend smoke" -CommandText $deployCommand -Report $deployReport -Reason "Skipped by -SkipDeploy."
    } elseif ($env:SMOKE_FRONTEND_URL -and $env:SMOKE_BACKEND_URL) {
        Invoke-EvidenceCommand `
            -Name "Deployed frontend/backend smoke" `
            -CommandText $deployCommand `
            -Report $deployReport `
            -Command {
                $env:SMOKE_DEPLOY_REPORT = $deployReport
                npm run smoke:deploy
            }
    } else {
        Add-SkippedEvidence -Name "Deployed frontend/backend smoke" -CommandText $deployCommand -Report $deployReport -Reason "SMOKE_FRONTEND_URL and SMOKE_BACKEND_URL must both be set."
    }

    $remoteReport = "artifacts/android-remote-assets-smoke.json"
    $remoteCommand = '$env:ANDROID_REMOTE_SMOKE_REPORT="artifacts/android-remote-assets-smoke.json"; powershell -ExecutionPolicy Bypass -File scripts\smoke_capacitor_remote.ps1 -ServerUrl $env:SMOKE_FRONTEND_URL'
    if ($SkipRemoteAndroid) {
        Add-SkippedEvidence -Name "Remote hosted frontend Android shell smoke" -CommandText $remoteCommand -Report $remoteReport -Reason "Skipped by -SkipRemoteAndroid."
    } elseif ($env:SMOKE_FRONTEND_URL) {
        Invoke-EvidenceCommand `
            -Name "Remote hosted frontend Android shell smoke" `
            -CommandText $remoteCommand `
            -Report $remoteReport `
            -Command {
                $env:ANDROID_REMOTE_SMOKE_REPORT = $remoteReport
                $args = @("-ExecutionPolicy", "Bypass", "-File", "scripts\smoke_capacitor_remote.ps1", "-ServerUrl", $env:SMOKE_FRONTEND_URL)
                if ($JavaHome) {
                    $args += @("-JavaHome", $JavaHome)
                }
                if ($AndroidHome) {
                    $args += @("-AndroidHome", $AndroidHome)
                }
                powershell @args
            }
    } else {
        Add-SkippedEvidence -Name "Remote hosted frontend Android shell smoke" -CommandText $remoteCommand -Report $remoteReport -Reason "SMOKE_FRONTEND_URL is not set."
    }

    $androidReport = "artifacts/android-smoke.json"
    $androidCommand = '$env:ANDROID_SMOKE_REPORT="artifacts/android-smoke.json"; npm run smoke:android'
    if ($SkipPhysicalAndroid) {
        Add-SkippedEvidence -Name "Physical Android phone smoke" -CommandText $androidCommand -Report $androidReport -Reason "Skipped by -SkipPhysicalAndroid."
    } elseif ($PlanOnly -or (Test-HasPhysicalAdbDevice)) {
        Invoke-EvidenceCommand `
            -Name "Physical Android phone smoke" `
            -CommandText $androidCommand `
            -Report $androidReport `
            -Command {
                $env:ANDROID_SMOKE_REPORT = $androidReport
                npm run smoke:android
            }
    } else {
        $connectedDevices = @(Get-AdbDeviceSerials)
        if ($connectedDevices.Count -gt 0) {
            Add-SkippedEvidence -Name "Physical Android phone smoke" -CommandText $androidCommand -Report $androidReport -Reason "No non-emulator adb device is connected. Connected adb devices: $($connectedDevices -join ', ')."
        } else {
            Add-SkippedEvidence -Name "Physical Android phone smoke" -CommandText $androidCommand -Report $androidReport -Reason "No adb device is connected."
        }
    }

    Invoke-EvidenceCommand `
        -Name "Release readiness after external evidence" `
        -CommandText '$env:RELEASE_READINESS_REPORT="artifacts/release-readiness-external.json"; npm run release:readiness' `
        -Report $FinalReadinessReport `
        -Command {
            $previousReadinessReport = $env:RELEASE_READINESS_REPORT
            $hadReadinessReport = $null -ne $previousReadinessReport
            $env:RELEASE_READINESS_REPORT = $FinalReadinessReport
            try {
                npm run release:readiness
            } finally {
                if ($hadReadinessReport) {
                    $env:RELEASE_READINESS_REPORT = $previousReadinessReport
                } else {
                    Remove-Item Env:\RELEASE_READINESS_REPORT -ErrorAction SilentlyContinue
                }
            }
        }

    $hasFailure = $EvidenceSteps.ToArray() | Where-Object { $_.status -eq "failed" }
    $hasSkipped = $EvidenceSteps.ToArray() | Where-Object { $_.status -eq "skipped" }
    $readinessSummary = Get-FinalReadinessSummary
    $hasReadinessBlockers = @($readinessSummary.blocking).Count -gt 0
    if ($hasFailure) {
        Write-EvidenceReport -Status "failed"
    } elseif ($hasSkipped -or $PlanOnly -or $hasReadinessBlockers) {
        Write-EvidenceReport -Status "partial"
    } else {
        Write-EvidenceReport -Status "ok"
    }
} catch {
    Write-EvidenceReport -Status "failed"
    throw
} finally {
    Pop-Location
}
