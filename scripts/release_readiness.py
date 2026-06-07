from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import hashlib
from dataclasses import asdict, dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APK_PATH = ROOT / "apps" / "web" / "android" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
DIST_DIR = ROOT / "apps" / "web" / "dist"
CAP_CONFIG = ROOT / "apps" / "web" / "android" / "app" / "src" / "main" / "assets" / "capacitor.config.json"
DEEPSEEK_REPORT = ROOT / "artifacts" / "deepseek-smoke.json"
DEPLOY_REPORT = ROOT / "artifacts" / "deploy-smoke.json"
ANDROID_REPORT = ROOT / "artifacts" / "android-smoke.json"
ANDROID_REMOTE_REPORT = ROOT / "artifacts" / "android-remote-assets-smoke.json"
LOCAL_VERIFY_REPORT = ROOT / "artifacts" / "local-verify.json"
TRUTHY = {"1", "true", "yes", "on"}


@dataclass
class Check:
    key: str
    label: str
    status: str
    detail: str
    command: str = ""
    report_path: str = ""
    external: bool = False


def main() -> int:
    strict = os.environ.get("RELEASE_READINESS_STRICT", "").strip().lower() in TRUTHY
    checks = [
        check_dist(),
        check_apk(),
        check_bundled_mode(),
        check_local_verify_report(),
        check_deepseek_env(),
        check_deploy_env(),
        check_remote_android_frontend(),
        check_android_device(),
    ]

    print("Release readiness audit")
    print("=======================")
    for check in checks:
        marker = {"ok": "OK", "warn": "WARN", "missing": "MISSING"}[check.status]
        print(f"[{marker}] {check.label}: {check.detail}")
        if check.command:
            print(f"      run: {check.command}")
        if check.report_path:
            print(f"      report: {check.report_path}")

    missing_external = [check for check in checks if check.external and check.status != "ok"]
    blocking_checks = [check for check in checks if check.status != "ok"]
    if missing_external:
        print("")
        print("External release evidence still required:")
        for check in missing_external:
            print(f"- {check.label}")

    if strict and blocking_checks:
        print("")
        print("Strict release blockers:")
        for check in blocking_checks:
            print(f"- {check.label} ({check.status})")
        write_report_if_requested(checks, strict, missing_external, blocking_checks)
        raise SystemExit(1)

    print("")
    print(
        "Readiness audit complete. "
        + ("Strict mode passed." if strict else "Use RELEASE_READINESS_STRICT=true for final blocking release checks."),
    )
    write_report_if_requested(checks, strict, missing_external, blocking_checks)
    return 0


def write_report_if_requested(
    checks: list[Check],
    strict: bool,
    missing_external: list[Check],
    blocking_checks: list[Check],
) -> None:
    report_path = os.environ.get("RELEASE_READINESS_REPORT", "").strip()
    if not report_path:
        return
    path = Path(report_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": int(time.time()),
        "strict": strict,
        "summary": {
            "total": len(checks),
            "ok": sum(1 for check in checks if check.status == "ok"),
            "warn": sum(1 for check in checks if check.status == "warn"),
            "missing": sum(1 for check in checks if check.status == "missing"),
            "missing_external": [check.key for check in missing_external],
            "blocking": [check.key for check in blocking_checks],
        },
        "checks": [asdict(check) for check in checks],
        "artifacts": artifact_summary(),
    }
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Readiness report written: {path}")


def artifact_summary() -> dict:
    return {
        "apk": file_summary(APK_PATH) if APK_PATH.exists() else None,
        "web_dist": web_dist_summary(),
        "capacitor_config": file_summary(CAP_CONFIG) if CAP_CONFIG.exists() else None,
        "local_verify": file_summary(LOCAL_VERIFY_REPORT) if LOCAL_VERIFY_REPORT.exists() else None,
    }


def web_dist_summary() -> dict | None:
    if not DIST_DIR.exists():
        return None
    files = [path for path in DIST_DIR.rglob("*") if path.is_file()]
    assets = [path for path in files if path.relative_to(DIST_DIR).as_posix().startswith("assets/")]
    core_files = {
        relative: file_summary(DIST_DIR / relative)
        for relative in ["index.html", "manifest.webmanifest", "sw.js"]
        if (DIST_DIR / relative).exists()
    }
    return {
        "path": str(DIST_DIR),
        "file_count": len(files),
        "total_size_bytes": sum(path.stat().st_size for path in files),
        "asset_count": len(assets),
        "asset_size_bytes": sum(path.stat().st_size for path in assets),
        "core_files": core_files,
    }


