import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from scripts import release_bundle as release_bundle_module  # noqa: E402
from scripts.release_bundle import (  # noqa: E402
    is_valid_deepseek_report,
    is_valid_deployment_report,
    is_valid_local_verify_report,
    is_valid_physical_android_report,
    is_valid_remote_android_report,
)


def write_report(path: Path, payload: dict) -> Path:
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def remote_checks() -> list[str]:
    return [
        "capacitor_remote_sync",
        "android_debug_apk_build",
        "remote_mode_apk_assets",
        "capacitor_bundled_restore",
        "bundled_mode_apk_assets",
    ]


def apk_summary(name: str = "app-debug.apk") -> dict:
    return {
        "path": f"C:/tmp/{name}",
        "size_bytes": 123456,
        "sha256": "a" * 64,
    }


def remote_report(server_url: str = "https://micro-action.example.com", **overrides) -> dict:
    host = server_url.split("://", 1)[1].split("/", 1)[0].lower() if "://" in server_url else ""
    report = {
        "status": "ok",
        "server_url": server_url,
        "server_url_host": host,
        "server_url_is_https": server_url.startswith("https://"),
        "server_url_is_placeholder": host == "example.micro-action-coach.test",
        "restored_bundled_mode": True,
        "remote_server_config": {
            "exists": True,
            "has_url": True,
            "url": server_url,
            "cleartext": False,
            "android_scheme": None,
        },
        "restored_server_config": {
            "exists": True,
            "has_url": False,
            "url": None,
            "cleartext": None,
            "android_scheme": "https",
        },
        "remote_apk": apk_summary("remote-app-debug.apk"),
        "restored_apk": apk_summary("restored-app-debug.apk"),
        "checks": remote_checks(),
    }
    report.update(overrides)
    return report


