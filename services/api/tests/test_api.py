import os
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["DATABASE_URL"] = f"sqlite:///{ROOT / 'test_micro_action_coach.db'}"

from app.main import app  # noqa: E402
from app.ai_provider import active_provider, available_providers, build_chat_completion_payload, generate_ai_response, provider_error_message  # noqa: E402
from app.fallbacks import local_fallback, safety_response  # noqa: E402
from app.prompts import default_prompt_content, user_prompt  # noqa: E402
from app.safety import risk_level, sanitize_context, sanitize_text  # noqa: E402
from app.schemas import CoachRequest, CoachResult  # noqa: E402
from app.settings import Settings, get_settings  # noqa: E402
from app.db import SCHEMA_VERSION, database_path, init_database, save_ai_record, upsert_prompt_config, upsert_runtime_model_config  # noqa: E402


def create_client() -> TestClient:
    return TestClient(app)


def generate_fallback_result() -> CoachResult:
    return CoachResult(
        reply_text="先做一个很小的动作。",
        emotion_labels=["stuck"],
        need_labels=["start"],
        risk_level=0,
        action_card=None,
        relationship_scripts=None,
        quick_replies=[],
    )


def assert_no_mojibake(text: str) -> None:
    suspicious_fragments = ["\u93b4", "\u9428", "\u9359", "\u6d93", "\ufffd"]
    assert not any(fragment in text for fragment in suspicious_fragments)


def test_default_prompts_are_readable_utf8_and_scene_specific():
    system = default_prompt_content("system")
    relationship = default_prompt_content("relationship")
    creation = default_prompt_content("creation")

    assert "微行动教练" in system
    assert "json" in system
    assert "relationship_scripts" in system
    assert "事实、猜测、情绪、需要/边界" in relationship
    assert "主动输出" in creation
    assert_no_mojibake(system + relationship + creation)


def test_user_prompt_contains_json_instruction_and_scene_rule():
    settings = Settings()
    prompt = user_prompt(settings, CoachRequest(scene="encouragement", text="我觉得自己不行"))

    assert "只输出一个合法 json 对象" in prompt
    assert "场景：鼓励师" in prompt
    assert "不要空泛夸奖" in prompt
    assert_no_mojibake(prompt)


def test_local_fallbacks_are_readable_and_structured():
    relationship = local_fallback(CoachRequest(scene="relationship", text="对方没回我"))
    creation = local_fallback(CoachRequest(scene="creation", text="刷手机很久"))
    encouragement = local_fallback(CoachRequest(scene="encouragement", text="我不行"))

    assert relationship.relationship_scripts is not None
    assert relationship.relationship_scripts.gentle
    assert relationship.relationship_scripts.direct
    assert relationship.relationship_scripts.boundary
    assert "事实和猜测" in relationship.reply_text
    assert creation.action_card is not None
    assert creation.action_card.estimated_minutes <= 3
    assert encouragement.action_card is not None
    assert "中性证据" in encouragement.reply_text
    assert_no_mojibake(relationship.reply_text + creation.reply_text + encouragement.reply_text)


def test_safety_sanitizes_address_and_detects_level_4():
    sanitized = sanitize_text("邮箱 a@example.com 手机 13812345678 地址 上海市浦东新区世纪大道100号")

    assert "a@example.com" not in sanitized
    assert "13812345678" not in sanitized
    assert "世纪大道100号" not in sanitized
    assert "[邮箱]" in sanitized
    assert "[手机号]" in sanitized
    assert "[地址]" in sanitized
    assert risk_level("kill myself") == 3
    assert risk_level("I want to die") == 3
    assert risk_level("I might hurt someone") == 3
    assert risk_level("我撑不下去了") == 3
    assert risk_level("我不想继续活了") == 3
    assert risk_level("kill myself tonight") == 4
    assert risk_level("I want to die and I have pills") == 4
    assert risk_level("我有点想死") == 3
    assert risk_level("我想消失，已经到了楼顶") == 4
    assert risk_level("我想自杀，今晚已经准备了具体方法") == 4
    assert risk_level("I might end my life right now") == 4
    urgent = safety_response(4)
    assert urgent.risk_level == 4
    assert "立即危险" in urgent.reply_text
    assert "110" in urgent.reply_text


def test_sanitize_context_redacts_nested_text_and_strips_history_when_profile_disabled():
    sanitized = sanitize_context(
        {
            "historyEnabled": True,
            "profileEnabled": False,
            "selectedContext": "联系我 a@example.com 或 13812345678",
            "conversationId": 42,
            "recentMessages": [{"role": "user", "content": "旧消息包含邮箱 old@example.com"}],
            "profileSummary": "常在 上海市浦东新区世纪大道100号 卡住",
        }
    )

    assert "conversationId" not in sanitized
    assert "recentMessages" not in sanitized
    assert "profileSummary" not in sanitized
    assert sanitized["selectedContext"] == "联系我 [邮箱] 或 [手机号]"


def test_health_reports_provider_and_model():
    with create_client() as client:
        response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["provider"]
    assert body["model"]
    assert "active_provider_configured" in body
    assert "configured_providers" in body


def test_readiness_reports_database_schema_without_paths_or_secrets(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'readyz.db'}")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "secret-deepseek-key")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            response = client.get("/readyz")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        get_settings.cache_clear()

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database_connected"] is True
    assert body["schema_version"] == SCHEMA_VERSION
    assert body["expected_schema_version"] == SCHEMA_VERSION
    assert "secret-deepseek-key" not in str(body)
    assert str(tmp_path) not in str(body)


