param(
    [string]$ServerUrl = "https://example.micro-action-coach.test",
    [string]$JavaHome,
    [string]$AndroidHome,
    [switch]$AllowCleartext,
    [switch]$SkipRestore,
    [string]$ReportPath
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$AndroidDir = Join-Path $Root "apps\web\android"
$ApkPath = Join-Path $AndroidDir "app\build\outputs\apk\debug\app-debug.apk"
$GeneratedCapacitorConfigPath = Join-Path $AndroidDir "app\src\main\assets\capacitor.config.json"
$PreviousCapServerUrl = $env:CAP_SERVER_URL
$PreviousCapAllowClearText = $env:CAP_ALLOW_CLEAR_TEXT
$PreviousExpectedCapServerUrl = $env:EXPECTED_CAP_SERVER_URL

if (-not $ReportPath -and $env:ANDROID_REMOTE_SMOKE_REPORT) {
    $ReportPath = $env:ANDROID_REMOTE_SMOKE_REPORT
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
    & $Command
    Assert-LastExitCode $Name
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

function Build-DebugApk {
    Invoke-External "Android debug APK build" {
        Push-Location $AndroidDir
        try {
            .\gradlew.bat assembleDebug --no-daemon
        } finally {
            Pop-Location
        }
    }
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
    return @{
        path = $apkFile.FullName
        size_bytes = $apkFile.Length
        sha256 = Get-FileSha256 -Path $apkFile.FullName
    }
}

function Get-CapacitorServerSnapshot {
    if (-not (Test-Path $GeneratedCapacitorConfigPath)) {
        return @{
            path = $GeneratedCapacitorConfigPath
            exists = $false
        }
    }

    $config = Get-Content -Raw -Encoding UTF8 $GeneratedCapacitorConfigPath | ConvertFrom-Json
    $server = $config.server
    $hasUrl = $false
    $url = $null
    $cleartext = $null
    $androidScheme = $null
    if ($server) {
        $hasUrl = [bool]($server.PSObject.Properties.Name -contains "url")
        if ($hasUrl) {
            $url = $server.url
        }
        if ($server.PSObject.Properties.Name -contains "cleartext") {
            $cleartext = [bool]$server.cleartext
        }
        if ($server.PSObject.Properties.Name -contains "androidScheme") {
            $androidScheme = $server.androidScheme
        }
    }

    return @{
        path = $GeneratedCapacitorConfigPath
        exists = $true
        has_url = $hasUrl
        url = $url
        cleartext = $cleartext
        android_scheme = $androidScheme
    }
}

function Get-ServerUrlEvidence {
    param([string]$Url)

    $uri = [Uri]$Url
    $hostName = $uri.Host.ToLowerInvariant()
    return @{
        host = $hostName
        is_https = ($uri.Scheme -eq "https")
        is_placeholder = ($hostName -eq "example.micro-action-coach.test")
    }
}

function Restore-EnvironmentVariables {
    if ($null -eq $PreviousCapServerUrl) {
        Remove-Item Env:\CAP_SERVER_URL -ErrorAction SilentlyContinue
    } else {
        $env:CAP_SERVER_URL = $PreviousCapServerUrl
    }

    if ($null -eq $PreviousCapAllowClearText) {
        Remove-Item Env:\CAP_ALLOW_CLEAR_TEXT -ErrorAction SilentlyContinue
    } else {
        $env:CAP_ALLOW_CLEAR_TEXT = $PreviousCapAllowClearText
    }

    if ($null -eq $PreviousExpectedCapServerUrl) {
        Remove-Item Env:\EXPECTED_CAP_SERVER_URL -ErrorAction SilentlyContinue
    } else {
        $env:EXPECTED_CAP_SERVER_URL = $PreviousExpectedCapServerUrl
    }
}

function Write-RemoteSmokeReport {
    param(
        [string]$Path,
        [string]$Url,
        [bool]$CleartextAllowed,
        [bool]$RestoreSkipped,
        [object]$RemoteServerConfig,
        [object]$RestoredServerConfig,
        [object]$RemoteApk,
        [object]$RestoredApk
    )

    if (-not $Path) {
        return
    }

    $parent = Split-Path -Parent $Path
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }

    $checks = @("web_build", "capacitor_remote_sync", "android_debug_apk_build", "remote_mode_apk_assets")
    if (-not $RestoreSkipped) {
        $checks += "capacitor_bundled_restore"
        $checks += "bundled_mode_apk_assets"
    }
    $urlEvidence = Get-ServerUrlEvidence -Url $Url

    $report = @{
        generated_at = [int][double]::Parse((Get-Date -UFormat %s))
        status = "ok"
        server_url = $Url
        server_url_host = $urlEvidence.host
        server_url_is_https = $urlEvidence.is_https
        server_url_is_placeholder = $urlEvidence.is_placeholder
        allow_cleartext = $CleartextAllowed
        restored_bundled_mode = (-not $RestoreSkipped)
        remote_server_config = $RemoteServerConfig
        restored_server_config = $RestoredServerConfig
        remote_apk = $RemoteApk
        restored_apk = $RestoredApk
        apk = $(if ($RestoredApk) { $RestoredApk } else { $RemoteApk })
        checks = $checks
    }

    $report | ConvertTo-Json -Depth 6 | Set-Content -Path $Path -Encoding UTF8
    Write-Output "Capacitor remote frontend smoke report written: $Path"
}

if (-not $ServerUrl.StartsWith("https://") -and -not $ServerUrl.StartsWith("http://")) {
    throw "ServerUrl must start with http:// or https://."
}
if ($ServerUrl.StartsWith("http://") -and -not $AllowCleartext) {
    $HostName = ([Uri]$ServerUrl).Host.ToLowerInvariant()
    $IsLocalCleartext = $HostName -eq "localhost" -or
        $HostName -eq "127.0.0.1" -or
        $HostName -eq "::1" -or
        $HostName.StartsWith("10.") -or
        $HostName.StartsWith("192.168.") -or
        ($HostName -match "^172\.(1[6-9]|2[0-9]|3[0-1])\.")
    if (-not $IsLocalCleartext) {
        throw "Remote hosted frontend mode should use https://. Pass -AllowCleartext only for trusted local debugging."
    }
}

Push-Location $Root
try {
    Configure-AndroidEnvironment

    Invoke-External "Web/PWA production build" { npm run build:web }

    $env:CAP_SERVER_URL = $ServerUrl
    if ($AllowCleartext) {
        $env:CAP_ALLOW_CLEAR_TEXT = "true"
    }
    $env:EXPECTED_CAP_SERVER_URL = $ServerUrl
    Invoke-External "Capacitor sync remote frontend mode" { npm run cap:sync }
    Build-DebugApk
    Invoke-External "Remote-mode APK asset smoke" { npm run smoke:apk }
    $RemoteServerConfig = Get-CapacitorServerSnapshot
    $RemoteApk = Get-ApkInfo

    if ($SkipRestore) {
        Write-Step "Restore bundled mode"
        Write-Output "Skipped by -SkipRestore. CAP_SERVER_URL remains set for the generated Android project."
        $RestoredServerConfig = $null
        $RestoredApk = $null
    } else {
        Remove-Item Env:\CAP_SERVER_URL -ErrorAction SilentlyContinue
        Remove-Item Env:\CAP_ALLOW_CLEAR_TEXT -ErrorAction SilentlyContinue
        Remove-Item Env:\EXPECTED_CAP_SERVER_URL -ErrorAction SilentlyContinue
        Invoke-External "Restore Capacitor bundled assets mode" { npm run cap:sync }
        Build-DebugApk
        Invoke-External "Bundled-mode APK asset smoke" { npm run smoke:apk }
        $RestoredServerConfig = Get-CapacitorServerSnapshot
        $RestoredApk = Get-ApkInfo
    }

    Write-RemoteSmokeReport `
        -Path $ReportPath `
        -Url $ServerUrl `
        -CleartextAllowed ([bool]$AllowCleartext) `
        -RestoreSkipped ([bool]$SkipRestore) `
        -RemoteServerConfig $RemoteServerConfig `
        -RestoredServerConfig $RestoredServerConfig `
        -RemoteApk $RemoteApk `
        -RestoredApk $RestoredApk
    Write-Output ""
    Write-Output "Capacitor remote frontend smoke passed for $ServerUrl."
} finally {
    Restore-EnvironmentVariables
    Pop-Location
}
