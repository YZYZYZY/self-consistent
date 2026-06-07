from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPORT = ROOT / "artifacts" / "external-evidence-collection.json"
REQUIRED_STEPS = {
    "Frontend API base predeploy smoke",
    "Deployed frontend/backend smoke",
    "Remote hosted frontend Android shell smoke",
    "Physical Android phone smoke",
    "Release readiness after external evidence",
}
INCOMPLETE_STEP_STATUSES = {"planned", "skipped"}


def main() -> int:
    report_path = resolve_report_path()
    report = load_json(report_path)
    validate_external_evidence_collection(report, report_path)
    print(
        "External evidence collection smoke checks passed: "
        f"report={report_path}, status={report.get('status')}, "
        f"blocking={report.get('final_readiness', {}).get('blocking', [])}",
    )
    return 0


def resolve_report_path() -> Path:
    value = (
        os.environ.get("EXTERNAL_EVIDENCE_COLLECTION_REPORT", "").strip()
        or os.environ.get("EXTERNAL_EVIDENCE_REPORT", "").strip()
    )
    if not value:
        return DEFAULT_REPORT
    path = Path(value)
    return path if path.is_absolute() else (ROOT / path).resolve()


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise AssertionError(f"External evidence collection report not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    assert_true(isinstance(data, dict), "external evidence report must be a JSON object")
    return data


def validate_external_evidence_collection(report: dict[str, Any], report_path: Path) -> None:
    status = str(report.get("status") or "")
    assert_true(status in {"ok", "partial", "failed"}, "external evidence status must be ok, partial, or failed")
    assert_true(isinstance(report.get("plan_only"), bool), "plan_only must be a boolean")
    steps = report.get("steps")
    assert_true(isinstance(steps, list), "steps must be a list")
    step_names = {str(step.get("name")) for step in steps if isinstance(step, dict)}
    assert_true(REQUIRED_STEPS.issubset(step_names), "external evidence report is missing required steps")

    final_readiness = report.get("final_readiness")
    assert_true(isinstance(final_readiness, dict), "final_readiness must be an object")
    blocking = list_values(final_readiness.get("blocking"))
    missing_external = list_values(final_readiness.get("missing_external"))
    readiness_report = str(final_readiness.get("report") or "")
    assert_true(bool(readiness_report), "final_readiness.report must be present")
    compare_readiness_report_if_present(readiness_report, blocking, missing_external, report_path)

    failed_steps = [
        step
        for step in steps
        if isinstance(step, dict) and str(step.get("status")) == "failed"
    ]
    incomplete_steps = [
        step
        for step in steps
        if isinstance(step, dict) and str(step.get("status")) in INCOMPLETE_STEP_STATUSES
    ]

    if failed_steps:
        assert_equal(status, "failed", "failed steps require failed collection status")
        return
    if report.get("plan_only") is True or incomplete_steps or blocking:
        assert_equal(status, "partial", "planned/skipped steps or readiness blockers require partial status")
        return
    assert_equal(status, "ok", "complete collection without blockers must be ok")


def compare_readiness_report_if_present(
    readiness_report: str,
    blocking: list[str],
    missing_external: list[str],
    collection_report_path: Path,
) -> None:
    path = Path(readiness_report)
    if not path.is_absolute():
        path = (ROOT / path).resolve()
    if not path.exists():
        return
    readiness = load_json(path)
    summary = readiness.get("summary")
    assert_true(isinstance(summary, dict), "readiness report summary must be an object")
    assert_equal(blocking, list_values(summary.get("blocking")), "collector blocking summary")
    assert_equal(missing_external, list_values(summary.get("missing_external")), "collector missing_external summary")
    assert_true(path != collection_report_path.resolve(), "collector report and readiness report must be separate files")


def list_values(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value]


def assert_true(value: bool, label: str) -> None:
    if not value:
        raise AssertionError(label)


def assert_equal(actual: Any, expected: Any, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


if __name__ == "__main__":
    raise SystemExit(main())
