import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAllLocalData,
  db,
  deleteActionTask,
  exportAllData,
  getProfileSummary,
  importAllData,
  saveActionTask,
  saveConversationTurn,
  saveCreationPlan,
  saveDailyReview,
  saveEncouragementPhrase,
  saveLocalRecord,
  saveRiskEvent,
} from './db'

describe('local database', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('exports local records and structured tables', async () => {
    await saveLocalRecord({
      scene: 'procrastination',
      input: 'task',
      result: {
        reply_text: 'start small',
        emotion_labels: ['stuck'],
        need_labels: ['start'],
        risk_level: 0,
        action_card: null,
        relationship_scripts: null,
        quick_replies: [],
      },
      createdAt: Date.now(),
    })

    const exported = await exportAllData()

    expect(exported.records).toHaveLength(1)
    expect(exported.conversations).toEqual([])
    expect(exported.actionTasks).toEqual([])
    expect(exported.dailyReviews).toEqual([])
    expect(exported.creationPlans).toEqual([])
    expect(exported.encouragementPhrases).toEqual([])
    expect(exported.riskEvents).toEqual([])
  })

  it('stores risk events without local record text', async () => {
    const now = Date.now()
    await saveRiskEvent({ scene: 'procrastination', riskLevel: 4, createdAt: now })

    const exported = await exportAllData()

    expect(exported.records).toEqual([])
    expect(exported.messages).toEqual([])
    expect(exported.riskEvents).toEqual([{ id: 1, scene: 'procrastination', riskLevel: 4, createdAt: now }])
  })

  it('summarizes profile patterns from local records', async () => {
    const now = Date.now()
    await saveLocalRecord({
      scene: 'procrastination',
      input: 'report',
      result: {
        reply_text: 'open the doc',
        emotion_labels: ['stuck'],
        need_labels: ['start'],
        risk_level: 0,
        action_card: null,
        relationship_scripts: null,
        quick_replies: [],
      },
      createdAt: now,
    })
    await saveActionTask({
      source: 'local',
      taskText: 'report',
      reason: 'too big',
      actionCard: {
        title: 'open doc',
        estimated_minutes: 1,
        difficulty: 'very_low',
        steps: ['open'],
      },
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
    })
    await saveDailyReview({
      mood: 'tired',
      pressure: 'work',
      win: 'opened doc',
      tomorrow: 'write title',
      summary: 'keep it small',
      source: 'local',
      createdAt: now,
      updatedAt: now,
    })

    const summary = await getProfileSummary()

    expect(summary.totalRecords).toBe(1)
    expect(summary.topScenes[0]).toEqual({ scene: 'procrastination', count: 1 })
    expect(summary.emotionLabels).toContain('stuck')
    expect(summary.needLabels).toContain('start')
    expect(summary.recentPatterns.length).toBeGreaterThan(0)
    expect(summary.actionCompletionRate).toBe(0)
    expect(summary.reviewStreakDays).toBe(1)
    expect(summary.nextMicroAction).toContain('1 分钟')
  })

  it('uses creation plans and encouragement phrases in the profile summary', async () => {
    const now = Date.now()
    await saveCreationPlan({
      conversationId: null,
      source: 'local',
      inputSummary: 'scrolling',
      switchTarget: '回到一个小输出',
      idleDuration: '30-60 分钟',
      energyLevel: '2',
      actionCard: {
        title: '写 50 个字',
        estimated_minutes: 3,
        difficulty: 'low',
        steps: ['打开备忘录', '写 50 个字'],
      },
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
    })
    await saveEncouragementPhrase({
      conversationId: null,
      source: 'local',
      phrase: '慢一点也算前进',
      inputSummary: 'self doubt',
      style: 'gentle',
      createdAt: now + 1,
      updatedAt: now + 1,
    })

    const summary = await getProfileSummary()

    expect(summary.recentPatterns).toContain('已经保存过切回创作计划，适合在空转时直接复用。')
    expect(summary.recentPatterns).toContain('已经积累鼓励短句库，低能量时可以先复用一句有效的话。')
    expect(summary.nextMicroAction).toContain('写 50 个字')
  })

  it('deletes an individual action task', async () => {
    const now = Date.now()
    const id = await saveActionTask({
      source: 'local',
      taskText: 'write outline',
      reason: 'too big',
      actionCard: {
        title: 'open notes',
        estimated_minutes: 1,
        difficulty: 'very_low',
        steps: ['open notes'],
      },
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
    })

    await deleteActionTask(id)

    const exported = await exportAllData()
    expect(exported.actionTasks).toEqual([])
  })

  it('clears all local structured data', async () => {
    const now = Date.now()
    await saveLocalRecord({
      scene: 'creation',
      input: 'make something',
      result: {
        reply_text: 'write one line',
        emotion_labels: ['tired'],
        need_labels: ['agency'],
        risk_level: 0,
        action_card: null,
        relationship_scripts: null,
        quick_replies: [],
      },
      createdAt: now,
    })
    await saveConversationTurn(
      { scene: 'creation', title: 'creation', createdAt: now, updatedAt: now },
      [{ role: 'user', content: 'make something', riskLevel: 0, createdAt: now }],
    )
    await saveActionTask({
      source: 'local',
      taskText: 'make something',
      reason: 'creation',
      actionCard: { title: 'write one line', estimated_minutes: 1, difficulty: 'low', steps: ['write'] },
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
    })
    await saveDailyReview({
      mood: 'ok',
      pressure: 'work',
      win: 'one line',
      tomorrow: 'one more line',
      summary: 'small is enough',
      source: 'local',
      createdAt: now,
      updatedAt: now,
    })
    await saveCreationPlan({
      conversationId: null,
      source: 'local',
      inputSummary: 'scrolling',
      switchTarget: '回到一个小输出',
      idleDuration: '10-30 分钟',
      energyLevel: '2',
      actionCard: { title: 'write one line', estimated_minutes: 1, difficulty: 'low', steps: ['write'] },
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
    })
    await saveEncouragementPhrase({
      conversationId: null,
      source: 'local',
      phrase: 'slow is still forward',
      inputSummary: 'self doubt',
      style: 'gentle',
      createdAt: now,
      updatedAt: now,
    })

    await clearAllLocalData()
    const exported = await exportAllData()

    expect(exported.records).toEqual([])
    expect(exported.conversations).toEqual([])
    expect(exported.messages).toEqual([])
    expect(exported.actionTasks).toEqual([])
    expect(exported.dailyReviews).toEqual([])
    expect(exported.creationPlans).toEqual([])
    expect(exported.encouragementPhrases).toEqual([])
    expect(exported.riskEvents).toEqual([])
  })

  it('imports exported local data by replacing structured tables', async () => {
    const now = Date.now()
    await saveLocalRecord({
      scene: 'creation',
      input: 'old local record',
      result: {
        reply_text: 'old',
        emotion_labels: ['old'],
        need_labels: ['old'],
        risk_level: 0,
        action_card: null,
        relationship_scripts: null,
        quick_replies: [],
      },
      createdAt: now,
    })

    const result = await importAllData({
      exportedAt: new Date(now).toISOString(),
      records: [
        {
          id: 10,
          scene: 'relationship',
          input: 'imported record',
          result: {
            reply_text: 'imported reply',
            emotion_labels: ['uncertain'],
            need_labels: ['boundary'],
            risk_level: 0,
            action_card: null,
            relationship_scripts: null,
            quick_replies: [],
          },
          createdAt: now + 1,
        },
      ],
      conversations: [{ id: 20, scene: 'relationship', title: 'imported conversation', createdAt: now, updatedAt: now }],
      messages: [{ id: 30, conversationId: 20, role: 'user', content: 'hello', riskLevel: 0, createdAt: now }],
      actionTasks: [],
      dailyReviews: [],
      creationPlans: [
        {
          id: 50,
          conversationId: 20,
          source: 'local',
          inputSummary: 'imported creation plan',
          switchTarget: '回到一个小输出',
          idleDuration: '少于 10 分钟',
          energyLevel: '4',
          actionCard: { title: 'write one line', estimated_minutes: 1, difficulty: 'low', steps: ['write'] },
          status: 'proposed',
          createdAt: now + 3,
          updatedAt: now + 3,
        },
      ],
      encouragementPhrases: [
        {
          id: 60,
          conversationId: 20,
          source: 'local',
          phrase: 'imported phrase',
          inputSummary: 'imported encouragement',
          style: 'gentle',
          createdAt: now + 4,
          updatedAt: now + 4,
        },
      ],
      relationshipDrafts: [],
      riskEvents: [{ id: 40, scene: 'procrastination', riskLevel: 3, createdAt: now + 2 }],
    })

    expect(result).toMatchObject({ records: 1, conversations: 1, messages: 1, creationPlans: 1, encouragementPhrases: 1, riskEvents: 1 })
    const exported = await exportAllData()
    expect(exported.records).toHaveLength(1)
    expect(exported.records[0]).toMatchObject({ id: 10, scene: 'relationship', input: 'imported record' })
    expect(exported.conversations[0]).toMatchObject({ id: 20, title: 'imported conversation' })
    expect(exported.messages[0]).toMatchObject({ conversationId: 20, content: 'hello' })
    expect(exported.creationPlans[0]).toMatchObject({ id: 50, inputSummary: 'imported creation plan' })
    expect(exported.encouragementPhrases[0]).toMatchObject({ id: 60, phrase: 'imported phrase' })
    expect(exported.riskEvents[0]).toMatchObject({ id: 40, scene: 'procrastination', riskLevel: 3 })
  })
})
