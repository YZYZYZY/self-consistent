import { LocalNotifications } from '@capacitor/local-notifications'
import { Network } from '@capacitor/network'
import { Preferences } from '@capacitor/preferences'
import { Capacitor } from '@capacitor/core'
import type { AppTab, CoachScene, ReminderKind } from '../types'

const reminderConfig: Record<ReminderKind, { id: number; title: string; body: string }> = {
  daily_review: {
    id: 2130,
    title: '微行动教练',
    body: '今天要不要用 1 分钟整理一下自己的状态？',
  },
  start_action: {
    id: 930,
    title: '微行动教练',
    body: '现在只做一个 2 分钟动作，不求完整。',
  },
  encouragement: {
    id: 1500,
    title: '微行动教练',
    body: '如果今天有点难，先写下一句中性事实。',
  },
  relationship_cooldown: {
    id: 2030,
    title: '微行动教练',
    body: '先冷却一下，再回来看事实、猜测、情绪和边界。',
  },
}

const reminderRoutes: Record<ReminderKind, { tab: AppTab; scene: CoachScene }> = {
  daily_review: { tab: 'review', scene: 'daily_review' },
  start_action: { tab: 'chat', scene: 'procrastination' },
  encouragement: { tab: 'chat', scene: 'encouragement' },
  relationship_cooldown: { tab: 'chat', scene: 'relationship' },
}

function reminderKindFromId(id: number) {
  return (Object.entries(reminderConfig).find(([, config]) => config.id === id)?.[0] ?? null) as ReminderKind | null
}

export async function savePreference(key: string, value: string) {
  await Preferences.set({ key, value })
}

export async function readPreference(key: string) {
  return (await Preferences.get({ key })).value
}

export async function getNetworkStatus() {
  return Network.getStatus()
}

export function getRuntimeSurface() {
  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform()
    return platform === 'android' ? 'Android App 壳' : `${platform} App 壳`
  }
  return 'Web / PWA'
}

async function ensureNotificationPermission() {
  const permission = await LocalNotifications.requestPermissions()
  if (permission.display === 'denied') {
    throw new Error('通知权限未开启，无法设置本地提醒。')
  }
}

export async function scheduleReminder(kind: ReminderKind, reminderTime: string) {
  const [hour = '21', minute = '30'] = reminderTime.split(':')
  const config = reminderConfig[kind]
  await ensureNotificationPermission()
  await LocalNotifications.cancel({ notifications: [{ id: config.id }] })
  return LocalNotifications.schedule({
    notifications: [
      {
        id: config.id,
        title: config.title,
        body: config.body,
        extra: { kind },
        schedule: {
          on: { hour: Number(hour), minute: Number(minute) },
          repeats: true,
          allowWhileIdle: true,
        },
      },
    ],
  })
}

export async function cancelReminder(kind: ReminderKind) {
  const config = reminderConfig[kind]
  return LocalNotifications.cancel({ notifications: [{ id: config.id }] })
}

export async function scheduleReviewReminder(reminderTime = '21:30') {
  return scheduleReminder('daily_review', reminderTime)
}

export async function startNotificationRouting(
  onRoute: (target: { tab: AppTab; scene: CoachScene; kind: ReminderKind }) => void,
) {
  const handle = await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    const kind = (event.notification.extra?.kind as ReminderKind | undefined) ?? reminderKindFromId(event.notification.id)
    if (!kind) return
    const route = reminderRoutes[kind]
    onRoute({ ...route, kind })
  })
  return () => handle.remove()
}
