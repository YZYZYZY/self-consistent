from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx


TIMEOUT_SECONDS = 12
TRUTHY = {"1", "true", "yes", "on"}


def main() -> int:
    frontend_url = normalize_origin(required_env("SMOKE_FRONTEND_URL"))
    backend_url = normalize_origin(required_env("SMOKE_BACKEND_URL"))
    admin_token = os.environ.get("SMOKE_ADMIN_TOKEN", "").strip()
    report_path = os.environ.get("SMOKE_DEPLOY_REPORT", "").strip()
    run_ai_check = os.environ.get("SMOKE_DEPLOY_AI", "false").strip().lower() in TRUTHY
    checks_run = [
        "frontend",
        "frontend_api_base",
        "backend",
        "backend_operational_headers",
        "backend_record_stats_and_cursor",
        "backend_profile_summary",
        "cors",
        "safety_intercept",
    ]

    with httpx.Client(timeout=TIMEOUT_SECONDS, trust_env=False, follow_redirects=True) as client:
        check_frontend(client, frontend_url, backend_url=backend_url, check_cache_headers=True)
        check_backend(client, backend_url)
        check_backend_operational_headers(client, backend_url)
        check_record_stats_and_cursor(client, backend_url)
        check_profile_summary(client, backend_url)
        check_cors(client, backend_url, frontend_url)
        check_safety_endpoint(client, backend_url)
        if run_ai_check:
            check_ai_action_endpoint(client, backend_url)
            checks_run.append("ai_action")
        if admin_token:
            check_admin_export(client, backend_url, admin_token)
            check_admin_maintenance(client, backend_url, admin_token)
            check_admin_single_record_delete_route(client, backend_url, admin_token)
            checks_run.extend(["admin_backup_restore", "admin_maintenance", "admin_single_record_delete_route"])

    if report_path:
        write_deploy_report(report_path, frontend_url, backend_url, run_ai_check, bool(admin_token), checks_run)

    print(
        "Deployment smoke checks passed: "
        f"frontend={frontend_url}, backend={backend_url}, ai_check={run_ai_check}, admin_check={bool(admin_token)}",
    )
    return 0


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required for deployment smoke verification.")
    return value


def normalize_origin(value: str) -> str:
    with_protocol = value if value.startswith(("http://", "https://")) else f"https://{value}"
    parsed = urlparse(with_protocol)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError(f"Invalid URL: {value}")
    path = parsed.path.rstrip("/")
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def join_url(origin: str, path: str) -> str:
    return f"{origin.rstrip('/')}/{path.lstrip('/')}"


def check_frontend(
    client: httpx.Client,
    frontend_url: str,
    backend_url: str | None = None,
    check_cache_headers: bool = False,
) -> None:
    html_response = get_response(client, frontend_url)
    html = html_response.text
    assert_true('<div id="root"' in html or 'id="root"' in html, "frontend must serve the React root")
    assert_true('lang="zh-CN"' in html, "frontend document language must be zh-CN")
    assert_true("<title>微行动教练</title>" in html, "frontend document title")
    assert_true('name="theme-color"' in html, "frontend theme color meta")
    if check_cache_headers:
        assert_revalidating_cache(html_response, "frontend HTML cache")

    manifest_response = get_response(client, join_url(frontend_url, "/manifest.webmanifest"))
    manifest = manifest_response.json()
    assert_true(manifest.get("name") == "微行动教练", "PWA manifest name")
    assert_true(manifest.get("display") == "standalone", "PWA manifest display mode")
    if check_cache_headers:
        assert_revalidating_cache(manifest_response, "PWA manifest cache")
    icons = manifest.get("icons", [])
    assert_true(bool(icons), "PWA manifest icons")
    assert_true(
        any(icon.get("type") == "image/png" and "maskable" in icon.get("purpose", "") for icon in icons),
        "PWA manifest contains a PNG maskable icon",
    )
    for icon in icons:
        icon_src = str(icon.get("src", "")).strip()
        if icon_src:
            icon_response = client.get(join_url(frontend_url, icon_src))
            assert_true(icon_response.status_code == 200, f"PWA icon is reachable: {icon_src}")

    service_worker_response = get_response(client, join_url(frontend_url, "/sw.js"))
    service_worker = service_worker_response.text
    assert_true("workbox" in service_worker.lower() or "precache" in service_worker.lower(), "service worker is present")
    if check_cache_headers:
        assert_revalidating_cache(service_worker_response, "service worker cache")
        asset_paths = collect_referenced_assets(html)
        immutable_asset = next((asset for asset in sorted(asset_paths) if asset.endswith((".js", ".css"))), "")
        assert_true(bool(immutable_asset), "frontend HTML references a hashed JS/CSS asset")
        asset_response = get_response(client, join_url(frontend_url, immutable_asset))
        assert_immutable_cache(asset_response, f"hashed asset cache: {immutable_asset}")

    if backend_url:
        check_frontend_api_base(client, frontend_url, html, backend_url)


