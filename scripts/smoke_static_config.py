from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "apps" / "web"
NO_CACHE = "no-cache"
REVALIDATE = "public, max-age=0, must-revalidate"
IMMUTABLE = "public, max-age=31536000, immutable"


def main() -> int:
    check_cloudflare_headers(WEB_DIR / "public" / "_headers")
    check_vercel_headers(WEB_DIR / "vercel.json")
    print("Static deployment config smoke checks passed.")
    return 0


def check_cloudflare_headers(path: Path) -> None:
    sections = parse_cloudflare_headers(path.read_text(encoding="utf-8"))
    assert_equal(sections.get("/*", {}).get("Cache-Control"), REVALIDATE, "Cloudflare default cache")
    assert_equal(sections.get("/assets/*", {}).get("Cache-Control"), IMMUTABLE, "Cloudflare hashed assets cache")
    assert_equal(sections.get("/sw.js", {}).get("Cache-Control"), NO_CACHE, "Cloudflare service worker cache")
    assert_equal(sections.get("/manifest.webmanifest", {}).get("Cache-Control"), NO_CACHE, "Cloudflare manifest cache")


def parse_cloudflare_headers(text: str) -> dict[str, dict[str, str]]:
    sections: dict[str, dict[str, str]] = {}
    current_path = ""
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue
        if not raw_line.startswith((" ", "\t")):
            current_path = line.strip()
            sections[current_path] = {}
            continue
        if current_path and ":" in line:
            key, value = line.split(":", 1)
            sections[current_path][key.strip()] = value.strip()
    return sections


def check_vercel_headers(path: Path) -> None:
    config = json.loads(path.read_text(encoding="utf-8"))
    headers = {entry["source"]: header_map(entry.get("headers", [])) for entry in config.get("headers", [])}
    assert_equal(headers.get("/(.*)", {}).get("Cache-Control"), REVALIDATE, "Vercel default cache")
    assert_equal(headers.get("/assets/(.*)", {}).get("Cache-Control"), IMMUTABLE, "Vercel hashed assets cache")
    assert_equal(headers.get("/sw.js", {}).get("Cache-Control"), NO_CACHE, "Vercel service worker cache")
    assert_equal(headers.get("/manifest.webmanifest", {}).get("Cache-Control"), NO_CACHE, "Vercel manifest cache")


def header_map(headers: list[dict[str, str]]) -> dict[str, str]:
    return {header["key"]: header["value"] for header in headers}


def assert_equal(actual: object, expected: object, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


if __name__ == "__main__":
    raise SystemExit(main())