def test_action_falls_back_without_api_key():
    with create_client() as client:
        response = client.post(
            "/api/ai/action",
            json={"scene": "procrastination", "text": "I do not want to write the report"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["risk_level"] == 0
    assert body["action_card"]["estimated_minutes"] <= 3


def test_model_providers_status_does_not_expose_keys(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'providers.db'}",
        ai_provider="qwen",
        qwen_api_key="secret-qwen-key",
        qwen_base_url="https://qwen.example/v1",
    )
    providers = available_providers(settings)
    qwen = next(provider for provider in providers if provider["id"] == "qwen")

    assert qwen["configured"] is True
    assert qwen["active"] is True
    assert qwen["base_url"] == "https://qwen.example/v1"
    assert "api_key" not in qwen
    assert "secret-qwen-key" not in str(providers)


def test_provider_catalog_covers_requested_openai_compatible_adapters(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'provider-catalog.db'}")
    providers = available_providers(settings)
    provider_ids = {provider["id"] for provider in providers}

    assert provider_ids == {
        "deepseek",
        "openai",
        "qwen",
        "moonshot",
        "zhipu",
        "claude",
        "gemini",
        "custom",
    }
    assert all(provider["openai_compatible"] is True for provider in providers)
    assert all("api_key" not in provider for provider in providers)


def test_model_providers_endpoint_is_available():
    with create_client() as client:
        response = client.get("/api/models/providers")
    assert response.status_code == 200
    body = response.json()
    assert any(provider["id"] == "deepseek" for provider in body)
    assert all("api_key" not in provider for provider in body)


def test_deepseek_payload_requests_json_output_and_disables_thinking(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'deepseek-payload.db'}",
        deepseek_api_key="test-key",
        ai_provider="deepseek",
        ai_model="deepseek-v4-flash",
    )
    provider = active_provider(settings, "deepseek")
    payload = build_chat_completion_payload(
        settings,
        CoachRequest(scene="procrastination", text="write report"),
        "deepseek-v4-flash",
        provider,
    )

    assert payload["model"] == "deepseek-v4-flash"
    assert payload["stream"] is False
    assert payload["response_format"] == {"type": "json_object"}
    assert payload["thinking"] == {"type": "disabled"}
    assert [message["role"] for message in payload["messages"]] == ["system", "user"]
    assert "json" in " ".join(message["content"] for message in payload["messages"]).lower()


def test_openai_compatible_payload_does_not_send_deepseek_thinking(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'openai-payload.db'}",
        ai_provider="openai",
        ai_model="gpt-4.1-mini",
        openai_api_key="test-key",
    )
    provider = active_provider(settings, "openai")
    payload = build_chat_completion_payload(
        settings,
        CoachRequest(scene="creation", text="make one tiny sketch"),
        "gpt-4.1-mini",
        provider,
    )

    assert payload["model"] == "gpt-4.1-mini"
    assert payload["stream"] is False
    assert payload["response_format"] == {"type": "json_object"}
    assert "thinking" not in payload
    assert "json" in " ".join(message["content"] for message in payload["messages"]).lower()


def test_diagnostics_reports_backend_and_database_without_secrets(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'diagnostics.db'}")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "secret-deepseek-key")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            response = client.get("/api/diagnostics")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        get_settings.cache_clear()

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"]
    assert body["provider"]
    assert body["model"]
    assert body["configured_providers"] >= 1
    assert body["active_provider_configured"] is True
    assert body["database"]["connected"] is True
    assert body["database"]["kind"] == "sqlite"
    assert body["database"]["journal_mode"]
    assert body["database"]["record_enabled"] is True
    assert body["database"]["page_count"] >= 1
    assert body["database"]["page_size"] >= 1024
    assert body["database"]["freelist_count"] >= 0
    assert body["database"]["schema_version"] == SCHEMA_VERSION
    assert body["deployment_checks"]
    assert any(check["key"] == "model_credentials" and check["status"] == "ok" for check in body["deployment_checks"])
    assert "secret-deepseek-key" not in str(body)
    assert "api_key" not in str(body).lower()


def test_diagnostics_reports_deployment_preflight_without_secrets(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'deploy-ready.db'}")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "secret-deepseek-key")
    monkeypatch.setenv("ADMIN_TOKEN", "secret-admin-token")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            response = client.get("/api/diagnostics")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        monkeypatch.delenv("ADMIN_TOKEN", raising=False)
        get_settings.cache_clear()

    assert response.status_code == 200
    body = response.json()
    checks = {check["key"]: check for check in body["deployment_checks"]}
    assert checks["cors"]["status"] == "ok"
    assert checks["model_credentials"]["status"] == "ok"
    assert checks["admin_token"]["status"] == "ok"
    assert checks["sqlite_persistence"]["status"] == "ok"
    assert "secret-deepseek-key" not in str(body)
    assert "secret-admin-token" not in str(body)
    assert str(tmp_path) not in str(body)


