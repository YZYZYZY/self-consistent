import { describe, expect, it } from 'vitest'
import { detectRiskLevel, redactText, safetyCoachResult } from './safety'

describe('safety helpers', () => {
  it('redacts emails and mainland China mobile numbers', () => {
    const result = redactText('email me at a@example.com or call 13812345678, address 上海市浦东新区世纪大道100号')

    expect(result).not.toContain('a@example.com')
    expect(result).not.toContain('13812345678')
    expect(result).not.toContain('世纪大道100号')
    expect(result).toContain('[邮箱]')
    expect(result).toContain('[手机号]')
    expect(result).toContain('[地址]')
  })

  it('detects high risk text before model calls', () => {
    expect(detectRiskLevel('kill myself')).toBe(3)
    expect(detectRiskLevel('I want to die')).toBe(3)
    expect(detectRiskLevel('I might hurt someone')).toBe(3)
    expect(detectRiskLevel('我撑不下去了')).toBe(3)
    expect(detectRiskLevel('我不想继续活了')).toBe(3)
    expect(detectRiskLevel('kill myself tonight')).toBe(4)
    expect(detectRiskLevel('I want to die and I have pills')).toBe(4)
    expect(detectRiskLevel('我有点想死')).toBe(3)
    expect(detectRiskLevel('我想消失，已经到了楼顶')).toBe(4)
    expect(detectRiskLevel('我想自杀，今晚已经准备了具体方法')).toBe(4)
    expect(detectRiskLevel('I might end my life right now')).toBe(4)
    expect(detectRiskLevel('我只是有点拖延')).toBe(0)
  })

  it('returns a safety response without an action card', () => {
    const result = safetyCoachResult()

    expect(result.risk_level).toBe(3)
    expect(result.action_card).toBeNull()
    expect(result.reply_text).toContain('110')
    expect(result.reply_text).toContain('120')
    expect(result.reply_text).toContain('12356')
  })

  it('can preserve level 4 in the safety response', () => {
    const result = safetyCoachResult(4)
    expect(result.risk_level).toBe(4)
    expect(result.reply_text).toContain('立即危险')
    expect(result.reply_text).toContain('110')
  })
})
