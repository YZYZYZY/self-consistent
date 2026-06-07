import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.schemas import CoachRequest, CoachResult
from app.settings import Settings


_INIT_LOCK = threading.Lock()
_WRITE_LOCK = threading.Lock()
_INITIALIZED_DATABASES: set[Path] = set()
MAX_RECORD_LIMIT = 200
SCHEMA_VERSION = 1
SQLITE_CACHE_SIZE_KIB = 20_000
SQLITE_MMAP_SIZE_BYTES = 268_435_456
SQLITE_WAL_AUTOCHECKPOINT_PAGES = 1000


def database_path(settings: Settings) -> Path:
    if settings.database_url.startswith("sqlite:///"):
        return Path(settings.database_url.removeprefix("sqlite:///"))
    return Path("micro_action_coach.db")


def clamp_limit(limit: int, maximum: int = MAX_RECORD_LIMIT) -> int:
    return max(1, min(limit, maximum))


def clamp_offset(offset: int) -> int:
    return max(0, offset)


@contextmanager
def connect_database(settings: Settings) -> Iterator[sqlite3.Connection]:
    init_database(settings)
    conn = sqlite3.connect(database_path(settings), timeout=10, cached_statements=128)
    conn.row_factory = sqlite3.Row
    configure_connection(conn)
    try:
        yield conn
    finally:
        conn.close()


def configure_connection(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(f"PRAGMA cache_size = -{SQLITE_CACHE_SIZE_KIB}")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute(f"PRAGMA mmap_size = {SQLITE_MMAP_SIZE_BYTES}")
    conn.execute(f"PRAGMA wal_autocheckpoint = {SQLITE_WAL_AUTOCHECKPOINT_PAGES}")


@contextmanager
def write_transaction(settings: Settings) -> Iterator[sqlite3.Connection]:
    with _WRITE_LOCK:
        with connect_database(settings) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise


def init_database(settings: Settings) -> None:
    path = database_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    resolved_path = path.resolve()
    if resolved_path in _INITIALIZED_DATABASES:
        return

    with _INIT_LOCK:
        if resolved_path in _INITIALIZED_DATABASES:
            return
        with sqlite3.connect(path, timeout=10, cached_statements=128) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
            configure_connection(conn)
            migrate_database(conn)
            conn.execute("PRAGMA optimize")
        _INITIALIZED_DATABASES.add(resolved_path)


def migrate_database(conn: sqlite3.Connection) -> None:
    current_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
    if current_version > SCHEMA_VERSION:
        raise RuntimeError(f"Database schema version {current_version} is newer than supported version {SCHEMA_VERSION}.")

    conn.execute("BEGIN")
    try:
        ensure_ai_records_schema(conn)
        ensure_prompt_configs_schema(conn)
        ensure_runtime_model_config_schema(conn)
        ensure_indexes(conn)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def ensure_ai_records_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scene TEXT NOT NULL,
            input TEXT NOT NULL,
            output TEXT NOT NULL,
            risk_level INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )
        """,
    )
    ensure_column(conn, "ai_records", "scene", "TEXT NOT NULL DEFAULT 'unknown'")
    ensure_column(conn, "ai_records", "input", "TEXT NOT NULL DEFAULT ''")
    ensure_column(conn, "ai_records", "output", "TEXT NOT NULL DEFAULT '{}'")
    ensure_column(conn, "ai_records", "risk_level", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(conn, "ai_records", "created_at", "INTEGER NOT NULL DEFAULT 0")


def ensure_prompt_configs_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS prompt_configs (
            key TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """,
    )
    ensure_column(conn, "prompt_configs", "content", "TEXT NOT NULL DEFAULT ''")
    ensure_column(conn, "prompt_configs", "updated_at", "INTEGER NOT NULL DEFAULT 0")