def check_frontend_api_base(client: httpx.Client, frontend_url: str, html: str, backend_url: str) -> None:
    asset_paths = collect_referenced_assets(html)
    script_paths = sorted(asset for asset in asset_paths if asset.endswith(".js"))
    assert_true(bool(script_paths), "frontend HTML references JavaScript assets")
    script_text = "\n".join(get_text(client, join_url(frontend_url, asset)) for asset in script_paths)
    assert_frontend_bundle_api_base(script_text, backend_url)


def assert_frontend_bundle_api_base(script_text: str, backend_url: str) -> None:
    expected_backend = normalize_origin(backend_url)
    assert_true(
        expected_backend in script_text,
        f"frontend bundle must include configured backend API base {expected_backend!r}",
    )
    backend_host = urlparse(expected_backend).hostname or ""
    if backend_host not in {"localhost", "127.0.0.1", "::1"}:
        assert_true(
            "http://localhost:8000" not in script_text,
            "deployed frontend bundle must not keep the localhost API fallback",
        )


def check_backend(client: httpx.Client, backend_url: str) -> None:
    health = get_json(client, join_url(backend_url, "/health"))
    assert_equal(health.get("status"), "ok", "backend health")
    assert_true(bool(health.get("provider")), "health provider")
    assert_true(bool(health.get("model")), "health model")
    assert_true("api_key" not in str(health).lower(), "health must not expose API keys")

    readiness = get_json(client, join_url(backend_url, "/readyz"))
    assert_equal(readiness.get("status"), "ok", "backend readiness")
    assert_true(readiness.get("database_connected") is True, "readiness database connection")
    assert_true(readiness.get("schema_version") == readiness.get("expected_schema_version"), "readiness schema version")
    assert_true("api_key" not in str(readiness).lower(), "readiness must not expose API keys")
    assert_true("database_url" not in str(readiness).lower(), "readiness must not expose database URL")

    diagnostics = get_json(client, join_url(backend_url, "/api/diagnostics"))
    assert_equal(diagnostics.get("status"), "ok", "diagnostics status")
    database = diagnostics.get("database", {})
    assert_true(database.get("connected") is True, "diagnostics database connection")
    assert_true(str(database.get("journal_mode", "")).lower() == "wal", "SQLite WAL mode")
    assert_true(bool(diagnostics.get("deployment_checks")), "deployment preflight checks are present")
    assert_true("api_key" not in str(diagnostics).lower(), "diagnostics must not expose API keys")
    assert_true("database_url" not in str(diagnostics).lower(), "diagnostics must not expose database URL")

    providers = get_json(client, join_url(backend_url, "/api/models/providers"))
    assert_true(isinstance(providers, list) and providers, "provider registry")
    assert_true(any(provider.get("id") == "deepseek" for provider in providers), "provider registry includes DeepSeek")
    assert_true("api_key" not in str(providers).lower(), "provider registry must not expose API keys")

    page = get_json(client, join_url(backend_url, "/api/records/page?limit=1"))
    for key in ["records", "total_records", "limit", "offset", "has_more"]:
        assert_true(key in page, f"record page includes {key}")


