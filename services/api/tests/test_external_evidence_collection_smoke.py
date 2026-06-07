import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from scripts.smoke_external_evidence_collection import validate_external_evidence_collection  # noqa: E402


def collection_report(status: str = "partial", **overrides) -> dict:
    report = {
        "status": status,
        "plan_only": False,
        "duration_ms": 120,
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


def test_external_evidence_collection_accepts_partial_with_blockers(tmp_path: Path):
    report = collection_report()

    validate_external_evidence_collection(report, tmp_path / "external-evidence.json")


def test_external_evidence_collection_accepts_ok_without_blockers(tmp_path: Path):
    report = collection_report(
        "ok",
        final_readiness={"blocking": [], "missing_external": [], "report": "artifacts/nonexistent-release-readiness-for-test.json"},
        steps=[
            {"name": "Frontend API base predeploy smoke", "status": "ok"},
            {"name": "Deployed frontend/backend smoke", "status": "ok"},
            {"name": "Remote hosted frontend Android shell smoke", "status": "ok"},
            {"name": "Physical Android phone smoke", "status": "ok"},
            {"name": "Release readiness after external evidence", "status": "ok"},
        ],
    )

    validate_external_evidence_collection(report, tmp_path / "external-evidence.json")


def test_external_evidence_collection_rejects_ok_with_blockers(tmp_path: Path):
    report = collection_report("ok")

    try:
        validate_external_evidence_collection(report, tmp_path / "external-evidence.json")
    except AssertionError as exc:
        assert "partial" in str(exc)
    else:
        raise AssertionError("Expected readiness blockers to require partial status")


def test_external_evidence_collection_rejects_partial_without_incomplete_reason(tmp_path: Path):
    report = collection_report(
        "partial",
        final_readiness={"blocking": [], "missing_external": [], "report": "artifacts/nonexistent-release-readiness-for-test.json"},
        steps=[
            {"name": "Frontend API base predeploy smoke", "status": "ok"},
            {"name": "Deployed frontend/backend smoke", "status": "ok"},
            {"name": "Remote hosted frontend Android shell smoke", "status": "ok"},
            {"name": "Physical Android phone smoke", "status": "ok"},
            {"name": "Release readiness after external evidence", "status": "ok"},
        ],
    )

    try:
        validate_external_evidence_collection(report, tmp_path / "external-evidence.json")
    except AssertionError as exc:
        assert "ok" in str(exc)
    else:
        raise AssertionError("Expected complete collection without blockers to require ok status")


def test_external_evidence_collection_compares_existing_readiness_summary(tmp_path: Path):
    readiness = tmp_path / "release-readiness-external.json"
    readiness.write_text(
        json.dumps({"summary": {"blocking": ["android_device"], "missing_external": ["android_device"]}}),
        encoding="utf-8",
    )
    report = collection_report(
        final_readiness={
            "blocking": ["deployment"],
            "missing_external": ["deployment"],
            "report": str(readiness),
        },
    )

    try:
        validate_external_evidence_collection(report, tmp_path / "external-evidence.json")
    except AssertionError as exc:
        assert "blocking summary" in str(exc)
    else:
        raise AssertionError("Expected collector and readiness summaries to match")


def test_external_evidence_collection_requires_failed_status_for_failed_steps(tmp_path: Path):
    report = collection_report(
        "partial",
        steps=[
            {"name": "Frontend API base predeploy smoke", "status": "ok"},
            {"name": "Deployed frontend/backend smoke", "status": "failed"},
            {"name": "Remote hosted frontend Android shell smoke", "status": "skipped"},
            {"name": "Physical Android phone smoke", "status": "skipped"},
            {"name": "Release readiness after external evidence", "status": "ok"},
        ],
    )

    try:
        validate_external_evidence_collection(report, tmp_path / "external-evidence.json")
    except AssertionError as exc:
        assert "failed" in str(exc)
    else:
        raise AssertionError("Expected failed step to require failed collection status")
