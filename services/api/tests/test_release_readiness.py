import subprocess
import sys
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from scripts import release_readiness  # noqa: E402


def deploy_report(checks: list[str]) -> dict:
    return {
        "status": "ok",
        "frontend_url": "https://app.example.com",
        "backend_url": "https://api.example.com",
        "checks_run": checks,
    }


def required_deploy_checks() -> list[str]:
    return [
        "frontend",
        "frontend_api_base",
        "backend",
        "backend_operational_headers",
        "backend_record_stats_and_cursor",
        "backend_profile_summary",
        "cors",
        "safety_intercept",
    ]


def optional_deploy_checks() -> list[str]:
    return [
        "ai_action",
        "admin_backup_restore",
        "admin_maintenance",
        "admin_single_record_delete_route",
    ]


def remote_android_report(server_url: str = "https://app.example.com", **overrides) -> dict:
    host = server_url.split("://", 1)[1].split("/", 1)[0].lower() if "://" in server_url else ""
    report = {
        "status": "ok",
        "server_url": server_url,
        "server_url_host": host,
        "server_url_is_https": server_url.startswith("https://"),
        "server_url_is_placeholder": host == "example.micro-action-coach.test",
        "restored_bundled_mode": True,
        "remote_server_config": {"exists": True, "has_url": True, "url": server_url, "cleartext": False},
        "restored_server_config": {"exists": True, "has_url": False, "android_scheme": "https"},
        "remote_apk": {"path": "C:/tmp/remote.apk", "size_bytes": 1000, "sha256": "b" * 64},
        "restored_apk": {"path": "C:/tmp/restored.apk", "size_bytes": 1000, "sha256": "c" * 64},
        "checks": [
            "capacitor_remote_sync",
            "android_debug_apk_build",
            "remote_mode_apk_assets",
            "capacitor_bundled_restore",
            "bundled_mode_apk_assets",
        ],
    }
    report.update(overrides)
    return report


def physical_android_report(**overrides) -> dict:
    report = {
        "status": "ok",
        "manifest_only": False,
        "package_name": "com.selfconsistent.microactioncoach",
        "apk": {"path": "C:/tmp/app-debug.apk", "size_bytes": 1000, "sha256": "d" * 64},
        "device": {"serial": "phone123", "model": "Pixel Test", "is_emulator": False},
        "checks": [
            "manifest_permissions",
            "safety_tel_links",
            "apk_install",
            "app_launch_foreground",
            "installed_permissions",
            "dial_intent_resolvable",
        ],
    }
    report.update(overrides)
    return report


def local_verify_steps() -> list[dict]:
    return [
        {"name": "Web lint", "status": "ok"},
        {"name": "Web tests", "status": "ok"},
        {"name": "FastAPI tests", "status": "ok"},
        {"name": "FastAPI local smoke", "status": "ok"},
        {"name": "Backend deployment config smoke", "status": "ok"},
        {"name": "Static deployment config smoke", "status": "ok"},
        {"name": "Web/PWA production build", "status": "ok"},
        {"name": "Frontend API base smoke", "status": "ok"},
        {"name": "PWA config smoke", "status": "ok"},
        {"name": "Text encoding smoke", "status": "ok"},
        {"name": "Client secret smoke", "status": "ok"},
        {"name": "Local deployment smoke", "status": "ok"},
        {"name": "Android manifest smoke", "status": "ok"},
        {"name": "Capacitor sync", "status": "ok"},
        {"name": "Android debug APK build", "status": "ok"},
        {"name": "Text encoding smoke after Capacitor sync", "status": "ok"},
        {"name": "Client secret smoke after Capacitor sync", "status": "ok"},
        {"name": "APK asset smoke", "status": "ok"},
        {"name": "DeepSeek smoke", "status": "skipped"},
        {"name": "Deployment smoke", "status": "skipped"},
    ]


def test_readiness_deployment_validator_requires_core_checks():
    assert release_readiness.is_valid_deployment_report(deploy_report(required_deploy_checks())) is True
    assert (
        release_readiness.is_valid_deployment_report(
            deploy_report([check for check in required_deploy_checks() if check != "safety_intercept"]),
        )
        is False
    )


def test_readiness_deployment_validator_requires_declared_optional_checks():
    ai_report = {**deploy_report(required_deploy_checks()), "ai_check": True}
    admin_report = {**deploy_report(required_deploy_checks()), "admin_check": True}
    full_report = {
        **deploy_report(required_deploy_checks() + optional_deploy_checks()),
        "ai_check": True,
        "admin_check": True,
    }

    assert release_readiness.is_valid_deployment_report(ai_report) is False
    assert release_readiness.is_valid_deployment_report(admin_report) is False
    assert release_readiness.is_valid_deployment_report(full_report) is True


