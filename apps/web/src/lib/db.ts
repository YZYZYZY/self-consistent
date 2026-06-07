import Dexie, { type Table } from 'dexie'
import type {
  ActionTask,
  Conversation,
  CreationPlan,
  DailyReview,
  EncouragementPhrase,
  LocalRecord,
  Message,
  ProfileSummary,
  RelationshipDraft,
  RiskEvent,
} from '../types'

class CoachDatabase extends Dexie {
  records!: Table<LocalRecord, number>
  conversations!: Table<Conversation, number>
  messages!: Table<Message, number>
  actionTasks!: Table<ActionTask, number>
  dailyReviews!: Table<DailyReview, number>
  creationPlans!: Table<CreationPlan, number>
  encouragementPhrases!: Table<EncouragementPhrase, number>
  relationshipDrafts!: Table<RelationshipDraft, number>
  riskEvents!: Table<RiskEvent, number>

  constructor() {
    super('microActionCoach')
    this.version(1).stores({
      records: '++id, scene, createdAt',
    })
    this.version(2).stores({
      records: '++id, scene, createdAt',
      conversations: '++id, scene, createdAt, updatedAt',
      messages: '++id, conversationId, role, riskLevel, createdAt',
      actionTasks: '++id, status, createdAt, updatedAt',
      dailyReviews: '++id, createdAt, updatedAt',
    })
    this.version(3).stores({
      records: '++id, scene, createdAt',
      conversations: '++id, scene, createdAt, updatedAt',
      messages: '++id, conversationId, role, riskLevel, createdAt',
      actionTasks: '++id, status, createdAt, updatedAt',
      dailyReviews: '++id, createdAt, updatedAt',
      relationshipDrafts: '++id, conversationId, selectedVersion, createdAt, updatedAt',
    })
    this.version(4).stores({
      records: '++id, scene, createdAt',
      conversations: '++id, scene, createdAt, updatedAt',
      messages: '++id, conversationId, role, riskLevel, createdAt',
      actionTasks: '++id, status, createdAt, updatedAt',
      dailyReviews: '++id, createdAt, updatedAt',
      relationshipDrafts: '++id, conversationId, selectedVersion, createdAt, updatedAt',
      riskEvents: '++id, scene, riskLevel, createdAt',
    })
    this.version(5).stores({
      records: '++id, scene, createdAt',
      conversations: '++id, scene, createdAt, updatedAt',
      messages: '++id, conversationId, role, riskLevel, createdAt',
      actionTasks: '++id, status, createdAt, updatedAt',
      dailyReviews: '++id, createdAt, updatedAt',
      creationPlans: '++id, conversationId, status, createdAt, updatedAt',
      relationshipDrafts: '++id, conversationId, selectedVersion, createdAt, updatedAt',
      riskEvents: '++id, scene, riskLevel, createdAt',
    })
    this.version(6).stores({
      records: '++id, scene, createdAt',
      conversations: '++id, scene, createdAt, updatedAt',
      messages: '++id, conversationId, role, riskLevel, createdAt',
      actionTasks: '++id, status, createdAt, updatedAt',
      dailyReviews: '++id, createdAt, updatedAt',
      creationPlans: '++id, conversationId, status, createdAt, updatedAt',
      encouragementPhrases: '++id, conversationId, style, createdAt, updatedAt',
      relationshipDrafts: '++id, conversationId, selectedVersion, createdAt, updatedAt',
      riskEvents: '++id, scene, riskLevel, createdAt',
    })
  }
}

export const db = new CoachDatabase()

export async function saveLocalRecord(record: Omit<LocalRecord, 'id'>) {
  return db.records.add(record)
}

