param(
    [switch]$SkipAndroidBuild,
    [switch]$SkipDeepSeek,
    [switch]$SkipDeploy,
    [string]$JavaHome,
    [string]$AndroidHome
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$AndroidDir = Join-Path $Root "apps\web\android"
$StartedAt = Get-Date
$VerificationSteps = New-Object System.Collections.Generic.List[object]

function Get-NowUnixSeconds {
    return [int][double]::Parse((Get-Date -UFormat %s), [System.Globalization.CultureInfo]::InvariantCulture)
}

function Add-VerificationStep {
    param(
        [string]$Name,
        [string]$Status,
        [int]$DurationMs = 0,
        [string]$Detail = ""
    )
    $VerificationSteps.Add([ordered]@{
        name = $Name
        status = $Status
        duration_ms = $DurationMs
        detail = $Detail
    }) | Out-Null
}

function Write-VerificationReport {
    param([string]$Status)
    if (-not $env:VERIFY_LOCAL_REPORT) {
        return
    }
    $reportPath = $env:VERIFY_LOCAL_REPORT
    $reportDir = Split-Path -Parent $reportPath
    if ($reportDir) {
        New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
    }
    $elapsed = New-TimeSpan -Start $StartedAt -End (Get-Date)
    $report = [ordered]@{
        generated_at = (Get-NowUnixSeconds)
        status = $Status
        duration_ms = [int]$elapsed.TotalMilliseconds
        skip_android_build = [bool]$SkipAndroidBuild
        skip_deepseek = [bool]$SkipDeepSeek
        skip_deploy = [bool]$SkipDeploy
        steps = $VerificationSteps.ToArray()
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8
    Write-Output "Local verification report written: $reportPath"
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

function Invoke-External {
    param(
        [string]$Name,
        [scriptblock]$Command
    )
    Write-Step $Name
    $stepStarted = Get-Date
    try {
        & $Command
        Assert-LastExitCode $Name
        $duration = [int](New-TimeSpan -Start $stepStarted -End (Get-Date)).TotalMilliseconds
        Add-VerificationStep -Name $Name -Status "ok" -DurationMs $duration
    } catch {
        $duration = [int](New-TimeSpan -Start $stepStarted -End (Get-Date)).TotalMilliseconds
        Add-VerificationStep -Name $Name -Status "failed" -DurationMs $duration -Detail $_.Exception.Message
        throw
    }
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
        throw "JAVA_HOME is required for Android build. Set JAVA_HOME, pass -JavaHome, or use -SkipAndroidBuild."
    }
    if (-not $env:ANDROID_HOME -or -not (Test-Path $env:ANDROID_HOME)) {
        throw "ANDROID_HOME is required for Android build. Set ANDROID_HOME, pass -AndroidHome, or use -SkipAndroidBuild."
    }

    $javaBin = Join-Path $env:JAVA_HOME "bin"
    $platformTools = Join-Path $env:ANDROID_HOME "platform-tools"
    $env:Path = "$javaBin;$platformTools;$env:Path"
}

function Invoke-FrontendApiBaseSmoke {
    $previousExpectedApiBase = $env:EXPECTED_FRONTEND_API_BASE
    $hadExpectedApiBase = $null -ne $previousExpectedApiBase
    if (-not $env:EXPECTED_FRONTEND_API_BASE -and -not $env:SMOKE_BACKEND_URL) {
        if ($env:VITE_API_BASE_URL) {
            $env:EXPECTED_FRONTEND_API_BASE = $env:VITE_API_BASE_URL
        } else {
            $env:EXPECTED_FRONTEND_API_BASE = "http://localhost:8000"
        }
    }
    try {
        npm run smoke:frontend-api-base
    } finally {
        if ($hadExpectedApiBase) {
            $env:EXPECTED_FRONTEND_API_BASE = $previousExpectedApiBase
        } else {
            Remove-Item Env:\EXPECTED_FRONTEND_API_BASE -ErrorAction SilentlyContinue
        }
    }
}

Push-Location $Root
try {
    Invoke-External "Web lint" { npm run lint:web }
    Invoke-External "Web tests" { npm run test:web }
    Invoke-External "FastAPI tests" { npm run test:api }
    Invoke-External "FastAPI local smoke" { npm run smoke:api }
    Invoke-External "Backend deployment config smoke" { npm run smoke:backend-deploy-config }
    Invoke-External "Static deployment config smoke" { npm run smoke:static-config }
    Invoke-External "Web/PWA production build" { npm run build:web }
    Invoke-External "Frontend API base smoke" { Invoke-FrontendApiBaseSmoke }
    Invoke-External "PWA config smoke" { npm run smoke:pwa-config }
    Invoke-External "Text encoding smoke" { npm run smoke:text-encoding }
    Invoke-External "Client secret smoke" { npm run smoke:secrets }
    Invoke-External "Local deployment smoke" { npm run smoke:local-deploy }
    Invoke-External "Android manifest smoke" { npm run smoke:android:manifest }

    if ($SkipAndroidBuild) {
        Write-Step "Android build"
        Write-Output "Skipped by -SkipAndroidBuild."
        Add-VerificationStep -Name "Android build" -Status "skipped" -Detail "Skipped by -SkipAndroidBuild."
    } else {
        Configure-AndroidEnvironment
        Invoke-External "Capacitor sync" { npm run cap:sync }
        Invoke-External "Android debug APK build" {
            Push-Location $AndroidDir
            try {
                .\gradlew.bat assembleDebug --no-daemon
            } finally {
                Pop-Location
            }
        }
    Invoke-External "Text encoding smoke after Capacitor sync" { npm run smoke:text-encoding }
    Invoke-External "Client secret smoke after Capacitor sync" { npm run smoke:secrets }
    Invoke-External "APK asset smoke" { npm run smoke:apk }
    }

    if ($SkipDeepSeek) {
        Write-Step "DeepSeek smoke"
        Write-Output "Skipped by -SkipDeepSeek."
        Add-VerificationStep -Name "DeepSeek smoke" -Status "skipped" -Detail "Skipped by -SkipDeepSeek."
    } elseif ($env:DEEPSEEK_API_KEY) {
        Invoke-External "DeepSeek real-provider smoke" { npm run smoke:deepseek }
    } else {
        Write-Step "DeepSeek smoke"
        Write-Output "Skipped because DEEPSEEK_API_KEY is not set."
        Add-VerificationStep -Name "DeepSeek smoke" -Status "skipped" -Detail "Skipped because DEEPSEEK_API_KEY is not set."
    }

    if ($SkipDeploy) {
        Write-Step "Deployment smoke"
        Write-Output "Skipped by -SkipDeploy."
        Add-VerificationStep -Name "Deployment smoke" -Status "skipped" -Detail "Skipped by -SkipDeploy."
    } elseif ($env:SMOKE_FRONTEND_URL -and $env:SMOKE_BACKEND_URL) {
        Invoke-External "Deployment smoke" { npm run smoke:deploy }
    } else {
        Write-Step "Deployment smoke"
        Write-Output "Skipped because SMOKE_FRONTEND_URL and SMOKE_BACKEND_URL are not both set."
        Add-VerificationStep -Name "Deployment smoke" -Status "skipped" -Detail "Skipped because SMOKE_FRONTEND_URL and SMOKE_BACKEND_URL are not both set."
    }

    $Elapsed = New-TimeSpan -Start $StartedAt -End (Get-Date)
    Write-Output ""
    Write-Output ("Local verification passed in {0:mm\:ss}." -f $Elapsed)
    Write-VerificationReport -Status "ok"
} catch {
    Write-VerificationReport -Status "failed"
    throw
} finally {
    Pop-Location
}
