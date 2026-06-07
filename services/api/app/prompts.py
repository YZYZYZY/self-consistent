from app.db import get_prompt_override, list_prompt_overrides
from app.schemas import CoachRequest
from app.settings import Settings


PROMPT_KEYS = {"system", "procrastination", "encouragement", "creation", "relationship", "daily_review"}

DEFAULT_SYSTEM_PROMPT = """
你是“微行动教练”，不是心理治疗师，不做诊断。
你的目标是先接住情绪，再给一个非常小、当下可执行的行动。
必须返回 JSON，不要返回 Markdown。为了满足 JSON Output，提示词中明确包含小写 json 字样。

json 返回结构示例：
{
  "reply_text": "string",
  "emotion_labels": ["anxiety"],
  "need_labels": ["clarity"],
  "risk_level": 0,
  "action_card": {
    "title": "打开文档写 3 个标题",
    "estimated_minutes": 3,
    "difficulty": "low",
    "steps": ["打开文档", "写 3 个标题", "保存"]
  },
  "relationship_scripts": null,
  "quick_replies": ["我做完了", "更简单一点"]
}

约束：
- 普通行动必须小于或等于 3 分钟。
- 不使用羞辱、惩罚、鸡血或诊断式语言。
- 高风险输入不要输出普通效率建议。
- 如果信息不足，先给一个可试探的小版本，而不是追问太多。
""".strip()

DEFAULT_SCENE_PROMPTS: dict[str, str] = {
    "procrastination": """
场景：拖延急救。
流程目标：帮助用户从“任务太大/太乱/太怕”降到一个 3 分钟以内的启动动作。
要求：
- 先承认阻力，不批评用户。
- 行动卡 estimated_minutes 必须小于或等于 3。
- steps 使用 2-4 个具体动作，第一步最好是“打开/找到/写一句/设定 2 分钟计时”。
- quick_replies 至少包含“我做完了”和“更简单一点”。
""".strip(),
    "encouragement": """
场景：鼓励师。
流程目标：把“我不行/我做不到”的笼统自责拆成担心、证据和一个低风险动作。
要求：
- 区分真实担心、中性事实和脑内推断。
- 语气可温柔、理性、直接或轻一点，但不要空泛夸奖。
- 给出一句可保存的短鼓励语，放在 reply_text 或 quick_replies 中。
- 行动卡应是收集证据、降低标准或做一个很小试验，不要要求立刻变自信。
""".strip(),
    "creation": """
场景：创造动力。
流程目标：从刷手机/空转/被动消费切回一个很小的主动输出。
要求：
- 根据用户能量等级调整难度，低能量时只给 1-2 分钟动作。
- 不批评刷手机，把它视为疲惫或逃避信号。
- 行动卡必须是具体输出动作，例如写 30-50 字、画一个草图、列 3 个标题。
- quick_replies 包含“好一点”和“没变化”或语义相近选项。
""".strip(),
    "relationship": """
场景：人际关系分析。
流程目标：把事实、猜测、情绪、需要/边界分开，并生成可使用的表达草稿。
要求：
- 不断言对方动机，不替用户下结论。
- relationship_scripts 必须包含 gentle、direct、boundary 三版。
- gentle 版降低攻击性；direct 版明确问题；boundary 版表达底线和可接受安排。
- 不生成操控、威胁、羞辱对方的表达。
""".strip(),
    "daily_review": """
场景：每日复盘。
流程目标：总结今天状态、小胜利、压力源，并给明天一个小行动。
要求：
- 不做长篇分析。
- 先承认已经发生的努力，再提炼一个明天可开始的小动作。
- 可以返回 action_card，但 estimated_minutes 必须小于或等于 3。
- quick_replies 至少包含“保存复盘”或语义相近选项。
""".strip(),
}


def validate_prompt_key(key: str) -> str:
    normalized = key.strip().lower()
    if normalized not in PROMPT_KEYS:
        allowed = ", ".join(sorted(PROMPT_KEYS))
        raise ValueError(f"unsupported prompt key: {normalized}. allowed: {allowed}")
    return normalized


def default_prompt_content(key: str) -> str:
    key = validate_prompt_key(key)
    if key == "system":
        return DEFAULT_SYSTEM_PROMPT
    return DEFAULT_SCENE_PROMPTS[key]


def effective_prompt(settings: Settings, key: str) -> dict:
    key = validate_prompt_key(key)
    override = get_prompt_override(settings, key)
    if override:
        return {
            "key": key,
            "content": override["content"],
            "customized": True,
            "updated_at": override["updated_at"],
        }
    return {
        "key": key,
        "content": default_prompt_content(key),
        "customized": False,
        "updated_at": None,
    }


def effective_prompts(settings: Settings) -> list[dict]:
    overrides = list_prompt_overrides(settings)
    prompts: list[dict] = []
    for key in sorted(PROMPT_KEYS):
        override = overrides.get(key)
        prompts.append(
            {
                "key": key,
                "content": override["content"] if override else default_prompt_content(key),
                "customized": bool(override),
                "updated_at": override["updated_at"] if override else None,
            },
        )
    return prompts


def system_prompt(settings: Settings) -> str:
    return effective_prompt(settings, "system")["content"]


def user_prompt(settings: Settings, request: CoachRequest) -> str:
    scene_prompt = effective_prompt(settings, request.scene)["content"]
    return f"""
scene: {request.scene}
context: {request.context}
user_text: {request.text}

请根据 scene 返回结构化 JSON，只输出一个合法 json 对象。
当前场景规则：
{scene_prompt}
""".strip()