export async function listRecentRecords(limit = 20) {
  return db.records.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function deleteLocalRecord(id: number) {
  return db.records.delete(id)
}

export async function saveRiskEvent(event: Omit<RiskEvent, 'id'>) {
  return db.riskEvents.add(event)
}

export async function listRecentRiskEvents(limit = 10) {
  return db.riskEvents.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function deleteRiskEvent(id: number) {
  return db.riskEvents.delete(id)
}

export async function saveConversationTurn(
  conversation: Omit<Conversation, 'id'>,
  messages: Array<Omit<Message, 'id' | 'conversationId'>>,
) {
  return db.transaction('rw', db.conversations, db.messages, async () => {
    const conversationId = await db.conversations.add(conversation)
    await db.messages.bulkAdd(messages.map((message) => ({ ...message, conversationId })))
    return conversationId
  })
}

export async function appendConversationTurn(
  conversationId: number,
  messages: Array<Omit<Message, 'id' | 'conversationId'>>,
) {
  return db.transaction('rw', db.conversations, db.messages, async () => {
    const now = Date.now()
    await db.conversations.update(conversationId, { updatedAt: now })
    await db.messages.bulkAdd(messages.map((message) => ({ ...message, conversationId })))
    return conversationId
  })
}

export async function listRecentConversations(limit = 20) {
  return db.conversations.orderBy('updatedAt').reverse().limit(limit).toArray()
}

export async function listMessagesForConversation(conversationId: number) {
  return db.messages.where('conversationId').equals(conversationId).sortBy('createdAt')
}

export async function listMessagesForConversations(conversationIds: number[]) {
  if (!conversationIds.length) return []
  return db.messages.where('conversationId').anyOf(conversationIds).sortBy('createdAt')
}

export async function deleteConversation(conversationId: number) {
  return db.transaction('rw', db.conversations, db.messages, async () => {
    await db.messages.where('conversationId').equals(conversationId).delete()
    await db.conversations.delete(conversationId)
  })
}

export async function saveActionTask(task: Omit<ActionTask, 'id'>) {
  return db.actionTasks.add(task)
}

export async function updateActionTask(id: number, changes: Partial<ActionTask>) {
  return db.actionTasks.update(id, { ...changes, updatedAt: Date.now() })
}

export async function listRecentActionTasks(limit = 5) {
  return db.actionTasks.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function deleteActionTask(id: number) {
  return db.actionTasks.delete(id)
}

export async function saveDailyReview(review: Omit<DailyReview, 'id'>) {
  return db.dailyReviews.add(review)
}

export async function updateDailyReview(id: number, changes: Partial<DailyReview>) {
  return db.dailyReviews.update(id, { ...changes, updatedAt: Date.now() })
}

export async function listDailyReviews(limit = 20) {
  return db.dailyReviews.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function deleteDailyReview(id: number) {
  return db.dailyReviews.delete(id)
}

export async function saveCreationPlan(plan: Omit<CreationPlan, 'id'>) {
  return db.creationPlans.add(plan)
}

export async function updateCreationPlan(id: number, changes: Partial<CreationPlan>) {
  return db.creationPlans.update(id, { ...changes, updatedAt: Date.now() })
}

export async function listCreationPlans(limit = 10) {
  return db.creationPlans.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function deleteCreationPlan(id: number) {
  return db.creationPlans.delete(id)
}

export async function saveEncouragementPhrase(phrase: Omit<EncouragementPhrase, 'id'>) {
  return db.encouragementPhrases.add(phrase)
}

export async function listEncouragementPhrases(limit = 10) {
  return db.encouragementPhrases.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function deleteEncouragementPhrase(id: number) {
  return db.encouragementPhrases.delete(id)
}

export async function saveRelationshipDraft(draft: Omit<RelationshipDraft, 'id'>) {
  return db.relationshipDrafts.add(draft)
}

export async function listRelationshipDrafts(limit = 10) {
  return db.relationshipDrafts.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function deleteRelationshipDraft(id: number) {
  return db.relationshipDrafts.delete(id)
}

export async function getTodayReview() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const reviews = await db.dailyReviews
    .where('createdAt')
    .aboveOrEqual(start.getTime())
    .reverse()
    .limit(1)
    .toArray()
  return reviews[0] ?? null
}

export async function exportAllData() {
  const [records, conversations, messages, actionTasks, dailyReviews, creationPlans, encouragementPhrases, relationshipDrafts, riskEvents] = await Promise.all([
    db.records.toArray(),
    db.conversations.toArray(),
    db.messages.toArray(),
    db.actionTasks.toArray(),
    db.dailyReviews.toArray(),
    db.creationPlans.toArray(),
    db.encouragementPhrases.toArray(),
    db.relationshipDrafts.toArray(),
    db.riskEvents.toArray(),
  ])
  return {
    exportedAt: new Date().toISOString(),
    records,
    conversations,
    messages,
    actionTasks,
    dailyReviews,
    creationPlans,
    encouragementPhrases,
    relationshipDrafts,
    riskEvents,
  }
}

export async function importAllData(data: unknown) {
  const exported = normalizeLocalDataExport(data)
  await db.transaction(
    'rw',
    [db.records, db.conversations, db.messages, db.actionTasks, db.dailyReviews, db.creationPlans, db.encouragementPhrases, db.relationshipDrafts, db.riskEvents],
    async () => {
      await Promise.all([
        db.records.clear(),
        db.conversations.clear(),
        db.messages.clear(),
        db.actionTasks.clear(),
        db.dailyReviews.clear(),
        db.creationPlans.clear(),
        db.encouragementPhrases.clear(),
        db.relationshipDrafts.clear(),
        db.riskEvents.clear(),
      ])
      await Promise.all([
        exported.records.length ? db.records.bulkPut(exported.records) : Promise.resolve(),
        exported.conversations.length ? db.conversations.bulkPut(exported.conversations) : Promise.resolve(),
        exported.messages.length ? db.messages.bulkPut(exported.messages) : Promise.resolve(),
        exported.actionTasks.length ? db.actionTasks.bulkPut(exported.actionTasks) : Promise.resolve(),
        exported.dailyReviews.length ? db.dailyReviews.bulkPut(exported.dailyReviews) : Promise.resolve(),
        exported.creationPlans.length ? db.creationPlans.bulkPut(exported.creationPlans) : Promise.resolve(),
        exported.encouragementPhrases.length ? db.encouragementPhrases.bulkPut(exported.encouragementPhrases) : Promise.resolve(),
        exported.relationshipDrafts.length ? db.relationshipDrafts.bulkPut(exported.relationshipDrafts) : Promise.resolve(),
        exported.riskEvents.length ? db.riskEvents.bulkPut(exported.riskEvents) : Promise.resolve(),
      ])
    },
  )
  return {
    records: exported.records.length,
    conversations: exported.conversations.length,
    messages: exported.messages.length,
    actionTasks: exported.actionTasks.length,
    dailyReviews: exported.dailyReviews.length,
    creationPlans: exported.creationPlans.length,
    encouragementPhrases: exported.encouragementPhrases.length,
    relationshipDrafts: exported.relationshipDrafts.length,
    riskEvents: exported.riskEvents.length,
  }
}

export async function clearAllLocalData() {
  await Promise.all([
    db.records.clear(),
    db.conversations.clear(),
    db.messages.clear(),
    db.actionTasks.clear(),
    db.dailyReviews.clear(),
    db.creationPlans.clear(),
    db.encouragementPhrases.clear(),
    db.relationshipDrafts.clear(),
    db.riskEvents.clear(),
  ])
}

export async function getProfileSummary(): Promise<ProfileSummary> {
  const [records, actionTasks, dailyReviews, creationPlans, encouragementPhrases] = await Promise.all([
    db.records.orderBy('createdAt').reverse().limit(80).toArray(),
    db.actionTasks.orderBy('createdAt').reverse().limit(40).toArray(),
    db.dailyReviews.orderBy('createdAt').reverse().limit(20).toArray(),
    db.creationPlans.orderBy('createdAt').reverse().limit(20).toArray(),
    db.encouragementPhrases.orderBy('createdAt').reverse().limit(20).toArray(),
  ])

  const sceneCounts = new Map<string, number>()
  const emotionCounts = new Map<string, number>()
  const needCounts = new Map<string, number>()

  for (const record of records) {
    sceneCounts.set(record.scene, (sceneCounts.get(record.scene) ?? 0) + 1)
    for (const label of record.result.emotion_labels) {
      emotionCounts.set(label, (emotionCounts.get(label) ?? 0) + 1)
    }
    for (const label of record.result.need_labels) {
      needCounts.set(label, (needCounts.get(label) ?? 0) + 1)
    }
  }

  const unfinishedActions = actionTasks.filter((task) => task.status !== 'completed').length
  const completedActions = actionTasks.filter((task) => task.status === 'completed').length
  const actionCompletionRate = actionTasks.length ? Math.round((completedActions / actionTasks.length) * 100) : null
  const reviewStreakDays = calculateReviewStreakDays(dailyReviews)
  const unfinishedCreationPlans = creationPlans.filter((plan) => plan.status !== 'completed').length
  const latestCreationPlan = creationPlans[0]
  const latestEncouragementPhrase = encouragementPhrases[0]
  const recentPatterns: string[] = []

  if (records.some((record) => record.scene === 'procrastination')) {
    recentPatterns.push('最近多次需要把任务降到更小的启动动作。')
  }
  if (unfinishedActions > completedActions && actionTasks.length > 0) {
    recentPatterns.push('行动卡的完成率偏低，下一步应继续降低难度。')
  }
  if (dailyReviews.length > 0) {
    recentPatterns.push('已经开始形成复盘记录，可以用它观察精力和压力变化。')
  }
  if (creationPlans.length > 0) {
    recentPatterns.push('已经保存过切回创作计划，适合在空转时直接复用。')
  }
  if (encouragementPhrases.length > 0) {
    recentPatterns.push('已经积累鼓励短句库，低能量时可以先复用一句有效的话。')
  }
  if (recentPatterns.length === 0) {
    recentPatterns.push('记录还不多，先积累 3 次对话或复盘再看趋势。')
  }

  const topNeed = topLabels(needCounts, 1)[0]
  const topScene = [...sceneCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return {
    generatedAt: Date.now(),
    totalRecords: records.length,
    topScenes: [...sceneCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([scene, count]) => ({ scene: scene as ProfileSummary['topScenes'][number]['scene'], count })),
    emotionLabels: topLabels(emotionCounts, 6),
    needLabels: topLabels(needCounts, 6),
    recentPatterns,
    suggestedFocus: topNeed ? `下一阶段优先照顾“${topNeed}”这个需求。` : '先保持记录，等样本多一点再生成重点建议。',
    actionCompletionRate,
    reviewStreakDays,
    nextMicroAction: buildNextMicroAction({
      actionTasksCount: actionTasks.length,
      dailyReviewsCount: dailyReviews.length,
      unfinishedActions,
      completedActions,
      topScene,
      topNeed,
      reviewStreakDays,
      creationPlansCount: creationPlans.length,
      unfinishedCreationPlans,
      latestCreationPlanTitle: latestCreationPlan?.actionCard.title,
      encouragementPhrasesCount: encouragementPhrases.length,
      latestEncouragementPhrase: latestEncouragementPhrase?.phrase,
    }),
  }
}

function normalizeLocalDataExport(data: unknown) {
  if (!data || typeof data !== 'object') {
    throw new Error('导入文件不是有效的本地数据 JSON。')
  }
  const value = data as Partial<{
    records: LocalRecord[]
    conversations: Conversation[]
    messages: Message[]
    actionTasks: ActionTask[]
    dailyReviews: DailyReview[]
    creationPlans: CreationPlan[]
    encouragementPhrases: EncouragementPhrase[]
    relationshipDrafts: RelationshipDraft[]
    riskEvents: RiskEvent[]
  }>
  return {
    records: importArray(value.records, 'records'),
    conversations: importArray(value.conversations, 'conversations'),
    messages: importArray(value.messages, 'messages'),
    actionTasks: importArray(value.actionTasks, 'actionTasks'),
    dailyReviews: importArray(value.dailyReviews, 'dailyReviews'),
    creationPlans: importArray(value.creationPlans, 'creationPlans'),
    encouragementPhrases: importArray(value.encouragementPhrases, 'encouragementPhrases'),
    relationshipDrafts: importArray(value.relationshipDrafts, 'relationshipDrafts'),
    riskEvents: importArray(value.riskEvents, 'riskEvents'),
  }
}

function importArray<T>(value: T[] | undefined, key: string): T[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Error(`导入文件的 ${key} 字段不是数组。`)
  }
  if (value.some((item) => !item || typeof item !== 'object')) {
    throw new Error(`导入文件的 ${key} 字段包含无效条目。`)
  }
  return value
}

function topLabels(counts: Map<string, number>, limit: number) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label]) => label)
}

function calculateReviewStreakDays(dailyReviews: DailyReview[]) {
  const reviewDays = new Set(dailyReviews.map((review) => toLocalDateKey(review.createdAt)))
  if (!reviewDays.size) return 0

  const sortedDays = [...reviewDays].sort().reverse()
  const latestDay = sortedDays[0]
  const cursor = localDateFromKey(latestDay)
  let streak = 0

  while (reviewDays.has(toLocalDateKey(cursor.getTime()))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  return streak
}

function toLocalDateKey(timestamp: number) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localDateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function buildNextMicroAction({
  actionTasksCount,
  dailyReviewsCount,
  unfinishedActions,
  completedActions,
  topScene,
  topNeed,
  reviewStreakDays,
  creationPlansCount,
  unfinishedCreationPlans,
  latestCreationPlanTitle,
  encouragementPhrasesCount,
  latestEncouragementPhrase,
}: {
  actionTasksCount: number
  dailyReviewsCount: number
  unfinishedActions: number
  completedActions: number
  topScene?: string
  topNeed?: string
  reviewStreakDays: number
  creationPlansCount: number
  unfinishedCreationPlans: number
  latestCreationPlanTitle?: string
  encouragementPhrasesCount: number
  latestEncouragementPhrase?: string
}) {
  if (actionTasksCount === 0 && dailyReviewsCount === 0 && creationPlansCount === 0 && encouragementPhrasesCount === 0) {
    return '先完成一次拖延急救或每日复盘，给画像一个真实样本。'
  }
  if (unfinishedCreationPlans > 0 && latestCreationPlanTitle) {
    return `先捡起最近的切回计划：“${latestCreationPlanTitle}”，只做第一步。`
  }
  if (actionTasksCount > 0 && unfinishedActions > completedActions) {
    return '下一张行动卡只保留 1 个步骤，目标控制在 1 分钟内。'
  }
  if (encouragementPhrasesCount > 0 && latestEncouragementPhrase) {
    return `低能量时先复用这句：“${latestEncouragementPhrase.slice(0, 36)}”。`
  }
  if (topScene === 'procrastination') {
    return '把最常卡住的任务写成“只打开/只命名/只写一行”。'
  }
  if (dailyReviewsCount === 0 || reviewStreakDays === 0) {
    return '今晚做一次 3 句复盘：情绪、一个完成、明天一步。'
  }
  if (topNeed) {
    return `下一次求助时先说明你最需要“${topNeed}”，再让教练给 3 分钟行动。`
  }
  return '继续保持微行动节奏：每天只选一个最小下一步。'
}
