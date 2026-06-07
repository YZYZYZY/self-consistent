from typing import Any, Literal

from pydantic import BaseModel, Field


Scene = Literal["procrastination", "encouragement", "creation", "relationship", "daily_review"]


class CoachRequest(BaseModel):
    scene: Scene
    text: str = Field(min_length=1, max_length=6000)
    context: dict[str, Any] = Field(default_factory=dict)


class ActionCard(BaseModel):
    title: str
    estimated_minutes: int = Field(ge=1, le=30)
    difficulty: str
    steps: list[str]


class RelationshipScripts(BaseModel):
    gentle: str = ""
    direct: str = ""
    boundary: str = ""


class CoachResult(BaseModel):
    reply_text: str
    emotion_labels: list[str] = Field(default_factory=list)
    need_labels: list[str] = Field(default_factory=list)
    risk_level: int = Field(default=0, ge=0, le=4)
    action_card: ActionCard | None = None
    relationship_scripts: RelationshipScripts | None = None
    quick_replies: list[str] = Field(default_factory=list)


class HealthResult(BaseModel):
    status: str = "ok"
    provider: str
    model: str
    active_provider_configured: bool
    configured_providers: int


class ReadinessResult(BaseModel):
    status: str = "ok"
    database_connected: bool
    schema_version: int | None = None
    expected_schema_version: int
    record_enabled: bool


class DatabaseDiagnostics(BaseModel):
    connected: bool
    kind: str
    path_configured: bool
    journal_mode: str
    busy_timeout_ms: int
    foreign_keys: bool
    record_enabled: bool
    page_count: int
    page_size: int
    freelist_count: int
    mmap_size: int | None = None
    wal_autocheckpoint: int | None = None
    schema_version: int | None = None


class DeploymentCheck(BaseModel):
    key: str
    label: str
    status: Literal["ok", "warn"]
    detail: str


class ApiDiagnostics(BaseModel):
    status: str = "ok"
    version: str
    server_time: int
    provider: str
    model: str
    configured_providers: int
    active_provider_configured: bool
    database: DatabaseDiagnostics
    deployment_checks: list[DeploymentCheck] = Field(default_factory=list)


class ModelProviderStatus(BaseModel):
    id: str
    label: str
    configured: bool
    active: bool
    base_url: str
    openai_compatible: bool


class ModelRuntimeConfig(BaseModel):
    provider: str
    model: str
    customized: bool
    updated_at: int | None = None


class ModelRuntimeConfigUpdate(BaseModel):
    provider: str = Field(min_length=1, max_length=40)
    model: str = Field(min_length=1, max_length=120)


class PromptConfig(BaseModel):
    key: str
    content: str
    customized: bool
    updated_at: int | None = None


class PromptConfigUpdate(BaseModel):
    content: str = Field(min_length=20, max_length=12000)


class AIRecord(BaseModel):
    id: int
    scene: str
    input: str
    output: CoachResult
    risk_level: int
    created_at: int


class AIRecordExport(BaseModel):
    exported_at: int
    total_records: int
    records: list[AIRecord]


class PromptOverrideBackup(BaseModel):
    key: str
    content: str
    updated_at: int


class RuntimeModelConfigBackup(BaseModel):
    provider: str
    model: str
    updated_at: int


class AIRecordPage(BaseModel):
    records: list[AIRecord]
    total_records: int
    limit: int
    offset: int
    next_offset: int | None = None
    has_more: bool


class AIRecordCursorPage(BaseModel):
    records: list[AIRecord]
    limit: int
    cursor: str | None = None
    next_cursor: str | None = None
    has_more: bool


class DeleteRecordsResult(BaseModel):
    deleted: int


class ServerRecordStats(BaseModel):
    total_records: int
    latest_created_at: int | None = None
    scene_counts: dict[str, int] = Field(default_factory=dict)
    risk_counts: dict[str, int] = Field(default_factory=dict)
    max_page_size: int


class ServerBackup(BaseModel):
    exported_at: int
    schema_version: int
    max_record_limit: int | None = None
    total_records: int
    records_included: int
    record_stats: ServerRecordStats
    prompt_overrides: list[PromptOverrideBackup] = Field(default_factory=list)
    runtime_model_config: RuntimeModelConfigBackup | None = None
    records: list[AIRecord] = Field(default_factory=list)


class ServerRestoreRequest(BaseModel):
    mode: Literal["merge", "replace"] = "merge"
    backup: ServerBackup


class ServerRestoreResult(BaseModel):
    mode: Literal["merge", "replace"]
    records_imported: int
    records_skipped: int
    prompt_overrides_imported: int
    runtime_model_config_imported: bool
    record_stats: ServerRecordStats


class ServerMaintenanceRequest(BaseModel):
    vacuum: bool = False
    prune_older_than_days: int | None = Field(default=None, ge=1, le=3650)


class ServerMaintenanceResult(BaseModel):
    optimized: bool
    vacuumed: bool
    records_pruned: int
    prune_before_timestamp: int | None = None
    wal_checkpoint: list[int]
    page_count_before: int
    page_count_after: int
    freelist_count_before: int
    freelist_count_after: int
    database_size_bytes_before: int
    database_size_bytes_after: int


class ServerProfileSummary(BaseModel):
    total_records: int
    top_scenes: dict[str, int]
    emotion_labels: list[str] = Field(default_factory=list)
    need_labels: list[str] = Field(default_factory=list)
    recent_patterns: list[str] = Field(default_factory=list)
    suggested_focus: str
