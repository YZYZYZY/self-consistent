from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

try:
    from smoke_external_evidence_collection import validate_external_evidence_collection
except ModuleNotFoundError:  # pragma: no cover - import path differs under pytest
    from scripts.smoke_external_evidence_collection import validate_external_evidence_collection


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS_DIR = ROOT / "artifacts"
APK_PATH = ROOT / "apps" / "web" / "android" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
DIST_DIR = ROOT / "apps" / "web" / "dist"
EXTERNAL_EVIDENCE_FILES = {
    "deepseek": ARTIFACTS_DIR / "deepseek-smoke.json",
    "deployment": ARTIFACTS_DIR / "deploy-smoke.json",
    "android_device": ARTIFACTS_DIR / "android-smoke.json",
    "android_remote_frontend": ARTIFACTS_DIR / "android-remote-assets-smoke.json",
}
LOCAL_VERIFY_REPORT = ARTIFACTS_DIR / "local-verify.json"
EXTERNAL_COLLECTION_REPORT = ARTIFACTS_DIR / "external-evidence-collection.json"


def main() -> int:
    require_file(APK_PATH, "Android debug APK")
    require_file(DIST_DIR / "index.html", "Web/PWA dist index.html")
    require_file(DIST_DIR / "manifest.webmanifest", "Web/PWA manifest")
    require_file(DIST_DIR / "sw.js", "Web/PWA service worker")

    bundle_dir = ARTIFACTS_DIR / f"release-{time.strftime('%Y%m%d-%H%M%S')}"
    bundle_dir.mkdir(parents=True, exist_ok=False)
    readiness_report = bundle_dir / "release-readiness.json"
    apk_copy = bundle_dir / APK_PATH.name

    run_readiness(readiness_report)
    shutil.copy2(APK_PATH, apk_copy)
    local_evidence = copy_local_evidence(bundle_dir)
    external_evidence = copy_external_evidence(bundle_dir)

    manifest = build_manifest(bundle_dir, readiness_report, apk_copy, local_evidence, external_evidence)
    manifest_path = bundle_dir / "release-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("Release bundle created:")
    print(f"- directory: {bundle_dir}")
    print(f"- apk: {apk_copy}")
    print(f"- readiness: {readiness_report}")
    print(f"- manifest: {manifest_path}")
    for key, copied in local_evidence.get("copied", {}).items():
        print(f"- local evidence ({key}): {copied['path']}")
    for key, reason in local_evidence.get("ignored", {}).items():
        print(f"- ignored local evidence ({key}): {reason}")
    if local_evidence.get("missing"):
        print(f"- missing local evidence reports: {', '.join(local_evidence['missing'])}")
    for key, copied in external_evidence["copied"].items():
        print(f"- external evidence ({key}): {copied['path']}")
    for key, copied in external_evidence.get("supplemental", {}).items():
        print(f"- supplemental evidence ({key}): {copied['path']}")
    for key, reason in external_evidence.get("ignored", {}).items():
        print(f"- ignored external evidence ({key}): {reason}")
    if external_evidence["missing"]:
        print(f"- missing external evidence reports: {', '.join(external_evidence['missing'])}")
    print(f"- apk_sha256: {manifest['apk']['sha256']}")
    return 0


def require_file(path: Path, label: str) -> None:
    if not path.exists():
        raise RuntimeError(f"{label} was not found at {path}. Run `npm run verify:local -- -SkipDeepSeek -SkipDeploy` first.")


def run_readiness(report_path: Path) -> None:
    env = os.environ.copy()
    env["RELEASE_READINESS_REPORT"] = str(report_path)
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "release_readiness.py")],
        cwd=ROOT,
        env=env,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"release_readiness.py failed with exit code {result.returncode}.")


def copy_external_evidence(bundle_dir: Path) -> dict:
    target_dir = bundle_dir / "external-evidence"
    copied: dict[str, dict] = {}
    missing: list[str] = []
    supplemental: dict[str, dict] = {}
    ignored: dict[str, str] = {}

    for key, source in EXTERNAL_EVIDENCE_FILES.items():
        if not source.exists():
            missing.append(key)
            continue
        if key == "deepseek" and not is_valid_deepseek_report(source):
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / "deepseek-unverified-smoke.json"
            shutil.copy2(source, target)
            supplemental["deepseek_unverified"] = file_summary(target)
            ignored[key] = "deepseek-smoke.json exists but is not valid real-provider evidence."
            missing.append(key)
            continue
        if key == "deployment" and not is_valid_deployment_report(source):
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / "deploy-unverified-smoke.json"
            shutil.copy2(source, target)
            supplemental["deployment_unverified"] = file_summary(target)
            ignored[key] = "deploy-smoke.json exists but is not valid deployed frontend/backend evidence."
            missing.append(key)
            continue
        if key == "android_device" and not is_valid_physical_android_report(source):
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / "android-emulator-smoke.json"
            shutil.copy2(source, target)
            supplemental["android_emulator"] = file_summary(target)
            ignored[key] = "android-smoke.json exists but is not physical-phone evidence."
            missing.append(key)
            continue
        if key == "android_remote_frontend" and not is_valid_remote_android_report(source):
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / "android-remote-unverified-smoke.json"
            shutil.copy2(source, target)
            supplemental["android_remote_unverified"] = file_summary(target)
            ignored[key] = (
                "android-remote-assets-smoke.json exists but does not prove a real deployed HTTPS frontend."
            )
            missing.append(key)
            continue
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / source.name
        shutil.copy2(source, target)
        copied[key] = file_summary(target)

    copy_external_collection_evidence(target_dir, supplemental, ignored)
    return {"copied": copied, "missing": missing, "supplemental": supplemental, "ignored": ignored}


