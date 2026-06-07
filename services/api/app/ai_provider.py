import json
from dataclasses import dataclass
from typing import Any

import httpx

from app.db import get_runtime_model_config
from app.fallbacks import local_fallback
from app.prompts import system_prompt, user_prompt
from app.schemas import CoachRequest, CoachResult
from app.settings import Settings


ERROR_MESSAGES = {
    401: "模型 API Key 无效或未授权。",
    402: "模型账户余额不足。",
    429: "模型请求过于频繁，请稍后再试。",
    500: "模型服务内部错误。",
    503: "模型服务暂时不可用。",
}


@dataclass(frozen=True)
class ProviderConfig:
    id: str
    label: str
    api_key: str
    base_url: str
    openai_compatible: bool = True
    supports_thinking: bool = False

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.base_url)

    @property
    def chat_completions_url(self) -> str:
        return f"{self.base_url.rstrip('/')}/chat/completions"


def provider_configs(settings: Settings) -> list[ProviderConfig]:
    return [
        ProviderConfig(
            id="deepseek",
            label="DeepSeek",
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            supports_thinking=True,
        ),
        ProviderConfig(id="openai", label="OpenAI", api_key=settings.openai_api_key, base_url=settings.openai_base_url),
        ProviderConfig(id="qwen", label="Qwen / 通义千问", api_key=settings.qwen_api_key, base_url=settings.qwen_base_url),
        ProviderConfig(id="moonshot", label="Moonshot / Kimi", api_key=settings.moonshot_api_key, base_url=settings.moonshot_base_url),
        ProviderConfig(id="zhipu", label="智谱 GLM", api_key=settings.zhipu_api_key, base_url=settings.zhipu_base_url),
        ProviderConfig(id="claude", label="Claude OpenAI-compatible gateway", api_key=settings.claude_api_key, base_url=settings.claude_base_url),
        ProviderConfig(id="gemini", label="Gemini OpenAI-compatible gateway", api_key=settings.gemini_api_key, base_url=settings.gemini_base_url),
        ProviderConfig(
            id="custom",
            label=settings.custom_provider_label,
            api_key=settings.custom_api_key,
            base_url=settings.custom_base_url,
        ),
    ]


def effective_model_config(settings: Settings) -> dict[str, Any]:
    runtime = get_runtime_model_config(settings)
    if runtime:
        return {
            "provider": runtime["provider"],
            "model": runtime["model"],
            "customized": True,
            "updated_at": runtime["updated_at"],
        }
    return {
        "provider": settings.ai_provider,
        "model": settings.ai_model,
        "customized": False,
        "updated_at": None,
    }


def active_provider(settings: Settings, provider_id: str | None = None) -> ProviderConfig:
    provider_id = (provider_id or effective_model_config(settings)["provider"]).lower().strip()
    for config in provider_configs(settings):
        if config.id == provider_id:
            return config
    return ProviderConfig(
        id=provider_id or "unknown",
        label=f"Unsupported provider: {provider_id or 'unknown'}",
        api_key="",
        base_url="",
    )


def available_providers(settings: Settings) -> list[dict[str, Any]]:
    active_id = effective_model_config(settings)["provider"].lower().strip()
    return [
        {
            "id": config.id,
            "label": config.label,
            "configured": config.configured,
            "active": config.id == active_id,
            "base_url": config.base_url,
            "openai_compatible": config.openai_compatible,
        }
        for config in provider_configs(settings)
    ]


def provider_error_message(status_code: int) -> str:
    return ERROR_MESSAGES.get(status_code, f"模型服务返回异常状态码：{status_code}。")


def parse_coach_content(content: str | None) -> CoachResult:
    if not content or not content.strip():
        raise ValueError("模型返回了空内容")
    data: Any = json.loads(content)
    return CoachResult.model_validate(data)


def build_chat_completion_payload(
    settings: Settings,
    request: CoachRequest,
    model: str,
    provider: ProviderConfig,
) -> dict[str, Any]:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt(settings)},
            {"role": "user", "content": user_prompt(settings, request)},
        ],
        "response_format": {"type": "json_object"},
        "stream": False,
    }
    if provider.supports_thinking:
        payload["thinking"] = {"type": "disabled"}

    return payload


async def generate_ai_response(settings: Settings, request: CoachRequest) -> CoachResult:
    model_config = effective_model_config(settings)
    provider = active_provider(settings, model_config["provider"])
    if not provider.configured:
        return local_fallback(request, f"后端未配置 {provider.label} API Key 或 base URL，已使用本地兜底建议。")

    payload = build_chat_completion_payload(settings, request, model_config["model"], provider)

    last_error: Exception | None = None
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    provider.chat_completions_url,
                    headers={"Authorization": f"Bearer {provider.api_key}", "Content-Type": "application/json"},
                    json=payload,
                )
            if response.status_code in ERROR_MESSAGES:
                return local_fallback(request, provider_error_message(response.status_code))
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            return parse_coach_content(content)
        except (json.JSONDecodeError, KeyError, ValueError) as exc:
            last_error = exc
            if attempt == 0:
                continue
        except httpx.HTTPStatusError as exc:
            return local_fallback(request, provider_error_message(exc.response.status_code))
        except Exception as exc:  # pragma: no cover - network fallback path
            last_error = exc
            break

    return local_fallback(request, f"模型暂时不可用，已使用本地兜底建议。原因：{last_error}")
