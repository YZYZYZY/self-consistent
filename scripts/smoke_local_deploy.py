from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

from smoke_deploy import (
    TIMEOUT_SECONDS,
    check_admin_export,
    check_admin_maintenance,
    check_admin_single_record_delete_route,
    check_backend,
    check_backend_operational_headers,
    check_cors,
    check_frontend,
    check_record_stats_and_cursor,
    check_safety_endpoint,
)


ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = ROOT / "apps" / "web" / "dist"
HOST = os.environ.get("SMOKE_LOCAL_HOST", "127.0.0.1")
FRONTEND_PORT = int(os.environ.get("SMOKE_LOCAL_FRONTEND_PORT", "8873"))
BACKEND_PORT = int(os.environ.get("SMOKE_LOCAL_BACKEND_PORT", "8874"))
FRONTEND_URL = f"http://{HOST}:{FRONTEND_PORT}"
BACKEND_URL = f"http://{HOST}:{BACKEND_PORT}"
ADMIN_TOKEN = "local-deploy-smoke-token"


def main() -> int:
    if not (DIST_DIR / "index.html").exists():
        raise RuntimeError("apps/web/dist is missing. Run `npm run build:web` before `npm run smoke:local-deploy`.")

    with tempfile.TemporaryDirectory(prefix="micro-action-coach-local-deploy-") as temp_dir:
        db_path = Path(temp_dir) / "local-deploy.db"
        api_process = start_api_process(db_path)
        web_process = start_frontend_process()
        try:
            wait_for_http(web_process, FRONTEND_URL, "frontend")
            wait_for_http(api_process, f"{BACKEND_URL}/health", "backend")
            run_checks()
            print(
                "Local deployment smoke checks passed: "
                f"frontend={FRONTEND_URL}, backend={BACKEND_URL}, admin_check=True",
            )
            return 0
        finally:
            terminate_process(web_process)
            terminate_process(api_process)


def start_api_process(db_path: Path) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env.update(
        {
            "DATABASE_URL": f"sqlite:///{db_path}",
            "SERVER_RECORD_ENABLED": "true",
            "ADMIN_TOKEN": ADMIN_TOKEN,
            "CORS_ORIGINS": FRONTEND_URL,
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
    return subprocess.Popen(
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
            str(BACKEND_PORT),
        ],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def start_frontend_process() -> subprocess.Popen[str]:
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "http.server",
            str(FRONTEND_PORT),
            "--bind",
            HOST,
            "--directory",
            str(DIST_DIR),
        ],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def wait_for_http(process: subprocess.Popen[str], url: str, label: str) -> None:
    deadline = time.monotonic() + 20
    last_error: Exception | None = None
    last_status: int | None = None
    with httpx.Client(timeout=2, trust_env=False, follow_redirects=True) as client:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                output = process.stdout.read() if process.stdout else ""
                raise RuntimeError(f"{label} process exited early with code {process.returncode}\n{output}")
            try:
                response = client.get(url)
                if response.status_code == 200:
                    return
                last_status = response.status_code
            except Exception as exc:  # pragma: no cover - timing dependent
                last_error = exc
            time.sleep(0.25)
    raise RuntimeError(f"{label} did not become ready: last_error={last_error!r}, last_status={last_status!r}")


def run_checks() -> None:
    with httpx.Client(timeout=TIMEOUT_SECONDS, trust_env=False, follow_redirects=True) as client:
        check_frontend(client, FRONTEND_URL)
        check_backend(client, BACKEND_URL)
        check_backend_operational_headers(client, BACKEND_URL)
        check_record_stats_and_cursor(client, BACKEND_URL)
        check_cors(client, BACKEND_URL, FRONTEND_URL)
        check_safety_endpoint(client, BACKEND_URL)
        check_admin_export(client, BACKEND_URL, ADMIN_TOKEN)
        check_admin_maintenance(client, BACKEND_URL, ADMIN_TOKEN)
        check_admin_single_record_delete_route(client, BACKEND_URL, ADMIN_TOKEN)


def terminate_process(process: subprocess.Popen[str]) -> None:
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=8)


if __name__ == "__main__":
    raise SystemExit(main())
