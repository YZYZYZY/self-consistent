import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from scripts.smoke_deploy import assert_frontend_bundle_api_base, assert_no_mojibake  # noqa: E402
from scripts.smoke_frontend_api_base import check_frontend_dist_api_base  # noqa: E402


def test_frontend_bundle_api_base_accepts_configured_backend():
    assert_frontend_bundle_api_base(
        'const DEFAULT_API_BASE="https://api.example.com";',
        "https://api.example.com",
    )


def test_frontend_bundle_api_base_rejects_missing_backend():
    try:
        assert_frontend_bundle_api_base(
            'const DEFAULT_API_BASE="https://other.example.com";',
            "https://api.example.com",
        )
    except AssertionError as exc:
        assert "backend API base" in str(exc)
    else:
        raise AssertionError("Expected missing backend URL to fail")


def test_frontend_bundle_api_base_rejects_localhost_fallback_for_hosted_backend():
    try:
        assert_frontend_bundle_api_base(
            'const DEFAULT_API_BASE="https://api.example.com"; const fallback="http://localhost:8000";',
            "https://api.example.com",
        )
    except AssertionError as exc:
        assert "localhost API fallback" in str(exc)
    else:
        raise AssertionError("Expected localhost fallback to fail for hosted backend")


def test_frontend_dist_api_base_reads_referenced_js_asset(tmp_path: Path):
    assets = tmp_path / "assets"
    assets.mkdir()
    (tmp_path / "index.html").write_text(
        '<div id="root"></div><script type="module" src="/assets/index.js"></script>',
        encoding="utf-8",
    )
    (assets / "index.js").write_text('const api="https://api.example.com";', encoding="utf-8")

    check_frontend_dist_api_base(tmp_path, "https://api.example.com")


def test_frontend_dist_api_base_requires_js_asset(tmp_path: Path):
    (tmp_path / "index.html").write_text('<div id="root"></div>', encoding="utf-8")

    try:
        check_frontend_dist_api_base(tmp_path, "https://api.example.com")
    except AssertionError as exc:
        assert "JavaScript assets" in str(exc)
    else:
        raise AssertionError("Expected missing JavaScript asset to fail")


def test_deploy_smoke_rejects_mojibake_profile_summary_text():
    assert_no_mojibake("下一阶段优先照顾启动这个需求。", "profile summary")
    try:
        assert_no_mojibake("涓嬩竴闃舵", "profile summary")
    except AssertionError as exc:
        assert "mojibake" in str(exc)
    else:
        raise AssertionError("Expected mojibake profile text to fail")