def ensure_runtime_model_config_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS runtime_model_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """,
    )
    ensure_column(conn, "runtime_model_config", "provider", "TEXT NOT NULL DEFAULT 'deepseek'")
    ensure_column(conn, "runtime_model_config", "model", "TEXT NOT NULL DEFAULT 'deepseek-v4-flash'")
    ensure_column(conn, "runtime_model_config", "updated_at", "INTEGER NOT NULL DEFAULT 0")


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def ensure_indexes(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_records_created_at ON ai_records(created_at DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_records_scene_created_at ON ai_records(scene, created_at DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_records_created_id ON ai_records(created_at DESC, id DESC)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_records_scene_created_id ON ai_records(scene, created_at DESC, id DESC)",
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_records_risk_level ON ai_records(risk_level)")


def save_ai_record(settings: Settings, request: CoachRequest, result: CoachResult) -> None:
    with write_transaction(settings) as conn:
        conn.execute(
            "INSERT INTO ai_records(scene, input, output, risk_level, created_at) VALUES (?, ?, ?, ?, ?)",
            (
                request.scene,
                request.text,
                result.model_dump_json(),
                result.risk_level,
                int(time.time()),
            ),
        )


def list_ai_records(settings: Settings, limit: int = 50, offset: int = 0, scene: str | None = None) -> list[dict]:
    with connect_database(settings) as conn:
        rows = query_ai_record_rows(conn, limit, offset, scene)
    return parse_ai_record_rows(rows)


def parse_ai_record_rows(rows: list[sqlite3.Row]) -> list[dict]:
    records: list[dict] = []
    for row in rows:
        data = dict(row)
        data["output"] = json.loads(data["output"])
        records.append(data)
    return records


def list_ai_record_page(settings: Settings, limit: int = 50, offset: int = 0, scene: str | None = None) -> dict:
    safe_limit = clamp_limit(limit)
    safe_offset = clamp_offset(offset)
    with connect_database(settings) as conn:
        rows = query_ai_record_page_rows(conn, safe_limit, safe_offset, scene)
        total_records = int(rows[0]["total_records"]) if rows else count_ai_records(conn, scene)

    records: list[dict] = []
    for row in rows:
        data = dict(row)
        data.pop("total_records", None)
        data["output"] = json.loads(data["output"])
        records.append(data)

    next_offset = safe_offset + len(records)
    has_more = next_offset < total_records
    return {
        "records": records,
        "total_records": total_records,
        "limit": safe_limit,
        "offset": safe_offset,
        "next_offset": next_offset if has_more else None,
        "has_more": has_more,
    }


def encode_record_cursor(record: dict | sqlite3.Row) -> str:
    return f"{int(record['created_at'])}:{int(record['id'])}"


def decode_record_cursor(cursor: str | None) -> tuple[int, int] | None:
    if not cursor:
        return None
    try:
        created_at, record_id = cursor.strip().split(":", maxsplit=1)
        return int(created_at), int(record_id)
    except (AttributeError, TypeError, ValueError) as exc:
        raise ValueError("Record cursor must use the '<created_at>:<id>' format.") from exc


def list_ai_record_cursor_page(
    settings: Settings,
    limit: int = 50,
    cursor: str | None = None,
    scene: str | None = None,
) -> dict:
    safe_limit = clamp_limit(limit)
    parsed_cursor = decode_record_cursor(cursor)
    with connect_database(settings) as conn:
        rows = query_ai_record_cursor_rows(conn, safe_limit + 1, parsed_cursor, scene)

    has_more = len(rows) > safe_limit
    page_rows = rows[:safe_limit]
    records = parse_ai_record_rows(page_rows)
    next_cursor = encode_record_cursor(page_rows[-1]) if has_more and page_rows else None
    return {
        "records": records,
        "limit": safe_limit,
        "cursor": cursor or None,
        "next_cursor": next_cursor,
        "has_more": has_more,
    }


def query_ai_record_rows(
    conn: sqlite3.Connection,
    limit: int,
    offset: int,
    scene: str | None = None,
) -> list[sqlite3.Row]:
    normalized_scene = scene.strip() if scene else ""
    where_clause = "WHERE scene = ?" if normalized_scene else ""
    params: tuple = (
        normalized_scene,
        clamp_limit(limit),
        clamp_offset(offset),
    ) if normalized_scene else (
        clamp_limit(limit),
        clamp_offset(offset),
    )
    return conn.execute(
        f"""
        SELECT id, scene, input, output, risk_level, created_at
        FROM ai_records
        {where_clause}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
        """,
        params,
    ).fetchall()


def query_ai_record_cursor_rows(
    conn: sqlite3.Connection,
    limit: int,
    cursor: tuple[int, int] | None = None,
    scene: str | None = None,
) -> list[sqlite3.Row]:
    normalized_scene = scene.strip() if scene else ""
    clauses: list[str] = []
    params: list[str | int] = []
    if normalized_scene:
        clauses.append("scene = ?")
        params.append(normalized_scene)
    if cursor:
        clauses.append("(created_at < ? OR (created_at = ? AND id < ?))")
        params.extend([cursor[0], cursor[0], cursor[1]])
    where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(clamp_limit(limit, MAX_RECORD_LIMIT + 1))
    return conn.execute(
        f"""
        SELECT id, scene, input, output, risk_level, created_at
        FROM ai_records
        {where_clause}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
        """,
        tuple(params),
    ).fetchall()


def query_all_ai_record_rows(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT id, scene, input, output, risk_level, created_at
        FROM ai_records
        ORDER BY created_at DESC, id DESC
        """,
    ).fetchall()