def check_backend_operational_headers(client: httpx.Client, backend_url: str) -> None:
    response = get_response(client, join_url(backend_url, "/health"))
    response_time = response.headers.get("x-response-time-ms", "")
    assert_true(bool(response_time), "backend response includes X-Response-Time-Ms")
    try:
        elapsed = float(response_time)
    except ValueError as exc:
        raise AssertionError(f"X-Response-Time-Ms must be numeric, got {response_time!r}") from exc
    assert_true(elapsed >= 0, "X-Response-Time-Ms must be non-negative")
    cache_header = cache_control(response)
    assert_true("max-age=10" in cache_header, f"health cache header should be short-lived, got {cache_header!r}")


def check_record_stats_and_cursor(client: httpx.Client, backend_url: str) -> None:
    stats = get_json(client, join_url(backend_url, "/api/records/stats"))
    for key in ["total_records", "scene_counts", "risk_counts", "max_page_size"]:
        assert_true(key in stats, f"record stats includes {key}")
    assert_true(isinstance(stats.get("scene_counts"), dict), "record stats scene_counts is an object")
    assert_true(isinstance(stats.get("risk_counts"), dict), "record stats risk_counts is an object")

    cursor_page = get_json(client, join_url(backend_url, "/api/records/cursor?limit=1"))
    for key in ["records", "limit", "has_more"]:
        assert_true(key in cursor_page, f"record cursor page includes {key}")
    assert_equal(cursor_page.get("limit"), 1, "record cursor page limit")


def check_profile_summary(client: httpx.Client, backend_url: str) -> None:
    summary = get_json(client, join_url(backend_url, "/api/profile/summary"))
    assert_true(isinstance(summary.get("total_records"), int), "profile summary total_records")
    assert_true(isinstance(summary.get("top_scenes"), dict), "profile summary top_scenes")
    assert_true(isinstance(summary.get("recent_patterns"), list), "profile summary recent_patterns")
    suggested_focus = str(summary.get("suggested_focus") or "")
    assert_true(bool(suggested_focus), "profile summary suggested_focus")
    combined_text = " ".join([suggested_focus, *(str(item) for item in summary.get("recent_patterns", []))])
    assert_no_mojibake(combined_text, "profile summary text")
    assert_true("api_key" not in str(summary).lower(), "profile summary must not expose API keys")
    assert_true("database_url" not in str(summary).lower(), "profile summary must not expose database URL")


