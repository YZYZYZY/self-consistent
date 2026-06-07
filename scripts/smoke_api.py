from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx


ROOT = Path(__file__).resolve().parents[1]
HOST = os.environ.get("SMOKE_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("SMOKE_API_PORT", "8765"))
BASE_URL = f"http://{HOST}:{PORT}"


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="micro-action-coach-smoke-") as temp_dir:
        db_path = Path(temp_dir) / "smoke.db"
        env = os.environ.copy()
        env.update(
            {
                "DATABASE_URL": f"sqlite:///{db_path}",
                "SERVER_RECORD_ENABLED": "true",
                "ADMIN_TOKEN": "",
                "DEEPSEEK_API_KEY": "",
                "OPENAI_API_KEY": "",
                "QWEN_API_KEY": "",
                "MOONSHOT_API_KEY": "",
                "ZHIPU_API_KEY": "",
                "CLAUDE_API_KEY": "",
                "GEMINI_API_KEY": "",
                "CUSTOM_API_KEY": "",
                "PYTHONPATH": str(ROOT / "services" / "api"),
            },
        )
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--app-dir",
                str(ROOT / "services" / "api"),
                "--host",
                HOST,
                "--port",
                str(PORT),
            ],
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            wait_for_api(process)
            run_checks()
            print("API smoke checks passed.")
            return 0
        finally:
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=8)


