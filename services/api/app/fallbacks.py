from app.schemas import ActionCard, CoachRequest, CoachResult, RelationshipScripts


def local_fallback(request: CoachRequest, warning: str | None = None) -> CoachResult:
    prefix = f"{warning}\n" if warning else ""
    if request.scene == "relationship":
        return CoachResult(
            reply_text=prefix + "先把事实和猜测分开。仅凭当前信息，我们还不能确定对方动机；可以先准备一版低攻击性的表达。",
            emotion_labels=["uncertainty"],
            need_labels=["clarity", "boundary"],
            relationship_scripts=RelationshipScripts(
                gentle="刚才那件事我有点在意。你方便的时候回我一下就好，我想确认我们是不是理解不一样。",
                direct="我想确认一下：你现在是不方便回复，还是暂时不想聊这个？我需要一个明确一点的回应。",
                boundary="如果你现在不方便聊，可以直接告诉我，我能接受。但长时间没有回应会让我有些困扰，我需要我们约一个可以沟通的时间。",
            ),
            quick_replies=["保存温和版", "10 分钟后提醒我"],
        )
    if request.scene == "daily_review":
        return CoachResult(
            reply_text=prefix + "今天先承认已经发生的努力。明天只需要选择一个 2 分钟动作开始，不需要把整天都规划完。",
            emotion_labels=["reflective"],
            need_labels=["rest", "clarity"],
            action_card=ActionCard(
                title="写下明天最小一步",
                estimated_minutes=2,
                difficulty="low",
                steps=["打开备忘录", "写一个明天要做的小动作", "把它放到容易看到的位置"],
            ),
            quick_replies=["保存复盘"],
        )
    if request.scene == "creation":
        return CoachResult(
            reply_text=prefix + "先不用责怪自己。我们从被动消费切到一个很小的主动输出，让大脑重新感觉到一点掌控。",
            emotion_labels=["tired"],
            need_labels=["agency"],
            action_card=ActionCard(
                title="写下 50 字想法",
                estimated_minutes=3,
                difficulty="low",
                steps=["把手机放远一点", "打开备忘录", "写下刚才冒出来的一件事"],
            ),
            quick_replies=["好一点", "没变化"],
        )
    if request.scene == "encouragement":
        return CoachResult(
            reply_text=prefix + "你说的“不行”更像是在表达担心，而不是事实。先收集一个中性证据，让判断稍微落地一点。",
            emotion_labels=["self_doubt"],
            need_labels=["confidence"],
            action_card=ActionCard(
                title="写下一句中性事实",
                estimated_minutes=2,
                difficulty="very_low",
                steps=["打开备忘录", "写一句你已经知道的事实", "不要求说服自己"],
            ),
            quick_replies=["温柔一点", "理性分析"],
        )
    return CoachResult(
        reply_text=prefix + "没关系，先把门槛降到最低。现在只做一个 1 分钟动作。",
        emotion_labels=["stuck"],
        need_labels=["start"],
        action_card=ActionCard(
            title="只打开相关文件",
            estimated_minutes=1,
            difficulty="very_low",
            steps=["找到相关文件", "打开它", "先不要求继续"],
        ),
        quick_replies=["我做完了", "更简单一点"],
    )


def safety_response(risk_level: int = 3) -> CoachResult:
    urgent_prefix = (
        "这听起来可能有立即危险。请现在先离开可能伤害自己的物品或地点，联系身边的人；如果已经有具体计划、工具或地点，请立刻拨打 110 或 120。"
        if risk_level >= 4
        else "我先不继续给效率建议。请优先联系现实中的可信任联系人；如果有立即危险，请拨打 110 或 120。"
    )
    return CoachResult(
        reply_text=f"{urgent_prefix} 也可以联系心理援助热线 12356。",
        emotion_labels=["high_risk"],
        need_labels=["safety"],
        risk_level=risk_level,
        quick_replies=["打开安全支持"],
    )