def query_ai_record_page_rows(
    conn: sqlite3.Connection,
    limit: int,
    offset: int,
    scene: str | None = None,
) -> list[sqlite3.Row]:
    normalized_scene = scene.strip() if scene else ""
    where_clause = "WHERE scene = ?" if normalized_scene else ""
    params: tuple = (
        normalized_scene,
        clamp_limit(limit),
        clamp_offset(offset),
    ) if normalized_scene else (
        clamp_limit(limit),
        clamp_offset(offset),
    )
    return conn.execute(
        f"""
        SELECT id, scene, input, output, risk_level, created_at, COUNT(*) OVER() AS total_records
        FROM ai_records
        {where_clause}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
        """,
        params,
    ).fetchall()


def count_ai_records(conn: sqlite3.Connection, scene: str | None = None) -> int:
    normalized_scene = scene.strip() if scene else ""
    if normalized_scene:
        row = conn.execute("SELECT COUNT(*) AS count FROM ai_records WHERE scene = ?", (normalized_scene,)).fetchone()
    else:
        row = conn.execute("SELECT COUNT(*) AS count FROM ai_records").fetchone()
    return int(row["count"] or 0)


def ai_record_stats(settings: Settings) -> dict:
    with connect_database(settings) as conn:
        return build_ai_record_stats(conn)


def build_ai_record_stats(conn: sqlite3.Connection) -> dict:
    total_row = conn.execute(
        "SELECT COUNT(*) AS total_records, MAX(created_at) AS latest_created_at FROM ai_records",
    ).fetchone()
    scene_rows = conn.execute(
        """
        SELECT scene, COUNT(*) AS count
        FROM ai_records
        GROUP BY scene
        ORDER BY count DESC, scene ASC
        """,
    ).fetchall()
    risk_rows = conn.execute(
        """
        SELECT risk_level, COUNT(*) AS count
        FROM ai_records
        GROUP BY risk_level
        ORDER BY risk_level ASC
        """,
    ).fetchall()
    return {
        "total_records": int(total_row["total_records"] or 0),
        "latest_created_at": total_row["latest_created_at"],
        "scene_counts": {row["scene"]: row["count"] for row in scene_rows},
        "risk_counts": {str(row["risk_level"]): row["count"] for row in risk_rows},
        "max_page_size": MAX_RECORD_LIMIT,
    }


def database_diagnostics(settings: Settings) -> dict:
    path = database_path(settings)
    with connect_database(settings) as conn:
        journal_mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        busy_timeout = conn.execute("PRAGMA busy_timeout").fetchone()[0]
        foreign_keys = conn.execute("PRAGMA foreign_keys").fetchone()[0]
        page_count = conn.execute("PRAGMA page_count").fetchone()[0]
        page_size = conn.execute("PRAGMA page_size").fetchone()[0]
        freelist_count = conn.execute("PRAGMA freelist_count").fetchone()[0]
        mmap_size = conn.execute("PRAGMA mmap_size").fetchone()[0]
        wal_autocheckpoint = conn.execute("PRAGMA wal_autocheckpoint").fetchone()[0]
        schema_version = conn.execute("PRAGMA user_version").fetchone()[0]
        conn.execute("SELECT 1 FROM ai_records LIMIT 1").fetchone()

    return {
        "connected": True,
        "kind": "sqlite",
        "path_configured": bool(str(path)),
        "journal_mode": str(journal_mode),
        "busy_timeout_ms": int(busy_timeout),
        "foreign_keys": bool(foreign_keys),
        "record_enabled": settings.server_record_enabled,
        "page_count": int(page_count),
        "page_size": int(page_size),
        "freelist_count": int(freelist_count),
        "mmap_size": int(mmap_size),
        "wal_autocheckpoint": int(wal_autocheckpoint),
        "schema_version": int(schema_version),
    }


