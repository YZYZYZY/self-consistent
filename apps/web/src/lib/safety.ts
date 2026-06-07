import type { CoachResult, RiskLevel } from '../types'

const HIGH_RISK_PATTERNS = [
  '自杀',
  '轻生',
  '不想活',
  '想死',
  '我想死',
  '活不下去',
  '撑不下去',
  '撑不住了',
  '不想继续活',
  '结束生命',
  '自残',
  '杀了自己',
  '伤害自己',
  '伤害别人',
  '想伤人',
  '我想消失',
  'i want to die',
  'want to die',
  'kill myself',
  'suicide',
  'end my life',
  'hurt myself',
  'harm myself',
  'hurt someone',
  'harm someone',
  'hurt others',
  'harm others',
  'self harm',
]

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const PHONE_RE = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g
const ADDRESS_RE =
  /[\u4e00-\u9fa5]{2,}(?:省|市|区|县|镇|乡|街道|路|街|巷|弄|号楼?|单元|室)(?:[\u4e00-\u9fa5A-Za-z0-9\-#]{0,18})/g
const LEVEL_4_HINTS = [
  '现在就',
  '今晚',
  '马上',
  '已经准备',
  '具体计划',
  '具体方法',
  '工具',
  '地点',
  '遗书',
  '刀',
  '药',
  '楼顶',
  '跳楼',
  '跳下去',
  'tonight',
  'right now',
  'already prepared',
  'plan',
  'method',
  'where to',
  'knife',
  'pills',
  'bridge',
  'roof',
  'jump',
]

export function detectRiskLevel(text: string): RiskLevel {
  const normalized = text.toLowerCase()
  const hasHighRisk = HIGH_RISK_PATTERNS.some((pattern) => normalized.includes(pattern.toLowerCase()))
  if (!hasHighRisk) return 0
  return LEVEL_4_HINTS.some((pattern) => normalized.includes(pattern.toLowerCase())) ? 4 : 3
}

export function redactText(text: string) {
  return text.replace(ADDRESS_RE, '[地址]').replace(EMAIL_RE, '[邮箱]').replace(PHONE_RE, '[手机号]')
}

export function safetyCoachResult(riskLevel: RiskLevel = 3): CoachResult {
  const urgentPrefix =
    riskLevel >= 4
      ? '这听起来可能有立即危险。请现在先离开可能伤害自己的物品或地点，联系身边的人；如果已经有具体计划、工具或地点，请立刻拨打 110 或 120。'
      : '我先不继续给效率建议。请优先联系现实中的可信任联系人；如果有立即危险，请拨打 110 或 120。'
  return {
    reply_text: `${urgentPrefix} 也可以联系心理援助热线 12356。`,
    emotion_labels: ['high_risk'],
    need_labels: ['safety'],
    risk_level: riskLevel,
    action_card: null,
    relationship_scripts: null,
    quick_replies: ['打开安全支持'],
  }
}