def physical_android_report(**overrides) -> dict:
    report = {
        "status": "ok",
        "manifest_only": False,
        "package_name": "com.selfconsistent.microactioncoach",
        "apk": apk_summary(),
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


def deploy_checks() -> list[str]:
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


def test_deepseek_evidence_requires_key_redaction_and_small_action_card(tmp_path: Path):
    valid = write_report(
        tmp_path / "deepseek-valid.json",
        {
            "status": "ok",
            "provider": "deepseek",
            "api_key_recorded": False,
            "reply_non_empty": True,
            "action_card": {"estimated_minutes": 2},
        },
    )
    leaked_key = write_report(
        tmp_path / "deepseek-leaked.json",
        {
            "status": "ok",
            "provider": "deepseek",
            "api_key_recorded": True,
            "reply_non_empty": True,
            "action_card": {"estimated_minutes": 2},
        },
    )
    too_large = write_report(
        tmp_path / "deepseek-too-large.json",
        {
            "status": "ok",
            "provider": "deepseek",
            "api_key_recorded": False,
            "reply_non_empty": True,
            "action_card": {"estimated_minutes": 8},
        },
    )

    assert is_valid_deepseek_report(valid) is True
    assert is_valid_deepseek_report(leaked_key) is False
    assert is_valid_deepseek_report(too_large) is False


def test_deployment_evidence_requires_core_live_checks(tmp_path: Path):
    valid = write_report(
        tmp_path / "deploy-valid.json",
        {
            "status": "ok",
            "frontend_url": "https://app.example.com",
            "backend_url": "https://api.example.com",
            "checks_run": deploy_checks(),
        },
    )
    missing_cors = write_report(
        tmp_path / "deploy-missing-cors.json",
        {
            "status": "ok",
            "frontend_url": "https://app.example.com",
            "backend_url": "https://api.example.com",
            "checks_run": [check for check in deploy_checks() if check != "cors"],
        },
    )
    failed = write_report(
        tmp_path / "deploy-failed.json",
        {
            "status": "failed",
            "frontend_url": "https://app.example.com",
            "backend_url": "https://api.example.com",
            "checks_run": deploy_checks(),
        },
    )

    assert is_valid_deployment_report(valid) is True
    assert is_valid_deployment_report(missing_cors) is False
    assert is_valid_deployment_report(failed) is False


def test_deployment_evidence_requires_declared_optional_checks(tmp_path: Path):
    missing_ai = write_report(
        tmp_path / "deploy-missing-ai.json",
        {
            "status": "ok",
            "frontend_url": "https://app.example.com",
            "backend_url": "https://api.example.com",
            "ai_check": True,
            "checks_run": deploy_checks(),
        },
    )
    missing_admin_route = write_report(
        tmp_path / "deploy-missing-admin-route.json",
        {
            "status": "ok",
            "frontend_url": "https://app.example.com",
            "backend_url": "https://api.example.com",
            "admin_check": True,
            "checks_run": deploy_checks() + ["admin_backup_restore", "admin_maintenance"],
        },
    )
    valid_optional = write_report(
        tmp_path / "deploy-valid-optional.json",
        {
            "status": "ok",
            "frontend_url": "https://app.example.com",
            "backend_url": "https://api.example.com",
            "ai_check": True,
            "admin_check": True,
            "checks_run": deploy_checks() + optional_deploy_checks(),
        },
    )

    assert is_valid_deployment_report(missing_ai) is False
    assert is_valid_deployment_report(missing_admin_route) is False
    assert is_valid_deployment_report(valid_optional) is True


def test_remote_android_evidence_rejects_placeholder_frontend(tmp_path: Path):
    placeholder = write_report(
        tmp_path / "remote-placeholder.json",
        remote_report("https://example.micro-action-coach.test"),
    )
    deployed = write_report(
        tmp_path / "remote-deployed.json",
        remote_report(),
    )

    assert is_valid_remote_android_report(placeholder) is False
    assert is_valid_remote_android_report(deployed) is True


def test_remote_android_evidence_requires_explicit_https_and_non_placeholder_flags(tmp_path: Path):
    missing_https_flag = write_report(
        tmp_path / "remote-missing-https-flag.json",
        remote_report(server_url_is_https=None),
    )
    missing_placeholder_flag = write_report(
        tmp_path / "remote-missing-placeholder-flag.json",
        remote_report(server_url_is_placeholder=None),
    )
    explicit_placeholder = write_report(
        tmp_path / "remote-explicit-placeholder.json",
        remote_report(server_url_is_placeholder=True),
    )
    explicit_non_https = write_report(
        tmp_path / "remote-explicit-non-https.json",
        remote_report(server_url_is_https=False),
    )

    assert is_valid_remote_android_report(missing_https_flag) is False
    assert is_valid_remote_android_report(missing_placeholder_flag) is False
    assert is_valid_remote_android_report(explicit_placeholder) is False
    assert is_valid_remote_android_report(explicit_non_https) is False


def test_remote_android_evidence_requires_config_restore_and_apk_hash(tmp_path: Path):
    missing_remote_config = write_report(
        tmp_path / "remote-missing-config.json",
        remote_report(remote_server_config=None),
    )
    wrong_remote_url = write_report(
        tmp_path / "remote-wrong-url.json",
        remote_report(remote_server_config={"exists": True, "has_url": True, "url": "https://other.example.com"}),
    )
    restore_still_remote = write_report(
        tmp_path / "remote-not-restored.json",
        remote_report(
            restored_server_config={
                "exists": True,
                "has_url": True,
                "url": "https://micro-action.example.com",
                "android_scheme": None,
            },
        ),
    )
    missing_apk_hash = write_report(
        tmp_path / "remote-no-apk-hash.json",
        remote_report(remote_apk={"path": "C:/tmp/app-debug.apk", "size_bytes": 123456}),
    )

    assert is_valid_remote_android_report(missing_remote_config) is False
    assert is_valid_remote_android_report(wrong_remote_url) is False
    assert is_valid_remote_android_report(restore_still_remote) is False
    assert is_valid_remote_android_report(missing_apk_hash) is False


def test_physical_android_evidence_requires_dial_and_apk_hash(tmp_path: Path):
    valid = write_report(tmp_path / "android-valid.json", physical_android_report())
    missing_dial = write_report(
        tmp_path / "android-missing-dial.json",
        physical_android_report(
            checks=[
                "manifest_permissions",
                "safety_tel_links",
                "apk_install",
                "app_launch_foreground",
                "installed_permissions",
            ],
        ),
    )
    missing_hash = write_report(
        tmp_path / "android-missing-hash.json",
        physical_android_report(apk={"path": "C:/tmp/app-debug.apk", "size_bytes": 123456}),
    )
    explicit_emulator = write_report(
        tmp_path / "android-explicit-emulator.json",
        physical_android_report(device={"serial": "phone123", "model": "Pixel Test", "is_emulator": True}),
    )

    assert is_valid_physical_android_report(valid) is True
    assert is_valid_physical_android_report(missing_dial) is False
    assert is_valid_physical_android_report(missing_hash) is False
    assert is_valid_physical_android_report(explicit_emulator) is False


def test_local_verify_evidence_requires_core_steps(tmp_path: Path):
    valid = write_report(
        tmp_path / "local-verify-valid.json",
        {
            "status": "ok",
            "steps": local_verify_steps(),
        },
    )
    missing_apk_smoke = write_report(
        tmp_path / "local-verify-missing-apk.json",
        {
            "status": "ok",
            "steps": [step for step in local_verify_steps() if step["name"] != "APK asset smoke"],
        },
    )
    failed_test = write_report(
        tmp_path / "local-verify-failed.json",
        {
            "status": "ok",
            "steps": [
                {**step, "status": "failed"} if step["name"] == "Web tests" else step
                for step in local_verify_steps()
            ],
        },
    )

    assert is_valid_local_verify_report(valid) is True
    assert is_valid_local_verify_report(missing_apk_smoke) is False
    assert is_valid_local_verify_report(failed_test) is False


def test_local_verify_evidence_accepts_utf8_bom_from_powershell(tmp_path: Path):
    report = tmp_path / "local-verify-bom.json"
    report.write_text(
        json.dumps({"status": "ok", "steps": local_verify_steps()}),
        encoding="utf-8-sig",
    )

    assert is_valid_local_verify_report(report) is True


def external_collection_report(status: str = "partial", **overrides) -> dict:
    report = {
        "status": status,
        "plan_only": False,
        "final_readiness": {
            "blocking": ["deployment"],
            "missing_external": ["deployment"],
            "report": "artifacts/nonexistent-release-readiness-for-test.json",
        },
        "steps": [
            {"name": "Frontend API base predeploy smoke", "status": "skipped"},
            {"name": "Deployed frontend/backend smoke", "status": "skipped"},
            {"name": "Remote hosted frontend Android shell smoke", "status": "skipped"},
            {"name": "Physical Android phone smoke", "status": "skipped"},
            {"name": "Release readiness after external evidence", "status": "ok"},
        ],
    }
    report.update(overrides)
    return report


def test_release_bundle_copies_valid_external_collection_as_supplemental(monkeypatch, tmp_path: Path):
    source = write_report(tmp_path / "external-evidence-collection.json", external_collection_report())
    monkeypatch.setattr(release_bundle_module, "EXTERNAL_COLLECTION_REPORT", source)
    supplemental: dict[str, dict] = {}
    ignored: dict[str, str] = {}

    release_bundle_module.copy_external_collection_evidence(tmp_path / "external-evidence", supplemental, ignored)

    assert "external_collection" in supplemental
    assert ignored == {}
    assert Path(supplemental["external_collection"]["path"]).name == "external-evidence-collection.json"


def test_release_bundle_keeps_invalid_external_collection_as_unverified(monkeypatch, tmp_path: Path):
    source = write_report(tmp_path / "external-evidence-collection.json", external_collection_report("ok"))
    monkeypatch.setattr(release_bundle_module, "EXTERNAL_COLLECTION_REPORT", source)
    supplemental: dict[str, dict] = {}
    ignored: dict[str, str] = {}

    release_bundle_module.copy_external_collection_evidence(tmp_path / "external-evidence", supplemental, ignored)

    assert "external_collection_unverified" in supplemental
    assert "external_collection" in ignored
