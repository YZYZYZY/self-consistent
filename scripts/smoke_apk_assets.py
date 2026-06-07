from __future__ import annotations

import json
import os
import re
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APK = ROOT / "apps" / "web" / "android" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
REQUIRED_ENTRIES = [
    "assets/capacitor.config.json",
    "assets/capacitor.plugins.json",
    "assets/public/index.html",
    "assets/public/manifest.webmanifest",
    "assets/public/sw.js",
]
REQUIRED_PLUGINS = {
    "@capacitor/local-notifications",
    "@capacitor/network",
    "@capacitor/preferences",
}


def main() -> int:
    apk_path = Path(os.environ.get("SMOKE_APK_PATH", str(DEFAULT_APK)))
    expected_server_url = os.environ.get("EXPECTED_CAP_SERVER_URL", "").strip()

    if not apk_path.exists():
        raise RuntimeError(f"APK was not found: {apk_path}")

    with ZipFile(apk_path) as apk:
        names = set(apk.namelist())
        for entry in REQUIRED_ENTRIES:
            assert_true(entry in names, f"APK is missing {entry}")

        config = read_json(apk, "assets/capacitor.config.json")
        assert_equal(config.get("appId"), "com.selfconsistent.microactioncoach", "Capacitor appId")
        assert_equal(config.get("appName"), "微行动教练", "Capacitor appName")
        assert_true("LocalNotifications" in config.get("plugins", {}), "Local Notifications config")
        server_config = config.get("server", {})
        if expected_server_url:
            assert_equal(server_config.get("url"), expected_server_url, "Capacitor remote server URL")
        else:
            assert_true("url" not in server_config, "Bundled-assets APK must not pin a remote server URL")
            assert_equal(server_config.get("androidScheme"), "https", "Bundled-assets Android scheme")

        plugins = read_json(apk, "assets/capacitor.plugins.json")
        plugin_packages = {plugin.get("pkg") for plugin in plugins}
        assert_true(REQUIRED_PLUGINS.issubset(plugin_packages), "Capacitor plugin registry")

        web_manifest = read_json(apk, "assets/public/manifest.webmanifest")
        assert_equal(web_manifest.get("name"), "微行动教练", "PWA manifest name")
        assert_equal(web_manifest.get("display"), "standalone", "PWA display mode")
        icons = web_manifest.get("icons", [])
        assert_true(bool(icons), "PWA manifest icons")
        assert_true(
            any(icon.get("type") == "image/png" and "maskable" in icon.get("purpose", "") for icon in icons),
            "PWA manifest contains a PNG maskable icon",
        )
        for icon in icons:
            icon_src = str(icon.get("src", "")).lstrip("/")
            if icon_src:
                assert_true(f"assets/public/{icon_src}" in names, f"APK is missing PWA icon {icon_src}")

        html = read_text(apk, "assets/public/index.html")
        assert_true('id="root"' in html, "React root in bundled index.html")
        assert_true('lang="zh-CN"' in html, "Bundled index.html document language")
        assert_true("<title>微行动教练</title>" in html, "Bundled index.html title")
        assert_true('name="theme-color"' in html, "Bundled index.html theme color meta")
        referenced_assets = collect_referenced_assets(html)
        assert_true(any(asset.endswith(".js") for asset in referenced_assets), "index.html references JS assets")
        assert_true(any(asset.endswith(".css") for asset in referenced_assets), "index.html references CSS assets")
        for asset in referenced_assets:
            assert_true(f"assets/public/{asset}" in names, f"APK is missing referenced asset {asset}")

        service_worker = read_text(apk, "assets/public/sw.js")
        assert_true(
            "workbox" in service_worker.lower() or "precache" in service_worker.lower(),
            "Bundled service worker contains a precache runtime",
        )

    print(
        "APK asset smoke checks passed: "
        f"apk={apk_path}, mode={'remote' if expected_server_url else 'bundled'}, size={apk_path.stat().st_size} bytes",
    )
    return 0


def read_json(apk: ZipFile, entry: str):
    return json.loads(read_text(apk, entry))


def read_text(apk: ZipFile, entry: str) -> str:
    return apk.read(entry).decode("utf-8")


def collect_referenced_assets(html: str) -> set[str]:
    assets = set()
    for match in re.finditer(r"""(?:src|href)=["'](/?assets/[^"']+)["']""", html):
        assets.add(match.group(1).lstrip("/"))
    return assets


def assert_equal(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_true(value: bool, label: str) -> None:
    if not value:
        raise AssertionError(label)


if __name__ == "__main__":
    raise SystemExit(main())
