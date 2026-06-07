import re
from typing import Any


EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)")
ADDRESS_RE = re.compile(
    r"[\u4e00-\u9fa5]{2,}(?:省|市|区|县|镇|乡|街道|路|街|巷|弄|号楼?|单元|室)(?:[\u4e00-\u9fa5A-Za-z0-9\-#]{0,18})"
)

HIGH_RISK_PATTERNS = [
    "自杀",
    "轻生",
    "不想活",
    "想死",
    "我想死",
    "活不下去",
    "撑不下去",
    "撑不住了",
    "不想继续活",
    "结束生命",
    "自残",
    "杀了自己",
    "i want to die",
    "want to die",
    "kill myself",
    "suicide",
    "end my life",
    "hurt myself",
    "harm myself",
    "hurt someone",
    "harm someone",
    "hurt others",
    "harm others",
    "self harm",
    "伤害自己",
    "伤害别人",
    "想伤人",
    "我想消失",
]

LEVEL_4_HINTS = [
    "现在就",
    "今晚",
    "马上",
    "已经准备",
    "具体计划",
    "具体方法",
    "工具",
    "地点",
    "遗书",
    "刀",
    "药",
    "楼顶",
    "跳楼",
    "跳下去",
    "tonight",
    "right now",
    "already prepared",
    "plan",
    "method",
    "where to",
    "knife",
    "pills",
    "bridge",
    "roof",
    "jump",
]


def sanitize_text(text: str) -> str:
    text = ADDRESS_RE.sub("[地址]", text)
    text = EMAIL_RE.sub("[邮箱]", text)
    text = PHONE_RE.sub("[手机号]", text)
    return text


HISTORY_CONTEXT_KEYS = {"conversationId", "recentMessages", "history", "historySummary"}
PROFILE_CONTEXT_KEYS = {"profile", "profileSummary", "profileContext"}


def sanitize_context(context: dict[str, Any]) -> dict[str, Any]:
    sanitized = sanitize_context_value(context)
    if not isinstance(sanitized, dict):
        return {}

    if sanitized.get("historyEnabled") is False or sanitized.get("profileEnabled") is False:
        for key in HISTORY_CONTEXT_KEYS:
            sanitized.pop(key, None)
    if sanitized.get("profileEnabled") is False:
        for key in PROFILE_CONTEXT_KEYS:
            sanitized.pop(key, None)

    return sanitized


def sanitize_context_value(value: Any) -> Any:
    if isinstance(value, str):
        return sanitize_text(value)
    if isinstance(value, list):
        return [sanitize_context_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): sanitize_context_value(item) for key, item in value.items()}
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    return str(value)


def context_text_for_risk(context: dict[str, Any]) -> str:
    parts: list[str] = []

    def collect(value: Any) -> None:
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, dict):
            for item in value.values():
                collect(item)

    collect(context)
    return "\n".join(parts)


def risk_level(text: str) -> int:
    normalized = text.lower()
    has_high_risk = any(pattern.lower() in normalized for pattern in HIGH_RISK_PATTERNS)
    if not has_high_risk:
        return 0
    return 4 if any(pattern.lower() in normalized for pattern in LEVEL_4_HINTS) else 3
