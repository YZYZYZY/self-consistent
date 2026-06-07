from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "apps" / "web"
EXPECTED_NAME = "\u5fae\u884c\u52a8\u6559\u7ec3"
EXPECTED_THEME = "#f59e0b"
EXPECTED_BACKGROUND = "#f7f5ef"


def main() -> int:
    check_vite_config(WEB_DIR / "vite.config.ts")
    check_index_html(WEB_DIR / "index.html")
    check_spa_fallback(WEB_DIR / "public" / "_redirects")

    dist_dir = WEB_DIR / "dist"
    if dist_dir.exists():
        check_dist_manifest(dist_dir / "manifest.webmanifest")
        check_service_worker(dist_dir / "sw.js")

    print("PWA config smoke checks passed.")
    return 0


def check_vite_config(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    assert_contains(text, "VitePWA(", "Vite PWA plugin")
    assert_contains(text, "registerType: 'prompt'", "PWA update prompt mode")
    assert_contains(text, "display: 'standalone'", "PWA standalone display mode")
    assert_contains(text, "scope: '/'", "PWA root scope")
    assert_contains(text, "start_url: '/'", "PWA root start URL")
    assert_contains(text, "purpose: 'any maskable'", "PWA maskable PNG icons")
    assert_contains(text, "vendor-capacitor", "Capacitor vendor chunk")
    assert_contains(text, "vendor-data", "data vendor chunk")
    assert_contains(text, "vendor-ui", "UI vendor chunk")


def check_index_html(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    assert_contains(text, 'lang="zh-CN"', "Chinese document language")
    assert_contains(text, 'name="theme-color"', "theme color meta")
    assert_contains(text, 'rel="apple-touch-icon"', "Apple touch icon")
    assert_contains(text, 'apple-mobile-web-app-capable', "Apple mobile web app capable meta")
    assert_contains(text, EXPECTED_NAME, "index title/app name")


def check_spa_fallback(path: Path) -> None:
    text = path.read_text(encoding="utf-8").strip()
    assert_true(text == "/* /index.html 200", "SPA fallback must route deep links to index.html")


def check_dist_manifest(path: Path) -> None:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    assert_equal(manifest.get("name"), EXPECTED_NAME, "dist manifest name")
    assert_equal(manifest.get("short_name"), "\u5fae\u884c\u52a8", "dist manifest short name")
    assert_equal(manifest.get("display"), "standalone", "dist manifest display")
    assert_equal(manifest.get("scope"), "/", "dist manifest scope")
    assert_equal(manifest.get("start_url"), "/", "dist manifest start URL")
    assert_equal(manifest.get("theme_color"), EXPECTED_THEME, "dist manifest theme color")
    assert_equal(manifest.get("background_color"), EXPECTED_BACKGROUND, "dist manifest background color")
    icons = manifest.get("icons", [])
    assert_true(any(icon.get("sizes") == "192x192" and "maskable" in icon.get("purpose", "") for icon in icons), "192 PNG maskable icon")
    assert_true(any(icon.get("sizes") == "512x512" and "maskable" in icon.get("purpose", "") for icon in icons), "512 PNG maskable icon")


def check_service_worker(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    assert_true("precache" in text.lower(), "service worker must include precache logic")
    assert_true(bool(re.search(r"workbox-[A-Za-z0-9]+", text)), "service worker imports Workbox runtime")
    assert_contains(text, 'createHandlerBoundToURL("index.html")', "service worker navigation fallback")


def assert_contains(text: str, needle: str, label: str) -> None:
    assert_true(needle in text, label)


def assert_equal(actual: object, expected: object, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_true(value: bool, label: str) -> None:
    if not value:
        raise AssertionError(label)


if __name__ == "__main__":
    raise SystemExit(main())
