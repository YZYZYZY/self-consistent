import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT))

from scripts import smoke_release_bundle  # noqa: E402
from scripts.release_bundle import sha256_file  # noqa: E402


def write_json(path: Path, payload: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def file_summary(path: Path) -> dict:
    return {
        "path": str(path),
        "size_bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


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
    ]


def valid_bundle(tmp_path: Path) -> tuple[Path, dict]:
    bundle = tmp_path / "release-20260605-000000"
    apk = (bundle / "app-debug.apk")
    apk.parent.mkdir(parents=True, exist_ok=True)
    apk.write_bytes(b"apk")
    readiness = write_json(
        bundle / "release-readiness.json",
        {
            "summary": {
                "missing_external": ["deployment", "android_remote_frontend", "android_device"],
                "blocking": ["deployment", "android_remote_frontend", "android_device"],
            },
        },
    )
    local_verify = write_json(
        bundle / "local-evidence" / "local-verify.json",
        {"status": "ok", "steps": local_verify_steps()},
    )
    deepseek = write_json(
        bundle / "external-evidence" / "deepseek-smoke.json",
        {
            "status": "ok",
            "provider": "deepseek",
            "api_key_recorded": False,
            "reply_non_empty": True,
            "action_card": {"estimated_minutes": 2},
        },
    )
    manifest = {
        "bundle_dir": str(bundle),
        "apk": file_summary(apk),
        "readiness_report": file_summary(readiness),
        "readiness_summary": {
            "missing_external": ["deployment", "android_remote_frontend", "android_device"],
            "blocking": ["deployment", "android_remote_frontend", "android_device"],
        },
        "local_evidence": {"local_verify": file_summary(local_verify)},
        "ignored_local_evidence": {},
        "missing_local_evidence_reports": [],
        "external_evidence": {"deepseek": file_summary(deepseek)},
        "supplemental_evidence": {},
        "ignored_external_evidence": {},
        "missing_external_evidence_reports": ["deployment", "android_device", "android_remote_frontend"],
        "remaining_external_evidence": ["deployment", "android_remote_frontend", "android_device"],
    }
    write_json(bundle / "release-manifest.json", manifest)
    return bundle, manifest


def test_release_bundle_smoke_accepts_valid_bundle(tmp_path: Path):
    bundle, manifest = valid_bundle(tmp_path)

    smoke_release_bundle.validate_file_summary(manifest["apk"], "APK", bundle)
    smoke_release_bundle.validate_local_evidence(manifest, bundle)
    smoke_release_bundle.validate_external_evidence(manifest, bundle)


def test_release_bundle_smoke_rejects_hash_mismatch(tmp_path: Path):
    bundle, manifest = valid_bundle(tmp_path)
    manifest["apk"]["sha256"] = "bad"

    try:
        smoke_release_bundle.validate_file_summary(manifest["apk"], "APK", bundle)
    except AssertionError as exc:
        assert "sha256" in str(exc)
    else:
        raise AssertionError("Expected APK hash mismatch to fail")


def test_release_bundle_smoke_requires_local_verify_evidence(tmp_path: Path):
    bundle, manifest = valid_bundle(tmp_path)
    manifest["local_evidence"] = {}

    try:
        smoke_release_bundle.validate_local_evidence(manifest, bundle)
    except AssertionError as exc:
        assert "local_verify" in str(exc)
    else:
        raise AssertionError("Expected missing local verification evidence to fail")


def test_release_bundle_smoke_requires_deepseek_evidence(tmp_path: Path):
    bundle, manifest = valid_bundle(tmp_path)
    manifest["external_evidence"] = {}

    try:
        smoke_release_bundle.validate_external_evidence(manifest, bundle)
    except AssertionError as exc:
        assert "DeepSeek" in str(exc)
    else:
        raise AssertionError("Expected missing DeepSeek evidence to fail")


def test_release_bundle_smoke_validates_external_collection_supplemental(tmp_path: Path):
    bundle, manifest = valid_bundle(tmp_path)
    collection = write_json(
        bundle / "external-evidence" / "external-evidence-collection.json",
        {
            "status": "partial",
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
        },
    )
    manifest["supplemental_evidence"] = {"external_collection": file_summary(collection)}

    smoke_release_bundle.validate_external_evidence(manifest, bundle)


def test_release_bundle_smoke_rejects_invalid_external_collection_supplemental(tmp_path: Path):
    bundle, manifest = valid_bundle(tmp_path)
    collection = write_json(
        bundle / "external-evidence" / "external-evidence-collection.json",
        {
            "status": "ok",
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
        },
    )
    manifest["supplemental_evidence"] = {"external_collection": file_summary(collection)}

    try:
        smoke_release_bundle.validate_external_evidence(manifest, bundle)
    except AssertionError as exc:
        assert "partial" in str(exc)
    else:
        raise AssertionError("Expected invalid external collection supplemental evidence to fail")
