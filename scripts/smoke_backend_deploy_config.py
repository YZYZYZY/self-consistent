from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    check_package_json(ROOT / "package.json")
    check_gitignore(ROOT / ".gitignore")
    check_env_examples(ROOT / ".env.example", ROOT / "apps" / "web" / ".env.example")
    check_dockerfile(ROOT / "services" / "api" / "Dockerfile")
    check_dockerignore(ROOT / "services" / "api" / ".dockerignore")
    check_compose(ROOT / "docker-compose.yml")
    check_render(ROOT / "render.yaml")
    check_docs(ROOT / "docs" / "DEPLOYMENT.md", ROOT / "docs" / "ACCEPTANCE.md")
    print("Backend deployment config smoke checks passed.")
    return 0


def check_package_json(path: Path) -> None:
    text = read(path)
    assert_contains(text, '"release:bundle"', "package.json release bundle script")
    assert_contains(text, "scripts\\\\release_bundle.py", "package.json release bundle target")


def check_gitignore(path: Path) -> None:
    text = read(path)
    assert_contains(text, "artifacts/", "gitignore release artifacts")


def check_env_examples(root_env: Path, web_env: Path) -> None:
    root_text = read(root_env)
    web_text = read(web_env)
    for key in [
        "DEEPSEEK_API_KEY=",
        "DEEPSEEK_BASE_URL=https://api.deepseek.com",
        "AI_PROVIDER=deepseek",
        "AI_MODEL=deepseek-v4-flash",
        "OPENAI_API_KEY=",
        "QWEN_API_KEY=",
        "MOONSHOT_API_KEY=",
        "ZHIPU_API_KEY=",
        "CLAUDE_API_KEY=",
        "GEMINI_API_KEY=",
        "CUSTOM_API_KEY=",
        "DATABASE_URL=sqlite:///./micro_action_coach.db",
        "SERVER_RECORD_ENABLED=true",
        "ADMIN_TOKEN=",
        "CORS_ORIGINS=http://localhost:5173",
    ]:
        assert_contains(root_text, key, f"root .env.example includes {key}")
    assert_contains(web_text, "VITE_API_BASE_URL=http://localhost:8000", "web .env.example API base URL")
    assert_contains(web_text, "CAP_SERVER_URL=https://your-frontend-domain.example", "web .env.example Capacitor remote URL")
    assert_contains(web_text, "CAP_ALLOW_CLEAR_TEXT=false", "web .env.example cleartext override")


def check_dockerfile(path: Path) -> None:
    text = read(path)
    assert_contains(text, "FROM python:3.12-slim", "Dockerfile Python base")
    assert_contains(text, "ENV PYTHONPATH=/app", "Dockerfile PYTHONPATH")
    assert_contains(text, "WORKDIR /app", "Dockerfile workdir")
    assert_contains(text, "pip install --no-cache-dir -r /app/requirements.txt", "Dockerfile dependency install")
    assert_contains(text, "COPY app /app/app", "Dockerfile app copy")
    assert_contains(text, "EXPOSE 8000", "Dockerfile exposed port")
    assert_contains(text, '"uvicorn", "app.main:app"', "Dockerfile uvicorn command")
    assert_contains(text, '"--host", "0.0.0.0"', "Dockerfile public host binding")
    assert_contains(text, '"--port", "8000"', "Dockerfile API port")


def check_dockerignore(path: Path) -> None:
    text = read(path)
    for pattern in ["__pycache__/", ".pytest_cache/", "*.pyc", "*.db", "*.sqlite", "*.sqlite3", ".env", ".env.*", "tests/"]:
        assert_contains(text, pattern, f"Docker ignore includes {pattern}")


def check_compose(path: Path) -> None:
    text = read(path)
    assert_contains(text, "context: ./services/api", "compose builds API service")
    assert_contains(text, "DATABASE_URL: sqlite:////data/micro_action_coach.db", "compose persistent SQLite URL")
    assert_contains(text, "api-data:/data", "compose persistent data volume")
    assert_contains(text, '"8000:8000"', "compose API port mapping")
    assert_contains(text, "http://127.0.0.1:8000/health", "compose healthcheck path")


def check_render(path: Path) -> None:
    text = read(path)
    assert_contains(text, "runtime: docker", "Render Docker runtime")
    assert_contains(text, "rootDir: services/api", "Render API rootDir")
    assert_contains(text, "healthCheckPath: /health", "Render health check path")
    assert_contains(text, "disk:", "Render persistent disk")
    assert_contains(text, "mountPath: /data", "Render disk mount path")
    assert_contains(text, "sizeGB: 5", "Render disk size")
    assert_contains(text, "key: CORS_ORIGINS\n        sync: false", "Render CORS secret/env override")
    assert_contains(text, "key: DEEPSEEK_API_KEY\n        sync: false", "Render DeepSeek secret")
    assert_contains(text, "key: ADMIN_TOKEN\n        sync: false", "Render admin token secret")
    assert_contains(text, "key: SERVER_RECORD_ENABLED\n        value: \"true\"", "Render server records enabled")
    assert_contains(text, "value: sqlite:////data/micro_action_coach.db", "Render persistent SQLite URL")


def check_docs(deployment: Path, acceptance: Path) -> None:
    deployment_text = read(deployment)
    acceptance_text = read(acceptance)
    for text, label in [(deployment_text, "deployment docs"), (acceptance_text, "acceptance docs")]:
        assert_contains(text, "VITE_API_BASE_URL", f"{label} frontend API env")
        assert_contains(text, "CORS_ORIGINS", f"{label} backend CORS env")
        assert_contains(text, "DEEPSEEK_API_KEY", f"{label} DeepSeek env")
        assert_contains(text, "ADMIN_TOKEN", f"{label} admin token env")
        assert_contains(text, "CAP_SERVER_URL", f"{label} Capacitor remote URL")
        assert_contains(text, "CAP_ALLOW_CLEAR_TEXT", f"{label} Capacitor cleartext override")
        assert_contains(text, "RELEASE_READINESS_REPORT", f"{label} readiness report env")
        assert_contains(text, "release:bundle", f"{label} release bundle script")
        assert_contains(text, "SMOKE_FRONTEND_URL", f"{label} frontend smoke URL")
        assert_contains(text, "SMOKE_BACKEND_URL", f"{label} backend smoke URL")
        assert_contains(text, "SMOKE_DEPLOY_REPORT", f"{label} deployment smoke report")
    assert_contains(deployment_text, "DATABASE_URL=sqlite:////data/micro_action_coach.db", "deployment docs persistent SQLite URL")
    assert_contains(acceptance_text, "DATABASE_URL=sqlite:////data/micro_action_coach.db", "acceptance docs persistent SQLite URL")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def assert_contains(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise AssertionError(label)


if __name__ == "__main__":
    raise SystemExit(main())
