param(
    [string]$FrontendUrl,
    [string]$BackendUrl,
    [switch]$PlanOnly,
    [switch]$SkipDeploySmoke,
    [switch]$SkipAndroidBuild,
    [switch]$RestoreBundled,
    [string]$ReportPath,
    [string]$JavaHome,
    [string]$AndroidHome
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$AndroidDir = Join-Path $Root "apps\web\android"
$ApkPath = Join-Path $AndroidDir "app\build\outputs\apk\debug\app-debug.apk"
$StartedAt = Get-Date
$Steps = New-Object System.Collections.Generic.List[object]

if (-not $FrontendUrl -and $env:SMOKE_FRONTEND_URL) {
    $FrontendUrl = $env:SMOKE_FRONTEND_URL
}
if (-not $BackendUrl -and $env:SMOKE_BACKEND_URL) {
    $BackendUrl = $env:SMOKE_BACKEND_URL
}
if (-not $ReportPath -and $env:OFFICIAL_URLS_REPORT) {
    $ReportPath = $env:OFFICIAL_URLS_REPORT
}
if (-not $ReportPath) {
    $ReportPath = "artifacts/official-urls.json"
}

function Get-NowUnixSeconds {
    return [int][double]::Parse((Get-Date -UFormat %s), [System.Globalization.CultureInfo]::InvariantCulture)
}

function Normalize-Origin {
    param([string]$Value, [string]$Label)
    if (-not $Value) {
        throw "$Label is required. Pass -$Label or set the matching SMOKE_* URL environment variable."
    }
    $trimmed = $Value.Trim()
    if (-not $trimmed) {
        throw "$Label is required. Pass -$Label or set the matching SMOKE_* URL environment variable."
    }
    if (-not ($trimmed.StartsWith("http://") -or $trimmed.StartsWith("https://"))) {
        $trimmed = "https://$trimmed"
    }
    $uri = [Uri]$trimmed
    if ($uri.Scheme -ne "https") {
        throw "$Label must use https:// for official hosted release URLs."
    }
    return $uri.GetLeftPart([System.UriPartial]::Authority)
}

function Add-Step {
    param(
        [string]$Name,
        [string]$Status,
        [string]$Command = "",
        [string]$Detail = "",
        [int]$DurationMs = 0
    )
    $Steps.Add([ordered]@{
        name = $Name
        status = $Status
        command = $Command
        detail = $Detail
        duration_ms = $DurationMs
    }) | Out-Null
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

function Invoke-ReleaseStep {
    param(
        [string]$Name,
        [string]$CommandText,
        [scriptblock]$Command
    )
    Write-Step $Name
    if ($PlanOnly) {
        Write-Output "Plan only: $CommandText"
        Add-Step -Name $Name -Status "planned" -Command $CommandText
        return
    }
    $stepStarted = Get-Date
    try {
        & $Command
        Assert-LastExitCode $Name
        $duration = [int](New-TimeSpan -Start $stepStarted -End (Get-Date)).TotalMilliseconds
        Add-Step -Name $Name -Status "ok" -Command $CommandText -DurationMs $duration
    } catch {
        $duration = [int](New-TimeSpan -Start $stepStarted -End (Get-Date)).TotalMilliseconds
        Add-Step -Name $Name -Status "failed" -Command $CommandText -Detail $_.Exception.Message -DurationMs $duration
        throw
    }
}

function Add-SkippedStep {
    param([string]$Name, [string]$CommandText, [string]$Reason)
    Write-Step $Name
    Write-Output "Skipped: $Reason"
    Add-Step -Name $Name -Status "skipped" -Command $CommandText -Detail $Reason
}

function Resolve-ExistingPath {
    param([string[]]$Candidates)
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }
    return ""
}

function Configure-AndroidEnvironment {
    if ($JavaHome) {
        $env:JAVA_HOME = $JavaHome
    } elseif (-not $env:JAVA_HOME) {
        $resolvedJavaHome = Resolve-ExistingPath @(
            "C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot",
            "C:\Program Files\Java\jdk-17"
        )
        if ($resolvedJavaHome) {
            $env:JAVA_HOME = $resolvedJavaHome
        }
    }

    if ($AndroidHome) {
        $env:ANDROID_HOME = $AndroidHome
    } elseif (-not $env:ANDROID_HOME) {
        $resolvedAndroidHome = Resolve-ExistingPath @(
            "D:\Android\Sdk",
            (Join-Path $env:LOCALAPPDATA "Android\Sdk")
        )
        if ($resolvedAndroidHome) {
            $env:ANDROID_HOME = $resolvedAndroidHome
        }
    }

    if (-not $env:JAVA_HOME -or -not (Test-Path $env:JAVA_HOME)) {
        throw "JAVA_HOME is required for Android build. Set JAVA_HOME or pass -JavaHome."
    }
    if (-not $env:ANDROID_HOME -or -not (Test-Path $env:ANDROID_HOME)) {
        throw "ANDROID_HOME is required for Android build. Set ANDROID_HOME or pass -AndroidHome."
    }

    $javaBin = Join-Path $env:JAVA_HOME "bin"
    $platformTools = Join-Path $env:ANDROID_HOME "platform-tools"
    $env:Path = "$javaBin;$platformTools;$env:Path"
}

function Get-FileSha256 {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        return $null
    }
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-ApkInfo {
    if (-not (Test-Path $ApkPath)) {
        return $null
    }
    $apkFile = Get-Item $ApkPath
    return [ordered]@{
        path = $apkFile.FullName
        size_bytes = $apkFile.Length
        sha256 = Get-FileSha256 -Path $apkFile.FullName
    }
}

function Write-Report {
    param([string]$Status, [object]$Apk = $null)
    $parent = Split-Path -Parent $ReportPath
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    $elapsed = New-TimeSpan -Start $StartedAt -End (Get-Date)
    $report = [ordered]@{
        generated_at = (Get-NowUnixSeconds)
        status = $Status
        plan_only = [bool]$PlanOnly
        frontend_url = $FrontendUrl
        backend_url = $BackendUrl
        vite_api_base_url = $BackendUrl
        cap_server_url = $(if ($RestoreBundled) { $null } else { $FrontendUrl })
        restored_bundled = [bool]$RestoreBundled
        duration_ms = [int]$elapsed.TotalMilliseconds
        apk = $Apk
        steps = $Steps.ToArray()
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -Path $ReportPath -Encoding UTF8
    Write-Output "Official URL preparation report written: $ReportPath"
}

$FrontendUrl = Normalize-Origin -Value $FrontendUrl -Label "FrontendUrl"
$BackendUrl = Normalize-Origin -Value $BackendUrl -Label "BackendUrl"
$finalApk = $null

Push-Location $Root
try {
    Invoke-ReleaseStep `
        -Name "Build frontend with official backend URL" `
        -CommandText '$env:VITE_API_BASE_URL=$BackendUrl; npm run build:web' `
        -Command {
            $previous = $env:VITE_API_BASE_URL
            $hadPrevious = $null -ne $previous
            $env:VITE_API_BASE_URL = $BackendUrl
            try {
                npm run build:web
            } finally {
                if ($hadPrevious) {
                    $env:VITE_API_BASE_URL = $previous
                } else {
                    Remove-Item Env:\VITE_API_BASE_URL -ErrorAction SilentlyContinue
                }
            }
        }

    Invoke-ReleaseStep `
        -Name "Verify frontend bundle API base" `
        -CommandText '$env:EXPECTED_FRONTEND_API_BASE=$BackendUrl; npm run smoke:frontend-api-base' `
        -Command {
            $previous = $env:EXPECTED_FRONTEND_API_BASE
            $hadPrevious = $null -ne $previous
            $env:EXPECTED_FRONTEND_API_BASE = $BackendUrl
            try {
                npm run smoke:frontend-api-base
            } finally {
                if ($hadPrevious) {
                    $env:EXPECTED_FRONTEND_API_BASE = $previous
                } else {
                    Remove-Item Env:\EXPECTED_FRONTEND_API_BASE -ErrorAction SilentlyContinue
                }
            }
        }

    if ($SkipDeploySmoke) {
        Add-SkippedStep -Name "Verify deployed frontend/backend" -CommandText '$env:SMOKE_FRONTEND_URL=$FrontendUrl; $env:SMOKE_BACKEND_URL=$BackendUrl; npm run smoke:deploy' -Reason "Skipped by -SkipDeploySmoke."
    } else {
        Invoke-ReleaseStep `
            -Name "Verify deployed frontend/backend" `
            -CommandText '$env:SMOKE_FRONTEND_URL=$FrontendUrl; $env:SMOKE_BACKEND_URL=$BackendUrl; npm run smoke:deploy' `
            -Command {
                $previousFrontend = $env:SMOKE_FRONTEND_URL
                $previousBackend = $env:SMOKE_BACKEND_URL
                $previousReport = $env:SMOKE_DEPLOY_REPORT
                $hadFrontend = $null -ne $previousFrontend
                $hadBackend = $null -ne $previousBackend
                $hadReport = $null -ne $previousReport
                $env:SMOKE_FRONTEND_URL = $FrontendUrl
                $env:SMOKE_BACKEND_URL = $BackendUrl
                $env:SMOKE_DEPLOY_REPORT = "artifacts/deploy-smoke.json"
                try {
                    npm run smoke:deploy
                } finally {
                    if ($hadFrontend) { $env:SMOKE_FRONTEND_URL = $previousFrontend } else { Remove-Item Env:\SMOKE_FRONTEND_URL -ErrorAction SilentlyContinue }
                    if ($hadBackend) { $env:SMOKE_BACKEND_URL = $previousBackend } else { Remove-Item Env:\SMOKE_BACKEND_URL -ErrorAction SilentlyContinue }
                    if ($hadReport) { $env:SMOKE_DEPLOY_REPORT = $previousReport } else { Remove-Item Env:\SMOKE_DEPLOY_REPORT -ErrorAction SilentlyContinue }
                }
            }
    }

    Invoke-ReleaseStep `
        -Name "Sync Capacitor shell to official frontend URL" `
        -CommandText '$env:CAP_SERVER_URL=$FrontendUrl; npm run cap:sync' `
        -Command {
            $env:CAP_SERVER_URL = $FrontendUrl
            Remove-Item Env:\CAP_ALLOW_CLEAR_TEXT -ErrorAction SilentlyContinue
            npm run cap:sync
        }

    if ($SkipAndroidBuild) {
        Add-SkippedStep -Name "Build and verify official remote Android APK" -CommandText 'gradlew assembleDebug; npm run smoke:apk' -Reason "Skipped by -SkipAndroidBuild."
    } else {
        Invoke-ReleaseStep `
            -Name "Build and verify official remote Android APK" `
            -CommandText '$env:EXPECTED_CAP_SERVER_URL=$FrontendUrl; gradlew assembleDebug; npm run smoke:apk' `
            -Command {
                Configure-AndroidEnvironment
                Push-Location $AndroidDir
                try {
                    .\gradlew.bat assembleDebug --no-daemon
                    if ($LASTEXITCODE -ne 0) {
                        throw "Android debug APK build failed with exit code $LASTEXITCODE."
                    }
                } finally {
                    Pop-Location
                }
                $previousExpected = $env:EXPECTED_CAP_SERVER_URL
                $hadExpected = $null -ne $previousExpected
                $env:EXPECTED_CAP_SERVER_URL = $FrontendUrl
                try {
                    npm run smoke:apk
                } finally {
                    if ($hadExpected) {
                        $env:EXPECTED_CAP_SERVER_URL = $previousExpected
                    } else {
                        Remove-Item Env:\EXPECTED_CAP_SERVER_URL -ErrorAction SilentlyContinue
                    }
                }
            }
        $finalApk = Get-ApkInfo
    }

    if ($RestoreBundled) {
        Invoke-ReleaseStep `
            -Name "Restore Capacitor bundled mode" `
            -CommandText 'Remove CAP_SERVER_URL; npm run cap:sync' `
            -Command {
                Remove-Item Env:\CAP_SERVER_URL -ErrorAction SilentlyContinue
                npm run cap:sync
            }
    }

    $failed = $Steps.ToArray() | Where-Object { $_.status -eq "failed" }
    $skipped = $Steps.ToArray() | Where-Object { $_.status -eq "skipped" }
    if ($failed) {
        Write-Report -Status "failed" -Apk $finalApk
    } elseif ($PlanOnly -or $skipped) {
        Write-Report -Status "partial" -Apk $finalApk
    } else {
        Write-Report -Status "ok" -Apk $finalApk
    }
} catch {
    Write-Report -Status "failed" -Apk $finalApk
    throw
} finally {
    Pop-Location
}