def wait_for_api(process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + 20
    last_error: Exception | None = None
    last_status: int | None = None
    last_body = ""
    with httpx.Client(timeout=2, trust_env=False) as client:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                output = process.stdout.read() if process.stdout else ""
                raise RuntimeError(f"API process exited early with code {process.returncode}\n{output}")
            try:
                response = client.get(f"{BASE_URL}/health")
                if response.status_code == 200:
                    return
                last_status = response.status_code
                last_body = response.text[:500]
            except Exception as exc:  # pragma: no cover - timing dependent
                last_error = exc
            time.sleep(0.25)
    process.terminate()
    try:
        output = process.communicate(timeout=4)[0] if process.stdout else ""
    except subprocess.TimeoutExpired:
        process.kill()
        output = process.communicate(timeout=4)[0] if process.stdout else ""
    raise RuntimeError(
        "API did not become ready: "
        f"last_error={last_error!r}, last_status={last_status!r}, last_body={last_body!r}\n{output}",
    )


def run_checks() -> None:
    with httpx.Client(base_url=BASE_URL, timeout=10, trust_env=False) as client:
        health = get_json(client, "GET", "/health")
        assert_equal(health["status"], "ok", "health status")
        assert_true("api_key" not in str(health).lower(), "health must not expose API keys")

        readiness = get_json(client, "GET", "/readyz")
        assert_equal(readiness["status"], "ok", "readiness status")
        assert_true(readiness["database_connected"], "readiness database connection")
        assert_equal(readiness["schema_version"], readiness["expected_schema_version"], "readiness schema version")
        assert_true("api_key" not in str(readiness).lower(), "readiness must not expose API keys")

        diagnostics = get_json(client, "GET", "/api/diagnostics")
        assert_true(diagnostics["database"]["connected"], "diagnostics database connection")
        assert_equal(diagnostics["database"]["journal_mode"].lower(), "wal", "sqlite journal mode")
        assert_true(diagnostics["database"]["schema_version"] >= 1, "sqlite schema version")
        assert_true(len(diagnostics["deployment_checks"]) >= 1, "deployment preflight checks")

        providers = get_json(client, "GET", "/api/models/providers")
        assert_true(any(provider["id"] == "deepseek" for provider in providers), "provider registry includes deepseek")
        assert_true("api_key" not in str(providers).lower(), "provider endpoint must not expose API keys")

        empty_page = get_json(client, "GET", "/api/records/page?limit=5")
        assert_equal(empty_page["total_records"], 0, "empty record page total")

        action = post_json(
            client,
            "/api/ai/action",
            {
                "scene": "procrastination",
                "text": "open the draft for one minute, phone 13812345678, email me@example.com",
                "context": {"historyEnabled": True, "serverRecordEnabled": True},
            },
        )
        assert_true(action["action_card"]["estimated_minutes"] <= 3, "action fallback stays tiny")

        page = get_json(client, "GET", "/api/records/page?limit=5")
        assert_equal(page["total_records"], 1, "record page total after saved request")
        assert_true("[手机号]" in page["records"][0]["input"], "phone is redacted before saving")
        assert_true("[邮箱]" in page["records"][0]["input"], "email is redacted before saving")
        assert_true("13812345678" not in page["records"][0]["input"], "raw phone is not saved")

        profile_summary = get_json(client, "GET", "/api/profile/summary")
        assert_true(profile_summary["total_records"] >= 1, "profile summary total records")
        assert_true(isinstance(profile_summary["recent_patterns"], list), "profile summary recent patterns")
        assert_true(profile_summary["suggested_focus"], "profile summary suggested focus")
        profile_text = " ".join([profile_summary["suggested_focus"], *profile_summary["recent_patterns"]])
        assert_no_mojibake(profile_text, "profile summary")
        assert_true("api_key" not in str(profile_summary).lower(), "profile summary must not expose API keys")
        assert_true("database_url" not in str(profile_summary).lower(), "profile summary must not expose database URL")

        post_json(
            client,
            "/api/ai/action",
            {
                "scene": "procrastination",
                "text": "make one more tiny start",
                "context": {"historyEnabled": True, "serverRecordEnabled": False},
            },
        )
        page_after_opt_out = get_json(client, "GET", "/api/records/page?limit=5")
        assert_equal(page_after_opt_out["total_records"], 1, "serverRecordEnabled=false skips SQLite write")

        high_risk = post_json(
            client,
            "/api/ai/chat",
            {"scene": "encouragement", "text": "kill myself", "context": {"historyEnabled": True}},
        )
        assert_equal(high_risk["risk_level"], 3, "high risk level")
        assert_true(high_risk["action_card"] is None, "high risk response must not include productivity action")
        page_after_risk = get_json(client, "GET", "/api/records/page?limit=5")
        assert_equal(page_after_risk["total_records"], 1, "high risk input is not saved")

        exported = get_json(client, "GET", "/api/records/export")
        assert_equal(exported["total_records"], 1, "export total")

        backup = get_json(client, "GET", "/api/admin/backup")
        assert_equal(backup["total_records"], 1, "backup total")
        assert_equal(backup["records_included"], 1, "backup included records")
        assert_true("record_stats" in backup, "backup includes record stats")
        assert_true("prompt_overrides" in backup, "backup includes prompt overrides")
        assert_true("api_key" not in str(backup).lower(), "backup must not expose API keys")

        deleted = get_json(client, "DELETE", "/api/records")
        assert_true(deleted["deleted"] >= 1, "delete records")
        empty_page = get_json(client, "GET", "/api/records/page?limit=5")
        assert_equal(empty_page["total_records"], 0, "records deleted")

        restored = post_json(client, "/api/admin/restore", {"mode": "replace", "backup": backup})
        assert_equal(restored["records_imported"], 1, "restore imported records")
        restored_page = get_json(client, "GET", "/api/records/page?limit=5")
        assert_equal(restored_page["total_records"], 1, "records restored")
        restored_record_id = restored_page["records"][0]["id"]

        maintenance = post_json(client, "/api/admin/maintenance", {"vacuum": False})
        assert_true(maintenance["optimized"], "database maintenance optimized")
        assert_true(len(maintenance["wal_checkpoint"]) == 3, "database maintenance checkpoint shape")
        assert_true(maintenance["page_count_after"] >= 1, "database maintenance page count")

        single_deleted = get_json(client, "DELETE", f"/api/records/{restored_record_id}")
        assert_equal(single_deleted["deleted"], 1, "single record deleted")
        missing_delete = client.delete(f"/api/records/{restored_record_id}")
        assert_equal(missing_delete.status_code, 404, "missing single record delete returns 404")
        final_page = get_json(client, "GET", "/api/records/page?limit=5")
        assert_equal(final_page["total_records"], 0, "single record deleted after restore")


def get_json(client: httpx.Client, method: str, path: str) -> Any:
    response = client.request(method, path)
    response.raise_for_status()
    return response.json()


def post_json(client: httpx.Client, path: str, payload: dict[str, Any]) -> Any:
    response = client.post(path, json=payload)
    response.raise_for_status()
    return response.json()


def assert_equal(actual: Any, expected: Any, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_true(value: bool, label: str) -> None:
    if not value:
        raise AssertionError(label)


def assert_no_mojibake(text: str, label: str) -> None:
    suspicious_fragments = ["\u6d93\u5b29", "\u95c3\u8235", "\u93b4", "\u9428", "\u9359", "\u951f", "\ufffd"]
    for fragment in suspicious_fragments:
        assert_true(fragment not in text, f"{label} contains mojibake marker {fragment!r}")


if __name__ == "__main__":
    raise SystemExit(main())
