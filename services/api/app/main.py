from contextlib import asynccontextmanager
import time

from fastapi import Header, HTTPException, FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.ai_provider import active_provider, available_providers, effective_model_config, generate_ai_response, provider_configs
from app.db import ai_record_stats, database_diagnostics, delete_ai_record, delete_ai_records, init_database, list_ai_record_cursor_page, list_ai_record_page, list_ai_records, maintain_database, restore_server_backup, save_ai_record, server_backup, server_profile_summary, upsert_prompt_config
from app.db import MAX_RECORD_LIMIT
from app.db import SCHEMA_VERSION
from app.db import upsert_runtime_model_config
from app.fallbacks import safety_response
from app.prompts import effective_prompt, effective_prompts, validate_prompt_key
from app.safety import context_text_for_risk, risk_level, sanitize_context, sanitize_text
from app.schemas import (
    AIRecord,
    AIRecordCursorPage,
    AIRecordExport,
    AIRecordPage,
    ApiDiagnostics,
    CoachRequest,
    CoachResult,
    DeleteRecordsResult,
    HealthResult,
    ModelRuntimeConfig,
    ModelRuntimeConfigUpdate,
    ModelProviderStatus,
    PromptConfig,
    PromptConfigUpdate,
    ReadinessResult,
    ServerBackup,
    ServerMaintenanceRequest,
    ServerMaintenanceResult,
    ServerRestoreRequest,
    ServerRestoreResult,
    ServerRecordStats,
    ServerProfileSummary,
)
from app.settings import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_database(settings)
    yield


app = FastAPI(title="Micro Action Coach API", version="0.1.0", lifespan=lifespan)
settings = get_settings()
app.add_middleware(GZipMiddleware, minimum_size=800)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_operational_headers(request: Request, call_next):
    started_at = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started_at) * 1000
    response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"
    if request.method == "GET" and request.url.path in CACHEABLE_READ_PATHS:
        response.headers.setdefault("Cache-Control", "public, max-age=10")
    return response


CACHEABLE_READ_PATHS = {
    "/health",
    "/readyz",
    "/api/models/providers",
    "/api/models/config",
    "/api/prompts",
    "/api/records/stats",
    "/api/profile/summary",
}


@app.get("/health", response_model=HealthResult)
async def health() -> HealthResult:
    settings = get_settings()
    config = effective_model_config(settings)
    providers = available_providers(settings)
    provider = active_provider(settings, config["provider"])
    return HealthResult(
        provider=config["provider"],
        model=config["model"],
        active_provider_configured=provider.configured,
        configured_providers=sum(1 for item in providers if item["configured"]),
    )


@app.get("/readyz", response_model=ReadinessResult)
async def readiness() -> ReadinessResult:
    settings = get_settings()
    database = await run_in_threadpool(database_diagnostics, settings)
    schema_version = database.get("schema_version")
    ready = database.get("connected") is True and schema_version == SCHEMA_VERSION
    if not ready:
        raise HTTPException(
            status_code=503,
            detail={
                "database_connected": database.get("connected") is True,
                "schema_version": schema_version,
                "expected_schema_version": SCHEMA_VERSION,
            },
        )
    return ReadinessResult(
        database_connected=True,
        schema_version=schema_version,
        expected_schema_version=SCHEMA_VERSION,
        record_enabled=bool(database.get("record_enabled")),
    )


@app.get("/api/diagnostics", response_model=ApiDiagnostics)
async def diagnostics() -> ApiDiagnostics:
    settings = get_settings()
    config = effective_model_config(settings)
    providers = available_providers(settings)
    provider = active_provider(settings, config["provider"])
    database = await run_in_threadpool(database_diagnostics, settings)
    return ApiDiagnostics.model_validate(
        {
            "version": app.version,
            "server_time": int(time.time()),
            "provider": config["provider"],
            "model": config["model"],
            "configured_providers": sum(1 for item in providers if item["configured"]),
            "active_provider_configured": provider.configured,
            "database": database,
            "deployment_checks": deployment_checks(settings, provider.configured),
        },
    )


@app.get("/api/models/providers", response_model=list[ModelProviderStatus])
async def model_providers() -> list[ModelProviderStatus]:
    return [ModelProviderStatus.model_validate(provider) for provider in available_providers(get_settings())]


def require_admin_token(x_admin_token: str = Header(default="")) -> None:
    settings = get_settings()
    if settings.admin_token and x_admin_token != settings.admin_token:
        raise HTTPException(status_code=403, detail="Admin token required.")


