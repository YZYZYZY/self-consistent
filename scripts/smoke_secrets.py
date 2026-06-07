from __future__ import annotations

import os
import re
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
WEB_DIST = ROOT / "apps" / "web" / "dist"
DEFAULT_APK = ROOT / "apps" / "web" / "android" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
TEXT_SUFFIXES = {
    ".html",
    ".js",
    ".css",
    ".json",
    ".webmanifest",
    ".txt",
    ".xml",
}
SECRET_ENV_NAMES = [
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "QWEN_API_KEY",
    "MOONSHOT_API_KEY",
    "ZHIPU_API_KEY",
    "CLAUDE_API_KEY",
    "GEMINI_API_KEY",
    "CUSTOM_API_KEY",
    "ADMIN_TOKEN",
    "SMOKE_ADMIN_TOKEN",
]
FORBIDDEN_CLIENT_TOKENS = [
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "QWEN_API_KEY",
    "MOONSHOT_API_KEY",
    "ZHIPU_API_KEY",
    "CLAUDE_API_KEY",
    "GEMINI_API_KEY",
    "CUSTOM_API_KEY",
]
SECRET_PATTERNS = [
    re.compile(r"\bsk-[A-Za-z0-9_\-]{20,}\b"),
    re.compile(r"\bsk-or-v1-[A-Za-z0-9_\-]{20,}\b"),
]


def main() -> int:
    checked = 0
    findings: list[str] = []
    secret_values = known_secret_values()

    if WEB_DIST.exists():
        checked += scan_directory(WEB_DIST, "web dist", secret_values, findings)

    apk_path = Path(os.environ.get("SMOKE_APK_PATH", str(DEFAULT_APK)))
    if apk_path.exists():
        checked += scan_apk(apk_path, secret_values, findings)

    if findings:
        raise AssertionError("Secret smoke found client-side secret leaks:\n" + "\n".join(findings))

    print(f"Secret smoke checks passed: scanned {checked} client artifact(s).")
    return 0


def known_secret_values() -> list[tuple[str, str]]:
    values: list[tuple[str, str]] = []
    for name in SECRET_ENV_NAMES:
        value = os.environ.get(name, "").strip()
        if len(value) >= 8 and value not in {"your-admin-token", "..."}:
            values.append((name, value))
    return values


def scan_directory(root: Path, label: str, secret_values: list[tuple[str, str]], findings: list[str]) -> int:
    count = 0
    for path in root.rglob("*"):
        if path.is_file() and path.suffix in TEXT_SUFFIXES:
            count += 1
            scan_text(path.read_text(encoding="utf-8", errors="ignore"), f"{label}:{path.relative_to(root)}", secret_values, findings)
    return count


def scan_apk(apk_path: Path, secret_values: list[tuple[str, str]], findings: list[str]) -> int:
    count = 0
    with ZipFile(apk_path) as apk:
        for name in apk.namelist():
            suffix = Path(name).suffix
            if suffix not in TEXT_SUFFIXES:
                continue
            if not name.startswith(("assets/", "res/")):
                continue
            count += 1
            text = apk.read(name).decode("utf-8", errors="ignore")
            scan_text(text, f"apk:{name}", secret_values, findings)
    return count


def scan_text(text: str, label: str, secret_values: list[tuple[str, str]], findings: list[str]) -> None:
    for token in FORBIDDEN_CLIENT_TOKENS:
        if token in text:
            findings.append(f"{label} contains forbidden token name {token}")
    for name, value in secret_values:
        if value and value in text:
            findings.append(f"{label} contains value from {name}")
    for pattern in SECRET_PATTERNS:
        match = pattern.search(text)
        if match:
            findings.append(f"{label} contains key-like token matching {pattern.pattern}")


if __name__ == "__main__":
    raise SystemExit(main())