def copy_external_collection_evidence(target_dir: Path, supplemental: dict[str, dict], ignored: dict[str, str]) -> None:
    if not EXTERNAL_COLLECTION_REPORT.exists():
        return
    target_dir.mkdir(parents=True, exist_ok=True)
    try:
        report = json.loads(EXTERNAL_COLLECTION_REPORT.read_text(encoding="utf-8-sig"))
        if not isinstance(report, dict):
            raise AssertionError("external evidence collection report must be a JSON object")
        validate_external_evidence_collection(report, EXTERNAL_COLLECTION_REPORT)
    except (OSError, json.JSONDecodeError, AssertionError) as exc:
        target = target_dir / "external-evidence-collection-unverified.json"
        shutil.copy2(EXTERNAL_COLLECTION_REPORT, target)
        supplemental["external_collection_unverified"] = file_summary(target)
        ignored["external_collection"] = f"external-evidence-collection.json exists but is not valid collection evidence: {exc}"
        return
    target = target_dir / EXTERNAL_COLLECTION_REPORT.name
    shutil.copy2(EXTERNAL_COLLECTION_REPORT, target)
    supplemental["external_collection"] = file_summary(target)


def copy_local_evidence(bundle_dir: Path) -> dict:
    target_dir = bundle_dir / "local-evidence"
    copied: dict[str, dict] = {}
    missing: list[str] = []
    ignored: dict[str, str] = {}

    if not LOCAL_VERIFY_REPORT.exists():
        missing.append("local_verify")
        return {"copied": copied, "missing": missing, "ignored": ignored}
    if not is_valid_local_verify_report(LOCAL_VERIFY_REPORT):
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / "local-verify-unverified.json"
        shutil.copy2(LOCAL_VERIFY_REPORT, target)
        ignored["local_verify"] = "local-verify.json exists but is not a successful local verification report."
        missing.append("local_verify")
        return {"copied": copied, "missing": missing, "ignored": ignored}

    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / LOCAL_VERIFY_REPORT.name
    shutil.copy2(LOCAL_VERIFY_REPORT, target)
    copied["local_verify"] = file_summary(target)
    return {"copied": copied, "missing": missing, "ignored": ignored}


def build_manifest(
    bundle_dir: Path,
    readiness_report: Path,
    apk_copy: Path,
    local_evidence: dict,
    external_evidence: dict,
) -> dict:
    readiness = json.loads(readiness_report.read_text(encoding="utf-8"))
    return {
        "generated_at": int(time.time()),
        "bundle_dir": str(bundle_dir),
        "apk": file_summary(apk_copy),
        "readiness_report": file_summary(readiness_report),
        "readiness_summary": readiness.get("summary", {}),
        "local_evidence": local_evidence.get("copied", {}),
        "ignored_local_evidence": local_evidence.get("ignored", {}),
        "missing_local_evidence_reports": local_evidence.get("missing", []),
        "external_evidence": external_evidence["copied"],
        "supplemental_evidence": external_evidence.get("supplemental", {}),
        "ignored_external_evidence": external_evidence.get("ignored", {}),
        "missing_external_evidence_reports": external_evidence["missing"],
        "remaining_external_evidence": readiness.get("summary", {}).get("missing_external", []),
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


def load_json_report(path: Path) -> dict | None:
    try:
        report = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return None
    return report if isinstance(report, dict) else None


def is_valid_status_report(report: dict | None) -> bool:
    return bool(report and report.get("status") == "ok")


def is_valid_deepseek_report(path: Path) -> bool:
    report = load_json_report(path)
    if not is_valid_status_report(report):
        return False
    action_card = report.get("action_card")
    if not isinstance(action_card, dict):
        return False
    estimated_minutes = action_card.get("estimated_minutes")
    return (
        report.get("provider") == "deepseek"
        and report.get("api_key_recorded") is False
        and report.get("reply_non_empty") is True
        and isinstance(estimated_minutes, int)
        and estimated_minutes <= 3
    )


def is_valid_deployment_report(path: Path) -> bool:
    report = load_json_report(path)
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


def is_valid_local_verify_report(path: Path) -> bool:
    report = load_json_report(path)
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


def is_valid_physical_android_report(path: Path) -> bool:
    report = load_json_report(path)
    if not is_valid_status_report(report) or report.get("manifest_only") is True:
        return False
    device = report.get("device")
    if not isinstance(device, dict):
        return False
    serial = str(device.get("serial") or "")
    if device.get("is_emulator") is True:
        return False
    if not serial or is_probable_emulator(serial):
        return False
    if not is_valid_apk_summary(report.get("apk")):
        return False
    checks = report.get("checks")
    if not isinstance(checks, list):
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


def is_valid_remote_android_report(path: Path) -> bool:
    report = load_json_report(path)
    if not is_valid_status_report(report):
        return False
    server_url = str(report.get("server_url") or "")
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
    if not is_valid_apk_summary(report.get("remote_apk")):
        return False
    if not is_valid_apk_summary(report.get("restored_apk")):
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


def is_probable_emulator(serial: str) -> bool:
    normalized = serial.lower()
    return normalized.startswith("emulator-") or "qemu" in normalized or normalized.startswith("127.0.0.1:")


if __name__ == "__main__":
    raise SystemExit(main())
