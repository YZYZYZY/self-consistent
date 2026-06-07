param(
    [switch]$ManifestOnly,
    [string]$ApkPath,
    [string]$PackageName = "com.selfconsistent.microactioncoach",
    [string]$ReportPath
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$ManifestPath = Join-Path $Root "apps\web\android\app\src\main\AndroidManifest.xml"
$AppSourcePath = Join-Path $Root "apps\web\src\App.tsx"

if (-not $ApkPath) {
    $ApkPath = Join-Path $Root "apps\web\android\app\build\outputs\apk\debug\app-debug.apk"
}

if (-not $ReportPath -and $env:ANDROID_SMOKE_REPORT) {
    $ReportPath = $env:ANDROID_SMOKE_REPORT
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )
    if (-not $Condition) {
        throw $Message
    }
}

function Find-Adb {
    if ($env:ANDROID_HOME) {
        $candidate = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    $command = Get-Command adb -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw "adb was not found. Set ANDROID_HOME or add platform-tools to PATH."
}

function Get-AdbTargetArgs {
    param([string]$AdbPath)

    $deviceLines = @(& $AdbPath devices | Select-Object -Skip 1 | Where-Object { $_ -match "\S+\s+device$" })
    if ($env:ANDROID_SERIAL) {
        $matchingDevices = @($deviceLines | Where-Object { $_ -match "^$([regex]::Escape($env:ANDROID_SERIAL))\s+device$" })
        Assert-True ($matchingDevices.Count -gt 0) "ANDROID_SERIAL is set, but that device is not connected."
        return @("-s", $env:ANDROID_SERIAL)
    }

    Assert-True ($deviceLines.Count -gt 0) "No Android device is connected. Connect a phone with USB debugging enabled."
    Assert-True ($deviceLines.Count -eq 1) "Multiple Android devices are connected. Set ANDROID_SERIAL to choose one."

    $serial = ($deviceLines[0] -split "\s+")[0]
    return @("-s", $serial)
}

function Get-AdbTargetSerial {
    param([string[]]$TargetArgs)
    $serialIndex = [Array]::IndexOf($TargetArgs, "-s")
    if ($serialIndex -ge 0 -and $serialIndex + 1 -lt $TargetArgs.Count) {
        return $TargetArgs[$serialIndex + 1]
    }
    return ""
}

function Test-IsProbableEmulator {
    param([string]$Serial)
    $normalized = $Serial.ToLowerInvariant()
    return $normalized.StartsWith("emulator-") -or
        $normalized.Contains("qemu") -or
        $normalized.StartsWith("127.0.0.1:")
}

function Wait-ForForegroundPackage {
    param(
        [string]$AdbPath,
        [string[]]$TargetArgs,
        [string]$PackageName,
        [int]$TimeoutSeconds = 10
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastActivityDump = ""
    do {
        $lastActivityDump = ((& $AdbPath @TargetArgs shell dumpsys activity activities) -join "`n")
        if ($lastActivityDump -match [regex]::Escape($PackageName)) {
            if ($lastActivityDump -match "topResumedActivity=.*$([regex]::Escape($PackageName))" -or
                $lastActivityDump -match "mResumedActivity:.*$([regex]::Escape($PackageName))" -or
                $lastActivityDump -match "ResumedActivity:.*$([regex]::Escape($PackageName))") {
                return $true
            }
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    Write-Output "Last activity dump excerpt:"
    ($lastActivityDump -split "`n" | Where-Object { $_ -match "ResumedActivity|topResumedActivity|mResumedActivity|ActivityRecord" } | Select-Object -First 12) | Write-Output
    return $false
}

function Test-Manifest {
    Assert-True (Test-Path $ManifestPath) "AndroidManifest.xml was not found: $ManifestPath"
    $manifest = Get-Content $ManifestPath -Raw -Encoding UTF8

    Assert-True ($manifest -match "android.permission.INTERNET") "Android manifest must request INTERNET."
    Assert-True ($manifest -match "android.permission.POST_NOTIFICATIONS") "Android manifest must request POST_NOTIFICATIONS for Android 13+ notification prompts."
    Assert-True ($manifest -notmatch "android.permission.CALL_PHONE") "Android manifest must not request CALL_PHONE; emergency links should use ACTION_DIAL/tel links without call permission."
    Assert-True ($manifest -match [regex]::Escape('android:name=".MainActivity"')) "Android manifest must declare MainActivity."
    Assert-True ($manifest -match "android.intent.action.MAIN") "Android manifest must declare a launcher MAIN action."

    Write-Output "Manifest checks passed."
}

function Test-SafetyDialLinks {
    Assert-True (Test-Path $AppSourcePath) "App.tsx was not found: $AppSourcePath"
    $source = Get-Content $AppSourcePath -Raw -Encoding UTF8

    Assert-True ($source -match 'href=\{`tel:\$\{number\}`\}') "DialLink must use tel: links rather than direct call APIs."
    foreach ($number in @("12356", "110", "120")) {
        Assert-True ($source -match "DialLink number=`"$number`"") "Safety support must expose tel:$number."
    }

    Write-Output "Safety dial link source checks passed."
}

function Test-DialIntentResolvable {
    param(
        [string]$AdbPath,
        [string[]]$TargetArgs
    )

    foreach ($number in @("12356", "110", "120")) {
        $output = (& $AdbPath @TargetArgs shell cmd package resolve-activity --brief -a android.intent.action.DIAL -d "tel:$number") -join "`n"
        Assert-True ($LASTEXITCODE -eq 0) "ACTION_DIAL resolve command failed for tel:$number."
        Assert-True ($output -notmatch "No activity found") "No Android dial activity resolved for tel:$number."
    }

    Write-Output "ACTION_DIAL resolve checks passed."
}

function Get-FileSha256 {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        return $null
    }
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-SmokeReport {
    param(
        [string]$Path,
        [bool]$ManifestOnlyMode,
        [string]$Apk,
        [string]$Package,
        [string]$Serial,
        [string]$Model,
        [bool]$IsEmulator = $false
    )

    if (-not $Path) {
        return
    }

    $parent = Split-Path -Parent $Path
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }

    $apkInfo = $null
    if ($Apk -and (Test-Path $Apk)) {
        $apkFile = Get-Item $Apk
        $apkInfo = @{
            path = $apkFile.FullName
            size_bytes = $apkFile.Length
            sha256 = Get-FileSha256 -Path $apkFile.FullName
        }
    }

    $checks = @("manifest_permissions")
    $checks += "safety_tel_links"
    if (-not $ManifestOnlyMode) {
        $checks += "apk_install"
        $checks += "app_launch_foreground"
        $checks += "installed_permissions"
        $checks += "dial_intent_resolvable"
    }

    $report = @{
        generated_at = [int][double]::Parse((Get-Date -UFormat %s))
        status = "ok"
        manifest_only = $ManifestOnlyMode
        package_name = $Package
        apk = $apkInfo
        device = @{
            serial = $Serial
            model = $Model
            is_emulator = $IsEmulator
        }
        checks = $checks
    }

    $report | ConvertTo-Json -Depth 6 | Set-Content -Path $Path -Encoding UTF8
    Write-Output "Android smoke report written: $Path"
}

Test-Manifest
Test-SafetyDialLinks

if ($ManifestOnly) {
    Write-SmokeReport -Path $ReportPath -ManifestOnlyMode $true -Apk $ApkPath -Package $PackageName -Serial "" -Model "" -IsEmulator $false
    Write-Output "Android smoke manifest-only checks passed."
    exit 0
}

Assert-True (Test-Path $ApkPath) "Debug APK was not found: $ApkPath"

$adb = Find-Adb
$targetArgs = Get-AdbTargetArgs -AdbPath $adb
$targetSerial = Get-AdbTargetSerial -TargetArgs $targetArgs
$targetModel = ((& $adb @targetArgs shell getprop ro.product.model) -join "`n").Trim()
$targetIsEmulator = Test-IsProbableEmulator -Serial $targetSerial
Write-Output "Using Android device: serial=$targetSerial model=$targetModel is_emulator=$targetIsEmulator"

Write-Output "Installing APK: $ApkPath"
& $adb @targetArgs install -r $ApkPath | Write-Output
Assert-True ($LASTEXITCODE -eq 0) "APK install failed."

Write-Output "Launching package: $PackageName"
& $adb @targetArgs shell monkey -p $PackageName -c android.intent.category.LAUNCHER 1 | Write-Output
Assert-True ($LASTEXITCODE -eq 0) "APK launch failed."
Assert-True (Wait-ForForegroundPackage -AdbPath $adb -TargetArgs $targetArgs -PackageName $PackageName) "Package did not become the foreground activity after launch."
Write-Output "Foreground activity check passed for package: $PackageName"

$packagePath = (& $adb @targetArgs shell pm path $PackageName) -join "`n"
Assert-True ($packagePath -match "package:") "Installed package was not found after install."

$permissionDump = (& $adb @targetArgs shell dumpsys package $PackageName) -join "`n"
Assert-True ($permissionDump -match "android.permission.INTERNET") "Installed package is missing INTERNET permission."
Assert-True ($permissionDump -match "android.permission.POST_NOTIFICATIONS") "Installed package is missing POST_NOTIFICATIONS permission."
Assert-True ($permissionDump -notmatch "android.permission.CALL_PHONE") "Installed package unexpectedly requests CALL_PHONE permission."
Test-DialIntentResolvable -AdbPath $adb -TargetArgs $targetArgs

Write-SmokeReport -Path $ReportPath -ManifestOnlyMode $false -Apk $ApkPath -Package $PackageName -Serial $targetSerial -Model $targetModel -IsEmulator $targetIsEmulator
Write-Output "Android device smoke checks passed."
