from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPORT = ROOT / "artifacts" / "official-urls.json"
REQUIRED_STEPS = {
    "Build frontend with official backend URL",
    "Verify frontend bundle API base",
    "Verify deployed frontend/backend",
    "Sync Capacitor shell to official frontend URL",
    "Build and verify official remote Android APK",
}
INCOMPLETE_STEP_STATUSES = {"planned", "skipped"}


def main() -> int:
    report_path = resolve_report_path()
    report = load_json(report_path)
    validate_official_urls_report(report)
    print(
        "Official URL smoke checks passed: "
        f"report={report_path}, status={report.get('status')}, "
        f"frontend={report.get('frontend_url')}, backend={report.get('backend_url')}",
    )
    return 0


def resolve_report_path() -> Path:
    value = os.environ.get("OFFICIAL_URLS_REPORT", "").strip()
    if not value:
        return DEFAULT_REPORT
    path = Path(value)
    return path if path.is_absolute() else (ROOT / path).resolve()


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise AssertionError(f"Official URL report not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    assert_true(isinstance(data, dict), "official URL report must be a JSON object")
    return data


def validate_official_urls_report(report: dict[str, Any]) -> None:
    status = str(report.get("status") or "")
    assert_true(status in {"ok", "partial", "failed"}, "official URL status must be ok, partial, or failed")
    assert_true(isinstance(report.get("plan_only"), bool), "plan_only must be a boolean")

    frontend_url = assert_https_origin(report.get("frontend_url"), "frontend_url")
    backend_url = assert_https_origin(report.get("backend_url"), "backend_url")
    assert_equal(report.get("vite_api_base_url"), backend_url, "VITE API base URL")

    restored_bundled = bool(report.get("restored_bundled"))
    if restored_bundled:
        assert_true(report.get("cap_server_url") in {None, ""}, "bundled restore must not keep cap_server_url")
    else:
        assert_equal(report.get("cap_server_url"), frontend_url, "Capacitor server URL")

    steps = report.get("steps")
    assert_true(isinstance(steps, list), "steps must be a list")
    step_names = {str(step.get("name")) for step in steps if isinstance(step, dict)}
    assert_true(REQUIRED_STEPS.issubset(step_names), "official URL report is missing required steps")

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
        assert_equal(status, "failed", "failed steps require failed official URL status")
        return
    if report.get("plan_only") is True or incomplete_steps:
        assert_equal(status, "partial", "planned/skipped steps require partial official URL status")
        return

    assert_equal(status, "ok", "complete official URL handoff without skipped steps must be ok")
    apk = report.get("apk")
    assert_true(isinstance(apk, dict), "ok official URL report must include apk info")
    assert_true(bool(apk.get("path")), "apk path must be present")
    assert_true(isinstance(apk.get("size_bytes"), int) and apk["size_bytes"] > 0, "apk size must be positive")
    sha256 = str(apk.get("sha256") or "")
    assert_true(len(sha256) == 64 and all(char in "0123456789abcdef" for char in sha256), "apk sha256 must be lowercase hex")


def assert_https_origin(value: Any, label: str) -> str:
    assert_true(isinstance(value, str) and bool(value.strip()), f"{label} must be present")
    parsed = urlparse(value.strip())
    assert_equal(parsed.scheme, "https", f"{label} scheme")
    assert_true(bool(parsed.netloc), f"{label} host")
    assert_true(parsed.path in {"", "/"}, f"{label} must be an origin without path")
    return f"{parsed.scheme}://{parsed.netloc}"


def assert_true(value: bool, label: str) -> None:
    if not value:
        raise AssertionError(label)


def assert_equal(actual: Any, expected: Any, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


if __name__ == "__main__":
    raise SystemExit(main())