def deployment_checks(settings, active_provider_configured: bool) -> list[dict[str, str]]:
    checks: list[dict[str, str]] = []
    cors_origins = settings.cors_origin_list
    localhost_origins = [origin for origin in cors_origins if "localhost" in origin or "127.0.0.1" in origin]
    checks.append(
        {
            "key": "cors",
            "label": "CORS origins",
            "status": "warn" if localhost_origins or not cors_origins else "ok",
            "detail": "CORS still includes localhost/test origins." if localhost_origins else f"{len(cors_origins)} origin(s) configured.",
        },
    )
    checks.append(
        {
            "key": "model_credentials",
            "label": "Active model credentials",
            "status": "ok" if active_provider_configured else "warn",
            "detail": "Active provider is callable." if active_provider_configured else "Active provider is missing credentials or base URL.",
        },
    )
    checks.append(
        {
            "key": "admin_token",
            "label": "Admin token",
            "status": "ok" if settings.admin_token else "warn",
            "detail": "Mutating admin endpoints require a token." if settings.admin_token else "Prompt/model/export/delete endpoints are not token-protected.",
        },
    )
    checks.append(
        {
            "key": "sqlite_persistence",
            "label": "SQLite persistence",
            "status": "warn" if is_default_relative_sqlite(settings.database_url) else "ok",
            "detail": "Using default relative SQLite path; configure a persistent volume for deployment."
            if is_default_relative_sqlite(settings.database_url)
            else "SQLite path is explicitly configured.",
        },
    )
    checks.append(
        {
            "key": "server_records",
            "label": "Server record storage",
            "status": "ok" if settings.server_record_enabled else "warn",
            "detail": "Server-side records are enabled." if settings.server_record_enabled else "Server-side records are disabled.",
        },
    )
    return checks


def is_default_relative_sqlite(database_url: str) -> bool:
    return database_url.strip() == "sqlite:///./micro_action_coach.db"


@app.get("/api/models/config", response_model=ModelRuntimeConfig)
async def model_runtime_config() -> ModelRuntimeConfig:
    return ModelRuntimeConfig.model_validate(effective_model_config(get_settings()))


@app.put("/api/models/config", response_model=ModelRuntimeConfig)
async def update_model_runtime_config(
    update: ModelRuntimeConfigUpdate,
    x_admin_token: str = Header(default="", alias="X-Admin-Token"),
) -> ModelRuntimeConfig:
    require_admin_token(x_admin_token)
    provider = update.provider.lower().strip()
    known_providers = {config.id for config in provider_configs(get_settings())}
    if provider not in known_providers:
        raise HTTPException(status_code=404, detail=f"Unsupported provider: {provider}")
    saved = await run_in_threadpool(upsert_runtime_model_config, get_settings(), provider, update.model.strip())
    return ModelRuntimeConfig.model_validate(
        {
            "provider": saved["provider"],
            "model": saved["model"],
            "customized": True,
            "updated_at": saved["updated_at"],
        },
    )


@app.get("/api/prompts", response_model=list[PromptConfig])
async def prompt_configs() -> list[PromptConfig]:
    prompts = await run_in_threadpool(effective_prompts, get_settings())
    return [PromptConfig.model_validate(prompt) for prompt in prompts]


@app.get("/api/prompts/{key}", response_model=PromptConfig)
async def prompt_config(key: str) -> PromptConfig:
    try:
        normalized_key = validate_prompt_key(key)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    prompt = await run_in_threadpool(effective_prompt, get_settings(), normalized_key)
    return PromptConfig.model_validate(prompt)


@app.put("/api/prompts/{key}", response_model=PromptConfig)
async def update_prompt_config(
    key: str,
    update: PromptConfigUpdate,
    x_admin_token: str = Header(default="", alias="X-Admin-Token"),
) -> PromptConfig:
    try:
        normalized_key = validate_prompt_key(key)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    require_admin_token(x_admin_token)
    saved = await run_in_threadpool(upsert_prompt_config, get_settings(), normalized_key, update.content)
    return PromptConfig.model_validate(
        {
            "key": saved["key"],
            "content": saved["content"],
            "customized": True,
            "updated_at": saved["updated_at"],
        },
    )


async def handle_ai_request(request: CoachRequest) -> CoachResult:
    context_for_risk = context_text_for_risk(request.context)
    level = risk_level(f"{request.text}\n{context_for_risk}")
    if level >= 3:
        return safety_response(level)
    sanitized = request.model_copy(update={"text": sanitize_text(request.text), "context": sanitize_context(request.context)})
    result = await generate_ai_response(get_settings(), sanitized)
    if should_save_server_record(sanitized):
        await run_in_threadpool(save_ai_record, get_settings(), sanitized, result)
    return result


def should_save_server_record(request: CoachRequest) -> bool:
    if not get_settings().server_record_enabled:
        return False
    if request.context.get("historyEnabled") is False:
        return False
    if request.context.get("serverRecordEnabled") is False:
        return False
    return True


@app.post("/api/ai/chat", response_model=CoachResult)
async def ai_chat(request: CoachRequest) -> CoachResult:
    return await handle_ai_request(request)


