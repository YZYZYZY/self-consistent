from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from release_bundle import (
    is_valid_deepseek_report,
    is_valid_deployment_report,
    is_valid_local_verify_report,
    is_valid_physical_android_report,
    is_valid_remote_android_report,
    sha256_file,
)
from smoke_external_evidence_collection import validate_external_evidence_collection


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS_DIR = ROOT / "artifacts"
REQUIRED_CURRENT_BLOCKERS = {"deployment", "android_remote_frontend", "android_device"}


def main() -> int:
    bundle_dir = resolve_bundle_dir()
    manifest_path = bundle_dir / "release-manifest.json"
    manifest = load_json(manifest_path)
    checks_run: list[str] = []

    assert_true(manifest.get("bundle_dir") == str(bundle_dir), "manifest bundle_dir must match the checked bundle")
    checks_run.append("manifest_bundle_dir")

    validate_file_summary(manifest.get("apk"), "APK", bundle_dir)
    validate_file_summary(manifest.get("readiness_report"), "readiness report", bundle_dir)
    checks_run.extend(["apk_hash", "readiness_hash"])

    readiness_report = load_json(Path(manifest["readiness_report"]["path"]))
    readiness_summary = readiness_report.get("summary", {})
    assert_equal(manifest.get("readiness_summary"), readiness_summary, "manifest readiness summary")
    assert_equal(
        manifest.get("remaining_external_evidence", []),
        readiness_summary.get("missing_external", []),
        "remaining external evidence",
    )
    checks_run.append("readiness_summary")

    validate_local_evidence(manifest, bundle_dir)
    checks_run.append("local_evidence")

    validate_external_evidence(manifest, bundle_dir)
    checks_run.append("external_evidence")

    report_path = os.environ.get("RELEASE_BUNDLE_SMOKE_REPORT", "").strip()
    if report_path:
        write_report(report_path, bundle_dir, checks_run, manifest)

    print(
        "Release bundle smoke checks passed: "
        f"bundle={bundle_dir}, local={sorted(manifest.get('local_evidence', {}).keys())}, "
        f"external={sorted(manifest.get('external_evidence', {}).keys())}, "
        f"remaining={manifest.get('remaining_external_evidence', [])}",
    )
    return 0


def resolve_bundle_dir() -> Path:
    requested = os.environ.get("RELEASE_BUNDLE_DIR", "").strip()
    if requested:
        path = Path(requested)
        return path if path.is_absolute() else (ROOT / path).resolve()
    candidates = sorted(
        (path for path in ARTIFACTS_DIR.glob("release-*") if path.is_dir()),
        key=lambda path: path.name,
        reverse=True,
    )
    if not candidates:
        raise RuntimeError("No release bundle directory found under artifacts/release-*.")
    return candidates[0].resolve()


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise AssertionError(f"JSON file not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    assert_true(isinstance(data, dict), f"{path} must contain a JSON object")
    return data


def validate_file_summary(summary: Any, label: str, bundle_dir: Path) -> Path:
    assert_true(isinstance(summary, dict), f"{label} summary must be an object")
    path_value = str(summary.get("path") or "")
    assert_true(bool(path_value), f"{label} summary must include path")
    path = Path(path_value)
    assert_true(path.exists(), f"{label} file must exist: {path}")
    assert_true(path.resolve().is_relative_to(bundle_dir.resolve()), f"{label} must live inside the release bundle")
    assert_equal(summary.get("size_bytes"), path.stat().st_size, f"{label} size")
    assert_equal(summary.get("sha256"), sha256_file(path), f"{label} sha256")
    return path


def validate_local_evidence(manifest: dict[str, Any], bundle_dir: Path) -> None:
    missing = manifest.get("missing_local_evidence_reports", [])
    assert_equal(missing, [], "missing local evidence reports")
    local_evidence = manifest.get("local_evidence")
    assert_true(isinstance(local_evidence, dict), "local_evidence must be an object")
    assert_true("local_verify" in local_evidence, "local_verify evidence must be present")
    local_report = validate_file_summary(local_evidence["local_verify"], "local verification report", bundle_dir)
    assert_true(is_valid_local_verify_report(local_report), "local verification report must be valid")


def validate_external_evidence(manifest: dict[str, Any], bundle_dir: Path) -> None:
    external = manifest.get("external_evidence")
    assert_true(isinstance(external, dict), "external_evidence must be an object")
    assert_true("deepseek" in external, "DeepSeek evidence must be present")
    deepseek_report = validate_file_summary(external["deepseek"], "DeepSeek evidence", bundle_dir)
    assert_true(is_valid_deepseek_report(deepseek_report), "DeepSeek evidence must be valid")

    if "deployment" in external:
        deployment_report = validate_file_summary(external["deployment"], "deployment evidence", bundle_dir)
        assert_true(is_valid_deployment_report(deployment_report), "deployment evidence must be valid")
    if "android_device" in external:
        android_report = validate_file_summary(external["android_device"], "physical Android evidence", bundle_dir)
        assert_true(is_valid_physical_android_report(android_report), "physical Android evidence must be valid")
    if "android_remote_frontend" in external:
        remote_report = validate_file_summary(external["android_remote_frontend"], "remote Android frontend evidence", bundle_dir)
        assert_true(is_valid_remote_android_report(remote_report), "remote Android frontend evidence must be valid")

    supplemental = manifest.get("supplemental_evidence", {})
    assert_true(isinstance(supplemental, dict), "supplemental_evidence must be an object")
    for key, summary in supplemental.items():
        supplemental_report = validate_file_summary(summary, f"supplemental evidence {key}", bundle_dir)
        if key == "external_collection":
            validate_external_evidence_collection(load_json(supplemental_report), supplemental_report)

    missing_external = set(manifest.get("missing_external_evidence_reports", []))
    remaining_external = set(manifest.get("remaining_external_evidence", []))
    assert_true(remaining_external.issubset(missing_external), "remaining external evidence must be listed as missing")
    assert_true(REQUIRED_CURRENT_BLOCKERS.issubset(missing_external), "current release blockers must stay explicit")


def write_report(report_path: str, bundle_dir: Path, checks_run: list[str], manifest: dict[str, Any]) -> None:
    path = Path(report_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": int(time.time()),
        "status": "ok",
        "bundle_dir": str(bundle_dir),
        "checks_run": checks_run,
        "local_evidence": sorted(manifest.get("local_evidence", {}).keys()),
        "external_evidence": sorted(manifest.get("external_evidence", {}).keys()),
        "supplemental_evidence": sorted(manifest.get("supplemental_evidence", {}).keys()),
        "remaining_external_evidence": manifest.get("remaining_external_evidence", []),
    }
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Release bundle smoke report written: {path}")


def assert_true(value: bool, label: str) -> None:
    if not value:
        raise AssertionError(label)


def assert_equal(actual: Any, expected: Any, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


if __name__ == "__main__":
    raise SystemExit(main())