def check_cors(client: httpx.Client, backend_url: str, frontend_url: str) -> None:
    response = client.options(
        join_url(backend_url, "/api/diagnostics"),
        headers={
            "Origin": frontend_url,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert_true(response.status_code in {200, 204}, f"CORS preflight status {response.status_code}")
    allow_origin = response.headers.get("access-control-allow-origin", "")
    assert_true(
        allow_origin in {frontend_url, "*"},
        f"CORS allow-origin must include frontend origin, got {allow_origin!r}",
    )


def check_safety_endpoint(client: httpx.Client, backend_url: str) -> None:
    result = post_json(
        client,
        join_url(backend_url, "/api/ai/chat"),
        {
            "scene": "encouragement",
            "text": "kill myself",
            "context": {"historyEnabled": False, "serverRecordEnabled": False, "smoke": True},
        },
    )
    assert_equal(result.get("risk_level"), 3, "high-risk input is intercepted")
    assert_true(result.get("action_card") is None, "high-risk input must not produce productivity action")
    assert_true("110" in result.get("reply_text", ""), "high-risk response includes emergency support")


def check_ai_action_endpoint(client: httpx.Client, backend_url: str) -> None:
    result = post_json(
        client,
        join_url(backend_url, "/api/ai/action"),
        {
            "scene": "procrastination",
            "text": "I am delaying a tiny smoke-test task. Give me one action under 3 minutes.",
            "context": {"historyEnabled": False, "serverRecordEnabled": False, "smoke": True},
        },
    )
    assert_true(bool(result.get("reply_text")), "AI action reply text")
    action_card = result.get("action_card")
    assert_true(action_card is not None, "AI action returns an action card")
    assert_true(action_card.get("estimated_minutes", 99) <= 3, "AI action remains under 3 minutes")


def check_admin_export(client: httpx.Client, backend_url: str, admin_token: str) -> None:
    response = client.get(
        join_url(backend_url, "/api/admin/backup"),
        headers={"X-Admin-Token": admin_token},
    )
    response.raise_for_status()
    backup = response.json()
    assert_true("records" in backup, "admin backup returns records")
    assert_true("record_stats" in backup, "admin backup returns record stats")
    assert_true("prompt_overrides" in backup, "admin backup returns prompt overrides")
    assert_true("api_key" not in str(backup).lower(), "admin backup must not expose API keys")

    restore = client.post(
        join_url(backend_url, "/api/admin/restore"),
        headers={"X-Admin-Token": admin_token},
        json={"mode": "merge", "backup": backup},
    )
    restore.raise_for_status()
    restored = restore.json()
    assert_true("records_imported" in restored, "admin restore returns import count")
    assert_true("record_stats" in restored, "admin restore returns record stats")


def check_admin_maintenance(client: httpx.Client, backend_url: str, admin_token: str) -> None:
    response = client.post(
        join_url(backend_url, "/api/admin/maintenance"),
        headers={"X-Admin-Token": admin_token},
        json={"vacuum": False},
    )
    response.raise_for_status()
    result = response.json()
    assert_true(result.get("optimized") is True, "admin maintenance optimizes database")
    assert_true(result.get("vacuumed") is False, "admin maintenance skips vacuum by default")
    assert_true(isinstance(result.get("wal_checkpoint"), list), "admin maintenance returns WAL checkpoint stats")


def check_admin_single_record_delete_route(client: httpx.Client, backend_url: str, admin_token: str) -> None:
    response = client.delete(
        join_url(backend_url, "/api/records/0"),
        headers={"X-Admin-Token": admin_token},
    )
    assert_equal(response.status_code, 404, "single-record delete route returns 404 for missing id")
    assert_true("api_key" not in response.text.lower(), "single-record delete error must not expose API keys")


def write_deploy_report(
    report_path: str,
    frontend_url: str,
    backend_url: str,
    ai_check: bool,
    admin_check: bool,
    checks_run: list[str],
) -> None:
    path = Path(report_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": int(time.time()),
        "frontend_url": frontend_url,
        "backend_url": backend_url,
        "ai_check": ai_check,
        "admin_check": admin_check,
        "checks_run": checks_run,
        "status": "ok",
    }
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Deployment smoke report written: {path}")


def get_response(client: httpx.Client, url: str) -> httpx.Response:
    response = client.get(url)
    response.raise_for_status()
    return response


def get_text(client: httpx.Client, url: str) -> str:
    return get_response(client, url).text


def get_json(client: httpx.Client, url: str) -> Any:
    return get_response(client, url).json()


def post_json(client: httpx.Client, url: str, payload: dict[str, Any]) -> Any:
    response = client.post(url, json=payload)
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


def collect_referenced_assets(html: str) -> set[str]:
    assets: set[str] = set()
    for match in re.finditer(r"""(?:src|href)=["'](/?assets/[^"']+)["']""", html):
        assets.add(match.group(1).lstrip("/"))
    return assets


def cache_control(response: httpx.Response) -> str:
    return response.headers.get("cache-control", "").lower()


def assert_revalidating_cache(response: httpx.Response, label: str) -> None:
    value = cache_control(response)
    assert_true(
        "no-cache" in value or "max-age=0" in value or "must-revalidate" in value,
        f"{label} should revalidate, got {value!r}",
    )


def assert_immutable_cache(response: httpx.Response, label: str) -> None:
    value = cache_control(response)
    assert_true(
        "immutable" in value and "max-age=31536000" in value,
        f"{label} should be immutable, got {value!r}",
    )


if __name__ == "__main__":
    raise SystemExit(main())