@app.post("/api/ai/review", response_model=CoachResult)
async def ai_review(request: CoachRequest) -> CoachResult:
    return await handle_ai_request(request.model_copy(update={"scene": "daily_review"}))


@app.post("/api/ai/action", response_model=CoachResult)
async def ai_action(request: CoachRequest) -> CoachResult:
    return await handle_ai_request(request.model_copy(update={"scene": "procrastination"}))


@app.post("/api/ai/relationship", response_model=CoachResult)
async def ai_relationship(request: CoachRequest) -> CoachResult:
    return await handle_ai_request(request.model_copy(update={"scene": "relationship"}))


@app.get("/api/records", response_model=list[AIRecord])
async def ai_records(limit: int = 50, offset: int = 0, scene: str | None = None) -> list[AIRecord]:
    records = await run_in_threadpool(list_ai_records, get_settings(), limit, offset, scene)
    return [AIRecord.model_validate(record) for record in records]


@app.get("/api/records/page", response_model=AIRecordPage)
async def ai_record_page(limit: int = 50, offset: int = 0, scene: str | None = None) -> AIRecordPage:
    page = await run_in_threadpool(list_ai_record_page, get_settings(), limit, offset, scene)
    return AIRecordPage.model_validate(page)


@app.get("/api/records/cursor", response_model=AIRecordCursorPage)
async def ai_record_cursor_page(limit: int = 50, cursor: str | None = None, scene: str | None = None) -> AIRecordCursorPage:
    try:
        page = await run_in_threadpool(list_ai_record_cursor_page, get_settings(), limit, cursor, scene)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AIRecordCursorPage.model_validate(page)


@app.get("/api/records/stats", response_model=ServerRecordStats)
async def record_stats() -> ServerRecordStats:
    stats = await run_in_threadpool(ai_record_stats, get_settings())
    return ServerRecordStats.model_validate(stats)


@app.get("/api/records/export", response_model=AIRecordExport)
async def export_records(
    scene: str | None = None,
    x_admin_token: str = Header(default="", alias="X-Admin-Token"),
) -> AIRecordExport:
    require_admin_token(x_admin_token)
    records = await run_in_threadpool(list_ai_records, get_settings(), MAX_RECORD_LIMIT, 0, scene)
    parsed_records = [AIRecord.model_validate(record) for record in records]
    return AIRecordExport(exported_at=int(time.time()), total_records=len(parsed_records), records=parsed_records)


@app.get("/api/admin/backup", response_model=ServerBackup)
async def admin_backup(x_admin_token: str = Header(default="", alias="X-Admin-Token")) -> ServerBackup:
    require_admin_token(x_admin_token)
    backup = await run_in_threadpool(server_backup, get_settings())
    return ServerBackup.model_validate(backup)


@app.post("/api/admin/restore", response_model=ServerRestoreResult)
async def admin_restore(
    request: ServerRestoreRequest,
    x_admin_token: str = Header(default="", alias="X-Admin-Token"),
) -> ServerRestoreResult:
    require_admin_token(x_admin_token)
    try:
        result = await run_in_threadpool(
            restore_server_backup,
            get_settings(),
            request.backup.model_dump(mode="python"),
            request.mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ServerRestoreResult.model_validate(result)


@app.post("/api/admin/maintenance", response_model=ServerMaintenanceResult)
async def admin_maintenance(
    request: ServerMaintenanceRequest = ServerMaintenanceRequest(),
    x_admin_token: str = Header(default="", alias="X-Admin-Token"),
) -> ServerMaintenanceResult:
    require_admin_token(x_admin_token)
    result = await run_in_threadpool(maintain_database, get_settings(), request.vacuum, request.prune_older_than_days)
    return ServerMaintenanceResult.model_validate(result)


@app.delete("/api/records", response_model=DeleteRecordsResult)
async def delete_records(x_admin_token: str = Header(default="", alias="X-Admin-Token")) -> DeleteRecordsResult:
    require_admin_token(x_admin_token)
    deleted = await run_in_threadpool(delete_ai_records, get_settings())
    return DeleteRecordsResult(deleted=deleted)


@app.delete("/api/records/{record_id}", response_model=DeleteRecordsResult)
async def delete_record(record_id: int, x_admin_token: str = Header(default="", alias="X-Admin-Token")) -> DeleteRecordsResult:
    require_admin_token(x_admin_token)
    if record_id <= 0:
        raise HTTPException(status_code=404, detail="Record not found.")
    deleted = await run_in_threadpool(delete_ai_record, get_settings(), record_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Record not found.")
    return DeleteRecordsResult(deleted=deleted)


@app.get("/api/profile/summary", response_model=ServerProfileSummary)
async def profile_summary() -> ServerProfileSummary:
    summary = await run_in_threadpool(server_profile_summary, get_settings())
    return ServerProfileSummary.model_validate(summary)
