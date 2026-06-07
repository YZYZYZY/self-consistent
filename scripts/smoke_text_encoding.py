from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "apps" / "web"
SOURCE_FILES = [
    WEB_DIR / "src" / "App.tsx",
    WEB_DIR / "src" / "lib" / "api.ts",
    WEB_DIR / "src" / "lib" / "mobile.ts",
    WEB_DIR / "index.html",
    WEB_DIR / "package.json",
    ROOT / "services" / "api" / "app" / "fallbacks.py",
    ROOT / "services" / "api" / "app" / "prompts.py",
    ROOT / "services" / "api" / "app" / "db.py",
    ROOT / "services" / "api" / "tests" / "test_api.py",
    ROOT / "services" / "api" / "tests" / "test_smoke_deploy.py",
    ROOT / "scripts" / "smoke_api.py",
    ROOT / "scripts" / "smoke_android.ps1",
    ROOT / "scripts" / "smoke_deploy.py",
    ROOT / "scripts" / "release_bundle.py",
    ROOT / "docs" / "ACCEPTANCE.md",
    ROOT / "docs" / "DEPLOYMENT.md",
    ROOT / "docs" / "PRD_GAP_AUDIT.md",
    ROOT / "docs" / "RELEASE_EVIDENCE.md",
]
EXPECTED_UI_TEXT = [
    "\u5fae\u884c\u52a8\u6559\u7ec3",
    "\u6211\u53c8\u62d6\u5ef6\u4e86",
    "\u4eca\u5929\u590d\u76d8\u4e00\u4e0b",
    "\u5b89\u5168\u652f\u6301",
    "\u540e\u7aef\u6a21\u578b\u8fd8\u6ca1\u6709\u914d\u7f6e API Key",
]
EXPECTED_SUPPORT_TEXT = [
    "\u901a\u77e5\u6743\u9650\u672a\u5f00\u542f",
    "API \u5730\u5740\u5fc5\u987b\u4ee5 http:// \u6216 https:// \u5f00\u5934",
    "cap init \u5fae\u884c\u52a8\u6559\u7ec3",
    "\u4f60\u662f\u201c\u5fae\u884c\u52a8\u6559\u7ec3\u201d",
    "\u4eca\u65e5\u95ed\u73af",
    "\u672c\u5468\u884c\u52a8\u5efa\u8bae",
    "\u670d\u52a1\u7aef\u8bb0\u5f55\u8fd8\u4e0d\u591a",
    "\u4e0b\u4e00\u9636\u6bb5\u4f18\u5148\u7167\u987e",
    "\u8fde\u7eed\u590d\u76d8",
    "\u5b89\u5168\u4e8b\u4ef6",
    "\u6211\u7684 -> \u540e\u7aef\u8fde\u63a5",
]
MOJIBAKE_MARKERS = [
    "\ufffd",
    "\u93b4\u621d",
    "\u935a\u5ea3",
    "\u5bf0\ufffd\u741b",
    "\u93c1\u6b11",
    "\u93b4",
    "\u9428",
    "\u9359",
    "\u6d93\u20ac",
    "\u5bf0\ueea6",
    "\u5bb8\u832c",
    "\u6d60\u5a43",
]


def main() -> int:
    source_text = "\n".join(read_text(path) for path in SOURCE_FILES)
    assert_no_mojibake(source_text, "frontend source")
    for phrase in EXPECTED_UI_TEXT + EXPECTED_SUPPORT_TEXT:
        assert_true(phrase in source_text, f"frontend source contains {phrase!r}")

    dist_dir = WEB_DIR / "dist"
    if dist_dir.exists():
        check_static_bundle(dist_dir, "Vite dist")

    android_assets = WEB_DIR / "android" / "app" / "src" / "main" / "assets" / "public"
    if android_assets.exists():
        check_static_bundle(android_assets, "Android bundled web assets")

    capacitor_config = WEB_DIR / "android" / "app" / "src" / "main" / "assets" / "capacitor.config.json"
    if capacitor_config.exists():
        config = json.loads(read_text(capacitor_config))
        assert_equal(config.get("appName"), EXPECTED_UI_TEXT[0], "Capacitor app name encoding")

    print("Text encoding smoke checks passed.")
    return 0


def check_static_bundle(root: Path, label: str) -> None:
    texts: list[str] = []
    for path in list(root.glob("*.html")) + list((root / "assets").glob("*.js")):
        texts.append(read_text(path))
    bundle_text = "\n".join(texts)
    assert_no_mojibake(bundle_text, label)
    for phrase in EXPECTED_UI_TEXT:
        assert_true(phrase in bundle_text, f"{label} contains {phrase!r}")

    manifest_path = root / "manifest.webmanifest"
    if manifest_path.exists():
        manifest = json.loads(read_text(manifest_path))
        assert_equal(manifest.get("name"), EXPECTED_UI_TEXT[0], f"{label} manifest name encoding")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def assert_no_mojibake(text: str, label: str) -> None:
    for marker in MOJIBAKE_MARKERS:
        assert_true(marker not in text, f"{label} contains mojibake marker {marker.encode('unicode_escape').decode()}")


def assert_equal(actual: object, expected: object, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_true(value: bool, label: str) -> None:
    if not value:
        raise AssertionError(label)


if __name__ == "__main__":
    raise SystemExit(main())