def file_summary(path: Path) -> dict:
    return {
        "path": str(path),
        "size_bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_dist() -> Check:
    index = DIST_DIR / "index.html"
    manifest = DIST_DIR / "manifest.webmanifest"
    sw = DIST_DIR / "sw.js"
    if index.exists() and manifest.exists() and sw.exists():
        return Check(
            key="dist",
            label="Web/PWA production build",
            status="ok",
            detail="dist contains index.html, manifest.webmanifest, and sw.js.",
            command="npm run build:web",
        )
    return Check(
        key="dist",
        label="Web/PWA production build",
        status="missing",
        detail="dist is missing core PWA files.",
        command="npm run build:web",
    )


def check_apk() -> Check:
    if APK_PATH.exists():
        size = APK_PATH.stat().st_size
        return Check(
            key="apk",
            label="Android debug APK",
            status="ok",
            detail=f"APK exists at {APK_PATH} ({size} bytes).",
            command="npm run cap:sync && cd apps\\web\\android && .\\gradlew.bat assembleDebug --no-daemon",
        )
    return Check(
        key="apk",
        label="Android debug APK",
        status="missing",
        detail=f"APK not found at {APK_PATH}.",
        command="npm run cap:sync && cd apps\\web\\android && .\\gradlew.bat assembleDebug --no-daemon",
    )


def check_bundled_mode() -> Check:
    if not CAP_CONFIG.exists():
        return Check(
            key="capacitor_mode",
            label="Capacitor bundled mode",
            status="missing",
            detail="capacitor.config.json has not been generated.",
            command="npm run cap:sync",
        )
    text = CAP_CONFIG.read_text(encoding="utf-8")
    if '"url"' in text:
        return Check(
            key="capacitor_mode",
            label="Capacitor bundled mode",
            status="warn",
            detail="Android assets currently contain a remote server.url. This is fine for remote-mode testing, but bundled release checks expect it cleared.",
            command="Remove-Item Env:\\CAP_SERVER_URL -ErrorAction SilentlyContinue; npm run cap:sync",
        )
    return Check(
        key="capacitor_mode",
        label="Capacitor bundled mode",
        status="ok",
        detail="Android assets do not pin a remote server.url.",
        command="npm run smoke:apk",
    )


def check_local_verify_report() -> Check:
    report = load_json_report(LOCAL_VERIFY_REPORT)
    if is_valid_local_verify_report(report):
        steps = report.get("steps", [])
        skipped = [str(step.get("name")) for step in steps if isinstance(step, dict) and step.get("status") == "skipped"]
        detail = f"Existing successful local verification report found at {relative(LOCAL_VERIFY_REPORT)}."
        if skipped:
            detail += f" Skipped optional steps: {', '.join(skipped)}."
        return Check(
            key="local_verify",
            label="Local verification report",
            status="ok",
            detail=detail,
            command="$env:VERIFY_LOCAL_REPORT='artifacts/local-verify.json'; npm run verify:local",
            report_path="artifacts/local-verify.json",
        )
    return Check(
        key="local_verify",
        label="Local verification report",
        status="missing",
        detail="No successful artifacts/local-verify.json report was found.",
        command="$env:VERIFY_LOCAL_REPORT='artifacts/local-verify.json'; npm run verify:local",
        report_path="artifacts/local-verify.json",
    )


def check_deepseek_env() -> Check:
    report = load_json_report(DEEPSEEK_REPORT)
    if is_valid_deepseek_report(report):
        return Check(
            key="deepseek",
            label="Real DeepSeek provider smoke",
            status="ok",
            detail=f"Existing successful DeepSeek smoke report found at {relative(DEEPSEEK_REPORT)}.",
            command="$env:DEEPSEEK_SMOKE_REPORT='artifacts/deepseek-smoke.json'; npm run smoke:deepseek",
            report_path="artifacts/deepseek-smoke.json",
            external=True,
        )
    if os.environ.get("DEEPSEEK_API_KEY", "").strip():
        return Check(
            key="deepseek",
            label="Real DeepSeek provider smoke",
            status="missing",
            detail="DEEPSEEK_API_KEY is set, but no successful artifacts/deepseek-smoke.json report was found.",
            command="$env:DEEPSEEK_SMOKE_REPORT='artifacts/deepseek-smoke.json'; npm run smoke:deepseek",
            report_path="artifacts/deepseek-smoke.json",
            external=True,
        )
    return Check(
        key="deepseek",
        label="Real DeepSeek provider smoke",
        status="missing",
        detail="DEEPSEEK_API_KEY is not set and no successful artifacts/deepseek-smoke.json report was found.",
        command="$env:DEEPSEEK_API_KEY='...'; $env:DEEPSEEK_SMOKE_REPORT='artifacts/deepseek-smoke.json'; npm run smoke:deepseek",
        report_path="artifacts/deepseek-smoke.json",
        external=True,
    )


def check_deploy_env() -> Check:
    report = load_json_report(DEPLOY_REPORT)
    if is_valid_deployment_report(report):
        return Check(
            key="deployment",
            label="Deployed frontend/backend smoke",
            status="ok",
            detail=f"Existing successful deployment smoke report found at {relative(DEPLOY_REPORT)}.",
            command="$env:SMOKE_DEPLOY_REPORT='artifacts/deploy-smoke.json'; npm run smoke:deploy",
            report_path="artifacts/deploy-smoke.json",
            external=True,
        )
    frontend = os.environ.get("SMOKE_FRONTEND_URL", "").strip()
    backend = os.environ.get("SMOKE_BACKEND_URL", "").strip()
    if frontend and backend:
        return Check(
            key="deployment",
            label="Deployed frontend/backend smoke",
            status="missing",
            detail=(
                "SMOKE_FRONTEND_URL and SMOKE_BACKEND_URL are set, but no successful "
                "artifacts/deploy-smoke.json report was found."
            ),
            command="$env:SMOKE_DEPLOY_REPORT='artifacts/deploy-smoke.json'; npm run smoke:deploy",
            report_path="artifacts/deploy-smoke.json",
            external=True,
        )
    missing = []
    if not frontend:
        missing.append("SMOKE_FRONTEND_URL")
    if not backend:
        missing.append("SMOKE_BACKEND_URL")
    return Check(
        key="deployment",
        label="Deployed frontend/backend smoke",
        status="missing",
        detail=", ".join(missing) + " not set.",
        command="$env:SMOKE_FRONTEND_URL='https://...'; $env:SMOKE_BACKEND_URL='https://...'; $env:SMOKE_DEPLOY_REPORT='artifacts/deploy-smoke.json'; npm run smoke:deploy",
        report_path="artifacts/deploy-smoke.json",
        external=True,
    )


def check_android_device() -> Check:
    report = load_json_report(ANDROID_REPORT)
    if is_valid_physical_android_report(report):
        return Check(
            key="android_device",
            label="Physical Android phone smoke",
            status="ok",
            detail=f"Existing successful physical Android smoke report found at {relative(ANDROID_REPORT)}.",
            command="$env:ANDROID_SMOKE_REPORT='artifacts/android-smoke.json'; npm run smoke:android",
            report_path="artifacts/android-smoke.json",
            external=True,
        )
    adb = find_adb()
    if not adb:
        return Check(
            key="android_device",
            label="Physical Android phone smoke",
            status="missing",
            detail="adb was not found.",
            command="Set ANDROID_HOME or add Android platform-tools to PATH; $env:ANDROID_SMOKE_REPORT='artifacts/android-smoke.json'; npm run smoke:android",
            report_path="artifacts/android-smoke.json",
            external=True,
        )
    try:
        result = subprocess.run([adb, "devices"], check=True, capture_output=True, text=True, timeout=8)
    except (subprocess.SubprocessError, OSError) as exc:
        return Check(
            key="android_device",
            label="Physical Android phone smoke",
            status="missing",
            detail=f"adb devices failed: {exc}",
            command="$env:ANDROID_SMOKE_REPORT='artifacts/android-smoke.json'; npm run smoke:android",
            report_path="artifacts/android-smoke.json",
            external=True,
        )
    devices = [
        line.split()[0]
        for line in result.stdout.splitlines()[1:]
        if line.strip() and line.split()[1:] == ["device"]
    ]
    if len(devices) == 1:
        if is_probable_emulator(devices[0]):
            return Check(
                key="android_device",
                label="Physical Android phone smoke",
                status="warn",
                detail=f"Only an emulator-like adb device is connected: {devices[0]}. Emulator smoke is useful but does not replace physical-phone verification.",
                command="Connect one USB-debugging physical Android phone; $env:ANDROID_SMOKE_REPORT='artifacts/android-smoke.json'; npm run smoke:android",
                report_path="artifacts/android-smoke.json",
                external=True,
            )
        return Check(
            key="android_device",
            label="Physical Android phone smoke",
            status="missing",
            detail=f"One physical adb device is connected ({devices[0]}), but no successful physical Android smoke report was found.",
            command="$env:ANDROID_SMOKE_REPORT='artifacts/android-smoke.json'; npm run smoke:android",
            report_path="artifacts/android-smoke.json",
            external=True,
        )
    if len(devices) > 1:
        physical_candidates = [device for device in devices if not is_probable_emulator(device)]
        if len(physical_candidates) == 1:
            return Check(
                key="android_device",
                label="Physical Android phone smoke",
                status="warn",
                detail=f"Multiple adb devices are connected; choose the physical candidate {physical_candidates[0]} with ANDROID_SERIAL.",
                command=f"$env:ANDROID_SERIAL='{physical_candidates[0]}'; $env:ANDROID_SMOKE_REPORT='artifacts/android-smoke.json'; npm run smoke:android",
                report_path="artifacts/android-smoke.json",
                external=True,
            )
        return Check(
            key="android_device",
            label="Physical Android phone smoke",
            status="warn",
            detail=f"Multiple adb devices connected: {', '.join(devices)}. Set ANDROID_SERIAL.",
            command="$env:ANDROID_SERIAL='...'; $env:ANDROID_SMOKE_REPORT='artifacts/android-smoke.json'; npm run smoke:android",
            report_path="artifacts/android-smoke.json",
            external=True,
        )
    return Check(
        key="android_device",
        label="Physical Android phone smoke",
        status="missing",
        detail="No adb device is connected.",
        command="Connect one USB-debugging Android phone; $env:ANDROID_SMOKE_REPORT='artifacts/android-smoke.json'; npm run smoke:android",
        report_path="artifacts/android-smoke.json",
        external=True,
    )


def check_remote_android_frontend() -> Check:
    report = load_json_report(ANDROID_REMOTE_REPORT)
    if is_valid_remote_android_report(report):
        return Check(
            key="android_remote_frontend",
            label="Remote hosted frontend Android shell smoke",
            status="ok",
            detail=f"Existing successful remote-front-end Android shell report found at {relative(ANDROID_REMOTE_REPORT)}.",
            command="$env:ANDROID_REMOTE_SMOKE_REPORT='artifacts/android-remote-assets-smoke.json'; npm run smoke:android:remote-assets",
            report_path="artifacts/android-remote-assets-smoke.json",
            external=True,
        )
    frontend = os.environ.get("SMOKE_FRONTEND_URL", "").strip()
    if frontend:
        return Check(
            key="android_remote_frontend",
            label="Remote hosted frontend Android shell smoke",
            status="missing",
            detail="SMOKE_FRONTEND_URL is set, but no successful artifacts/android-remote-assets-smoke.json report was found.",
            command="$env:ANDROID_REMOTE_SMOKE_REPORT='artifacts/android-remote-assets-smoke.json'; powershell -ExecutionPolicy Bypass -File scripts\\smoke_capacitor_remote.ps1 -ServerUrl $env:SMOKE_FRONTEND_URL",
            report_path="artifacts/android-remote-assets-smoke.json",
            external=True,
        )
    return Check(
        key="android_remote_frontend",
        label="Remote hosted frontend Android shell smoke",
        status="missing",
        detail="No successful artifacts/android-remote-assets-smoke.json report was found.",
        command="$env:SMOKE_FRONTEND_URL='https://your-frontend.example'; $env:ANDROID_REMOTE_SMOKE_REPORT='artifacts/android-remote-assets-smoke.json'; powershell -ExecutionPolicy Bypass -File scripts\\smoke_capacitor_remote.ps1 -ServerUrl $env:SMOKE_FRONTEND_URL",
        report_path="artifacts/android-remote-assets-smoke.json",
        external=True,
    )


def find_adb() -> str:
    android_home = os.environ.get("ANDROID_HOME", "").strip()
    if android_home:
        candidate = Path(android_home) / "platform-tools" / "adb.exe"
        if candidate.exists():
            return str(candidate)
    return shutil.which("adb") or ""


def is_probable_emulator(serial: str) -> bool:
    normalized = serial.lower()
    return normalized.startswith("emulator-") or "qemu" in normalized or normalized.startswith("127.0.0.1:")


def relative(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def load_json_report(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def is_valid_status_report(report: dict | None) -> bool:
    return bool(report and report.get("status") == "ok")


def is_valid_deepseek_report(report: dict | None) -> bool:
    if not is_valid_status_report(report):
        return False
    action_card = report.get("action_card")
    if not isinstance(action_card, dict):
        return False
    return (
        report.get("provider") == "deepseek"
        and report.get("api_key_recorded") is False
        and report.get("reply_non_empty") is True
        and isinstance(action_card.get("estimated_minutes"), int)
        and action_card["estimated_minutes"] <= 3
    )


def is_valid_deployment_report(report: dict | None) -> bool:
    if not is_valid_status_report(report):
        return False
    frontend_url = str(report.get("frontend_url") or "")
    backend_url = str(report.get("backend_url") or "")
    if not frontend_url.startswith(("http://", "https://")) or not backend_url.startswith(("http://", "https://")):
        return False
    checks_run = report.get("checks_run")
    if not isinstance(checks_run, list):
        return False
    required_checks = {
        "frontend",
        "frontend_api_base",
        "backend",
        "backend_operational_headers",
        "backend_record_stats_and_cursor",
        "backend_profile_summary",
        "cors",
        "safety_intercept",
    }
    normalized_checks = {str(check) for check in checks_run}
    if not required_checks.issubset(normalized_checks):
        return False
    if report.get("ai_check") is True and "ai_action" not in normalized_checks:
        return False
    if report.get("admin_check") is True:
        required_admin_checks = {"admin_backup_restore", "admin_maintenance", "admin_single_record_delete_route"}
        if not required_admin_checks.issubset(normalized_checks):
            return False
    return True


def is_valid_local_verify_report(report: dict | None) -> bool:
    if not report or report.get("status") != "ok":
        return False
    steps = report.get("steps")
    if not isinstance(steps, list):
        return False
    by_name = {
        str(step.get("name")): str(step.get("status"))
        for step in steps
        if isinstance(step, dict)
    }
    required_ok_steps = {
        "Web lint",
        "Web tests",
        "FastAPI tests",
        "FastAPI local smoke",
        "Backend deployment config smoke",
        "Static deployment config smoke",
        "Web/PWA production build",
        "Frontend API base smoke",
        "PWA config smoke",
        "Text encoding smoke",
        "Client secret smoke",
        "Local deployment smoke",
        "Android manifest smoke",
        "Capacitor sync",
        "Android debug APK build",
        "Text encoding smoke after Capacitor sync",
        "Client secret smoke after Capacitor sync",
        "APK asset smoke",
    }
    return all(by_name.get(step) == "ok" for step in required_ok_steps)


def is_valid_physical_android_report(report: dict | None) -> bool:
    if not is_valid_status_report(report) or report.get("manifest_only") is True:
        return False
    device = report.get("device")
    checks = report.get("checks")
    apk = report.get("apk")
    if not isinstance(device, dict) or not device.get("serial"):
        return False
    if device.get("is_emulator") is True:
        return False
    if is_probable_emulator(str(device["serial"])):
        return False
    if not isinstance(checks, list):
        return False
    if not is_valid_apk_summary(apk):
        return False
    required_checks = {
        "manifest_permissions",
        "safety_tel_links",
        "apk_install",
        "app_launch_foreground",
        "installed_permissions",
        "dial_intent_resolvable",
    }
    return required_checks.issubset({str(check) for check in checks})


def is_valid_remote_android_report(report: dict | None) -> bool:
    if not is_valid_status_report(report):
        return False
    server_url = str(report.get("server_url", ""))
    if report.get("server_url_is_https") is not True:
        return False
    if report.get("server_url_is_placeholder") is not False:
        return False
    if not server_url.startswith("https://"):
        return False
    if "example.micro-action-coach.test" in server_url:
        return False
    if report.get("restored_bundled_mode") is not True:
        return False
    remote_server_config = report.get("remote_server_config")
    if not isinstance(remote_server_config, dict):
        return False
    if remote_server_config.get("url") != server_url or remote_server_config.get("has_url") is not True:
        return False
    restored_server_config = report.get("restored_server_config")
    if not isinstance(restored_server_config, dict):
        return False
    if restored_server_config.get("has_url") is not False:
        return False
    if restored_server_config.get("android_scheme") != "https":
        return False
    remote_apk = report.get("remote_apk")
    restored_apk = report.get("restored_apk")
    if not is_valid_apk_summary(remote_apk) or not is_valid_apk_summary(restored_apk):
        return False
    checks = report.get("checks")
    if not isinstance(checks, list):
        return False
    required_checks = {
        "capacitor_remote_sync",
        "android_debug_apk_build",
        "remote_mode_apk_assets",
        "capacitor_bundled_restore",
        "bundled_mode_apk_assets",
    }
    return required_checks.issubset({str(check) for check in checks})


def is_valid_apk_summary(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    sha256 = str(value.get("sha256") or "")
    return (
        bool(value.get("path"))
        and isinstance(value.get("size_bytes"), int)
        and value["size_bytes"] > 0
        and len(sha256) == 64
        and all(character in "0123456789abcdef" for character in sha256)
    )


if __name__ == "__main__":
    raise SystemExit(main())
