from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.ai_provider import generate_ai_response  # noqa: E402
from app.schemas import CoachRequest  # noqa: E402
from app.settings import Settings  # noqa: E402


def main() -> int:
    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is required for real DeepSeek smoke verification.")

    model = os.environ.get("DEEPSEEK_SMOKE_MODEL", os.environ.get("AI_MODEL", "deepseek-v4-flash")).strip()
    base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip()

    with tempfile.TemporaryDirectory(prefix="micro-action-coach-deepseek-") as temp_dir:
        settings = Settings(
            ai_provider="deepseek",
            ai_model=model,
            deepseek_api_key=api_key,
            deepseek_base_url=base_url,
            database_url=f"sqlite:///{Path(temp_dir) / 'deepseek-smoke.db'}",
            server_record_enabled=False,
        )
        request = CoachRequest(
            scene="procrastination",
            text="I am delaying a tiny test task. Give me one action under 3 minutes.",
            context={"historyEnabled": False, "serverRecordEnabled": False, "smoke": True},
        )

        import anyio

        result = anyio.run(generate_ai_response, settings, request)

    if result.risk_level != 0:
        raise AssertionError(f"Expected low-risk result, got risk_level={result.risk_level}")
    if not result.reply_text.strip():
        raise AssertionError("DeepSeek result reply_text is empty.")
    if not result.action_card:
        raise AssertionError("DeepSeek result must include an action_card.")
    if result.action_card.estimated_minutes > 3:
        raise AssertionError(f"Action card is too large: {result.action_card.estimated_minutes} minutes.")

    report_path = os.environ.get("DEEPSEEK_SMOKE_REPORT", "").strip()
    if report_path:
        write_report(report_path, model, base_url, result)

    print(
        "DeepSeek smoke checks passed: "
        f"model={model}, action='{result.action_card.title}', minutes={result.action_card.estimated_minutes}",
    )
    return 0


def write_report(report_path: str, model: str, base_url: str, result) -> None:
    path = Path(report_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "generated_at": int(time.time()),
        "provider": "deepseek",
        "model": model,
        "base_url": base_url,
        "status": "ok",
        "risk_level": result.risk_level,
        "reply_non_empty": bool(result.reply_text.strip()),
        "action_card": {
            "title": result.action_card.title,
            "estimated_minutes": result.action_card.estimated_minutes,
            "difficulty": result.action_card.difficulty,
            "steps_count": len(result.action_card.steps),
        },
        "api_key_recorded": False,
    }
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"DeepSeek smoke report written: {path}")


if __name__ == "__main__":
    raise SystemExit(main())