def test_diagnostics_warns_for_local_deployment_defaults(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///./micro_action_coach.db")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    monkeypatch.setenv("ADMIN_TOKEN", "")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            response = client.get("/api/diagnostics")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        monkeypatch.delenv("ADMIN_TOKEN", raising=False)
        get_settings.cache_clear()

    assert response.status_code == 200
    checks = {check["key"]: check for check in response.json()["deployment_checks"]}
    assert checks["cors"]["status"] == "warn"
    assert checks["model_credentials"]["status"] == "warn"
    assert checks["admin_token"]["status"] == "warn"
    assert checks["sqlite_persistence"]["status"] == "warn"


def test_model_runtime_config_can_be_updated(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "secret-token")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            blocked = client.put(
                "/api/models/config",
                json={"provider": "qwen", "model": "qwen-plus"},
            )
            allowed = client.put(
                "/api/models/config",
                headers={"X-Admin-Token": "secret-token"},
                json={"provider": "qwen", "model": "qwen-plus"},
            )
            providers = client.get("/api/models/providers")
            health = client.get("/health")

            client.put(
                "/api/models/config",
                headers={"X-Admin-Token": "secret-token"},
                json={"provider": "deepseek", "model": "deepseek-v4-flash"},
            )
    finally:
        monkeypatch.delenv("ADMIN_TOKEN", raising=False)
        get_settings.cache_clear()

    assert blocked.status_code == 403
    assert allowed.status_code == 200
    assert allowed.json()["provider"] == "qwen"
    assert allowed.json()["model"] == "qwen-plus"
    assert health.json()["provider"] == "qwen"
    assert health.json()["model"] == "qwen-plus"
    assert next(provider for provider in providers.json() if provider["id"] == "qwen")["active"] is True


def test_model_runtime_config_rejects_unknown_provider():
    with create_client() as client:
        response = client.put(
            "/api/models/config",
            json={"provider": "unknown-provider", "model": "some-model"},
        )
    assert response.status_code == 404


def test_prompt_configs_are_available_and_can_be_updated():
    with create_client() as client:
        prompts = client.get("/api/prompts")
        assert prompts.status_code == 200
        body = prompts.json()
        assert any(prompt["key"] == "system" for prompt in body)
        assert all("content" in prompt for prompt in body)

        update = client.put(
            "/api/prompts/procrastination",
            json={"content": "行动必须更轻：先做 30 秒版本，再允许停下。返回 JSON。"},
        )
        assert update.status_code == 200
        assert update.json()["customized"] is True

        prompt = client.get("/api/prompts/procrastination")
        assert prompt.status_code == 200
        assert "30 秒版本" in prompt.json()["content"]


def test_prompt_update_can_require_admin_token(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "secret-token")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            blocked = client.put(
                "/api/prompts/creation",
                json={"content": "请生成一个更轻的创造动作，并返回 JSON。"},
            )
            allowed = client.put(
                "/api/prompts/creation",
                headers={"X-Admin-Token": "secret-token"},
                json={"content": "请生成一个更轻的创造动作，并返回 JSON。"},
            )
    finally:
        monkeypatch.delenv("ADMIN_TOKEN", raising=False)
        get_settings.cache_clear()

    assert blocked.status_code == 403
    assert allowed.status_code == 200


def test_relationship_returns_three_scripts_without_api_key():
    with create_client() as client:
        response = client.post(
            "/api/ai/relationship",
            json={"scene": "relationship", "text": "My friend read my message but did not reply"},
        )
    assert response.status_code == 200
    scripts = response.json()["relationship_scripts"]
    assert scripts["gentle"]
    assert scripts["direct"]
    assert scripts["boundary"]


def test_records_and_profile_summary_are_available():
    with create_client() as client:
        response = client.post(
            "/api/ai/chat",
            json={"scene": "creation", "text": "I want to stop scrolling and create something"},
        )
        assert response.status_code == 200

        records = client.get("/api/records?limit=5")
        assert records.status_code == 200
        body = records.json()
        assert body
        assert body[0]["output"]["reply_text"]

        summary = client.get("/api/profile/summary")
        assert summary.status_code == 200
        summary_body = summary.json()
        assert summary_body["total_records"] >= 1
        assert summary_body["suggested_focus"]
        summary_text = " ".join(
            [summary_body["suggested_focus"], *summary_body["recent_patterns"]],
        )
        assert_no_mojibake(summary_text)
        assert "下一阶段优先照顾" in summary_body["suggested_focus"]


def test_record_stats_are_available():
    with create_client() as client:
        response = client.post(
            "/api/ai/action",
            json={"scene": "procrastination", "text": "write a tiny draft"},
        )
        assert response.status_code == 200

        stats = client.get("/api/records/stats")

    assert stats.status_code == 200
    body = stats.json()
    assert body["total_records"] >= 1
    assert body["latest_created_at"]
    assert body["scene_counts"]["procrastination"] >= 1
    assert "0" in body["risk_counts"]
    assert body["max_page_size"] == 200


def test_concurrent_record_writes_are_serialized(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'concurrent-writes.db'}")
    get_settings.cache_clear()
    try:
        settings = get_settings()
        init_database(settings)
        result = generate_fallback_result()

        def write_record(index: int) -> None:
            save_ai_record(settings, CoachRequest(scene="creation", text=f"concurrent write {index}"), result)

        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(write_record, range(24)))

        with create_client() as client:
            records = client.get("/api/records?limit=200")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        get_settings.cache_clear()

    assert records.status_code == 200
    body = records.json()
    assert len(body) == 24
    assert {record["input"] for record in body} == {f"concurrent write {index}" for index in range(24)}


def test_server_records_can_be_disabled(monkeypatch):
    monkeypatch.setenv("SERVER_RECORD_ENABLED", "false")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            before = client.get("/api/records?limit=200")
            assert before.status_code == 200
            before_ids = {item["id"] for item in before.json()}

            response = client.post(
                "/api/ai/chat",
                json={"scene": "creation", "text": "make a small sketch"},
            )
            assert response.status_code == 200

            after = client.get("/api/records?limit=200")
            assert after.status_code == 200
            after_ids = {item["id"] for item in after.json()}
    finally:
        monkeypatch.delenv("SERVER_RECORD_ENABLED", raising=False)
        get_settings.cache_clear()

    assert after_ids == before_ids


def test_server_records_respect_request_history_disabled(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'history-disabled.db'}")
    monkeypatch.setenv("SERVER_RECORD_ENABLED", "true")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            response = client.post(
                "/api/ai/chat",
                json={
                    "scene": "creation",
                    "text": "make one tiny thing",
                    "context": {"historyEnabled": False},
                },
            )
            records = client.get("/api/records?limit=5")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("SERVER_RECORD_ENABLED", raising=False)
        get_settings.cache_clear()

    assert response.status_code == 200
    assert records.status_code == 200
    assert records.json() == []