def maintain_database(settings: Settings, vacuum: bool = False, prune_older_than_days: int | None = None) -> dict:
    path = database_path(settings)
    size_before = path.stat().st_size if path.exists() else 0
    records_pruned = 0
    prune_before_timestamp = None
    with _WRITE_LOCK:
        with connect_database(settings) as conn:
            page_count_before = int(conn.execute("PRAGMA page_count").fetchone()[0])
            freelist_count_before = int(conn.execute("PRAGMA freelist_count").fetchone()[0])
            if prune_older_than_days is not None:
                prune_before_timestamp = int(time.time()) - prune_older_than_days * 86_400
                cursor = conn.execute("DELETE FROM ai_records WHERE created_at < ?", (prune_before_timestamp,))
                records_pruned = cursor.rowcount
                conn.commit()
            conn.execute("PRAGMA optimize")
            checkpoint_row = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            if vacuum:
                conn.execute("VACUUM")
            page_count_after = int(conn.execute("PRAGMA page_count").fetchone()[0])
            freelist_count_after = int(conn.execute("PRAGMA freelist_count").fetchone()[0])

    size_after = path.stat().st_size if path.exists() else 0
    return {
        "optimized": True,
        "vacuumed": vacuum,
        "records_pruned": records_pruned,
        "prune_before_timestamp": prune_before_timestamp,
        "wal_checkpoint": [int(value) for value in checkpoint_row],
        "page_count_before": page_count_before,
        "page_count_after": page_count_after,
        "freelist_count_before": freelist_count_before,
        "freelist_count_after": freelist_count_after,
        "database_size_bytes_before": size_before,
        "database_size_bytes_after": size_after,
    }


def delete_ai_records(settings: Settings) -> int:
    with write_transaction(settings) as conn:
        cursor = conn.execute("DELETE FROM ai_records")
        deleted = cursor.rowcount

    with connect_database(settings) as conn:
        conn.execute("PRAGMA optimize")
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return deleted


def delete_ai_record(settings: Settings, record_id: int) -> int:
    with write_transaction(settings) as conn:
        cursor = conn.execute("DELETE FROM ai_records WHERE id = ?", (record_id,))
        deleted = cursor.rowcount

    if deleted:
        with connect_database(settings) as conn:
            conn.execute("PRAGMA optimize")
    return deleted


def get_prompt_override(settings: Settings, key: str) -> dict | None:
    with connect_database(settings) as conn:
        row = conn.execute(
            "SELECT key, content, updated_at FROM prompt_configs WHERE key = ?",
            (key,),
        ).fetchone()
    return dict(row) if row else None


def list_prompt_overrides(settings: Settings) -> dict[str, dict]:
    with connect_database(settings) as conn:
        rows = conn.execute("SELECT key, content, updated_at FROM prompt_configs").fetchall()
    return {row["key"]: dict(row) for row in rows}


def upsert_prompt_config(settings: Settings, key: str, content: str) -> dict:
    updated_at = int(time.time())
    with write_transaction(settings) as conn:
        conn.execute(
            """
            INSERT INTO prompt_configs(key, content, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
            """,
            (key, content, updated_at),
        )
    return {"key": key, "content": content, "updated_at": updated_at}


def get_runtime_model_config(settings: Settings) -> dict | None:
    with connect_database(settings) as conn:
        row = conn.execute(
            "SELECT provider, model, updated_at FROM runtime_model_config WHERE id = 1",
        ).fetchone()
    return dict(row) if row else None


def server_backup(settings: Settings) -> dict:
    with connect_database(settings) as conn:
        record_rows = query_all_ai_record_rows(conn)
        prompt_rows = conn.execute(
            "SELECT key, content, updated_at FROM prompt_configs ORDER BY key ASC",
        ).fetchall()
        runtime_row = conn.execute(
            "SELECT provider, model, updated_at FROM runtime_model_config WHERE id = 1",
        ).fetchone()
        stats = build_ai_record_stats(conn)
        schema_version = int(conn.execute("PRAGMA user_version").fetchone()[0])

    records = parse_ai_record_rows(record_rows)
    return {
        "exported_at": int(time.time()),
        "schema_version": schema_version,
        "max_record_limit": None,
        "total_records": stats["total_records"],
        "records_included": len(records),
        "record_stats": stats,
        "prompt_overrides": [dict(row) for row in prompt_rows],
        "runtime_model_config": dict(runtime_row) if runtime_row else None,
        "records": records,
    }


