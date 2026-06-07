from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "apps" / "web"


def main() -> int:
    check_root_package(ROOT / "package.json")
    check_web_package(WEB_DIR / "package.json")
    check_pages_assets(WEB_DIR / "public")
    check_pages_output_if_built(ROOT / "dist", WEB_DIR / "dist")
    check_deployment_docs(ROOT / "docs" / "DEPLOYMENT.md")
    print("Cloudflare Pages config smoke checks passed.")
    return 0


def check_root_package(path: Path) -> None:
    config = json.loads(path.read_text(encoding="utf-8"))
    scripts = config.get("scripts", {})
    assert_equal(
        scripts.get("build"),
        "npm run build:web && node scripts/sync_cloudflare_pages_dist.mjs",
        "root package build script",
    )
    assert_equal(scripts.get("build:web"), "npm --workspace apps/web run build", "root package build:web script")
    if "apps/web" not in config.get("workspaces", []):
        raise AssertionError("root package workspaces must include apps/web")


def check_web_package(path: Path) -> None:
    config = json.loads(path.read_text(encoding="utf-8"))
    assert_equal(config.get("scripts", {}).get("build"), "tsc -b && vite build", "web package build script")


def check_pages_assets(public_dir: Path) -> None:
    for filename in ["_headers", "_redirects"]:
        path = public_dir / filename
        if not path.exists():
            raise AssertionError(f"Cloudflare Pages asset missing: {path}")


def check_pages_output_if_built(root_dist: Path, web_dist: Path) -> None:
    if not web_dist.exists() and not root_dist.exists():
        return
    for dist_dir, label in [(web_dist, "workspace dist"), (root_dist, "repository-root dist")]:
        for filename in ["index.html", "manifest.webmanifest", "sw.js"]:
            path = dist_dir / filename
            if not path.exists():
                raise AssertionError(f"{label} is missing {filename}: {path}")


def check_deployment_docs(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    for needle, label in [
        ("Project root: apps/web", "recommended Pages project root"),
        ("Build command: npm run build", "Pages build command"),
        ("Build output directory: dist", "recommended Pages output directory"),
        ("Project root: /", "repository-root Pages project root"),
        ("Build output directory: dist", "repository-root Pages output directory"),
        ("VITE_API_BASE_URL", "Pages API base environment variable"),
        ("The repository root `build` script delegates to `npm run build:web` and mirrors `apps/web/dist` into root `dist`", "root build compatibility note"),
    ]:
        if needle not in text:
            raise AssertionError(f"Deployment docs missing {label}")


def assert_equal(actual: object, expected: object, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


if __name__ == "__main__":
    raise SystemExit(main())