def test_readiness_remote_android_validator_requires_remote_and_restore_snapshots():
    assert release_readiness.is_valid_remote_android_report(remote_android_report()) is True
    assert (
        release_readiness.is_valid_remote_android_report(
            remote_android_report(server_url_is_https=None),
        )
        is False
    )
    assert (
        release_readiness.is_valid_remote_android_report(
            remote_android_report(server_url_is_placeholder=None),
        )
        is False
    )
    assert (
        release_readiness.is_valid_remote_android_report(
            remote_android_report(server_url_is_placeholder=True),
        )
        is False
    )
    assert (
        release_readiness.is_valid_remote_android_report(
            remote_android_report(server_url_is_https=False),
        )
        is False
    )
    assert (
        release_readiness.is_valid_remote_android_report(
            remote_android_report(remote_server_config={"exists": True, "has_url": True, "url": "https://other.example.com"}),
        )
        is False
    )
    assert (
        release_readiness.is_valid_remote_android_report(
            remote_android_report(restored_server_config={"exists": True, "has_url": True, "url": "https://app.example.com"}),
        )
        is False
    )
    assert (
        release_readiness.is_valid_remote_android_report(
            remote_android_report(remote_apk={"path": "C:/tmp/app.apk", "size_bytes": 1000}),
        )
        is False
    )


def test_readiness_physical_android_validator_requires_dial_and_apk_evidence():
    assert release_readiness.is_valid_physical_android_report(physical_android_report()) is True
    assert (
        release_readiness.is_valid_physical_android_report(
            physical_android_report(checks=["apk_install", "app_launch_foreground", "installed_permissions"]),
        )
        is False
    )
    assert (
        release_readiness.is_valid_physical_android_report(
            physical_android_report(apk={"path": "C:/tmp/app-debug.apk", "size_bytes": 1000}),
        )
        is False
    )
    assert (
        release_readiness.is_valid_physical_android_report(
            physical_android_report(device={"serial": "emulator-5554", "model": "Emulator"}),
        )
        is False
    )
    assert (
        release_readiness.is_valid_physical_android_report(
            physical_android_report(device={"serial": "phone123", "model": "Pixel Test", "is_emulator": True}),
        )
        is False
    )


def test_readiness_local_verify_report_status(monkeypatch, tmp_path: Path):
    report_path = tmp_path / "local-verify.json"
    report_path.write_text(json.dumps({"status": "ok", "steps": local_verify_steps()}), encoding="utf-8-sig")
    monkeypatch.setattr(release_readiness, "LOCAL_VERIFY_REPORT", report_path)

    check = release_readiness.check_local_verify_report()

    assert check.status == "ok"
    assert check.external is False
    assert "DeepSeek smoke" in check.detail


def test_readiness_local_verify_report_missing_or_incomplete(monkeypatch, tmp_path: Path):
    missing_path = tmp_path / "missing-local-verify.json"
    monkeypatch.setattr(release_readiness, "LOCAL_VERIFY_REPORT", missing_path)
    assert release_readiness.check_local_verify_report().status == "missing"

    incomplete_path = tmp_path / "incomplete-local-verify.json"
    incomplete_path.write_text(
        json.dumps(
            {
                "status": "ok",
                "steps": [step for step in local_verify_steps() if step["name"] != "APK asset smoke"],
            },
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(release_readiness, "LOCAL_VERIFY_REPORT", incomplete_path)
    assert release_readiness.check_local_verify_report().status == "missing"


def test_readiness_report_includes_all_blocking_checks(monkeypatch, tmp_path: Path):
    report_path = tmp_path / "readiness.json"
    monkeypatch.setenv("RELEASE_READINESS_REPORT", str(report_path))
    checks = [
        release_readiness.Check(key="dist", label="Web/PWA production build", status="ok", detail="ok"),
        release_readiness.Check(key="local_verify", label="Local verification report", status="missing", detail="missing"),
        release_readiness.Check(key="deployment", label="Deployed smoke", status="missing", detail="missing", external=True),
        release_readiness.Check(key="android_device", label="Physical Android", status="warn", detail="emulator", external=True),
    ]

    release_readiness.write_report_if_requested(
        checks,
        strict=True,
        missing_external=[checks[2], checks[3]],
        blocking_checks=[checks[1], checks[2], checks[3]],
    )

    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["summary"]["missing_external"] == ["deployment", "android_device"]
    assert report["summary"]["blocking"] == ["local_verify", "deployment", "android_device"]


def test_deepseek_key_without_report_is_still_missing(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(release_readiness, "DEEPSEEK_REPORT", tmp_path / "missing-deepseek.json")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "present-but-not-evidence")

    check = release_readiness.check_deepseek_env()

    assert check.status == "missing"
    assert check.external is True


def test_deployment_urls_without_report_are_still_missing(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(release_readiness, "DEPLOY_REPORT", tmp_path / "missing-deploy.json")
    monkeypatch.setenv("SMOKE_FRONTEND_URL", "https://app.example.com")
    monkeypatch.setenv("SMOKE_BACKEND_URL", "https://api.example.com")

    check = release_readiness.check_deploy_env()

    assert check.status == "missing"
    assert check.external is True


def test_connected_physical_device_without_report_is_still_missing(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(release_readiness, "ANDROID_REPORT", tmp_path / "missing-android.json")
    monkeypatch.setattr(release_readiness, "find_adb", lambda: "adb")

    def fake_run(*_args, **_kwargs):
        return subprocess.CompletedProcess(args=["adb", "devices"], returncode=0, stdout="List of devices attached\nphone123\tdevice\n")

    monkeypatch.setattr(release_readiness.subprocess, "run", fake_run)

    check = release_readiness.check_android_device()

    assert check.status == "missing"
    assert check.external is True