def restore_server_backup(settings: Settings, backup: dict, mode: str = "merge") -> dict:
    backup_schema_version = int(backup.get("schema_version") or 0)
    if backup_schema_version > SCHEMA_VERSION:
        raise ValueError(
            f"Backup schema version {backup_schema_version} is newer than supported version {SCHEMA_VERSION}.",
        )

    if mode not in {"merge", "replace"}:
        raise ValueError("Restore mode must be merge or replace.")

    records = backup.get("records") or []
    prompt_overrides = backup.get("prompt_overrides") or []
    runtime_model_config = backup.get("runtime_model_config")
    prompt_count = 0
    imported_records = 0
    skipped_records = 0
    runtime_imported = False

    with write_transaction(settings) as conn:
        if mode == "replace":
            conn.execute("DELETE FROM ai_records")
            conn.execute("DELETE FROM prompt_configs")
            conn.execute("DELETE FROM runtime_model_config")

        prompt_rows = [
            (
                str(prompt["key"]),
                str(prompt["content"]),
                int(prompt["updated_at"]),
            )
            for prompt in prompt_overrides
        ]
        if prompt_rows:
            conn.executemany(
                """
                INSERT INTO prompt_configs(key, content, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    content = excluded.content,
                    updated_at = excluded.updated_at
                """,
                prompt_rows,
            )
            prompt_count = len(prompt_rows)

        if runtime_model_config:
            conn.execute(
                """
                INSERT INTO runtime_model_config(id, provider, model, updated_at)
                VALUES (1, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    provider = excluded.provider,
                    model = excluded.model,
                    updated_at = excluded.updated_at
                """,
                (
                    str(runtime_model_config["provider"]),
                    str(runtime_model_config["model"]),
                    int(runtime_model_config["updated_at"]),
                ),
            )
            runtime_imported = True

        record_rows = []
        for record in records:
            output = record["output"]
            output_json = output if isinstance(output, str) else json.dumps(output, ensure_ascii=False)
            record_rows.append(
                (
                    int(record["id"]),
                    str(record["scene"]),
                    str(record["input"]),
                    output_json,
                    int(record["risk_level"]),
                    int(record["created_at"]),
                ),
            )
        if record_rows:
            insert_verb = "INSERT OR REPLACE" if mode == "replace" else "INSERT OR IGNORE"
            before_changes = conn.total_changes
            conn.executemany(
                f"""
                {insert_verb} INTO ai_records(id, scene, input, output, risk_level, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                record_rows,
            )
            if mode == "replace":
                imported_records = len(record_rows)
            else:
                changed_records = max(0, conn.total_changes - before_changes)
                imported_records = min(changed_records, len(record_rows))
            skipped_records = len(record_rows) - imported_records

        stats = build_ai_record_stats(conn)

    return {
        "mode": mode,
        "records_imported": imported_records,
        "records_skipped": skipped_records,
        "prompt_overrides_imported": prompt_count,
        "runtime_model_config_imported": runtime_imported,
        "record_stats": stats,
    }


def upsert_runtime_model_config(settings: Settings, provider: str, model: str) -> dict:
    updated_at = int(time.time())
    with write_transaction(settings) as conn:
        conn.execute(
            """
            INSERT INTO runtime_model_config(id, provider, model, updated_at)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model,
                updated_at = excluded.updated_at
            """,
            (provider, model, updated_at),
        )
    return {"provider": provider, "model": model, "updated_at": updated_at}


def server_profile_summary(settings: Settings) -> dict:
    records = list_ai_records(settings, limit=MAX_RECORD_LIMIT)
    scene_counts: dict[str, int] = {}
    emotion_counts: dict[str, int] = {}
    need_counts: dict[str, int] = {}
    for record in records:
        scene_counts[record["scene"]] = scene_counts.get(record["scene"], 0) + 1
        output = record["output"]
        for label in output.get("emotion_labels", []):
            emotion_counts[label] = emotion_counts.get(label, 0) + 1
        for label in output.get("need_labels", []):
            need_counts[label] = need_counts.get(label, 0) + 1

    recent_patterns: list[str] = []
    if scene_counts.get("procrastination", 0) > 0:
        recent_patterns.append("最近存在拖延急救记录，适合继续降低启动门槛。")
    if scene_counts.get("daily_review", 0) > 0:
        recent_patterns.append("已经有复盘记录，可以开始观察情绪和压力的重复模式。")
    if not recent_patterns:
        recent_patterns.append("服务端记录还不多，先积累更多对话后再观察趋势。")

    top_need = top_keys(need_counts, 1)
    return {
        "total_records": len(records),
        "top_scenes": dict(sorted(scene_counts.items(), key=lambda item: item[1], reverse=True)[:5]),
        "emotion_labels": top_keys(emotion_counts, 6),
        "need_labels": top_keys(need_counts, 6),
        "recent_patterns": recent_patterns,
        "suggested_focus": f"下一阶段优先照顾“{top_need[0]}”这个需求。" if top_need else "先保持记录，等样本多一点再生成重点建议。",
    }


def top_keys(counts: dict[str, int], limit: int) -> list[str]:
    return [key for key, _ in sorted(counts.items(), key=lambda item: item[1], reverse=True)[:limit]]
