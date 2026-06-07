from __future__ import annotations

import json
import os
import time
from pathlib import Path

try:
    from smoke_deploy import assert_frontend_bundle_api_base, collect_referenced_assets, normalize_origin
except ModuleNotFoundError:  # pragma: no cover - exercised when imported as a package in tests
    from scripts.smoke_deploy import assert_frontend_bundle_api_base, collect_referenced_assets, normalize_origin


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIST_DIR = ROOT / "apps" / "web" / "dist"


def main() -> int:
    dist_dir = Path(os.environ.get("FRONTEND_DIST_DIR", str(DEFAULT_DIST_DIR)))
    expected_backend = expected_backend_url()
    report_path = os.environ.get("FRONTEND_API_BASE_REPORT", "").strip()

    check_frontend_dist_api_base(dist_dir, expected_backend)

    if report_path:
        write_report(report_path, dist_dir, expected_backend)

    print(f"Frontend API base smoke checks passed: dist={dist_dir}, backend={normalize_origin(expected_backend)}")
    return 0


def expected_backend_url() -> str:
    value = os.environ.get("EXPECTED_FRONTEND_API_BASE", "").strip() or os.environ.get("SMOKE_BACKEND_URL", "").strip()
    if not value:
        raise RuntimeError("Set EXPECTED_FRONTEND_API_BASE or SMOKE_BACKEND_URL before running frontend API base smoke.")
    return value


def check_frontend_dist_api_base(dist_dir: Path, expected_backend: str) -> None:
    index = dist_dir / "index.html"
    if not index.exists():
        raise RuntimeError(f"Frontend dist index.html was not found: {index}. Run `npm run build:web` first.")

    html = index.read_text(encoding="utf-8")
    script_paths = sorted(asset for asset in collect_referenced_assets(html) if asset.endswith(".js"))
    if not script_paths:
        raise AssertionError("Frontend dist index.html does not reference JavaScript assets.")

    script_text = "\n".join(read_dist_text(dist_dir, asset) for asset in script_paths)
    assert_frontend_bundle_api_base(script_text, expected_backend)


def read_dist_text(dist_dir: Path, asset_path: str) -> str:
    path = dist_dir / asset_path.lstrip("/")
    if not path.exists():
        raise RuntimeError(f"Frontend dist asset was not found: {path}")
    return path.read_text(encoding="utf-8")


def write_report(report_path: str, dist_dir: Path, expected_backend: str) -> None:
    path = Path(report_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": int(time.time()),
        "status": "ok",
        "dist_dir": str(dist_dir),
        "expected_backend_url": normalize_origin(expected_backend),
    }
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Frontend API base smoke report written: {path}")


if __name__ == "__main__":
    raise SystemExit(main())