def test_server_records_respect_request_server_record_disabled(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'server-record-disabled.db'}")
    monkeypatch.setenv("SERVER_RECORD_ENABLED", "true")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            response = client.post(
                "/api/ai/action",
                json={
                    "scene": "procrastination",
                    "text": "open the draft for one minute",
                    "context": {"historyEnabled": True, "serverRecordEnabled": False},
                },
            )
            records = client.get("/api/records?limit=5")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("SERVER_RECORD_ENABLED", raising=False)
        get_settings.cache_clear()

    assert response.status_code == 200
    assert records.status_code == 200
    assert records.json() == []


def test_high_risk_input_is_not_treated_as_productivity_request():
    with create_client() as client:
        response = client.post(
            "/api/ai/chat",
            json={"scene": "encouragement", "text": "kill myself"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["risk_level"] == 3
    assert body["action_card"] is None
    assert "110" in body["reply_text"]


def test_level_4_high_risk_input_preserves_urgency_level():
    with create_client() as client:
        response = client.post(
            "/api/ai/chat",
            json={"scene": "encouragement", "text": "我想自杀，今晚已经准备了具体方法"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["risk_level"] == 4
    assert body["action_card"] is None
    assert "12356" in body["reply_text"]


def test_high_risk_inputs_are_blocked_across_ai_endpoints_without_server_records(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'high-risk-endpoints.db'}")
    monkeypatch.setenv("SERVER_RECORD_ENABLED", "true")
    get_settings.cache_clear()
    called = {"model": False}

    async def fake_generate(settings: Settings, request: CoachRequest) -> CoachResult:
        called["model"] = True
        return generate_fallback_result()

    monkeypatch.setattr("app.main.generate_ai_response", fake_generate)
    cases = [
        ("/api/ai/chat", "encouragement"),
        ("/api/ai/chat", "creation"),
        ("/api/ai/action", "procrastination"),
        ("/api/ai/review", "daily_review"),
        ("/api/ai/relationship", "relationship"),
    ]
    try:
        with create_client() as client:
            responses = [
                client.post(
                    endpoint,
                    json={
                        "scene": scene,
                        "text": "我想自杀，今晚已经准备了具体方法",
                        "context": {"historyEnabled": True, "serverRecordEnabled": True},
                    },
                )
                for endpoint, scene in cases
            ]
            records = client.get("/api/records?limit=20")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("SERVER_RECORD_ENABLED", raising=False)
        get_settings.cache_clear()

    assert called["model"] is False
    assert records.status_code == 200
    assert records.json() == []
    for response in responses:
        assert response.status_code == 200
        body = response.json()
        assert body["risk_level"] == 4
        assert body["action_card"] is None
        assert body["relationship_scripts"] is None
        assert "12356" in body["reply_text"]


def test_backend_sanitizes_context_before_model_proxy(monkeypatch):
    captured: dict[str, CoachRequest] = {}

    async def fake_generate(settings: Settings, request: CoachRequest) -> CoachResult:
        captured["request"] = request
        return generate_fallback_result()

    monkeypatch.setattr("app.main.generate_ai_response", fake_generate)

    with create_client() as client:
        response = client.post(
            "/api/ai/chat",
            json={
                "scene": "encouragement",
                "text": "我想要一句鼓励",
                "context": {
                    "historyEnabled": True,
                    "profileEnabled": False,
                    "selectedContext": "联系我 a@example.com 或 13812345678",
                    "conversationId": 7,
                    "recentMessages": [{"role": "user", "content": "旧消息里有 old@example.com"}],
                    "profileSummary": "常在 上海市浦东新区世纪大道100号 卡住",
                },
            },
        )

    assert response.status_code == 200
    context = captured["request"].context
    assert context["selectedContext"] == "联系我 [邮箱] 或 [手机号]"
    assert "conversationId" not in context
    assert "recentMessages" not in context
    assert "profileSummary" not in context


def test_backend_blocks_high_risk_context_before_model_proxy(monkeypatch):
    called = {"model": False}

    async def fake_generate(settings: Settings, request: CoachRequest) -> CoachResult:
        called["model"] = True
        return generate_fallback_result()

    monkeypatch.setattr("app.main.generate_ai_response", fake_generate)

    with create_client() as client:
        response = client.post(
            "/api/ai/chat",
            json={
                "scene": "encouragement",
                "text": "我想要一句鼓励",
                "context": {"recentMessages": [{"role": "user", "content": "kill myself tonight"}]},
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["risk_level"] == 4
    assert body["action_card"] is None
    assert called["model"] is False


def test_sanitize_redacts_email_and_phone():
    sanitized = sanitize_text("mail me at a@example.com or 13812345678")
    assert "[邮箱]" in sanitized
    assert "[手机号]" in sanitized
    assert "a@example.com" not in sanitized
    assert "13812345678" not in sanitized


def test_risk_level_detects_high_risk_terms():
    assert risk_level("我想自杀") == 3
    assert risk_level("我活不下去") == 3
    assert risk_level("hurt myself") == 3
    assert risk_level("kill myself") == 3
    assert risk_level("只是有点拖延") == 0


def test_provider_error_mapping():
    assert "API Key" in provider_error_message(401)
    assert "余额" in provider_error_message(402)
    assert "频繁" in provider_error_message(429)


def test_records_support_offset_and_limit_clamp():
    with create_client() as client:
        for index in range(3):
            response = client.post(
                "/api/ai/chat",
                json={"scene": "creation", "text": f"create one tiny thing {index}"},
            )
            assert response.status_code == 200

        first_page = client.get("/api/records?limit=2")
        second_page = client.get("/api/records?limit=2&offset=2")
        clamped = client.get("/api/records?limit=999")

    assert first_page.status_code == 200
    assert second_page.status_code == 200
    assert clamped.status_code == 200
    assert len(first_page.json()) <= 2
    assert len(second_page.json()) <= 2
    assert len(clamped.json()) <= 200
    assert {item["id"] for item in first_page.json()}.isdisjoint({item["id"] for item in second_page.json()})


def test_record_page_reports_total_and_next_offset(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'record-page.db'}")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            for index in range(3):
                response = client.post(
                    "/api/ai/chat",
                    json={"scene": "creation", "text": f"create one tiny thing {index}"},
                )
                assert response.status_code == 200

            first_page = client.get("/api/records/page?limit=2")
            second_page = client.get("/api/records/page?limit=2&offset=2")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        get_settings.cache_clear()

    assert first_page.status_code == 200
    body = first_page.json()
    assert body["total_records"] == 3
    assert body["limit"] == 2
    assert body["offset"] == 0
    assert body["has_more"] is True
    assert body["next_offset"] == 2
    assert len(body["records"]) == 2

    assert second_page.status_code == 200
    second_body = second_page.json()
    assert second_body["has_more"] is False
    assert second_body["next_offset"] is None
    assert len(second_body["records"]) == 1


def test_record_cursor_page_uses_stable_seek_pagination(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'record-cursor-page.db'}")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            for index in range(3):
                response = client.post(
                    "/api/ai/chat",
                    json={"scene": "creation", "text": f"create one tiny thing {index}"},
                )
                assert response.status_code == 200

            first_page = client.get("/api/records/cursor?limit=2")
            body = first_page.json()
            second_page = client.get(f"/api/records/cursor?limit=2&cursor={body['next_cursor']}")
            invalid_cursor = client.get("/api/records/cursor?cursor=bad-cursor")
            clamped = client.get("/api/records/cursor?limit=999")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        get_settings.cache_clear()

    assert first_page.status_code == 200
    assert body["limit"] == 2
    assert body["cursor"] is None
    assert body["has_more"] is True
    assert body["next_cursor"]
    assert len(body["records"]) == 2

    assert second_page.status_code == 200
    second_body = second_page.json()
    assert second_body["cursor"] == body["next_cursor"]
    assert second_body["has_more"] is False
    assert second_body["next_cursor"] is None
    assert len(second_body["records"]) == 1
    assert {item["id"] for item in body["records"]}.isdisjoint({item["id"] for item in second_body["records"]})

    assert invalid_cursor.status_code == 400
    assert clamped.status_code == 200
    assert clamped.json()["limit"] == 200


def test_record_cursor_page_can_be_filtered_by_scene(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'record-cursor-filter.db'}")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            creation = client.post(
                "/api/ai/chat",
                json={"scene": "creation", "text": "create one tiny thing"},
            )
            review = client.post(
                "/api/ai/review",
                json={"scene": "daily_review", "text": "mood: tired"},
            )
            filtered = client.get("/api/records/cursor?limit=5&scene=daily_review")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        get_settings.cache_clear()

    assert creation.status_code == 200
    assert review.status_code == 200
    assert filtered.status_code == 200
    records = filtered.json()["records"]
    assert len(records) == 1
    assert records[0]["scene"] == "daily_review"


def test_records_can_be_filtered_by_scene(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'scene-filter.db'}")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            creation = client.post(
                "/api/ai/chat",
                json={"scene": "creation", "text": "create one tiny thing"},
            )
            review = client.post(
                "/api/ai/review",
                json={"scene": "daily_review", "text": "mood: tired"},
            )
            filtered = client.get("/api/records?limit=10&scene=creation")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        get_settings.cache_clear()

    assert creation.status_code == 200
    assert review.status_code == 200
    assert filtered.status_code == 200
    body = filtered.json()
    assert body
    assert {item["scene"] for item in body} == {"creation"}


def test_records_can_be_exported_with_scene_filter(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'record-export.db'}")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            creation = client.post(
                "/api/ai/chat",
                json={"scene": "creation", "text": "create one tiny thing"},
            )
            review = client.post(
                "/api/ai/review",
                json={"scene": "daily_review", "text": "mood: tired"},
            )
            exported = client.get("/api/records/export?scene=creation")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        get_settings.cache_clear()

    assert creation.status_code == 200
    assert review.status_code == 200
    assert exported.status_code == 200
    body = exported.json()
    assert body["exported_at"]
    assert body["total_records"] == 1
    assert body["records"][0]["scene"] == "creation"


def test_export_records_can_require_admin_token(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'export-token.db'}")
    monkeypatch.setenv("ADMIN_TOKEN", "secret-token")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            blocked = client.get("/api/records/export")
            allowed = client.get("/api/records/export", headers={"X-Admin-Token": "secret-token"})
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ADMIN_TOKEN", raising=False)
        get_settings.cache_clear()

    assert blocked.status_code == 403
    assert allowed.status_code == 200


def test_admin_backup_exports_records_prompts_and_runtime_config_without_secrets(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'backup.db'}")
    monkeypatch.setenv("ADMIN_TOKEN", "secret-admin-token")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "secret-deepseek-key")
    get_settings.cache_clear()
    try:
        settings = get_settings()
        upsert_prompt_config(settings, "creation", "Return JSON and keep the creative action under one minute.")
        upsert_runtime_model_config(settings, "qwen", "qwen-plus")
        with create_client() as client:
            saved = client.post(
                "/api/ai/chat",
                json={"scene": "creation", "text": "make one tiny thing"},
            )
            blocked = client.get("/api/admin/backup")
            allowed = client.get("/api/admin/backup", headers={"X-Admin-Token": "secret-admin-token"})
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ADMIN_TOKEN", raising=False)
        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        get_settings.cache_clear()

    assert saved.status_code == 200
    assert blocked.status_code == 403
    assert allowed.status_code == 200
    body = allowed.json()
    assert body["exported_at"]
    assert body["schema_version"] == SCHEMA_VERSION
    assert body["record_stats"]["total_records"] == 1
    assert body["total_records"] == 1
    assert body["records_included"] == 1
    assert body["records"][0]["scene"] == "creation"
    assert body["prompt_overrides"][0]["key"] == "creation"
    assert body["runtime_model_config"] == {
        "provider": "qwen",
        "model": "qwen-plus",
        "updated_at": body["runtime_model_config"]["updated_at"],
    }
    assert "secret-admin-token" not in str(body)
    assert "secret-deepseek-key" not in str(body)
    assert "api_key" not in str(body).lower()


def test_admin_backup_includes_all_records_beyond_page_clamp(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'full-backup.db'}")
    get_settings.cache_clear()
    try:
        settings = get_settings()
        for index in range(205):
            save_ai_record(
                settings,
                CoachRequest(scene="creation", text=f"backup record {index}"),
                generate_fallback_result(),
            )
        with create_client() as client:
            clamped_export = client.get("/api/records/export")
            backup = client.get("/api/admin/backup")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        get_settings.cache_clear()

    assert clamped_export.status_code == 200
    assert backup.status_code == 200
    assert clamped_export.json()["total_records"] == 200
    backup_body = backup.json()
    assert backup_body["max_record_limit"] is None
    assert backup_body["record_stats"]["max_page_size"] == 200
    assert backup_body["total_records"] == 205
    assert backup_body["records_included"] == 205
    assert len(backup_body["records"]) == 205


def test_admin_restore_imports_full_backup_and_requires_token(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'restore.db'}")
    monkeypatch.setenv("ADMIN_TOKEN", "secret-token")
    get_settings.cache_clear()
    try:
        settings = get_settings()
        upsert_prompt_config(settings, "creation", "Return JSON and suggest one very tiny creative action.")
        upsert_runtime_model_config(settings, "qwen", "qwen-plus")
        with create_client() as client:
            saved = client.post(
                "/api/ai/chat",
                json={"scene": "creation", "text": "make one tiny thing"},
            )
            backup = client.get("/api/admin/backup", headers={"X-Admin-Token": "secret-token"}).json()
            client.delete("/api/records", headers={"X-Admin-Token": "secret-token"})
            upsert_prompt_config(settings, "creation", "Temporary overwritten prompt content for restore testing.")
            upsert_runtime_model_config(settings, "deepseek", "temporary-model")

            blocked = client.post("/api/admin/restore", json={"mode": "replace", "backup": backup})
            restored = client.post(
                "/api/admin/restore",
                headers={"X-Admin-Token": "secret-token"},
                json={"mode": "replace", "backup": backup},
            )
            records = client.get("/api/records?limit=5")
            prompt = client.get("/api/prompts/creation")
            model = client.get("/api/models/config")

            newer_backup = dict(backup)
            newer_backup["schema_version"] = SCHEMA_VERSION + 1
            rejected = client.post(
                "/api/admin/restore",
                headers={"X-Admin-Token": "secret-token"},
                json={"mode": "merge", "backup": newer_backup},
            )
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ADMIN_TOKEN", raising=False)
        get_settings.cache_clear()

    assert saved.status_code == 200
    assert blocked.status_code == 403
    assert restored.status_code == 200
    restore_body = restored.json()
    assert restore_body["mode"] == "replace"
    assert restore_body["records_imported"] == 1
    assert restore_body["records_skipped"] == 0
    assert restore_body["prompt_overrides_imported"] == 1
    assert restore_body["runtime_model_config_imported"] is True
    assert restore_body["record_stats"]["total_records"] == 1
    assert records.json()[0]["scene"] == "creation"
    assert prompt.json()["content"] == "Return JSON and suggest one very tiny creative action."
    assert model.json()["provider"] == "qwen"
    assert model.json()["model"] == "qwen-plus"
    assert rejected.status_code == 400


def test_admin_maintenance_optimizes_database_and_requires_token(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'maintenance.db'}")
    monkeypatch.setenv("ADMIN_TOKEN", "secret-token")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            saved = client.post(
                "/api/ai/chat",
                json={"scene": "creation", "text": "create one tiny thing"},
            )
            blocked = client.post("/api/admin/maintenance", json={"vacuum": False})
            maintained = client.post(
                "/api/admin/maintenance",
                headers={"X-Admin-Token": "secret-token"},
                json={"vacuum": False},
            )
            vacuumed = client.post(
                "/api/admin/maintenance",
                headers={"X-Admin-Token": "secret-token"},
                json={"vacuum": True},
            )
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ADMIN_TOKEN", raising=False)
        get_settings.cache_clear()

    assert saved.status_code == 200
    assert blocked.status_code == 403
    assert maintained.status_code == 200
    body = maintained.json()
    assert body["optimized"] is True
    assert body["vacuumed"] is False
    assert body["records_pruned"] == 0
    assert body["prune_before_timestamp"] is None
    assert len(body["wal_checkpoint"]) == 3
    assert body["page_count_before"] >= 1
    assert body["page_count_after"] >= 1
    assert body["freelist_count_before"] >= 0
    assert body["freelist_count_after"] >= 0
    assert body["database_size_bytes_before"] >= 0
    assert body["database_size_bytes_after"] >= 0
    assert vacuumed.status_code == 200
    assert vacuumed.json()["vacuumed"] is True


def test_admin_maintenance_can_prune_old_records(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'maintenance-prune.db'}")
    monkeypatch.setenv("ADMIN_TOKEN", "secret-token")
    get_settings.cache_clear()
    try:
        settings = get_settings()
        init_database(settings)
        with create_client() as client:
            old_record = client.post(
                "/api/ai/chat",
                json={"scene": "creation", "text": "old record"},
            )
            fresh_record = client.post(
                "/api/ai/chat",
                json={"scene": "creation", "text": "fresh record"},
            )
            assert old_record.status_code == 200
            assert fresh_record.status_code == 200

            old_timestamp = int(time.time()) - 120 * 86_400
            with sqlite3.connect(database_path(settings)) as conn:
                conn.execute("UPDATE ai_records SET created_at = ? WHERE input = ?", (old_timestamp, "old record"))

            maintained = client.post(
                "/api/admin/maintenance",
                headers={"X-Admin-Token": "secret-token"},
                json={"vacuum": False, "prune_older_than_days": 90},
            )
            records = client.get("/api/records?limit=10")
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ADMIN_TOKEN", raising=False)
        get_settings.cache_clear()

    assert maintained.status_code == 200
    body = maintained.json()
    assert body["records_pruned"] == 1
    assert body["prune_before_timestamp"] is not None
    remaining_inputs = {record["input"] for record in records.json()}
    assert "fresh record" in remaining_inputs
    assert "old record" not in remaining_inputs


def test_records_can_be_deleted():
    with create_client() as client:
        response = client.post(
            "/api/ai/chat",
            json={"scene": "creation", "text": "create one more tiny thing"},
        )
        assert response.status_code == 200

        deleted = client.delete("/api/records")
        assert deleted.status_code == 200
        assert deleted.json()["deleted"] >= 1

        records = client.get("/api/records?limit=5")
        assert records.status_code == 200
        assert records.json() == []


def test_delete_records_can_require_admin_token(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "secret-token")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            blocked = client.delete("/api/records")
            allowed = client.delete("/api/records", headers={"X-Admin-Token": "secret-token"})
    finally:
        monkeypatch.delenv("ADMIN_TOKEN", raising=False)
        get_settings.cache_clear()

    assert blocked.status_code == 403
    assert allowed.status_code == 200


def test_single_record_can_be_deleted():
    suffix = time.time_ns()
    creation_text = f"single delete sketch {suffix}"
    procrastination_text = f"single delete action {suffix}"
    with create_client() as client:
        first = client.post(
            "/api/ai/chat",
            json={"scene": "creation", "text": creation_text},
        )
        second = client.post(
            "/api/ai/chat",
            json={"scene": "procrastination", "text": procrastination_text},
        )
        assert first.status_code == 200
        assert second.status_code == 200

        records = client.get("/api/records?limit=20")
        assert records.status_code == 200
        creation_record = next(record for record in records.json() if record["input"] == creation_text)

        deleted = client.delete(f"/api/records/{creation_record['id']}")
        missing = client.delete(f"/api/records/{creation_record['id']}")
        remaining = client.get("/api/records?limit=20")

    assert deleted.status_code == 200
    assert deleted.json()["deleted"] == 1
    assert missing.status_code == 404
    remaining_inputs = {record["input"] for record in remaining.json()}
    assert creation_text not in remaining_inputs
    assert procrastination_text in remaining_inputs


def test_delete_single_record_can_require_admin_token(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "secret-token")
    get_settings.cache_clear()
    try:
        with create_client() as client:
            blocked = client.delete("/api/records/1")
            allowed_missing = client.delete("/api/records/1", headers={"X-Admin-Token": "secret-token"})
    finally:
        monkeypatch.delenv("ADMIN_TOKEN", raising=False)
        get_settings.cache_clear()

    assert blocked.status_code == 403
    assert allowed_missing.status_code == 404


def test_database_initialization_creates_indexes(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'smooth.db'}")
    init_database(settings)
    with sqlite3.connect(database_path(settings)) as conn:
        indexes = {row[1] for row in conn.execute("PRAGMA index_list(ai_records)").fetchall()}
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()}
        schema_version = conn.execute("PRAGMA user_version").fetchone()[0]

    assert "idx_ai_records_created_at" in indexes
    assert "idx_ai_records_scene_created_at" in indexes
    assert "idx_ai_records_created_id" in indexes
    assert "idx_ai_records_scene_created_id" in indexes
    assert "prompt_configs" in tables
    assert "runtime_model_config" in tables
    assert schema_version == SCHEMA_VERSION


def test_database_initialization_migrates_legacy_missing_columns(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'legacy.db'}")
    with sqlite3.connect(database_path(settings)) as conn:
        conn.execute(
            """
            CREATE TABLE ai_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scene TEXT NOT NULL,
                input TEXT NOT NULL,
                output TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """,
        )
        conn.execute("PRAGMA user_version = 0")

    init_database(settings)

    with sqlite3.connect(database_path(settings)) as conn:
        ai_record_columns = {row[1] for row in conn.execute("PRAGMA table_info(ai_records)").fetchall()}
        indexes = {row[1] for row in conn.execute("PRAGMA index_list(ai_records)").fetchall()}
        schema_version = conn.execute("PRAGMA user_version").fetchone()[0]

    save_ai_record(
        settings,
        CoachRequest(scene="creation", text="make one tiny thing"),
        generate_fallback_result(),
    )

    with sqlite3.connect(database_path(settings)) as conn:
        row = conn.execute("SELECT scene, risk_level FROM ai_records ORDER BY id DESC LIMIT 1").fetchone()

    assert "risk_level" in ai_record_columns
    assert "idx_ai_records_scene_created_id" in indexes
    assert schema_version == SCHEMA_VERSION
    assert row == ("creation", 0)


def test_deepseek_payload_uses_json_output_and_disables_thinking(monkeypatch, tmp_path):
    calls = {"url": "", "headers": {}, "payload": {}}

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": """
                            {
                              "reply_text": "先打开文件。",
                              "emotion_labels": ["stuck"],
                              "need_labels": ["start"],
                              "risk_level": 0,
                              "action_card": {
                                "title": "打开文件",
                                "estimated_minutes": 1,
                                "difficulty": "very_low",
                                "steps": ["打开文件"]
                              },
                              "relationship_scripts": null,
                              "quick_replies": ["我做完了"]
                            }
                            """
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, *args, **kwargs):
            calls["url"] = url
            calls["headers"] = kwargs["headers"]
            calls["payload"] = kwargs["json"]
            return FakeResponse()

    monkeypatch.setattr("app.ai_provider.httpx.AsyncClient", FakeClient)
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'deepseek-payload.db'}",
        ai_provider="deepseek",
        ai_model="deepseek-v4-flash",
        deepseek_api_key="test-deepseek-key",
    )
    request = CoachRequest(scene="procrastination", text="write report")

    import anyio

    result = anyio.run(generate_ai_response, settings, request)
    assert calls["url"] == "https://api.deepseek.com/chat/completions"
    assert calls["headers"]["Authorization"] == "Bearer test-deepseek-key"
    assert calls["payload"]["model"] == "deepseek-v4-flash"
    assert calls["payload"]["stream"] is False
    assert calls["payload"]["thinking"] == {"type": "disabled"}
    assert calls["payload"]["response_format"] == {"type": "json_object"}
    assert "json" in calls["payload"]["messages"][0]["content"].lower()
    assert "json" in calls["payload"]["messages"][1]["content"].lower()
    assert result.action_card


def test_qwen_provider_uses_configured_base_url(monkeypatch, tmp_path):
    calls = {"url": "", "payload": {}}

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": """
                            {
                              "reply_text": "先打开文件。",
                              "emotion_labels": ["stuck"],
                              "need_labels": ["start"],
                              "risk_level": 0,
                              "action_card": {
                                "title": "打开文件",
                                "estimated_minutes": 1,
                                "difficulty": "very_low",
                                "steps": ["打开文件"]
                              },
                              "relationship_scripts": null,
                              "quick_replies": ["我做完了"]
                            }
                            """
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, *args, **kwargs):
            calls["url"] = url
            calls["payload"] = kwargs["json"]
            return FakeResponse()

    monkeypatch.setattr("app.ai_provider.httpx.AsyncClient", FakeClient)
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'qwen-provider.db'}",
        ai_provider="qwen",
        ai_model="qwen-plus",
        qwen_api_key="test-key",
        qwen_base_url="https://qwen.example/v1",
    )
    request = CoachRequest(scene="procrastination", text="write report")

    import anyio

    result = anyio.run(generate_ai_response, settings, request)
    assert calls["url"] == "https://qwen.example/v1/chat/completions"
    assert calls["payload"]["model"] == "qwen-plus"
    assert "thinking" not in calls["payload"]
    assert result.action_card
    assert result.action_card.estimated_minutes == 1


def test_custom_prompt_is_used_in_model_payload(monkeypatch, tmp_path):
    calls = {"payload": {}}

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": """
                            {
                              "reply_text": "先做 30 秒。",
                              "emotion_labels": ["stuck"],
                              "need_labels": ["start"],
                              "risk_level": 0,
                              "action_card": {
                                "title": "30 秒启动",
                                "estimated_minutes": 1,
                                "difficulty": "very_low",
                                "steps": ["打开入口", "只做 30 秒"]
                              },
                              "relationship_scripts": null,
                              "quick_replies": ["我做完了"]
                            }
                            """
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            calls["payload"] = kwargs["json"]
            return FakeResponse()

    monkeypatch.setattr("app.ai_provider.httpx.AsyncClient", FakeClient)
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'prompts.db'}",
        deepseek_api_key="test-key",
    )
    upsert_prompt_config(settings, "procrastination", "只允许生成 30 秒版本的行动，并返回 JSON。")
    request = CoachRequest(scene="procrastination", text="write report")

    import anyio

    result = anyio.run(generate_ai_response, settings, request)
    user_message = calls["payload"]["messages"][1]["content"]
    assert "30 秒版本" in user_message
    assert result.action_card


def test_runtime_model_config_is_used_in_model_payload(monkeypatch, tmp_path):
    calls = {"payload": {}, "url": ""}

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": """
                            {
                              "reply_text": "先打开文件。",
                              "emotion_labels": ["stuck"],
                              "need_labels": ["start"],
                              "risk_level": 0,
                              "action_card": {
                                "title": "打开文件",
                                "estimated_minutes": 1,
                                "difficulty": "very_low",
                                "steps": ["打开文件"]
                              },
                              "relationship_scripts": null,
                              "quick_replies": ["我做完了"]
                            }
                            """
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, *args, **kwargs):
            calls["url"] = url
            calls["payload"] = kwargs["json"]
            return FakeResponse()

    monkeypatch.setattr("app.ai_provider.httpx.AsyncClient", FakeClient)
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'runtime-model.db'}",
        ai_provider="deepseek",
        ai_model="deepseek-v4-flash",
        qwen_api_key="test-key",
        qwen_base_url="https://qwen.example/v1",
    )
    upsert_runtime_model_config(settings, "qwen", "qwen-plus")

    import anyio

    result = anyio.run(generate_ai_response, settings, CoachRequest(scene="procrastination", text="write report"))
    assert calls["url"] == "https://qwen.example/v1/chat/completions"
    assert calls["payload"]["model"] == "qwen-plus"
    assert result.action_card


def test_empty_model_content_retries_once(monkeypatch, tmp_path):
    calls = {"count": 0}

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            calls["count"] += 1
            if calls["count"] == 1:
                return {"choices": [{"message": {"content": ""}}]}
            return {
                "choices": [
                    {
                        "message": {
                            "content": """
                            {
                              "reply_text": "先打开文档。",
                              "emotion_labels": ["stuck"],
                              "need_labels": ["start"],
                              "risk_level": 0,
                              "action_card": {
                                "title": "打开文档",
                                "estimated_minutes": 1,
                                "difficulty": "very_low",
                                "steps": ["打开文档"]
                              },
                              "relationship_scripts": null,
                              "quick_replies": ["我做完了"]
                            }
                            """
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr("app.ai_provider.httpx.AsyncClient", FakeClient)
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'empty-retry.db'}", deepseek_api_key="test-key")
    request = CoachRequest(scene="procrastination", text="write report")

    import anyio

    result = anyio.run(generate_ai_response, settings, request)
    assert calls["count"] == 2
    assert result.action_card
    assert result.action_card.estimated_minutes == 1
