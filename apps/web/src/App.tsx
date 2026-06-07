import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Bell,
  ChevronRight,
  HeartHandshake,
  Home,
  MessageCircle,
  NotebookPen,
  Phone,
  RefreshCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import { motion } from 'framer-motion'
import {
  getApiBaseUrl,
  getHealth,
  getReadiness,
  getModelProviders,
  getModelRuntimeConfig,
  getPromptConfigs,
  getServerProfileSummary,
  getServerRecordCursorPage,
  getServerRecordStats,
  exportServerBackup,
  exportServerRecords,
  requestCoachTurn,
  restoreServerBackup,
  runServerMaintenance,
  deleteServerRecord,
  deleteServerRecords,
  setApiBaseUrlOverride,
  getDiagnostics,
  updateModelRuntimeConfig,
  updatePromptConfig,
} from './lib/api'
import {
  appendConversationTurn,
  clearAllLocalData,
  deleteActionTask,
  deleteCreationPlan,
  deleteConversation,
  deleteDailyReview,
  deleteEncouragementPhrase,
  deleteLocalRecord,
  deleteRelationshipDraft,
  deleteRiskEvent,
  getTodayReview,
  exportAllData,
  getProfileSummary,
  importAllData,
  listCreationPlans,
  listDailyReviews,
  listEncouragementPhrases,
  listMessagesForConversation,
  listMessagesForConversations,
  listRecentConversations,
  listRecentActionTasks,
  listRecentRecords,
  listRecentRiskEvents,
  listRelationshipDrafts,
  saveActionTask,
  saveConversationTurn,
  saveCreationPlan,
  saveDailyReview,
  saveEncouragementPhrase,
  saveLocalRecord,
  saveRelationshipDraft,
  saveRiskEvent,
  updateActionTask,
  updateCreationPlan,
  updateDailyReview,
} from './lib/db'
import {
  cancelReminder,
  getRuntimeSurface,
  getNetworkStatus,
  readPreference,
  savePreference,
  scheduleReminder,
  scheduleReviewReminder,
  startNotificationRouting,
} from './lib/mobile'
import { detectRiskLevel, redactText, safetyCoachResult } from './lib/safety'
import { useAppStore } from './store/appStore'
import type {
  ActionCard,
  ActionTask,
  AppTab,
  AppTheme,
  CoachResult,
  CoachScene,
  Conversation,
  CreationPlan,
  DailyReview,
  EncouragementPhrase,
  EncouragementStyle,
  FontDensity,
  LocalRecord,
  MainChallenge,
  Message,
  RelationshipDraft,
  RelationshipScripts,
  RiskEvent,
} from './types'

type PwaUpdateHandler = (reloadPage?: boolean) => Promise<void>

const healthQueryOptions = {
  staleTime: 30_000,
  refetchInterval: 60_000,
  refetchOnWindowFocus: true,
}

const networkQueryOptions = {
  staleTime: 5_000,
  refetchInterval: 15_000,
  refetchOnWindowFocus: true,
}

const providerQueryOptions = {
  staleTime: 120_000,
  refetchOnWindowFocus: false,
}

const serverDataQueryOptions = {
  staleTime: 20_000,
  refetchOnWindowFocus: false,
}

const sceneCards: Array<{
  id: CoachScene
  title: string
  description: string
  icon: LucideIcon
  enabled: boolean
  targetTab: AppTab
}> = [
  {
    id: 'procrastination',
    title: '我又拖延了',
    description: '把卡住的任务降到 3 分钟内可以开始。',
    icon: Activity,
    enabled: true,
    targetTab: 'chat',
  },
  {
    id: 'daily_review',
    title: '今天复盘一下',
    description: '用 1 分钟整理今天的状态和明天的一小步。',
    icon: NotebookPen,
    enabled: true,
    targetTab: 'review',
  },
  {
    id: 'encouragement',
    title: '我需要一点勇气',
    description: '把自我否定翻译成担心和证据。',
    icon: Sparkles,
    enabled: true,
    targetTab: 'chat',
  },
  {
    id: 'creation',
    title: '我不想刷手机了',
    description: '从被动消费切到一个小创造动作。',
    icon: RefreshCcw,
    enabled: true,
    targetTab: 'chat',
  },
  {
    id: 'relationship',
    title: '帮我分析一段关系',
    description: '分清事实、猜测、情绪、需求和沟通脚本。',
    icon: HeartHandshake,
    enabled: true,
    targetTab: 'chat',
  },
]

const sceneStyles: Record<
  CoachScene,
  { tile: string; icon: string; badge: string; glow: string; label: string }
> = {
  procrastination: {
    tile: 'from-amber-50 via-white to-orange-50 hover:border-amber-200',
    icon: 'from-amber-100 to-orange-200 text-amber-800',
    badge: 'bg-amber-100 text-amber-800',
    glow: 'bg-amber-300/25',
    label: '3 分钟启动',
  },
  daily_review: {
    tile: 'from-teal-50 via-white to-cyan-50 hover:border-teal-200',
    icon: 'from-teal-100 to-cyan-200 text-teal-800',
    badge: 'bg-teal-100 text-teal-800',
    glow: 'bg-teal-300/25',
    label: '今日收束',
  },
  encouragement: {
    tile: 'from-rose-50 via-white to-amber-50 hover:border-rose-200',
    icon: 'from-rose-100 to-amber-200 text-rose-800',
    badge: 'bg-rose-100 text-rose-800',
    glow: 'bg-rose-300/20',
    label: '轻一点',
  },
  creation: {
    tile: 'from-indigo-50 via-white to-sky-50 hover:border-indigo-200',
    icon: 'from-indigo-100 to-sky-200 text-indigo-800',
    badge: 'bg-indigo-100 text-indigo-800',
    glow: 'bg-indigo-300/20',
    label: '从刷到做',
  },
  relationship: {
    tile: 'from-emerald-50 via-white to-lime-50 hover:border-emerald-200',
    icon: 'from-emerald-100 to-lime-200 text-emerald-800',
    badge: 'bg-emerald-100 text-emerald-800',
    glow: 'bg-emerald-300/20',
    label: '分清事实',
  },
}

const procrastinationReasons = ['太大了', '怕做不好', '没能量', '不知道从哪开始', '不想面对']
const procrastinationStepLabels = [
  { id: 'task', label: '说任务' },
  { id: 'reason', label: '选原因' },
  { id: 'action', label: '做行动' },
] as const

const tabItems: Array<{ id: AppTab; title: string; icon: LucideIcon }> = [
  { id: 'home', title: '首页', icon: Home },
  { id: 'chat', title: '对话', icon: MessageCircle },
  { id: 'review', title: '复盘', icon: NotebookPen },
  { id: 'mine', title: '我的', icon: UserRound },
]

const quickStartSteps = [
  { index: '01', title: '看见卡住点', body: '只写当前任务，不评价自己。' },
  { index: '02', title: '降到可开始', body: 'AI 或本地兜底给出 1-3 分钟动作。' },
  { index: '03', title: '记录真实结果', body: '完成、没做、换简单版都算有效反馈。' },
]

function shouldShowBrandSplash() {
  try {
    return window.sessionStorage.getItem('brandSplashSeen') !== 'true'
  } catch {
    return true
  }
}

function rememberBrandSplashSeen() {
  try {
    window.sessionStorage.setItem('brandSplashSeen', 'true')
  } catch {
    // Session storage can be unavailable in restricted WebViews; the splash still dismisses in memory.
  }
}

const promptLabels: Record<string, string> = {
  system: '全局系统规则',
  procrastination: '拖延急救',
  encouragement: '鼓励师',
  creation: '创造动力',
  relationship: '人际关系',
  daily_review: '每日复盘',
}

const coachCopy: Record<
  Exclude<CoachScene, 'daily_review' | 'procrastination'>,
  { title: string; subtitle: string; placeholder: string; localFallback: string }
> = {
  encouragement: {
    title: '鼓励师',
    subtitle: '把“我不行”拆成真实担心、中性证据和一个低风险动作。',
    placeholder: '把你现在对自己的否定或担心写下来，例如：我肯定做不好这件事。',
    localFallback: '先不急着说服自己。我们只收集一个中性事实，再做一个 2 分钟低风险动作。',
  },
  creation: {
    title: '创造动力',
    subtitle: '从刷手机和空转里切出一个很小的主动输出。',
    placeholder: '写下你刚刚在刷什么、刷了多久、现在的能量大概几分。',
    localFallback: '先不责怪自己。把手机放远一点，写下 50 个字，就算重新拿回一点主动权。',
  },
  relationship: {
    title: '人际关系分析',
    subtitle: '分清事实、猜测、情绪和需求，生成温和/直接/边界三版表达。',
    placeholder: '描述发生了什么。尽量不要写真名、手机号、邮箱或其他可识别信息。',
    localFallback: '先把事实和猜测分开。仅凭当前信息，我们还不能确定对方动机。',
  },
}

const mainChallengeOptions: Array<{ value: MainChallenge; label: string; description: string }> = [
  { value: 'procrastination', label: '拖延启动', description: '把卡住的任务变成 3 分钟以内的一步。' },
  { value: 'self_doubt', label: '自我怀疑', description: '把否定自己的念头翻译成证据和需要。' },
  { value: 'doomscrolling', label: '刷手机停不下', description: '从被动消耗切回一点主动输出。' },
  { value: 'relationship', label: '关系消耗', description: '分清事实、猜测、情绪、需要和边界。' },
  { value: 'emotion', label: '情绪过载', description: '先安顿状态，再决定一小步。' },
  { value: 'unsure', label: '我还不确定', description: '先用复盘和最近记录慢慢观察。' },
]

const encouragementStyleOptions: Array<{ value: EncouragementStyle; label: string; description: string }> = [
  { value: 'rational', label: '理性拆解', description: '偏证据、步骤和下一步。' },
  { value: 'gentle', label: '温和陪伴', description: '先接住感受，再轻轻启动。' },
  { value: 'direct', label: '直接清爽', description: '少铺垫，快一点给行动。' },
  { value: 'light', label: '轻松一点', description: '语气更松，降低压力感。' },
]

const appThemeOptions: Array<{ value: AppTheme; label: string; description: string }> = [
  { value: 'warm', label: '暖沙', description: '默认暖色，适合日常陪伴感。' },
  { value: 'calm', label: '静蓝', description: '降低视觉刺激，适合晚上复盘。' },
  { value: 'focus', label: '专注', description: '对比更清晰，适合快速行动。' },
]

const fontDensityOptions: Array<{ value: FontDensity; label: string; description: string }> = [
  { value: 'comfortable', label: '舒适', description: '默认间距和字号。' },
  { value: 'compact', label: '紧凑', description: '一屏显示更多内容。' },
  { value: 'large', label: '大字', description: '字号更大，触控更从容。' },
]

const scenePlaybooks: Record<Exclude<CoachScene, 'daily_review' | 'procrastination'>, { label: string; options: string[]; privacyTip?: string }> = {
  encouragement: {
    label: '先选一个现在最贴近的担心',
    options: ['我怕做不好', '我觉得自己太慢', '我担心别人评价', '我需要一个很小的开始'],
  },
  creation: {
    label: '先选一个切换目标',
    options: ['离开手机 2 分钟', '写 50 个字', '整理一个素材', '发出一个草稿'],
  },
  relationship: {
    label: '先选分析重点',
    options: ['分清事实和猜测', '整理我的感受', '准备一句边界表达', '判断要不要继续沟通'],
    privacyTip: '关系场景请尽量使用“对方/同事/朋友”等称呼，不输入真实姓名、手机号、邮箱或地址。',
  },
}

function isMainChallenge(value: string | null): value is MainChallenge {
  return mainChallengeOptions.some((option) => option.value === value)
}

function isEncouragementStyle(value: string | null): value is EncouragementStyle {
  return encouragementStyleOptions.some((option) => option.value === value)
}

function isAppTheme(value: string | null): value is AppTheme {
  return appThemeOptions.some((option) => option.value === value)
}

function isFontDensity(value: string | null): value is FontDensity {
  return fontDensityOptions.some((option) => option.value === value)
}

export default function App() {
  const tab = useAppStore((state) => state.tab)
  const appTheme = useAppStore((state) => state.appTheme)
  const fontDensity = useAppStore((state) => state.fontDensity)
  const setTab = useAppStore((state) => state.setTab)
  const setScene = useAppStore((state) => state.setScene)
  const onboardingComplete = useAppStore((state) => state.onboardingComplete)
  const setOnboardingComplete = useAppStore((state) => state.setOnboardingComplete)
  const setHistoryEnabled = useAppStore((state) => state.setHistoryEnabled)
  const setServerRecordEnabled = useAppStore((state) => state.setServerRecordEnabled)
  const setProfileEnabled = useAppStore((state) => state.setProfileEnabled)
  const setMainChallenge = useAppStore((state) => state.setMainChallenge)
  const setEncouragementStyle = useAppStore((state) => state.setEncouragementStyle)
  const setAppTheme = useAppStore((state) => state.setAppTheme)
  const setFontDensity = useAppStore((state) => state.setFontDensity)
  const setReminderEnabled = useAppStore((state) => state.setReminderEnabled)
  const setReminderTime = useAppStore((state) => state.setReminderTime)
  const setApiBaseUrl = useAppStore((state) => state.setApiBaseUrl)
  const [safetyOpen, setSafetyOpen] = useState(false)
  const [pwaUpdate, setPwaUpdate] = useState<PwaUpdateHandler | null>(null)
  const [pwaOfflineReady, setPwaOfflineReady] = useState(false)
  const [brandSplashVisible, setBrandSplashVisible] = useState(shouldShowBrandSplash)

  useEffect(() => {
    async function hydratePreferences() {
      const [
        onboarding,
        history,
        serverRecord,
        profileEnabled,
        mainChallenge,
        encouragementStyle,
        appTheme,
        fontDensity,
        reminderEnabled,
        reminderTime,
        apiBaseUrl,
      ] = await Promise.all([
        readPreference('onboardingComplete'),
        readPreference('historyEnabled'),
        readPreference('serverRecordEnabled'),
        readPreference('profileEnabled'),
        readPreference('mainChallenge'),
        readPreference('encouragementStyle'),
        readPreference('appTheme'),
        readPreference('fontDensity'),
        readPreference('reminderEnabled'),
        readPreference('reminderTime'),
        getApiBaseUrl(),
      ])
      const hasCompletedOnboarding = onboarding === 'true'
      const shouldScheduleReminder = reminderEnabled !== 'false'
      const hydratedReminderTime = reminderTime ?? '21:30'
      setOnboardingComplete(hasCompletedOnboarding)
      setHistoryEnabled(history !== 'false')
      setServerRecordEnabled(serverRecord !== 'false')
      setProfileEnabled(profileEnabled !== 'false')
      setMainChallenge(isMainChallenge(mainChallenge) ? mainChallenge : 'procrastination')
      setEncouragementStyle(isEncouragementStyle(encouragementStyle) ? encouragementStyle : 'rational')
      setAppTheme(isAppTheme(appTheme) ? appTheme : 'warm')
      setFontDensity(isFontDensity(fontDensity) ? fontDensity : 'comfortable')
      setReminderEnabled(shouldScheduleReminder)
      setReminderTime(hydratedReminderTime)
      setApiBaseUrl(apiBaseUrl)
      if (hasCompletedOnboarding && shouldScheduleReminder) {
        await scheduleReviewReminder(hydratedReminderTime).catch(() => undefined)
      }
    }
    hydratePreferences()
  }, [
    setApiBaseUrl,
    setAppTheme,
    setEncouragementStyle,
    setFontDensity,
    setHistoryEnabled,
    setMainChallenge,
    setOnboardingComplete,
    setProfileEnabled,
    setReminderEnabled,
    setReminderTime,
    setServerRecordEnabled,
  ])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    startNotificationRouting(({ tab, scene }) => {
      setScene(scene)
      setTab(tab)
    }).then((removeListener) => {
      cleanup = removeListener
    })
    return () => cleanup?.()
  }, [setScene, setTab])

  useEffect(() => {
    function handleUpdate(event: Event) {
      const updateHandler = (event as CustomEvent<PwaUpdateHandler>).detail
      if (updateHandler) {
        setPwaUpdate(() => updateHandler)
      }
    }
    function handleOfflineReady() {
      setPwaOfflineReady(true)
    }
    window.addEventListener('micro-action-coach:pwa-update', handleUpdate)
    window.addEventListener('micro-action-coach:pwa-offline-ready', handleOfflineReady)
    return () => {
      window.removeEventListener('micro-action-coach:pwa-update', handleUpdate)
      window.removeEventListener('micro-action-coach:pwa-offline-ready', handleOfflineReady)
    }
  }, [])

  useEffect(() => {
    if (!brandSplashVisible) return undefined
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timeout = window.setTimeout(() => {
      rememberBrandSplashSeen()
      setBrandSplashVisible(false)
    }, prefersReducedMotion ? 80 : 1400)
    return () => window.clearTimeout(timeout)
  }, [brandSplashVisible])

  function dismissBrandSplash() {
    rememberBrandSplashSeen()
    setBrandSplashVisible(false)
  }

  return (
    <main className={`app-shell theme-${appTheme} density-${fontDensity} isolate mx-auto flex min-h-screen max-w-5xl flex-col overflow-hidden text-slate-900 sm:my-4 sm:min-h-[calc(100vh-2rem)] sm:rounded-[2rem] sm:ring-1 sm:ring-white/70`}>
      {brandSplashVisible ? <BrandSplash onDismiss={dismissBrandSplash} /> : null}
      <AppHeader onOpenSafety={() => setSafetyOpen(true)} />
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="content-fade flex-1 px-4 pb-24 sm:px-8"
      >
        {tab === 'home' ? <HomeScreen onOpenSafety={() => setSafetyOpen(true)} /> : null}
        {tab === 'chat' ? <ChatScreen onOpenSafety={() => setSafetyOpen(true)} /> : null}
        {tab === 'review' ? <ReviewScreen onOpenSafety={() => setSafetyOpen(true)} /> : null}
        {tab === 'mine' ? <MineScreen onOpenSafety={() => setSafetyOpen(true)} /> : null}
      </motion.div>
      <BottomTabs active={tab} onChange={setTab} />
      {!onboardingComplete ? (
        <Onboarding
          onComplete={async (preferences) => {
            setOnboardingComplete(true)
            setMainChallenge(preferences.mainChallenge)
            setEncouragementStyle(preferences.encouragementStyle)
            setReminderEnabled(preferences.reminderEnabled)
            setReminderTime(preferences.reminderTime)
            await Promise.all([
              savePreference('onboardingComplete', 'true'),
              savePreference('serverRecordEnabled', 'true'),
              savePreference('profileEnabled', 'true'),
              savePreference('mainChallenge', preferences.mainChallenge),
              savePreference('encouragementStyle', preferences.encouragementStyle),
              savePreference('reminderEnabled', String(preferences.reminderEnabled)),
              savePreference('reminderTime', preferences.reminderTime),
            ])
            if (preferences.reminderEnabled) {
              await scheduleReviewReminder(preferences.reminderTime).catch(() => undefined)
            }
            setScene('procrastination')
          }}
        />
      ) : null}
      {safetyOpen ? <SafetySheet onClose={() => setSafetyOpen(false)} /> : null}
      {pwaUpdate || pwaOfflineReady ? (
        <PwaUpdateToast
          hasUpdate={Boolean(pwaUpdate)}
          offlineReady={pwaOfflineReady}
          onUpdate={() => pwaUpdate?.(true)}
          onClose={() => {
            setPwaUpdate(null)
            setPwaOfflineReady(false)
          }}
        />
      ) : null}
    </main>
  )
}

function BrandSplash({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="brand-splash fixed inset-0 z-50 flex items-center justify-center bg-[#f7f5ef] p-6">
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.32, ease: 'easeOut' }}
        className="brand-splash-card relative w-full max-w-md overflow-hidden rounded-[2.2rem] border border-white/80 bg-white/72 p-6 text-center shadow-[0_28px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl"
      >
        <div className="absolute -right-12 -top-16 h-36 w-36 rounded-full bg-amber-300/25 blur-2xl" />
        <div className="absolute -bottom-14 left-6 h-32 w-32 rounded-full bg-teal-300/20 blur-2xl" />
        <div className="relative">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.7rem] bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/25">
            <Sparkles size={34} />
          </div>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.26em] text-amber-700">Micro Action Coach</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">微行动教练</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">先碰一下，就算开始。拖延、复盘、关系表达和低能量时刻，都先降到一个可行动的小版本。</p>
          <div className="mt-5 grid gap-2 text-left text-xs text-slate-600">
            <div className="rounded-2xl bg-white/70 p-3">默认本地记录，可随时关闭、导出或单条删除。</div>
            <div className="rounded-2xl bg-white/70 p-3">调用 AI 前先脱敏，高风险输入不发往模型。</div>
            <div className="rounded-2xl bg-white/70 p-3">PWA + Android 壳，前端可远程快速迭代。</div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="pressable tap-target mt-6 rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-slate-900/15"
          >
            直接进入
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function AppHeader({ onOpenSafety }: { onOpenSafety: () => void }) {
  const runtimeSurface = useMemo(() => getRuntimeSurface(), [])
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth, ...healthQueryOptions })
  const network = useQuery({ queryKey: ['network'], queryFn: getNetworkStatus, ...networkQueryOptions })
  const modelStatus = health.data
    ? `${health.data.model} / ${health.data.active_provider_configured ? '已配置' : '未配置'}`
    : health.isError
      ? '未连接'
      : '检测中'
  const backendStatus = health.data?.status ?? (health.isError ? '未连接' : '检测中')
  return (
    <header className="px-4 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
      <div className="app-header-card surface-card relative overflow-hidden rounded-[1.8rem] border border-white/70 bg-white/58 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:p-5">
        <div className="hero-orb absolute -right-12 -top-16 h-32 w-32 rounded-full bg-amber-300/20 blur-2xl" />
        <div className="hero-orb hero-orb-delayed absolute -bottom-16 left-1/2 h-28 w-28 rounded-full bg-teal-300/15 blur-2xl" />
        <div className="relative flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
              PWA + Capacitor
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">微行动教练</h1>
            <p className="mt-1 text-sm text-slate-500">安卓壳可用，前端远程迭代，后端统一代理模型。</p>
          </div>
          <button
            type="button"
            onClick={onOpenSafety}
            className="pressable tap-target rounded-full border border-red-100 bg-white/85 px-3 py-2 text-xs font-semibold text-red-600 shadow-sm backdrop-blur hover:bg-red-50"
          >
            安全支持
          </button>
        </div>
        <div className="relative mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
          <StatusPill text={runtimeSurface} tone="neutral" />
          <StatusPill icon={Wifi} text={network.data?.connected === false ? '离线' : '在线'} tone={network.data?.connected === false ? 'warn' : 'ok'} />
          <StatusPill text={`后端：${backendStatus}`} tone={health.isError ? 'warn' : health.data ? 'ok' : 'neutral'} />
          <StatusPill text={`模型：${modelStatus}`} tone={health.data?.active_provider_configured ? 'ok' : 'neutral'} />
        </div>
      </div>
    </header>
  )
}

function PwaUpdateToast({
  hasUpdate,
  offlineReady,
  onUpdate,
  onClose,
}: {
  hasUpdate: boolean
  offlineReady: boolean
  onUpdate: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-24 z-40 px-4 sm:bottom-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto flex max-w-xl items-center justify-between gap-3 rounded-[1.4rem] border border-slate-900/10 bg-slate-950/95 p-3 text-white shadow-2xl shadow-slate-900/20 backdrop-blur"
      >
        <div>
          <p className="text-sm font-bold">{hasUpdate ? '发现新版本' : '已可离线使用'}</p>
          <p className="mt-0.5 text-xs text-slate-300">
            {hasUpdate
              ? '前端已更新，点击后会刷新到最新版本；Android 壳不用重新安装。'
              : offlineReady
                ? 'PWA 资源已缓存，断网时也能打开本地功能。'
                : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {hasUpdate ? (
            <button type="button" onClick={onUpdate} className="pressable rounded-full bg-white px-3 py-2 text-xs font-bold text-slate-950">
              立即更新
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="pressable rounded-full bg-white/10 px-3 py-2 text-xs font-bold text-white">
            知道了
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function HomeScreen({ onOpenSafety }: { onOpenSafety: () => void }) {
  const setTab = useAppStore((state) => state.setTab)
  const setScene = useAppStore((state) => state.setScene)
  const recentActions = useLiveQuery(() => listRecentActionTasks(3), [], [])
  const recentRecords = useLiveQuery(() => listRecentRecords(3), [], [])
  const todayReview = useLiveQuery(() => getTodayReview(), [], null)

  return (
    <section className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="hero-card soft-panel relative overflow-hidden rounded-[2rem] bg-slate-950 p-5 text-white"
      >
        <div className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-amber-300/20 blur-2xl" />
        <div className="absolute -bottom-14 left-10 h-32 w-32 rounded-full bg-teal-300/10 blur-2xl" />
        <div className="relative">
          <p className="text-sm font-semibold text-amber-200">今天先不追求变好很多</p>
          <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="max-w-xl text-2xl font-black leading-tight tracking-tight sm:text-3xl">
              只把下一步缩小到你愿意碰一下。
            </h2>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => {
                  setScene('procrastination')
                  setTab('chat')
                }}
                className="pressable tap-target rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-black/10"
              >
                立刻救急
              </button>
              <button
                type="button"
                onClick={() => {
                  setScene('daily_review')
                  setTab('review')
                }}
                className="pressable tap-target rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/20"
              >
                去复盘
              </button>
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <MiniStat title="最近行动" value={`${recentActions?.length ?? 0} 个`} />
          <MiniStat title="今日复盘" value={todayReview ? '已完成' : '未完成'} />
          <MiniStat title="本地记录" value={`${recentRecords?.length ?? 0} 条`} />
        </div>
      </motion.div>

      <QuickStartRail />

      <DailyLoopCard
        latestAction={recentActions?.[0] ?? null}
        todayReview={todayReview ?? null}
        onStartAction={() => {
          setScene('procrastination')
          setTab('chat')
        }}
        onReview={() => {
          setScene('daily_review')
          setTab('review')
        }}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {sceneCards.map((scene, index) => {
          const Icon = scene.icon
          const style = sceneStyles[scene.id]
          return (
            <motion.button
              key={scene.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.035 }}
              type="button"
              onClick={() => {
                if (!scene.enabled) return
                setScene(scene.id)
                setTab(scene.targetTab)
              }}
              className={`pressable haptic-card group relative overflow-hidden rounded-3xl border border-white/80 bg-gradient-to-br ${style.tile} p-4 text-left shadow-[0_18px_45px_rgba(15,23,42,0.06)] backdrop-blur hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70`}
              disabled={!scene.enabled}
            >
              <div className={`absolute -right-8 -top-10 h-24 w-24 rounded-full ${style.glow} blur-2xl transition group-hover:scale-125`} />
              <div className="flex items-start gap-3">
                <div className={`relative rounded-2xl bg-gradient-to-br ${style.icon} p-3 shadow-sm transition group-hover:scale-105`}>
                  <Icon size={22} />
                </div>
                <div className="relative flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{scene.title}</h3>
                    <span className="text-xs text-slate-400 transition group-hover:translate-x-0.5">
                      {scene.enabled ? <ChevronRight size={16} /> : '即将开放'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{scene.description}</p>
                  <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${style.badge}`}>
                    {style.label}
                  </span>
                </div>
              </div>
            </motion.button>
          )
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <InfoCard
          icon={ShieldCheck}
          title="高风险输入会先本地拦截"
          body="触发安全风险时不会发往模型，也不会保存原文；应用会转向安全支持。"
          actionLabel="打开安全支持"
          onAction={onOpenSafety}
        />
        <RecentList records={recentRecords ?? []} />
      </div>
    </section>
  )
}

function DailyLoopCard({
  latestAction,
  todayReview,
  onStartAction,
  onReview,
}: {
  latestAction: ActionTask | null
  todayReview: DailyReview | null
  onStartAction: () => void
  onReview: () => void
}) {
  const actionState = getActionLoopState(latestAction)
  const hasReview = Boolean(todayReview)
  const loopReady = actionState.key === 'completed' && hasReview

  return (
    <Card className="relative overflow-hidden border-amber-100 bg-gradient-to-br from-white via-amber-50/70 to-teal-50/70">
      <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-amber-200/40 blur-2xl" />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-600">今日闭环</p>
          <h3 className="mt-2 text-xl font-black text-slate-900">
            {loopReady ? '行动和复盘都接上了。' : '把行动和复盘接成一个小回路。'}
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            目标不是今天彻底改变，而是留下一个可继续的线索：做了什么、卡在哪里、明天从哪一步开始。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={onStartAction} className="pressable tap-target rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">
            {latestAction ? '继续行动' : '生成行动'}
          </button>
          <button type="button" onClick={onReview} className="pressable tap-target rounded-full border border-amber-200 bg-white/80 px-4 py-2 text-sm font-bold text-amber-800">
            {hasReview ? '查看复盘' : '补上复盘'}
          </button>
        </div>
      </div>

      <div className="relative mt-4 grid gap-3 md:grid-cols-3">
        <LoopStep
          index="1"
          title="最近行动"
          status={actionState.label}
          body={latestAction ? `${latestAction.actionCard.title} · ${latestAction.actionCard.estimated_minutes} 分钟` : '还没有行动卡，先从一个 3 分钟以内动作开始。'}
          active={Boolean(latestAction)}
        />
        <LoopStep
          index="2"
          title="结果反馈"
          status={actionState.feedback}
          body={latestAction?.resultNote || actionState.description}
          active={actionState.key === 'completed' || actionState.key === 'simplified'}
        />
        <LoopStep
          index="3"
          title="今日复盘"
          status={hasReview ? '已保存' : '待补上'}
          body={todayReview?.tomorrow ? `明天的一小步：${todayReview.tomorrow}` : '用一句话记录今天，明天就不用从空白开始。'}
          active={hasReview}
        />
      </div>
    </Card>
  )
}

function LoopStep({
  index,
  title,
  status,
  body,
  active,
}: {
  index: string
  title: string
  status: string
  body: string
  active: boolean
}) {
  return (
    <div className={`rounded-3xl border p-4 ${active ? 'border-amber-100 bg-white/80 shadow-sm' : 'border-white/70 bg-white/45'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-black ${active ? 'bg-amber-400 text-slate-950' : 'bg-slate-100 text-slate-400'}`}>
          {index}
        </span>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {status}
        </span>
      </div>
      <p className="mt-3 font-bold text-slate-800">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-500">{body}</p>
    </div>
  )
}

function getActionLoopState(action: ActionTask | null) {
  if (!action) {
    return {
      key: 'empty',
      label: '待开始',
      feedback: '未反馈',
      description: '先生成一张足够小的行动卡。',
    }
  }
  if (action.status === 'completed') {
    return {
      key: 'completed',
      label: '已完成',
      feedback: '已反馈',
      description: '完成感已经记录下来，可以进入复盘。',
    }
  }
  if (action.status === 'simplified') {
    return {
      key: 'simplified',
      label: '已降难度',
      feedback: '更简单版',
      description: '难度已经降低，下一步只需要碰一下。',
    }
  }
  if (action.status === 'skipped') {
    return {
      key: 'skipped',
      label: '未执行',
      feedback: '需降难度',
      description: '没有完成也算有效信息，适合换成更轻的版本。',
    }
  }
  return {
    key: 'proposed',
    label: '待尝试',
    feedback: '等反馈',
    description: '先执行一下，再回来标记完成或换更简单版本。',
  }
}

function ChatScreen({ onOpenSafety }: { onOpenSafety: () => void }) {
  const scene = useAppStore((state) => state.scene)
  const historyEnabled = useAppStore((state) => state.historyEnabled)
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null)
  const [conversationSearch, setConversationSearch] = useState('')
  const [conversationSceneFilter, setConversationSceneFilter] = useState<'all' | CoachScene>('all')
  const conversations = useLiveQuery(() => listRecentConversations(30), [], [])
  const conversationMessages = useLiveQuery(
    () => listMessagesForConversations((conversations ?? []).flatMap((conversation) => (conversation.id ? [conversation.id] : []))),
    [conversations],
    [],
  )
  const messages = useLiveQuery(
    () => (selectedConversationId ? listMessagesForConversation(selectedConversationId) : Promise.resolve([])),
    [selectedConversationId],
    [],
  )
  const messagesByConversation = useMemo(() => groupMessagesByConversation(conversationMessages ?? []), [conversationMessages])
  const filteredConversations = useMemo(
    () => filterConversations(conversations ?? [], messagesByConversation, conversationSearch, conversationSceneFilter),
    [conversationSearch, conversationSceneFilter, conversations, messagesByConversation],
  )

  const coach =
    scene === 'procrastination' ? (
      <ProcrastinationCoach
        selectedConversationId={selectedConversationId}
        selectedMessages={messages ?? []}
        onConversationSaved={setSelectedConversationId}
        onOpenSafety={onOpenSafety}
      />
    ) : scene === 'daily_review' ? (
      <ReviewScreen onOpenSafety={onOpenSafety} />
    ) : (
      <GenericCoach
        scene={scene}
        selectedConversationId={selectedConversationId}
        selectedMessages={messages ?? []}
        onConversationSaved={setSelectedConversationId}
        onOpenSafety={onOpenSafety}
      />
    )

  return (
    <section className="space-y-4">
      <ConversationHistoryPanel
        enabled={historyEnabled}
        conversations={filteredConversations}
        totalConversations={conversations?.length ?? 0}
        messages={messages ?? []}
        search={conversationSearch}
        sceneFilter={conversationSceneFilter}
        selectedConversationId={selectedConversationId}
        onSearch={setConversationSearch}
        onSceneFilter={setConversationSceneFilter}
        onSelect={setSelectedConversationId}
        onNew={() => setSelectedConversationId(null)}
        onDelete={async (id) => {
          await deleteConversation(id)
          if (selectedConversationId === id) setSelectedConversationId(null)
        }}
      />
      {coach}
    </section>
  )
}

function ConversationHistoryPanel({
  enabled,
  conversations,
  totalConversations,
  messages,
  search,
  sceneFilter,
  selectedConversationId,
  onSearch,
  onSceneFilter,
  onSelect,
  onNew,
  onDelete,
}: {
  enabled: boolean
  conversations: Conversation[]
  totalConversations: number
  messages: Message[]
  search: string
  sceneFilter: 'all' | CoachScene
  selectedConversationId: number | null
  onSearch: (value: string) => void
  onSceneFilter: (value: 'all' | CoachScene) => void
  onSelect: (id: number) => void
  onNew: () => void
  onDelete: (id: number) => Promise<void>
}) {
  if (!enabled) {
    return (
      <Card className="border-slate-100 bg-white/55">
        <h3 className="font-semibold">对话历史</h3>
        <p className="mt-1 text-sm text-slate-500">本地历史已关闭，新的消息正文不会落到 IndexedDB。</p>
      </Card>
    )
  }
  return (
    <Card className="border-slate-100 bg-white/65">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">对话历史</h3>
          <p className="mt-1 text-sm text-slate-500">查看、继续参考或删除最近的本地对话。</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
            {conversations.length}/{totalConversations} 条
          </span>
          <button type="button" onClick={onNew} className="pressable rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm font-semibold">
            新建对话
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="sr-only" htmlFor="conversation-search">
          搜索对话
        </label>
        <input
          id="conversation-search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="搜索对话标题、场景或最近内容"
          className="rounded-2xl border border-slate-200 bg-white/75 px-4 py-3 text-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
        />
        <label className="sr-only" htmlFor="conversation-scene">
          对话场景
        </label>
        <select
          id="conversation-scene"
          value={sceneFilter}
          onChange={(event) => onSceneFilter(event.target.value as 'all' | CoachScene)}
          className="rounded-2xl border border-slate-200 bg-white/75 px-4 py-3 text-sm font-semibold outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
        >
          <option value="all">全部场景</option>
          {sceneCards
            .filter((item) => item.id !== 'daily_review')
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
        </select>
      </div>
      {conversations.length ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-2">
            {conversations.map((conversation) => {
              const id = conversation.id
              return (
                <article
                  key={id ?? conversation.updatedAt}
                  className={`rounded-2xl border p-3 ${
                    selectedConversationId === id ? 'border-amber-200 bg-amber-50/80' : 'border-white/70 bg-white/70'
                  }`}
                >
                  <button
                    type="button"
                    disabled={!id}
                    onClick={() => id && onSelect(id)}
                    className="block w-full text-left"
                  >
                    <p className="font-semibold text-slate-800">{conversation.title}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {promptLabels[conversation.scene] ?? conversation.scene} · {new Date(conversation.updatedAt).toLocaleString()}
                    </p>
                    {selectedConversationId === id ? <p className="mt-2 text-xs font-semibold text-amber-700">正在继续此对话</p> : null}
                  </button>
                  {id ? (
                    <button
                      type="button"
                      onClick={() => onDelete(id)}
                      className="mt-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-red-50 hover:text-red-600"
                    >
                      删除
                    </button>
                  ) : null}
                </article>
              )
            })}
          </div>
          <div className="rounded-2xl border border-white/70 bg-slate-50/80 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-600">{selectedConversationId ? '对话详情' : '选择一条对话查看详情'}</p>
              {selectedConversationId ? (
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                  {messages.length} 条消息
                </span>
              ) : null}
            </div>
            <div className="mt-3 space-y-2">
              {messages.length ? (
                messages.map((message) => (
                  <article
                    key={message.id ?? `${message.role}-${message.createdAt}`}
                    className={`rounded-2xl p-3 text-sm ${
                      message.role === 'user' ? 'bg-white text-slate-700' : 'bg-amber-50 text-amber-900'
                    }`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{message.role}</p>
                    <p className="mt-1 whitespace-pre-wrap">{message.content}</p>
                  </article>
                ))
              ) : (
                <p className="text-sm text-slate-400">暂无已选中的消息。</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
          {totalConversations ? '没有匹配的对话，换个关键词或场景试试。' : '还没有本地对话记录。'}
        </p>
      )}
    </Card>
  )
}

function groupMessagesByConversation(messages: Message[]) {
  return messages.reduce<Record<number, Message[]>>((grouped, message) => {
    if (!grouped[message.conversationId]) grouped[message.conversationId] = []
    grouped[message.conversationId].push(message)
    return grouped
  }, {})
}

function filterConversations(
  conversations: Conversation[],
  messagesByConversation: Record<number, Message[]>,
  search: string,
  sceneFilter: 'all' | CoachScene,
) {
  const keyword = search.trim().toLowerCase()
  return conversations.filter((conversation) => {
    if (sceneFilter !== 'all' && conversation.scene !== sceneFilter) return false
    if (!keyword) return true
    const messageText = conversation.id ? (messagesByConversation[conversation.id] ?? []).map((message) => message.content).join('\n') : ''
    return [conversation.title, conversation.scene, promptLabels[conversation.scene] ?? '', messageText]
      .join('\n')
      .toLowerCase()
      .includes(keyword)
  })
}

function summarizeConversationMessages(messages: Message[]) {
  return messages.slice(-6).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 500),
    riskLevel: message.riskLevel,
    createdAt: message.createdAt,
  }))
}

function buildCloudHistoryContext({
  historyEnabled,
  profileEnabled,
  selectedConversationId,
  selectedMessages,
}: {
  historyEnabled: boolean
  profileEnabled: boolean
  selectedConversationId: number | null
  selectedMessages: Message[]
}) {
  if (!historyEnabled || !profileEnabled || !selectedConversationId) {
    return {}
  }
  return {
    conversationId: selectedConversationId,
    recentMessages: summarizeConversationMessages(selectedMessages),
  }
}

async function saveMinimalRiskEvent(scene: CoachScene, riskLevel: CoachResult['risk_level']) {
  await saveRiskEvent({ scene, riskLevel, createdAt: Date.now() })
}

function useModelGate() {
  const providers = useQuery({ queryKey: ['model-providers'], queryFn: getModelProviders, ...providerQueryOptions })
  const activeProvider = providers.data?.find((provider) => provider.active)
  return {
    isMissing: providers.isSuccess && (!activeProvider || !activeProvider.configured),
    providerLabel: activeProvider?.label ?? '当前模型',
  }
}

function ModelConfigurationNotice({ providerLabel }: { providerLabel: string }) {
  const setTab = useAppStore((state) => state.setTab)
  return (
    <Card className="border-amber-100 bg-amber-50/90">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-amber-900">后端模型还没有配置 API Key</p>
          <p className="mt-1 text-sm text-amber-800">
            当前启用的是 {providerLabel}。为避免把 Key 暴露在客户端，请在 FastAPI 环境变量里配置对应 Key；配置前这里只使用本地兜底建议。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTab('mine')}
            className="pressable tap-target shrink-0 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/15"
        >
          去模型设置
        </button>
      </div>
    </Card>
  )
}

const relationshipScriptLabels: Record<keyof RelationshipScripts, string> = {
  gentle: '温和版',
  direct: '直接版',
  boundary: '边界版',
}

function buildRelationshipDraftPayload({
  conversationId,
  source,
  inputSummary,
  scripts,
  selectedVersion,
}: {
  conversationId: number | null
  source: 'ai' | 'local'
  inputSummary: string
  scripts: RelationshipScripts
  selectedVersion: keyof RelationshipScripts
}): Omit<RelationshipDraft, 'id'> {
  const now = Date.now()
  return {
    conversationId,
    source,
    inputSummary,
    gentle: scripts.gentle,
    direct: scripts.direct,
    boundary: scripts.boundary,
    selectedVersion,
    createdAt: now,
    updatedAt: now,
  }
}

function GenericCoach({
  scene,
  selectedConversationId,
  selectedMessages,
  onConversationSaved,
  onOpenSafety,
}: {
  scene: Exclude<CoachScene, 'daily_review' | 'procrastination'>
  selectedConversationId: number | null
  selectedMessages: Message[]
  onConversationSaved: (id: number) => void
  onOpenSafety: () => void
}) {
  const historyEnabled = useAppStore((state) => state.historyEnabled)
  const serverRecordEnabled = useAppStore((state) => state.serverRecordEnabled)
  const profileEnabled = useAppStore((state) => state.profileEnabled)
  const encouragementStyle = useAppStore((state) => state.encouragementStyle)
  const modelGate = useModelGate()
  const copy = coachCopy[scene]
  const playbook = scenePlaybooks[scene]
  const [selectedContext, setSelectedContext] = useState(playbook.options[0])
  const [text, setText] = useState('')
  const [encouragementEvidence, setEncouragementEvidence] = useState('')
  const [encouragementPhrase, setEncouragementPhrase] = useState('')
  const [creationDuration, setCreationDuration] = useState('10-30 分钟')
  const [creationEnergy, setCreationEnergy] = useState('3')
  const [relationshipFact, setRelationshipFact] = useState('')
  const [relationshipGuess, setRelationshipGuess] = useState('')
  const [relationshipEmotion, setRelationshipEmotion] = useState('')
  const [relationshipNeed, setRelationshipNeed] = useState('')
  const [result, setResult] = useState<CoachResult | null>(null)
  const [resultSource, setResultSource] = useState<'ai' | 'local'>('local')
  const [savedConversationId, setSavedConversationId] = useState<number | null>(null)
  const [savedActionTaskId, setSavedActionTaskId] = useState<number | null>(null)
  const [savedCreationPlanId, setSavedCreationPlanId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const encouragementPhrases = useLiveQuery(
    () => (scene === 'encouragement' ? listEncouragementPhrases(5) : Promise.resolve([])),
    [scene],
    [],
  )
  const creationPlans = useLiveQuery(
    () => (scene === 'creation' ? listCreationPlans(5) : Promise.resolve([])),
    [scene],
    [],
  )
  const relationshipDrafts = useLiveQuery(
    () => (scene === 'relationship' ? listRelationshipDrafts(5) : Promise.resolve([])),
    [scene],
    [],
  )
  const structuredInput = useMemo(
    () =>
      buildStructuredCoachInput(scene, text, {
        selectedContext,
        encouragementEvidence,
        encouragementPhrase,
        creationDuration,
        creationEnergy,
        relationshipFact,
        relationshipGuess,
        relationshipEmotion,
        relationshipNeed,
      }),
    [
      creationDuration,
      creationEnergy,
      encouragementEvidence,
      encouragementPhrase,
      relationshipEmotion,
      relationshipFact,
      relationshipGuess,
      relationshipNeed,
      scene,
      selectedContext,
      text,
    ],
  )

  const mutation = useMutation({
    mutationFn: async () => {
      const riskLevel = detectRiskLevel(structuredInput)
      if (riskLevel >= 3) {
        return { redactedInput: '[高风险输入已隐藏]', result: safetyCoachResult(riskLevel), source: 'local' as const }
      }
      const inputWithContext = `场景重点：${selectedContext}\n鼓励风格：${encouragementStyle}\n${structuredInput}`
      const redactedInput = redactText(inputWithContext)
      if (modelGate.isMissing) {
        return {
          redactedInput,
          result: localGenericResult(scene, `${copy.localFallback}\n\n后端当前模型还没有配置 API Key，这次没有发起云端模型请求。`),
          source: 'local' as const,
        }
      }
      try {
        const result = await requestCoachTurn({
          scene,
          text: redactedInput,
          context: {
            historyEnabled,
            serverRecordEnabled,
            profileEnabled,
            encouragementStyle,
            selectedContext,
            ...buildCloudHistoryContext({ historyEnabled, profileEnabled, selectedConversationId, selectedMessages }),
          },
        })
        return { redactedInput, result, source: 'ai' as const }
      } catch {
        return {
          redactedInput,
          result: localGenericResult(scene, copy.localFallback),
          source: 'local' as const,
        }
      }
    },
    onSuccess: async ({ redactedInput, result, source }) => {
      setResult(result)
      setResultSource(source)
      setNotice('')
      setSavedActionTaskId(null)
      setSavedCreationPlanId(null)
      if (result.risk_level >= 3) {
        setSavedConversationId(null)
        await saveMinimalRiskEvent(scene, result.risk_level)
        onOpenSafety()
        return
      }
      if (!historyEnabled) {
        setSavedConversationId(null)
        return
      }
      const now = Date.now()
      await saveLocalRecord({ scene, input: redactedInput, result, createdAt: now })
      const messagesToSave = [
        { role: 'user' as const, content: redactedInput, riskLevel: 0 as const, createdAt: now },
        { role: 'assistant' as const, content: result.reply_text, riskLevel: result.risk_level, createdAt: now + 1 },
      ]
      const conversationId = selectedConversationId
        ? await appendConversationTurn(selectedConversationId, messagesToSave)
        : await saveConversationTurn(
            {
              scene,
              title: sceneCards.find((item) => item.id === scene)?.title ?? copy.title,
              createdAt: now,
              updatedAt: now,
            },
            messagesToSave,
          )
      setSavedConversationId(conversationId)
      onConversationSaved(conversationId)
      if (result.action_card) {
        const actionTaskId = await saveActionTask({
          source,
          taskText: redactedInput.slice(0, 120),
          reason: copy.title,
          actionCard: result.action_card,
          status: 'proposed',
          createdAt: now,
          updatedAt: now,
        })
        setSavedActionTaskId(actionTaskId)
      }
    },
  })

  async function markGenericAction(status: 'completed' | 'simplified') {
    if (!savedActionTaskId || !result?.action_card) return
    if (status === 'completed') {
      await updateActionTask(savedActionTaskId, {
        status: 'completed',
        resultNote: '用户反馈：已经做了一点。',
      })
      setNotice('已记录：你做了一点。这个反馈会进入本地行动闭环。')
      return
    }
    await updateActionTask(savedActionTaskId, {
      status: 'simplified',
      resultNote: '用户反馈：需要换成更轻版本。',
      actionCard: {
        title: `更轻版本：${result.action_card.steps[0] ?? result.action_card.title}`,
        estimated_minutes: 1,
        difficulty: 'very_low',
        steps: [result.action_card.steps[0] ?? '只做 30 秒', '做到这里就可以停下'],
      },
    })
    setNotice('已换成更轻版本：只做第一小步也算数。')
  }

  async function saveCreationPlanFromResult() {
    if (scene !== 'creation' || !result?.action_card) return
    const now = Date.now()
    const planId = await saveCreationPlan({
      conversationId: savedConversationId ?? selectedConversationId,
      source: resultSource,
      inputSummary: redactText(structuredInput).replace(/\s+/g, ' ').trim().slice(0, 240) || '切回创作计划',
      switchTarget: selectedContext,
      idleDuration: creationDuration,
      energyLevel: creationEnergy,
      actionCard: result.action_card,
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
    })
    setSavedCreationPlanId(planId)
    setNotice('已保存切回创作计划。下次卡住时可以直接从这里捡起来。')
  }

  async function markSavedCreationPlanCompleted() {
    if (!savedCreationPlanId) return
    await updateCreationPlan(savedCreationPlanId, {
      status: 'completed',
    })
    setNotice('已记录这个创作计划完成了一点。')
  }

  async function saveEncouragementPhraseFromResult() {
    if (scene !== 'encouragement' || !result) return
    const phrase = (encouragementPhrase || result.quick_replies[0] || result.reply_text.slice(0, 80)).trim()
    if (!phrase) return
    const now = Date.now()
    await Promise.all([
      savePreference('savedEncouragementPhrase', phrase),
      saveEncouragementPhrase({
        conversationId: savedConversationId ?? selectedConversationId,
        source: resultSource,
        phrase,
        inputSummary: redactText(structuredInput).replace(/\s+/g, ' ').trim().slice(0, 240) || '鼓励短句',
        style: encouragementStyle,
        createdAt: now,
        updatedAt: now,
      }),
    ])
    setNotice('已保存这句鼓励短句，并加入本地短句库。')
  }

  async function saveRelationshipScript(version: keyof RelationshipScripts) {
    if (!result?.relationship_scripts) return
    await saveRelationshipDraft(
      buildRelationshipDraftPayload({
        conversationId: savedConversationId ?? selectedConversationId,
        source: resultSource,
        inputSummary: redactText(structuredInput).replace(/\s+/g, ' ').trim().slice(0, 240) || '关系表达草稿',
        scripts: result.relationship_scripts,
        selectedVersion: version,
      }),
    )
    setNotice(`已保存${relationshipScriptLabels[version]}表达草稿。`)
  }

  return (
    <section className="space-y-4">
      <SectionTitle title={copy.title} subtitle={copy.subtitle} />
      {modelGate.isMissing ? <ModelConfigurationNotice providerLabel={modelGate.providerLabel} /> : null}
      <Card className="surface-card">
        <p className="text-sm font-semibold text-slate-600">{playbook.label}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {playbook.options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSelectedContext(option)}
              className={`pressable rounded-full px-3 py-2 text-xs font-semibold ${
                selectedContext === option ? 'bg-slate-950 text-white shadow-lg shadow-slate-900/15' : 'bg-white/80 text-slate-600 ring-1 ring-slate-100'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        {playbook.privacyTip ? <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-xs text-amber-800">{playbook.privacyTip}</p> : null}
        <SceneStructuredFields
          scene={scene}
          encouragementEvidence={encouragementEvidence}
          encouragementPhrase={encouragementPhrase}
          creationDuration={creationDuration}
          creationEnergy={creationEnergy}
          relationshipFact={relationshipFact}
          relationshipGuess={relationshipGuess}
          relationshipEmotion={relationshipEmotion}
          relationshipNeed={relationshipNeed}
          onEncouragementEvidence={setEncouragementEvidence}
          onEncouragementPhrase={setEncouragementPhrase}
          onCreationDuration={setCreationDuration}
          onCreationEnergy={setCreationEnergy}
          onRelationshipFact={setRelationshipFact}
          onRelationshipGuess={setRelationshipGuess}
          onRelationshipEmotion={setRelationshipEmotion}
          onRelationshipNeed={setRelationshipNeed}
        />
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={copy.placeholder}
          className="input-zone min-h-36 w-full rounded-2xl border border-slate-200 bg-white/76 p-4 shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
        />
        <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!structuredInput.trim() || mutation.isPending}
                onClick={() => mutation.mutate()}
                className="pressable tap-target rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-slate-900/15 disabled:bg-slate-300 disabled:shadow-none"
          >
            {mutation.isPending ? '正在整理...' : '生成教练回复'}
          </button>
          <button
            type="button"
          onClick={() => {
              setText('')
              setEncouragementEvidence('')
              setEncouragementPhrase('')
              setCreationDuration('10-30 分钟')
              setCreationEnergy('3')
              setRelationshipFact('')
              setRelationshipGuess('')
              setRelationshipEmotion('')
              setRelationshipNeed('')
              setResult(null)
              setSavedActionTaskId(null)
              setSavedCreationPlanId(null)
              setNotice('')
            }}
          className="pressable tap-target rounded-full border border-slate-200 bg-white/80 px-5 py-3 text-sm font-bold hover:border-slate-300"
          >
            清空
          </button>
        </div>
      </Card>
      {result ? (
        <ResultCard result={result}>
          {result.risk_level >= 3 ? (
            <button type="button" onClick={onOpenSafety} className="rounded-full bg-red-600 px-4 py-2 text-sm text-white">
              打开安全支持
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setNotice('已保存。你可以先照着行动卡做一个很小的版本。')}
                className="rounded-full bg-emerald-600 px-4 py-2 text-sm text-white"
              >
                我准备试试
              </button>
              {result.action_card && savedActionTaskId ? (
                <>
                  <button
                    type="button"
                    onClick={() => markGenericAction('completed')}
                    className="rounded-full bg-emerald-700 px-4 py-2 text-sm text-white"
                  >
                    我做了一点
                  </button>
                  <button
                    type="button"
                    onClick={() => markGenericAction('simplified')}
                    className="rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-800"
                  >
                    换更轻版本
                  </button>
                </>
              ) : null}
              {scene === 'encouragement' ? (
                <button
                  type="button"
                  onClick={saveEncouragementPhraseFromResult}
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white"
                >
                  保存鼓励短句
                </button>
              ) : null}
              {scene === 'relationship' ? (
                <button
                  type="button"
                  onClick={async () => {
                    await scheduleReminder('relationship_cooldown', '20:30')
                    setNotice('已设置 20:30 关系冷静提醒，稍后再回来整理事实和边界。')
                  }}
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white"
                >
                  设置冷静提醒
                </button>
              ) : null}
              {scene === 'creation' && result.action_card ? (
                <>
                  <button
                    type="button"
                    onClick={saveCreationPlanFromResult}
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white"
                  >
                    保存切回计划
                  </button>
                  {savedCreationPlanId ? (
                    <button
                      type="button"
                      onClick={markSavedCreationPlanCompleted}
                      className="rounded-full bg-emerald-700 px-4 py-2 text-sm text-white"
                    >
                      计划做了一点
                    </button>
                  ) : null}
                </>
              ) : null}
              {scene === 'relationship' && result.relationship_scripts
                ? (Object.keys(relationshipScriptLabels) as Array<keyof RelationshipScripts>).map((version) => (
                    <button
                      key={version}
                      type="button"
                      onClick={() => saveRelationshipScript(version)}
                      className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                    >
                      存为{relationshipScriptLabels[version]}草稿
                    </button>
                  ))
                : null}
              {result.quick_replies.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  onClick={() => setText(reply)}
                  className="rounded-full bg-white px-4 py-2 text-sm text-slate-700"
                >
                  {reply}
                </button>
              ))}
            </div>
          )}
        </ResultCard>
      ) : null}
      {notice ? <p className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</p> : null}
      {scene === 'encouragement' ? (
        <EncouragementPhraseList
          phrases={encouragementPhrases ?? []}
          onUse={(phrase) => setEncouragementPhrase(phrase)}
          onDelete={async (id) => {
            await deleteEncouragementPhrase(id)
            setNotice('已删除这句鼓励短句。')
          }}
        />
      ) : null}
      {scene === 'creation' ? (
        <CreationPlanList
          plans={creationPlans ?? []}
          onComplete={async (id) => {
            await updateCreationPlan(id, { status: 'completed' })
            setNotice('已记录这个切回计划完成了一点。')
          }}
          onDelete={async (id) => {
            await deleteCreationPlan(id)
            setNotice('已删除这条切回创作计划。')
          }}
        />
      ) : null}
      {scene === 'relationship' ? (
        <RelationshipDraftList
          drafts={relationshipDrafts ?? []}
          onDelete={async (id) => {
            await deleteRelationshipDraft(id)
            setNotice('已删除这条关系表达草稿。')
          }}
        />
      ) : null}
    </section>
  )
}

function buildStructuredCoachInput(
  scene: Exclude<CoachScene, 'daily_review' | 'procrastination'>,
  text: string,
  fields: {
    selectedContext: string
    encouragementEvidence: string
    encouragementPhrase: string
    creationDuration: string
    creationEnergy: string
    relationshipFact: string
    relationshipGuess: string
    relationshipEmotion: string
    relationshipNeed: string
  },
) {
  if (scene === 'encouragement') {
    return [
      `当前担心：${fields.selectedContext}`,
      fields.encouragementEvidence ? `支持我的证据：${fields.encouragementEvidence}` : '',
      fields.encouragementPhrase ? `我希望听到的话：${fields.encouragementPhrase}` : '',
      text ? `补充：${text}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }
  if (scene === 'creation') {
    return [
      `切换目标：${fields.selectedContext}`,
      `刚才刷手机/空转时长：${fields.creationDuration}`,
      `当前能量等级：${fields.creationEnergy}/5`,
      text ? `我刚才在刷或逃避的内容：${text}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }
  return [
    `分析重点：${fields.selectedContext}`,
    fields.relationshipFact ? `事实：${fields.relationshipFact}` : '',
    fields.relationshipGuess ? `我的猜测：${fields.relationshipGuess}` : '',
    fields.relationshipEmotion ? `我的情绪：${fields.relationshipEmotion}` : '',
    fields.relationshipNeed ? `我的需要/边界：${fields.relationshipNeed}` : '',
    text ? `补充：${text}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function SceneStructuredFields({
  scene,
  encouragementEvidence,
  encouragementPhrase,
  creationDuration,
  creationEnergy,
  relationshipFact,
  relationshipGuess,
  relationshipEmotion,
  relationshipNeed,
  onEncouragementEvidence,
  onEncouragementPhrase,
  onCreationDuration,
  onCreationEnergy,
  onRelationshipFact,
  onRelationshipGuess,
  onRelationshipEmotion,
  onRelationshipNeed,
}: {
  scene: Exclude<CoachScene, 'daily_review' | 'procrastination'>
  encouragementEvidence: string
  encouragementPhrase: string
  creationDuration: string
  creationEnergy: string
  relationshipFact: string
  relationshipGuess: string
  relationshipEmotion: string
  relationshipNeed: string
  onEncouragementEvidence: (value: string) => void
  onEncouragementPhrase: (value: string) => void
  onCreationDuration: (value: string) => void
  onCreationEnergy: (value: string) => void
  onRelationshipFact: (value: string) => void
  onRelationshipGuess: (value: string) => void
  onRelationshipEmotion: (value: string) => void
  onRelationshipNeed: (value: string) => void
}) {
  if (scene === 'encouragement') {
    return (
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ReviewInput label="支持我的证据" value={encouragementEvidence} onChange={onEncouragementEvidence} placeholder="哪怕只有一点点事实，也写下来。" />
        <ReviewInput label="我希望听到的话" value={encouragementPhrase} onChange={onEncouragementPhrase} placeholder="例如：慢一点也算在往前。" />
      </div>
    )
  }
  if (scene === 'creation') {
    return (
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-slate-600" htmlFor="creation-duration">
          刷手机/空转时长
          <select
            id="creation-duration"
            value={creationDuration}
            onChange={(event) => onCreationDuration(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-normal outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
          >
            {['少于 10 分钟', '10-30 分钟', '30-60 分钟', '超过 1 小时'].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold text-slate-600" htmlFor="creation-energy">
          当前能量等级
          <select
            id="creation-energy"
            value={creationEnergy}
            onChange={(event) => onCreationEnergy(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-normal outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
          >
            {['1', '2', '3', '4', '5'].map((option) => (
              <option key={option} value={option}>
                {option}/5
              </option>
            ))}
          </select>
        </label>
      </div>
    )
  }
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <ReviewInput label="事实" value={relationshipFact} onChange={onRelationshipFact} placeholder="只写看得见、听得见的事实。" />
      <ReviewInput label="我的猜测" value={relationshipGuess} onChange={onRelationshipGuess} placeholder="我脑中自动补全了什么？" />
      <ReviewInput label="我的情绪" value={relationshipEmotion} onChange={onRelationshipEmotion} placeholder="委屈、紧张、生气、失望..." />
      <ReviewInput label="需要/边界" value={relationshipNeed} onChange={onRelationshipNeed} placeholder="我想被怎样对待？底线是什么？" />
    </div>
  )
}

function ProcrastinationStepGuide({ activeStep, hasReason }: { activeStep: 'task' | 'reason' | 'action'; hasReason: boolean }) {
  return (
    <div className="mb-5 grid gap-2 sm:grid-cols-3">
      {procrastinationStepLabels.map((step, index) => {
        const isActive = step.id === activeStep
        const isDone = step.id === 'task' ? activeStep !== 'task' : step.id === 'reason' ? hasReason && activeStep === 'action' : false
        return (
          <div
            key={step.id}
            className={`rounded-2xl border p-3 text-sm ${
              isActive
                ? 'border-amber-200 bg-amber-50 text-amber-900 shadow-sm'
                : isDone
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
                  : 'border-slate-100 bg-white/60 text-slate-500'
            }`}
          >
            <p className="text-xs font-bold">{String(index + 1).padStart(2, '0')}</p>
            <p className="mt-1 font-semibold">{step.label}</p>
          </div>
        )
      })}
    </div>
  )
}

function ProcrastinationCoach({
  selectedConversationId,
  selectedMessages,
  onConversationSaved,
  onOpenSafety,
}: {
  selectedConversationId: number | null
  selectedMessages: Message[]
  onConversationSaved: (id: number) => void
  onOpenSafety: () => void
}) {
  const historyEnabled = useAppStore((state) => state.historyEnabled)
  const serverRecordEnabled = useAppStore((state) => state.serverRecordEnabled)
  const profileEnabled = useAppStore((state) => state.profileEnabled)
  const encouragementStyle = useAppStore((state) => state.encouragementStyle)
  const modelGate = useModelGate()
  const [taskText, setTaskText] = useState('')
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<CoachResult | null>(null)
  const [currentActionId, setCurrentActionId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const activeStep = result ? 'action' : reason ? 'reason' : taskText.trim() ? 'reason' : 'task'
  const canGenerateAction = Boolean(taskText.trim() && reason)

  const mutation = useMutation({
    mutationFn: async () => {
      const input = `任务：${taskText}\n拖延原因：${reason}`
      const riskLevel = detectRiskLevel(input)
      if (riskLevel >= 3) {
        return { input, redactedInput: '[高风险输入已隐藏]', result: safetyCoachResult(riskLevel), source: 'local' as const }
      }
      const redactedInput = redactText(input)
      if (modelGate.isMissing) {
        return {
          input,
          redactedInput,
          result: localActionResult('后端当前模型还没有配置 API Key，这次没有发起云端模型请求，我先给你一个本地兜底动作。'),
          source: 'local' as const,
        }
      }
      try {
        const result = await requestCoachTurn({
          scene: 'procrastination',
          text: redactedInput,
          context: {
            reason,
            historyEnabled,
            serverRecordEnabled,
            profileEnabled,
            encouragementStyle,
            ...buildCloudHistoryContext({ historyEnabled, profileEnabled, selectedConversationId, selectedMessages }),
          },
        })
        return { input, redactedInput, result, source: 'ai' as const }
      } catch {
        return {
          input,
          redactedInput,
          result: localActionResult('模型暂时不可用，我先给你一个本地兜底动作。'),
          source: 'local' as const,
        }
      }
    },
    onSuccess: async ({ redactedInput, result, source }) => {
      setNotice('')
      if (result.risk_level >= 3) {
        setCurrentActionId(null)
        setResult(result)
        await saveMinimalRiskEvent('procrastination', result.risk_level)
        onOpenSafety()
        return
      }
      if (!historyEnabled) {
        setCurrentActionId(null)
        setResult(result)
        return
      }
      const now = Date.now()
      await saveLocalRecord({ scene: 'procrastination', input: redactedInput, result, createdAt: now })
      const messagesToSave = [
        { role: 'user' as const, content: redactedInput, riskLevel: 0 as const, createdAt: now },
        { role: 'assistant' as const, content: result.reply_text, riskLevel: result.risk_level, createdAt: now + 1 },
      ]
      const conversationId = selectedConversationId
        ? await appendConversationTurn(selectedConversationId, messagesToSave)
        : await saveConversationTurn(
            {
              scene: 'procrastination',
              title: taskText.slice(0, 24) || '拖延急救',
              createdAt: now,
              updatedAt: now,
            },
            messagesToSave,
          )
      onConversationSaved(conversationId)
      if (result.action_card) {
        const id = await saveActionTask({
          source,
          taskText: redactText(taskText),
          reason,
          actionCard: result.action_card,
          status: 'proposed',
          createdAt: now,
          updatedAt: now,
        })
        setCurrentActionId(id)
      } else {
        setCurrentActionId(null)
      }
      setResult(result)
    },
  })

  async function markActionCompleted() {
    if (!result?.action_card) return
    if (currentActionId) {
      await updateActionTask(currentActionId, { status: 'completed' })
    }
    setNotice('已记录完成。今天不是靠意志力赢，是靠把门槛降下来了。')
  }

  async function simplifyAction(feedback: 'missed' | 'simpler') {
    if (!result?.action_card) return
    const simpler = simplerActionCard()
    setResult({
      ...result,
      reply_text:
        feedback === 'missed'
          ? '没做也没关系，说明刚才那一步还偏大。我们继续降难度，只做 1 分钟版本。'
          : '好，我们主动把难度再降一档。现在只做 1 分钟版本，不追求推进。',
      action_card: simpler,
      quick_replies: ['我做完了', '还是太大'],
    })
    if (currentActionId) {
      await updateActionTask(currentActionId, {
        actionCard: simpler,
        status: 'simplified',
        resultNote: feedback === 'missed' ? '用户反馈没做，已自动降低难度。' : '用户要求换简单版本。',
      })
    }
    setNotice(feedback === 'missed' ? '已记录“我没做”，并自动换成更小的一分钟动作。' : '已换成更简单的一分钟动作。')
  }

  return (
    <section className="space-y-4">
      <SectionTitle title="拖延急救" subtitle="输入任务，选一个卡住原因，然后生成 3 分钟以内的行动。" />
      {modelGate.isMissing ? <ModelConfigurationNotice providerLabel={modelGate.providerLabel} /> : null}
      <Card className="surface-card">
        <ProcrastinationStepGuide activeStep={activeStep} hasReason={Boolean(reason)} />
        <label className="text-sm font-semibold text-slate-600" htmlFor="task">
          第一步：现在卡住的任务
        </label>
        <textarea
          id="task"
          value={taskText}
          onChange={(event) => setTaskText(event.target.value)}
          placeholder="例如：我一直不想打开报告文档"
            className="input-zone mt-2 min-h-28 w-full rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
        />
        <div className="mt-4">
          <p className="text-sm font-semibold text-slate-600">第二步：拖延原因</p>
          <p className="mt-1 text-xs text-slate-400">不用分析得很准，先选最像的一个。选完才会生成行动卡。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {procrastinationReasons.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setReason(item)}
                className={`pressable tap-target rounded-full px-4 py-2 text-sm font-semibold ${
                  item === reason ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/12' : 'bg-white/80 text-slate-600 ring-1 ring-slate-200 hover:bg-white'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          disabled={!canGenerateAction || mutation.isPending || Boolean(result)}
          onClick={() => mutation.mutate()}
          className="pressable tap-target mt-5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-amber-500/20 disabled:bg-slate-300 disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
        >
          {mutation.isPending ? '正在生成...' : '生成 3 分钟行动'}
        </button>
      </Card>
      {result ? (
        <ResultCard result={result}>
          {result.risk_level >= 3 ? (
            <button type="button" onClick={onOpenSafety} className="rounded-full bg-red-600 px-4 py-2 text-sm text-white">
              打开安全支持
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={markActionCompleted} className="pressable rounded-full bg-emerald-600 px-4 py-2 text-sm text-white shadow-lg shadow-emerald-600/15">
                我做完了
              </button>
              <button type="button" onClick={() => simplifyAction('missed')} className="pressable rounded-full bg-slate-950 px-4 py-2 text-sm text-white shadow-lg shadow-slate-900/15">
                我没做
              </button>
              <button type="button" onClick={() => simplifyAction('simpler')} className="pressable rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                换简单版本
              </button>
            </div>
          )}
        </ResultCard>
      ) : null}
      {notice ? <p className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</p> : null}
    </section>
  )
}

function ReviewScreen({ onOpenSafety }: { onOpenSafety: () => void }) {
  const historyEnabled = useAppStore((state) => state.historyEnabled)
  const serverRecordEnabled = useAppStore((state) => state.serverRecordEnabled)
  const profileEnabled = useAppStore((state) => state.profileEnabled)
  const encouragementStyle = useAppStore((state) => state.encouragementStyle)
  const modelGate = useModelGate()
  const [mood, setMood] = useState('')
  const [pressure, setPressure] = useState('')
  const [win, setWin] = useState('')
  const [tomorrow, setTomorrow] = useState('')
  const [summary, setSummary] = useState('')
  const [source, setSource] = useState<'ai' | 'local'>('local')
  const [summaryRiskLevel, setSummaryRiskLevel] = useState<CoachResult['risk_level']>(0)
  const [savedNotice, setSavedNotice] = useState('')
  const [editingReviewId, setEditingReviewId] = useState<number | null>(null)
  const [reviewSearch, setReviewSearch] = useState('')
  const [reviewSourceFilter, setReviewSourceFilter] = useState<'all' | 'ai' | 'local'>('all')
  const reviews = useLiveQuery(() => listDailyReviews(8), [], [])
  const reviewWeather = useMemo(() => getEmotionWeather(mood), [mood])
  const reviewStreak = useMemo(() => getReviewStreak(reviews ?? []), [reviews])
  const hasReviewDraft = useMemo(() => [mood, pressure, win, tomorrow].some((value) => value.trim().length > 0), [mood, pressure, tomorrow, win])
  const filteredReviews = useMemo(
    () => filterReviews(reviews ?? [], reviewSearch, reviewSourceFilter),
    [reviewSearch, reviewSourceFilter, reviews],
  )

  const inputText = useMemo(
    () => `情绪：${mood}\n压力源：${pressure}\n小胜利：${win}\n明天的一步：${tomorrow}`,
    [mood, pressure, tomorrow, win],
  )

  const mutation = useMutation({
    mutationFn: async () => {
      const riskLevel = detectRiskLevel(inputText)
      if (riskLevel >= 3) {
        return { result: safetyCoachResult(riskLevel), source: 'local' as const }
      }
      if (modelGate.isMissing) {
        const localResult = localReviewResult(mood, tomorrow)
        return {
          result: {
            ...localResult,
            reply_text: `${localResult.reply_text}\n\n后端当前模型还没有配置 API Key，这次没有发起云端模型请求。`,
          },
          source: 'local' as const,
        }
      }
      try {
        const result = await requestCoachTurn({
          scene: 'daily_review',
          text: redactText(inputText),
          context: { historyEnabled, serverRecordEnabled, profileEnabled, encouragementStyle },
        })
        return { result, source: 'ai' as const }
      } catch {
        return { result: localReviewResult(mood, tomorrow), source: 'local' as const }
      }
    },
    onSuccess: async ({ result, source }) => {
      setSource(source)
      setSummary(result.reply_text)
      setSummaryRiskLevel(result.risk_level)
      if (result.risk_level >= 3) {
        await saveMinimalRiskEvent('daily_review', result.risk_level)
        onOpenSafety()
      }
    },
  })

  async function saveReview() {
    if (!hasReviewDraft && !summary.trim()) return
    if (summaryRiskLevel >= 3 || detectRiskLevel(inputText) >= 3) {
      setSavedNotice('高风险内容不会保存为普通复盘；这里只保留风险级别和时间戳。')
      return
    }
    if (!historyEnabled) {
      setSavedNotice('历史记录已关闭，这次复盘不会保存。')
      return
    }
    const now = Date.now()
    const fallbackSummary = summary.trim() ? null : localReviewResult(mood, tomorrow).reply_text
    const finalSummary = fallbackSummary ?? summary
    const finalSource = fallbackSummary ? 'local' : source
    if (fallbackSummary) {
      setSummary(fallbackSummary)
      setSource('local')
      setSummaryRiskLevel(0)
    }
    const reviewPayload = {
      mood: redactText(mood),
      pressure: redactText(pressure),
      win: redactText(win),
      tomorrow: redactText(tomorrow),
      summary: finalSummary,
      source: finalSource,
      updatedAt: now,
    }
    if (editingReviewId) {
      await updateDailyReview(editingReviewId, reviewPayload)
      setSavedNotice('已更新这条复盘。')
      setEditingReviewId(null)
    } else {
      await saveDailyReview({
        ...reviewPayload,
        createdAt: now,
      })
      setSavedNotice('已保存今天的复盘。')
    }
  }

  function editReview(review: DailyReview) {
    setEditingReviewId(review.id ?? null)
    setMood(review.mood)
    setPressure(review.pressure)
    setWin(review.win)
    setTomorrow(review.tomorrow)
    setSummary(review.summary)
    setSource(review.source)
    setSummaryRiskLevel(0)
    setSavedNotice('正在编辑历史复盘，保存后会更新原记录。')
  }

  function resetReviewDraft() {
    setEditingReviewId(null)
    setMood('')
    setPressure('')
    setWin('')
    setTomorrow('')
    setSummary('')
    setSource('local')
    setSummaryRiskLevel(0)
    setSavedNotice('')
  }

  return (
    <section className="space-y-4">
      <SectionTitle title="每日复盘" subtitle="离线或模型失败时也可以保存本地模板总结。" />
      {modelGate.isMissing ? <ModelConfigurationNotice providerLabel={modelGate.providerLabel} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat title="情绪天气" value={reviewWeather} />
        <MiniStat title="连续复盘" value={`${reviewStreak} 天`} />
        <MiniStat title="历史复盘" value={`${reviews?.length ?? 0} 条`} />
      </div>
      <Card className="surface-card">
        <ReviewInput label="主要情绪" value={mood} onChange={setMood} placeholder="例如：焦虑、疲惫，但也有一点松动" />
        <ReviewInput label="压力源" value={pressure} onChange={setPressure} placeholder="今天最消耗我的是什么？" />
        <ReviewInput label="小胜利" value={win} onChange={setWin} placeholder="哪怕很小，也算数" />
        <ReviewInput label="明天的一小步" value={tomorrow} onChange={setTomorrow} placeholder="小到 2 分钟以内也可以" />
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!hasReviewDraft || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="pressable tap-target rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-slate-900/15 disabled:bg-slate-300 disabled:shadow-none"
          >
            {mutation.isPending ? '正在总结...' : '生成复盘总结'}
          </button>
          <button
            type="button"
            onClick={saveReview}
            disabled={!hasReviewDraft && !summary.trim()}
            className="pressable tap-target rounded-full border border-slate-200 bg-white/70 px-5 py-3 text-sm font-bold disabled:text-slate-300"
          >
            {editingReviewId ? '更新复盘' : '保存复盘'}
          </button>
          <button
            type="button"
            onClick={resetReviewDraft}
            className="pressable tap-target rounded-full border border-slate-200 bg-white/70 px-5 py-3 text-sm font-bold hover:border-slate-300"
          >
            新建复盘
          </button>
        </div>
      </Card>
      {summary ? (
        <Card>
          <p className="mb-2 text-sm font-semibold text-slate-600">可编辑总结</p>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          className="input-zone min-h-36 w-full rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
          />
          <p className="mt-2 text-xs text-slate-400">来源：{source === 'ai' ? 'AI 总结' : '本地模板'}</p>
        </Card>
      ) : null}
      {savedNotice ? <p className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700">{savedNotice}</p> : null}
      <ReviewHistory
        reviews={filteredReviews}
        search={reviewSearch}
        sourceFilter={reviewSourceFilter}
        onSearch={setReviewSearch}
        onSourceFilter={setReviewSourceFilter}
        onEdit={editReview}
        onDelete={async (id) => {
          await deleteDailyReview(id)
          if (editingReviewId === id) resetReviewDraft()
          setSavedNotice('已删除这条复盘。')
        }}
      />
    </section>
  )
}

function MineScreen({ onOpenSafety }: { onOpenSafety: () => void }) {
  const queryClient = useQueryClient()
  const historyEnabled = useAppStore((state) => state.historyEnabled)
  const serverRecordEnabled = useAppStore((state) => state.serverRecordEnabled)
  const profileEnabled = useAppStore((state) => state.profileEnabled)
  const mainChallenge = useAppStore((state) => state.mainChallenge)
  const encouragementStyle = useAppStore((state) => state.encouragementStyle)
  const appTheme = useAppStore((state) => state.appTheme)
  const fontDensity = useAppStore((state) => state.fontDensity)
  const reminderEnabled = useAppStore((state) => state.reminderEnabled)
  const reminderTime = useAppStore((state) => state.reminderTime)
  const apiBaseUrl = useAppStore((state) => state.apiBaseUrl)
  const setHistoryEnabled = useAppStore((state) => state.setHistoryEnabled)
  const setServerRecordEnabled = useAppStore((state) => state.setServerRecordEnabled)
  const setProfileEnabled = useAppStore((state) => state.setProfileEnabled)
  const setMainChallenge = useAppStore((state) => state.setMainChallenge)
  const setEncouragementStyle = useAppStore((state) => state.setEncouragementStyle)
  const setAppTheme = useAppStore((state) => state.setAppTheme)
  const setFontDensity = useAppStore((state) => state.setFontDensity)
  const setReminderEnabled = useAppStore((state) => state.setReminderEnabled)
  const setReminderTime = useAppStore((state) => state.setReminderTime)
  const setApiBaseUrl = useAppStore((state) => state.setApiBaseUrl)
  const setOnboardingComplete = useAppStore((state) => state.setOnboardingComplete)
  const [notice, setNotice] = useState('')
  const [apiBaseInput, setApiBaseInput] = useState('')
  const [apiBaseDirty, setApiBaseDirty] = useState(false)
  const [selectedPromptKey, setSelectedPromptKey] = useState('procrastination')
  const [promptDraftInput, setPromptDraftInput] = useState('')
  const [promptDirty, setPromptDirty] = useState(false)
  const [modelProviderInput, setModelProviderInput] = useState('')
  const [modelNameInput, setModelNameInput] = useState('')
  const [modelConfigDirty, setModelConfigDirty] = useState(false)
  const [adminToken, setAdminToken] = useState('')
  const [localRecordScene, setLocalRecordScene] = useState<'all' | CoachScene>('all')
  const [serverRecordScene, setServerRecordScene] = useState<'all' | CoachScene>('all')
  const [savedEncouragementPhrase, setSavedEncouragementPhrase] = useState('')
  const serverBackupInputRef = useRef<HTMLInputElement | null>(null)
  const localImportInputRef = useRef<HTMLInputElement | null>(null)
  const serverRecordPageSize = 5
  const profile = useLiveQuery(() => getProfileSummary(), [], null)
  const actionTasks = useLiveQuery(() => listRecentActionTasks(20), [], [])
  const localRecords = useLiveQuery(() => listRecentRecords(50), [], [])
  const riskEvents = useLiveQuery(() => listRecentRiskEvents(10), [], [])
  const creationPlans = useLiveQuery(() => listCreationPlans(5), [], [])
  const encouragementPhrases = useLiveQuery(() => listEncouragementPhrases(5), [], [])
  const relationshipDrafts = useLiveQuery(() => listRelationshipDrafts(5), [], [])
  const providers = useQuery({ queryKey: ['model-providers'], queryFn: getModelProviders, ...providerQueryOptions })
  const modelRuntime = useQuery({ queryKey: ['model-runtime-config'], queryFn: getModelRuntimeConfig, ...providerQueryOptions })
  const prompts = useQuery({ queryKey: ['prompt-configs'], queryFn: getPromptConfigs, ...providerQueryOptions })
  const serverSummary = useQuery({ queryKey: ['server-profile-summary'], queryFn: getServerProfileSummary, ...serverDataQueryOptions })
  const serverStats = useQuery({ queryKey: ['server-record-stats'], queryFn: getServerRecordStats, ...serverDataQueryOptions })
  const serverRecordSceneFilter = serverRecordScene === 'all' ? undefined : serverRecordScene
  const filteredServerRecordTotal = serverRecordSceneFilter
    ? (serverStats.data?.scene_counts[serverRecordSceneFilter] ?? 0)
    : serverStats.data?.total_records
  const serverRecords = useInfiniteQuery({
    queryKey: ['server-records', serverRecordScene],
    queryFn: ({ pageParam }) => getServerRecordCursorPage(serverRecordPageSize, pageParam, serverRecordSceneFilter),
    initialPageParam: '',
    getNextPageParam: (lastPage) => (lastPage.has_more ? (lastPage.next_cursor ?? undefined) : undefined),
    ...serverDataQueryOptions,
  })
  const pagedServerRecords = serverRecords.data?.pages.flatMap((page) => page.records) ?? []
  const serverRecordTotal = filteredServerRecordTotal ?? pagedServerRecords.length
  const filteredLocalRecords = useMemo(
    () => (localRecords ?? []).filter((record) => localRecordScene === 'all' || record.scene === localRecordScene),
    [localRecordScene, localRecords],
  )
  const diagnostics = useMutation({
    mutationFn: async () => {
      const startedAt = performance.now()
      const [data, readiness] = await Promise.all([getDiagnostics(), getReadiness()])
      return { data, readiness, latencyMs: Math.round(performance.now() - startedAt) }
    },
    onSuccess: ({ latencyMs }) => {
      setNotice(`后端诊断完成，响应耗时约 ${latencyMs}ms。`)
    },
    onError: (error) => {
      setNotice(error instanceof Error ? error.message : '后端诊断失败。')
    },
  })
  const apiBaseDraft = apiBaseDirty ? apiBaseInput : apiBaseUrl
  const selectedPrompt = prompts.data?.find((prompt) => prompt.key === selectedPromptKey)
  const promptDraft = promptDirty ? promptDraftInput : selectedPrompt?.content ?? ''
  const modelProviderDraft = modelConfigDirty ? modelProviderInput : modelRuntime.data?.provider ?? ''
  const modelNameDraft = modelConfigDirty ? modelNameInput : modelRuntime.data?.model ?? ''

  useEffect(() => {
    readPreference('savedEncouragementPhrase').then((value) => setSavedEncouragementPhrase(value ?? ''))
  }, [])

  async function updateHistory(value: boolean) {
    setHistoryEnabled(value)
    await savePreference('historyEnabled', String(value))
  }

  async function updateServerRecord(value: boolean) {
    setServerRecordEnabled(value)
    await savePreference('serverRecordEnabled', String(value))
    setNotice(value ? '服务端记录已开启。后端仍会先脱敏并拦截高风险输入。' : '服务端记录已关闭。之后的 AI 请求不会写入 FastAPI/SQLite。')
  }

  async function updateProfileEnabled(value: boolean) {
    setProfileEnabled(value)
    await savePreference('profileEnabled', String(value))
    setNotice(value ? '个性化画像已开启，会用于生成更贴近你的上下文提示。' : '个性化画像已关闭，之后请求不会主动使用本地画像/历史偏好上下文。')
  }

  async function updateMainChallenge(value: MainChallenge) {
    setMainChallenge(value)
    await savePreference('mainChallenge', value)
  }

  async function updateEncouragementStyle(value: EncouragementStyle) {
    setEncouragementStyle(value)
    await savePreference('encouragementStyle', value)
  }

  async function updateAppTheme(value: AppTheme) {
    setAppTheme(value)
    await savePreference('appTheme', value)
  }

  async function updateFontDensity(value: FontDensity) {
    setFontDensity(value)
    await savePreference('fontDensity', value)
  }

  async function updateReminder(value: boolean) {
    setReminderEnabled(value)
    await savePreference('reminderEnabled', String(value))
    if (value) {
      await scheduleReviewReminder(reminderTime)
      setNotice(`已设置每日 ${reminderTime} 复盘提醒。`)
    }
  }

  async function updateReminderTime(value: string) {
    setReminderTime(value)
    await savePreference('reminderTime', value)
    if (reminderEnabled) {
      await scheduleReviewReminder(value)
      setNotice(`已更新每日 ${value} 复盘提醒。`)
    }
  }

  async function saveApiBaseUrl() {
    try {
      const normalized = await setApiBaseUrlOverride(apiBaseDraft)
      setApiBaseUrl(normalized)
      setApiBaseInput('')
      setApiBaseDirty(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['health'] }),
        queryClient.invalidateQueries({ queryKey: ['model-providers'] }),
        queryClient.invalidateQueries({ queryKey: ['model-runtime-config'] }),
        queryClient.invalidateQueries({ queryKey: ['prompt-configs'] }),
        queryClient.invalidateQueries({ queryKey: ['server-profile-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['server-record-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['server-records'] }),
      ])
      diagnostics.mutate()
      setNotice(`已切换后端地址：${normalized}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '后端地址格式不正确。')
    }
  }

  async function savePromptConfig() {
    if (!selectedPrompt) return
    try {
      const saved = await updatePromptConfig(selectedPrompt.key, promptDraft, adminToken)
      await queryClient.invalidateQueries({ queryKey: ['prompt-configs'] })
      setPromptDraftInput('')
      setPromptDirty(false)
      setNotice(`已更新 ${promptLabels[saved.key] ?? saved.key} 的提示词。`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '提示词保存失败。')
    }
  }

  async function saveModelRuntimeConfig() {
    try {
      const saved = await updateModelRuntimeConfig(modelProviderDraft, modelNameDraft, adminToken)
      setModelProviderInput('')
      setModelNameInput('')
      setModelConfigDirty(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['health'] }),
        queryClient.invalidateQueries({ queryKey: ['model-providers'] }),
        queryClient.invalidateQueries({ queryKey: ['model-runtime-config'] }),
      ])
      setNotice(`已切换模型：${saved.provider} / ${saved.model}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '模型配置保存失败。')
    }
  }

  async function clearServerRecords() {
    try {
      const result = await deleteServerRecords(adminToken)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['server-profile-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['server-record-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['server-records'] }),
      ])
      setNotice(`已清理 ${result.deleted} 条服务端记录。`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '服务端记录清理失败。')
    }
  }

  async function removeServerRecord(recordId: number) {
    try {
      const result = await deleteServerRecord(recordId, adminToken)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['server-profile-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['server-record-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['server-records'] }),
      ])
      setNotice(result.deleted ? '已删除这条服务端记录。' : '没有找到这条服务端记录。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '服务端记录删除失败。')
    }
  }

  async function downloadServerExport() {
    try {
      const data = await exportServerRecords(serverRecordSceneFilter, adminToken)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      const sceneSuffix = serverRecordSceneFilter ? `-${serverRecordSceneFilter}` : ''
      anchor.download = `micro-action-coach-server-records${sceneSuffix}-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setNotice(`已导出 ${data.total_records} 条服务端记录。`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '服务端记录导出失败。')
    }
  }

  async function downloadServerBackup() {
    try {
      const data = await exportServerBackup(adminToken)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `micro-action-coach-server-backup-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setNotice(`已导出完整服务端备份：${data.records_included}/${data.total_records} 条记录，${data.prompt_overrides.length} 个提示词覆盖。`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '完整服务端备份导出失败。')
    }
  }

  async function importServerBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      const backup = JSON.parse(await file.text())
      const result = await restoreServerBackup(backup, 'merge', adminToken)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['server-profile-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['server-record-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['server-records'] }),
        queryClient.invalidateQueries({ queryKey: ['model-runtime-config'] }),
        queryClient.invalidateQueries({ queryKey: ['prompt-configs'] }),
        queryClient.invalidateQueries({ queryKey: ['health'] }),
        queryClient.invalidateQueries({ queryKey: ['model-providers'] }),
      ])
      setNotice(`已合并导入服务端备份：新增 ${result.records_imported} 条，跳过 ${result.records_skipped} 条，恢复 ${result.prompt_overrides_imported} 个提示词覆盖。`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '服务端备份导入失败，请确认 JSON 文件来自完整备份。')
    }
  }

  async function optimizeServerDatabase() {
    try {
      const result = await runServerMaintenance(adminToken)
      const freedPages = Math.max(0, result.freelist_count_before - result.freelist_count_after)
      setNotice(`已优化服务端 SQLite：WAL checkpoint 完成，释放空闲页 ${freedPages}。`)
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['server-record-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['server-records'] }),
      ])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '服务端 SQLite 优化失败。')
    }
  }

  async function pruneOldServerRecords() {
    try {
      const result = await runServerMaintenance(adminToken, false, 90)
      const pruneDate = result.prune_before_timestamp
        ? new Date(result.prune_before_timestamp * 1000).toLocaleDateString()
        : '90 天前'
      setNotice(`已清理 ${pruneDate} 之前的服务端记录 ${result.records_pruned} 条，并完成 SQLite 优化。`)
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['server-profile-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['server-record-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['server-records'] }),
      ])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '服务端记录留存清理失败。')
    }
  }

  async function scheduleExtraReminder(kind: 'start_action' | 'encouragement', time: string) {
    await scheduleReminder(kind, time)
    setNotice(kind === 'start_action' ? `已设置每日 ${time} 启动行动提醒。` : `已设置每日 ${time} 鼓励提醒。`)
  }

  async function cancelExtraReminder(kind: 'start_action' | 'encouragement') {
    await cancelReminder(kind)
    setNotice(kind === 'start_action' ? '已关闭启动行动提醒。' : '已关闭鼓励提醒。')
  }

  async function downloadExport() {
    const data = await exportAllData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `micro-action-coach-export-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice('已导出本地数据 JSON。')
  }

  async function importLocalDataFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const confirmed = window.confirm('导入会替换当前本地记录、对话、行动卡、复盘历史、切回创作计划、鼓励短句库和关系表达草稿。设置项和服务端记录不会被改动。确定继续吗？')
    if (!confirmed) return
    try {
      const parsed = JSON.parse(await file.text())
      const result = await importAllData(parsed)
      setNotice(
        `已导入本地数据：${result.records} 条记录、${result.conversations} 个对话、${result.actionTasks} 张行动卡、${result.dailyReviews} 条复盘、${result.creationPlans} 条切回创作计划、${result.encouragementPhrases} 条鼓励短句、${result.relationshipDrafts} 条关系草稿、${result.riskEvents} 条安全事件。`,
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '本地数据导入失败，请确认 JSON 文件来自本应用导出。')
    }
  }

  async function clearLocalData() {
    const confirmed = window.confirm('确定清理本地记录、对话、行动卡、复盘历史、切回创作计划、鼓励短句库、关系表达草稿和安全事件吗？设置项和服务端记录不会被清理。')
    if (!confirmed) return
    await clearAllLocalData()
    setNotice('已清理本地记录、对话、行动卡、复盘历史、切回创作计划、鼓励短句库、关系表达草稿和安全事件。')
  }

  async function clearEncouragementPhrase() {
    await savePreference('savedEncouragementPhrase', '')
    setSavedEncouragementPhrase('')
    setNotice('已清除保存的鼓励短句。')
  }

  return (
    <section className="space-y-4">
      <SectionTitle title="我的" subtitle="设置本地保存、提醒和安全支持。" />
      <Card>
        <SettingRow
          icon={Settings}
          title="历史记录"
          body="关闭后不保存消息正文和复盘历史；高风险输入始终不保存原文。"
        >
          <Toggle checked={historyEnabled} onChange={updateHistory} ariaLabel="切换历史记录" />
        </SettingRow>
        <SettingRow
          icon={ShieldCheck}
          title="服务端记录"
          body="关闭后仍可调用 AI，但请求会带上 serverRecordEnabled=false，后端不会写入 SQLite。"
        >
          <Toggle checked={serverRecordEnabled} onChange={updateServerRecord} ariaLabel="切换服务端记录" />
        </SettingRow>
        <SettingRow
          icon={UserRound}
          title="个性化画像"
          body="开启后会把偏好和本地画像摘要作为上下文；关闭后不主动传 profile/history context。"
        >
          <Toggle checked={profileEnabled} onChange={updateProfileEnabled} ariaLabel="切换个性化画像" />
        </SettingRow>
        <div className="grid gap-3 border-b border-slate-100 py-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-600" htmlFor="main-challenge">
            主要问题
            <select
              id="main-challenge"
              value={mainChallenge}
              onChange={(event) => updateMainChallenge(event.target.value as MainChallenge)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-normal shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
            >
              {mainChallengeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-xs font-normal text-slate-400">
              {mainChallengeOptions.find((option) => option.value === mainChallenge)?.description}
            </span>
          </label>
          <label className="block text-sm font-semibold text-slate-600" htmlFor="encouragement-style">
            鼓励风格
            <select
              id="encouragement-style"
              value={encouragementStyle}
              onChange={(event) => updateEncouragementStyle(event.target.value as EncouragementStyle)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-normal shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
            >
              {encouragementStyleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-xs font-normal text-slate-400">
              {encouragementStyleOptions.find((option) => option.value === encouragementStyle)?.description}
            </span>
          </label>
        </div>
        <div className="grid gap-3 border-b border-slate-100 py-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-600" htmlFor="app-theme">
            主题
            <select
              id="app-theme"
              value={appTheme}
              onChange={(event) => updateAppTheme(event.target.value as AppTheme)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-normal shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
            >
              {appThemeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-xs font-normal text-slate-400">
              {appThemeOptions.find((option) => option.value === appTheme)?.description}
            </span>
          </label>
          <label className="block text-sm font-semibold text-slate-600" htmlFor="font-density">
            字体密度
            <select
              id="font-density"
              value={fontDensity}
              onChange={(event) => updateFontDensity(event.target.value as FontDensity)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-normal shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
            >
              {fontDensityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-xs font-normal text-slate-400">
              {fontDensityOptions.find((option) => option.value === fontDensity)?.description}
            </span>
          </label>
        </div>
        <SettingRow icon={Bell} title="每日复盘提醒" body="使用 Capacitor Local Notifications。">
          <Toggle checked={reminderEnabled} onChange={updateReminder} ariaLabel="切换每日复盘提醒" />
        </SettingRow>
        <label className="mt-4 block text-sm font-semibold text-slate-600" htmlFor="reminder">
          提醒时间
        </label>
        <input
          id="reminder"
          type="time"
          value={reminderTime}
          onChange={(event) => updateReminderTime(event.target.value)}
          className="mt-2 rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
        />
      </Card>
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-semibold">鼓励短句</h3>
            <p className="mt-1 text-sm text-slate-500">鼓励师里保存的一句话会出现在这里，适合低能量时直接拿来用。</p>
          </div>
          {savedEncouragementPhrase ? (
            <button
              type="button"
              onClick={clearEncouragementPhrase}
              className="pressable rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-semibold hover:border-red-100 hover:text-red-600"
            >
              清除短句
            </button>
          ) : null}
        </div>
        {savedEncouragementPhrase ? (
          <blockquote className="mt-4 rounded-3xl border border-rose-100 bg-rose-50/80 p-4 text-base font-semibold leading-7 text-slate-800">
            {savedEncouragementPhrase}
          </blockquote>
        ) : (
          <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-400">还没有保存鼓励短句。去“我需要一点勇气”生成后，可以点“保存鼓励短句”。</p>
        )}
      </Card>
      <Card>
        <h3 className="font-semibold">后端连接</h3>
        <p className="mt-1 text-sm text-slate-500">
          Android 壳和 PWA 都会使用这个地址访问 FastAPI。换服务器或内网调试时，不需要重新安装应用。
        </p>
        <label className="mt-4 block text-sm font-semibold text-slate-600" htmlFor="api-base-url">
          API Base URL
        </label>
        <input
          id="api-base-url"
          type="url"
          value={apiBaseDraft}
          onChange={(event) => {
            setApiBaseDirty(true)
            setApiBaseInput(event.target.value)
          }}
          placeholder="例如：https://api.example.com 或 192.168.1.5:8000"
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveApiBaseUrl}
            className="pressable rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/15"
          >
            保存并重连
          </button>
          <button
            type="button"
            onClick={() => {
              setApiBaseInput('')
              setApiBaseDirty(false)
            }}
            className="pressable rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-semibold hover:border-slate-300"
          >
            恢复当前值
          </button>
          <button
            type="button"
            onClick={() => diagnostics.mutate()}
            disabled={diagnostics.isPending}
            className="pressable rounded-full border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
          >
            {diagnostics.isPending ? '正在诊断...' : '诊断连接'}
          </button>
        </div>
        {diagnostics.data ? (
          <div className="mt-4 rounded-2xl border border-white/70 bg-white/60 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold">后端诊断</p>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                {diagnostics.data.data.status} · {diagnostics.data.latencyMs}ms
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <DiagnosticItem label="API 版本" value={diagnostics.data.data.version} />
              <DiagnosticItem
                label="readyz"
                value={`${diagnostics.data.readiness.status} · schema v${diagnostics.data.readiness.schema_version ?? '-'}/${diagnostics.data.readiness.expected_schema_version}`}
              />
              <DiagnosticItem label="模型" value={`${diagnostics.data.data.provider} / ${diagnostics.data.data.model}`} />
              <DiagnosticItem label="可用 Provider" value={`${diagnostics.data.data.configured_providers} 个`} />
              <DiagnosticItem
                label="当前模型 Key"
                value={diagnostics.data.data.active_provider_configured ? '已配置' : '未配置'}
              />
              <DiagnosticItem
                label="SQLite"
                value={`${diagnostics.data.data.database.connected ? '已连接' : '未连接'} · ${diagnostics.data.data.database.journal_mode}`}
              />
              <DiagnosticItem label="schema" value={`v${diagnostics.data.data.database.schema_version ?? '-'}`} />
              <DiagnosticItem label="busy timeout" value={`${diagnostics.data.data.database.busy_timeout_ms}ms`} />
              <DiagnosticItem
                label="mmap"
                value={
                  diagnostics.data.data.database.mmap_size
                    ? `${Math.round(diagnostics.data.data.database.mmap_size / 1024 / 1024)}MB`
                    : '未启用'
                }
              />
              <DiagnosticItem
                label="WAL checkpoint"
                value={`${diagnostics.data.data.database.wal_autocheckpoint ?? '-'} pages`}
              />
              <DiagnosticItem
                label="DB pages"
                value={`${diagnostics.data.data.database.page_count} x ${diagnostics.data.data.database.page_size}B`}
              />
              <DiagnosticItem label="free pages" value={`${diagnostics.data.data.database.freelist_count}`} />
              <DiagnosticItem
                label="服务端记录"
                value={diagnostics.data.data.database.record_enabled ? '开启保存' : '关闭保存'}
              />
              <DiagnosticItem
                label="服务器时间"
                value={new Date(diagnostics.data.data.server_time * 1000).toLocaleString()}
              />
            </div>
            {diagnostics.data.data.deployment_checks?.length ? (
              <div className="mt-4 rounded-2xl border border-white/70 bg-slate-50/80 p-3">
                <p className="font-semibold">部署预检</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {diagnostics.data.data.deployment_checks.map((check) => (
                    <div key={check.key} className="rounded-2xl bg-white/80 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-500">{check.label}</p>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            check.status === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                          }`}
                        >
                          {check.status === 'ok' ? 'OK' : 'WARN'}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">{check.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>
      <Card>
        <h3 className="font-semibold">模型代理</h3>
        <p className="mt-1 text-sm text-slate-500">
          后端统一代理大模型 API，客户端不会保存或暴露模型 API Key。
        </p>
        <div className="mt-4 space-y-3 rounded-2xl border border-white/70 bg-white/60 p-3">
          {modelRuntime.isLoading ? (
            <p className="text-sm text-slate-400">正在读取当前模型...</p>
          ) : modelRuntime.isError ? (
            <p className="text-sm text-amber-700">暂时无法读取当前模型配置。</p>
          ) : (
            <p className="text-sm text-slate-600">
              当前：<span className="font-semibold">{modelRuntime.data?.provider}</span> /{' '}
              <span className="font-semibold">{modelRuntime.data?.model}</span>
              {modelRuntime.data?.customized ? <span className="ml-2 text-xs text-amber-700">运行时覆盖</span> : null}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-600" htmlFor="model-provider">
              Provider
              <select
                id="model-provider"
                value={modelProviderDraft}
                onChange={(event) => {
                  setModelConfigDirty(true)
                  setModelProviderInput(event.target.value)
                  setModelNameInput(modelNameDraft)
                }}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-normal shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
              >
                {(providers.data ?? []).map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold text-slate-600" htmlFor="model-name">
              Model
              <input
                id="model-name"
                value={modelNameDraft}
                onChange={(event) => {
                  setModelConfigDirty(true)
                  setModelProviderInput(modelProviderDraft)
                  setModelNameInput(event.target.value)
                }}
                placeholder="例如：deepseek-v4-flash"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-normal shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveModelRuntimeConfig}
              disabled={!modelProviderDraft || !modelNameDraft.trim()}
              className="pressable rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 disabled:bg-slate-300 disabled:shadow-none"
            >
              保存模型配置
            </button>
            <button
              type="button"
              onClick={() => {
                setModelProviderInput('')
                setModelNameInput('')
                setModelConfigDirty(false)
              }}
              className="pressable rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-semibold hover:border-slate-300"
            >
              恢复当前模型
            </button>
          </div>
        </div>
        {providers.isLoading ? (
          <p className="mt-3 text-sm text-slate-400">正在读取后端模型配置...</p>
        ) : providers.isError ? (
          <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-700">
            暂时无法读取模型配置。离线或后端未启动时，教练会继续使用本地兜底。
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {providers.data?.map((provider) => (
              <div key={provider.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/70 bg-white/60 p-3">
                <div>
                  <p className="text-sm font-semibold">
                    {provider.label}
                    {provider.active ? <span className="ml-2 text-xs text-amber-700">当前</span> : null}
                  </p>
                  <p className="mt-1 max-w-[16rem] truncate text-xs text-slate-400">{provider.base_url || '未配置 base URL'}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    provider.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {provider.configured ? '已配置' : '未配置'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <h3 className="font-semibold">提示词管理</h3>
        <p className="mt-1 text-sm text-slate-500">
          修改后端场景规则后，Web/PWA/Android 会在下一次 AI 调用时立即使用新规则。
        </p>
        {prompts.isLoading ? (
          <p className="mt-3 text-sm text-slate-400">正在读取提示词配置...</p>
        ) : prompts.isError ? (
          <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-700">
            暂时无法读取提示词。请确认后端地址和 FastAPI 服务状态。
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-semibold text-slate-600" htmlFor="prompt-key">
              场景
            </label>
            <select
              id="prompt-key"
              value={selectedPromptKey}
              onChange={(event) => {
                setSelectedPromptKey(event.target.value)
                setPromptDraftInput('')
                setPromptDirty(false)
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
            >
              {prompts.data?.map((prompt) => (
                <option key={prompt.key} value={prompt.key}>
                  {promptLabels[prompt.key] ?? prompt.key}
                </option>
              ))}
            </select>
            {selectedPrompt ? (
              <p className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-500">
                {selectedPrompt.customized ? '当前使用自定义提示词。' : '当前使用默认提示词。'}
                {selectedPrompt.updated_at ? ` 更新时间：${new Date(selectedPrompt.updated_at * 1000).toLocaleString()}` : ''}
              </p>
            ) : null}
            <label className="block text-sm font-semibold text-slate-600" htmlFor="prompt-content">
              提示词内容
            </label>
            <textarea
              id="prompt-content"
              value={promptDraft}
              onChange={(event) => {
                setPromptDirty(true)
                setPromptDraftInput(event.target.value)
              }}
                      className="input-zone min-h-44 w-full rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
            />
            <label className="block text-sm font-semibold text-slate-600" htmlFor="admin-token">
              Admin Token
            </label>
            <input
              id="admin-token"
              type="password"
              value={adminToken}
              onChange={(event) => setAdminToken(event.target.value)}
              placeholder="后端配置 ADMIN_TOKEN 时需要填写"
              className="w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={savePromptConfig}
                disabled={!selectedPrompt || promptDraft.trim().length < 20}
                className="pressable rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 disabled:bg-slate-300 disabled:shadow-none"
              >
                保存提示词
              </button>
              <button
                type="button"
                onClick={() => {
                  setPromptDraftInput('')
                  setPromptDirty(false)
                }}
                className="pressable rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-semibold hover:border-slate-300"
              >
                恢复当前值
              </button>
            </div>
          </div>
        )}
      </Card>
      <Card>
        <SettingRow icon={ShieldCheck} title="安全支持" body="可信任联系人、12356、110 和 120 拨号入口。">
          <button type="button" onClick={onOpenSafety} className="rounded-full bg-red-50 px-4 py-2 text-sm font-semibold text-red-600">
            打开
          </button>
        </SettingRow>
        <button
          type="button"
          onClick={async () => {
            await savePreference('onboardingComplete', 'false')
            setOnboardingComplete(false)
          }}
          className="mt-5 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold"
        >
          重新查看首次引导
        </button>
        <button
          type="button"
          onClick={downloadExport}
          className="ml-2 mt-5 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold"
        >
          导出本地数据
        </button>
        <input
          ref={localImportInputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="选择本地数据 JSON"
          onChange={importLocalDataFile}
        />
        <button
          type="button"
          onClick={() => localImportInputRef.current?.click()}
          className="ml-2 mt-5 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold"
        >
          导入本地数据
        </button>
        <button
          type="button"
          onClick={clearLocalData}
          className="ml-2 mt-5 rounded-full border border-red-100 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600"
        >
          清理本地数据
        </button>
      </Card>
      <Card>
        <h3 className="font-semibold">关于与免责声明</h3>
        <div className="mt-3 space-y-3 text-sm text-slate-600">
          <p>
            微行动教练是个人效率与情绪行动辅助工具，目标是把当下的一步变小；它不是心理治疗、医学诊断、法律或财务建议。
          </p>
          <p>
            如果输入涉及自伤、伤人或立即危险，应用会优先显示安全支持；请联系现实中的可信任联系人，紧急情况请拨打 110 或 120。
          </p>
          <p>
            当前架构采用 Web/PWA + Capacitor Android 壳 + FastAPI 后端代理，大模型 API Key 只应配置在后端环境变量中，不放在前端或 Android 壳里。
          </p>
          <p>
            本地记录、服务端记录、画像上下文和提醒都可以在本页关闭或清理；调用 AI 前会进行手机号、邮箱和疑似地址脱敏。
          </p>
        </div>
      </Card>
      <LocalRecordManager
        records={filteredLocalRecords}
        totalCount={localRecords?.length ?? 0}
        sceneFilter={localRecordScene}
        onSceneFilter={setLocalRecordScene}
        onDelete={async (id) => {
          await deleteLocalRecord(id)
          setNotice('已删除这条本地记录。')
        }}
      />
      <RiskEventList
        events={riskEvents ?? []}
        onDelete={async (id) => {
          await deleteRiskEvent(id)
          setNotice('已删除这条安全事件。')
        }}
      />
      <CreationPlanList
        plans={creationPlans ?? []}
        onComplete={async (id) => {
          await updateCreationPlan(id, { status: 'completed' })
          setNotice('已记录这个切回计划完成了一点。')
        }}
        onDelete={async (id) => {
          await deleteCreationPlan(id)
          setNotice('已删除这条切回创作计划。')
        }}
      />
      <EncouragementPhraseList
        phrases={encouragementPhrases ?? []}
        onUse={async (phrase) => {
          await savePreference('savedEncouragementPhrase', phrase)
          setSavedEncouragementPhrase(phrase)
          setNotice('已设为当前常用鼓励短句。')
        }}
        onDelete={async (id) => {
          await deleteEncouragementPhrase(id)
          setNotice('已删除这句鼓励短句。')
        }}
      />
      <RelationshipDraftList
        drafts={relationshipDrafts ?? []}
        onDelete={async (id) => {
          await deleteRelationshipDraft(id)
          setNotice('已删除这条关系表达草稿。')
        }}
      />
      <ActionTaskManager
        tasks={actionTasks ?? []}
        onComplete={async (id) => {
          await updateActionTask(id, {
            status: 'completed',
            resultNote: '用户从行动卡历史标记完成。',
          })
          setNotice('已把这张行动卡标记为完成。')
        }}
        onSimplify={async (id) => {
          await updateActionTask(id, {
            status: 'simplified',
            actionCard: simplerActionCard(),
            resultNote: '用户从行动卡历史换成更轻版本。',
          })
          setNotice('已把这张行动卡换成 1 分钟更轻版本。')
        }}
        onDelete={async (id) => {
          await deleteActionTask(id)
          setNotice('已删除这张行动卡。')
        }}
      />
      <Card>
        <h3 className="font-semibold">服务端数据</h3>
        <p className="mt-1 text-sm text-slate-500">
          这里显示 FastAPI + SQLite 保存的服务端记录；关闭 `SERVER_RECORD_ENABLED` 后不会新增服务端记录。
        </p>
        {serverSummary.isLoading || serverStats.isLoading || serverRecords.isLoading ? (
          <p className="mt-3 text-sm text-slate-400">正在读取服务端数据...</p>
        ) : serverSummary.isError || serverStats.isError || serverRecords.isError ? (
          <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-700">
            暂时无法读取服务端数据。请确认后端连接和 CORS 配置。
          </p>
        ) : (
          <div className="mt-4 space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
                <p className="text-xs text-slate-400">服务端记录</p>
                <p className="mt-1 text-2xl font-bold">{serverStats.data?.total_records ?? serverSummary.data?.total_records ?? 0}</p>
                <p className="mt-1 text-xs text-slate-400">当前筛选 {serverRecordTotal} 条</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
                <p className="text-xs text-slate-400">最新写入</p>
                <p className="mt-1 text-slate-700">
                  {serverStats.data?.latest_created_at
                    ? new Date(serverStats.data.latest_created_at * 1000).toLocaleString()
                    : '暂无'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
                <p className="text-xs text-slate-400">单页上限</p>
                <p className="mt-1 text-2xl font-bold">{serverStats.data?.max_page_size ?? 200}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
              <p className="font-semibold">数据库健康</p>
              <p className="mt-1 text-xs text-slate-500">
                当前服务端 SQLite 可读写；客户端会按分页读取，避免一次性拉取过多历史。
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <CountPills title="场景分布" counts={serverStats.data?.scene_counts ?? {}} />
                <CountPills title="风险级别" counts={serverStats.data?.risk_counts ?? {}} prefix="L" />
              </div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
              <p className="text-xs text-slate-400">建议关注</p>
              <p className="mt-1 text-slate-700">{serverSummary.data?.suggested_focus ?? '暂无'}</p>
            </div>
            <SummaryTags title="服务端情绪标签" tags={serverSummary.data?.emotion_labels ?? []} />
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">最近服务端记录</p>
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor="server-record-scene">
                    服务端记录场景
                  </label>
                  <select
                    id="server-record-scene"
                    value={serverRecordScene}
                    onChange={(event) => setServerRecordScene(event.target.value as 'all' | CoachScene)}
                    className="rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  >
                    <option value="all">全部场景</option>
                    {sceneCards.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => queryClient.invalidateQueries({ queryKey: ['server-records', serverRecordScene] })}
                    className="pressable rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold hover:border-slate-300"
                  >
                    刷新
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {serverRecordScene === 'all'
                  ? `当前显示全部场景，已加载 ${pagedServerRecords.length}/${serverRecordTotal} 条。`
                  : `当前筛选：${sceneCards.find((item) => item.id === serverRecordScene)?.title ?? serverRecordScene}，已加载 ${pagedServerRecords.length}/${serverRecordTotal} 条。`}
              </p>
              <div className="mt-2 space-y-2">
                {pagedServerRecords.length ? (
                  pagedServerRecords.map((record) => (
                    <article key={record.id} className="pressable rounded-2xl border border-white/70 bg-white/68 p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${sceneStyles[record.scene as CoachScene]?.badge ?? 'bg-slate-100 text-slate-600'}`}>
                          {sceneCards.find((item) => item.id === record.scene)?.title ?? record.scene}
                        </span>
                        <span className="text-[11px] text-slate-400">{new Date(record.created_at * 1000).toLocaleString()}</span>
                      </div>
                      <p className="mt-2 line-clamp-1 font-medium">{record.input}</p>
                      <p className="mt-1 line-clamp-2 text-slate-500">{record.output.reply_text}</p>
                      <button
                        type="button"
                        onClick={() => removeServerRecord(record.id)}
                        className="mt-3 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500 hover:border-red-100 hover:text-red-600"
                      >
                        删除服务端记录
                      </button>
                    </article>
                  ))
                ) : (
                  <p className="text-slate-400">暂无服务端记录。</p>
                )}
              </div>
              {serverRecords.hasNextPage ? (
                <button
                  type="button"
                  onClick={() => serverRecords.fetchNextPage()}
                  disabled={serverRecords.isFetchingNextPage}
                  className="pressable mt-3 rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-semibold hover:border-slate-300"
                >
                  {serverRecords.isFetchingNextPage ? '正在加载...' : '加载更多'}
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={serverBackupInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={importServerBackup}
                aria-label="选择服务端备份 JSON"
              />
              <button
                type="button"
                onClick={downloadServerExport}
                className="pressable rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-semibold hover:border-slate-300"
              >
                导出当前筛选
              </button>
              <button
                type="button"
                onClick={downloadServerBackup}
                className="pressable rounded-full border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
              >
                导出完整备份
              </button>
              <button
                type="button"
                onClick={() => serverBackupInputRef.current?.click()}
                className="pressable rounded-full border border-blue-100 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
              >
                导入完整备份
              </button>
              <button
                type="button"
                onClick={optimizeServerDatabase}
                className="pressable rounded-full border border-violet-100 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100"
              >
                优化数据库
              </button>
              <button
                type="button"
                onClick={pruneOldServerRecords}
                className="pressable rounded-full border border-amber-100 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
              >
                清理 90 天前记录
              </button>
              <button
                type="button"
                onClick={clearServerRecords}
                className="pressable rounded-full border border-red-100 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100"
              >
                清理服务端记录
              </button>
            </div>
          </div>
        )}
      </Card>
      <Card>
        <h3 className="font-semibold">画像摘要</h3>
        <p className="mt-1 text-sm text-slate-500">
          基于本地记录生成，不上传。记录越多，摘要越有参考价值。
        </p>
        {!profileEnabled ? (
          <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
            个性化画像已关闭。你仍然可以保留本地记录，但不会把画像摘要作为 AI 上下文。
          </p>
        ) : profile ? (
          <div className="mt-4 space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
                <p className="text-xs text-slate-400">本地记录</p>
                <p className="mt-1 text-2xl font-bold">{profile.totalRecords}</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
                <p className="text-xs text-slate-400">行动完成率</p>
                <p className="mt-1 text-2xl font-bold">
                  {profile.actionCompletionRate === null ? '暂无' : `${profile.actionCompletionRate}%`}
                </p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
                <p className="text-xs text-slate-400">连续复盘</p>
                <p className="mt-1 text-2xl font-bold">{profile.reviewStreakDays} 天</p>
              </div>
            </div>
            <div className="rounded-3xl border border-amber-100 bg-amber-50/80 p-4">
              <p className="text-xs font-semibold text-amber-700">本周行动建议</p>
              <p className="mt-2 text-base font-semibold text-slate-800">{profile.nextMicroAction}</p>
            </div>
            <div>
              <p className="font-semibold">高频场景</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {profile.topScenes.length ? (
                  profile.topScenes.map((item) => (
                    <span key={item.scene} className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                      {sceneCards.find((sceneCard) => sceneCard.id === item.scene)?.title ?? item.scene} · {item.count}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400">暂无</span>
                )}
              </div>
            </div>
            <SummaryTags title="情绪标签" tags={profile.emotionLabels} />
            <SummaryTags title="需求标签" tags={profile.needLabels} />
            <div>
              <p className="font-semibold">近期模式</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
                {profile.recentPatterns.map((pattern) => (
                  <li key={pattern}>{pattern}</li>
                ))}
              </ul>
            </div>
            <p className="rounded-2xl bg-amber-50 p-3 text-amber-800">{profile.suggestedFocus}</p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">正在读取本地记录...</p>
        )}
      </Card>
      <Card>
        <h3 className="font-semibold">更多提醒</h3>
        <p className="mt-1 text-sm text-slate-500">除每日复盘外，可以给自己加一个轻量启动或鼓励提醒。</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => scheduleExtraReminder('start_action', '09:30')}
            className="pressable rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/15"
          >
            每日 09:30 启动行动
          </button>
          <button
            type="button"
            onClick={() => scheduleExtraReminder('encouragement', '15:00')}
            className="pressable rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-amber-500/20"
          >
            每日 15:00 鼓励提醒
          </button>
          <button
            type="button"
            onClick={() => cancelExtraReminder('start_action')}
            className="pressable rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-semibold hover:border-slate-300"
          >
            关闭启动提醒
          </button>
          <button
            type="button"
            onClick={() => cancelExtraReminder('encouragement')}
            className="pressable rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-semibold hover:border-slate-300"
          >
            关闭鼓励提醒
          </button>
        </div>
      </Card>
      {notice ? <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">{notice}</p> : null}
    </section>
  )
}

function Onboarding({
  onComplete,
}: {
  onComplete: (preferences: {
    mainChallenge: MainChallenge
    encouragementStyle: EncouragementStyle
    reminderEnabled: boolean
    reminderTime: string
  }) => void | Promise<void>
}) {
  const [step, setStep] = useState(0)
  const [mainChallenge, setMainChallenge] = useState<MainChallenge>('procrastination')
  const [encouragementStyle, setEncouragementStyle] = useState<EncouragementStyle>('rational')
  const [reminderEnabled, setReminderEnabled] = useState(true)
  const [reminderTime, setReminderTime] = useState('21:30')
  const isLastStep = step === 3
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-slate-950/40 p-4 sm:items-center sm:justify-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card max-w-lg rounded-[2rem] p-6"
      >
        <p className="text-sm font-semibold text-amber-700">首次引导</p>
        <div className="mt-3 flex gap-1">
          {[0, 1, 2, 3].map((item) => (
            <span key={item} className={`h-1.5 flex-1 rounded-full ${item <= step ? 'bg-slate-950' : 'bg-slate-200'}`} />
          ))}
        </div>
        {step === 0 ? (
          <div className="mt-5 space-y-3">
            <h2 className="text-2xl font-bold">先把目标说小一点。</h2>
            <p className="text-sm text-slate-600">
              微行动教练专注一件事：在你拖延、内耗、刷手机或关系消耗时，把“我应该变好”改成“现在能做的一小步”。
            </p>
          </div>
        ) : null}
        {step === 1 ? (
          <div className="mt-5 space-y-3">
            <h2 className="text-2xl font-bold">边界也先放在桌面上。</h2>
            <p className="text-sm text-slate-600">它不是心理治疗师，不做诊断，不替你做重大决定；高风险内容会优先转向安全支持。</p>
            <p className="text-sm text-slate-600">如果你处在立即危险中，请优先联系现实中的可信任联系人，或拨打 110 / 120。</p>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="mt-5 space-y-3">
            <h2 className="text-2xl font-bold">默认本地保存，调用 AI 前先脱敏。</h2>
            <p className="text-sm text-slate-600">本地历史用于最近行动、对话、复盘和画像摘要；你可以在“我的”里随时关闭。</p>
            <p className="text-sm text-slate-600">调用 AI 时会发送当前输入和必要上下文。手机号、邮箱和疑似地址会先脱敏；高风险输入不发往模型。</p>
          </div>
        ) : null}
        {step === 3 ? (
          <div className="mt-5 space-y-4">
            <h2 className="text-2xl font-bold">先初始化你的使用偏好。</h2>
            <div>
              <p className="text-sm font-semibold text-slate-600">主要问题</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {mainChallengeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setMainChallenge(option.value)}
                    className={`rounded-2xl border p-3 text-left text-sm ${
                      mainChallenge === option.value ? 'border-slate-950 bg-slate-950 text-white' : 'border-white/70 bg-white/70 text-slate-600'
                    }`}
                  >
                    <span className="font-semibold">{option.label}</span>
                    <span className="mt-1 block text-xs opacity-75">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-600">鼓励风格</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {encouragementStyleOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setEncouragementStyle(option.value)}
                    className={`rounded-full px-3 py-2 text-xs font-semibold ${
                      encouragementStyle === option.value ? 'bg-slate-950 text-white' : 'bg-white/80 text-slate-600 ring-1 ring-slate-100'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-white/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700">每日复盘提醒</p>
                  <p className="text-xs text-slate-500">默认 21:30，可在“我的”里修改或关闭。</p>
                </div>
                <Toggle checked={reminderEnabled} onChange={setReminderEnabled} ariaLabel="切换引导复盘提醒" />
              </div>
              <input
                type="time"
                value={reminderTime}
                onChange={(event) => setReminderTime(event.target.value)}
                className="mt-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              />
            </div>
          </div>
        ) : null}
        <div className="mt-6 flex gap-2">
          {step > 0 ? (
            <button type="button" onClick={() => setStep((value) => value - 1)} className="pressable rounded-full border border-slate-200 bg-white/70 px-5 py-3 font-bold">
              上一步
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (!isLastStep) {
                setStep((value) => value + 1)
                return
              }
              onComplete({ mainChallenge, encouragementStyle, reminderEnabled, reminderTime })
            }}
            className="pressable flex-1 rounded-full bg-slate-950 px-5 py-3 font-bold text-white shadow-lg shadow-slate-900/15"
          >
            {isLastStep ? '我知道了，开始' : '继续'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function SafetySheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 p-4 sm:items-center sm:justify-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card w-full max-w-lg rounded-[2rem] p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-red-600">安全支持</p>
            <h2 className="mt-1 text-2xl font-bold">先把安全放在第一位。</h2>
          </div>
          <button type="button" onClick={onClose} className="pressable rounded-full bg-slate-100 px-3 py-1 text-sm hover:bg-slate-200">
            关闭
          </button>
        </div>
        <div className="mt-4 space-y-3 text-sm text-slate-600">
          <p>请联系一个现实中的可信任联系人：家人、朋友、同事、老师或社区工作人员。</p>
          <p>如果有立即危险，请使用下面的拨号入口。这里使用 `tel:` 拨号链接，不申请通话权限。</p>
        </div>
        <div className="mt-5 grid gap-2">
          <DialLink number="12356" label="心理援助热线 12356" />
          <DialLink number="110" label="紧急危险 110" />
          <DialLink number="120" label="医疗急救 120" />
        </div>
      </motion.div>
    </div>
  )
}

function ResultCard({ result, children }: { result: CoachResult; children?: React.ReactNode }) {
  return (
    <Card className={result.risk_level >= 3 ? 'border-red-100 bg-red-50' : 'border-amber-100 bg-amber-50'}>
      <p className="text-sm font-semibold text-amber-800">教练回复</p>
      <p className="mt-2 whitespace-pre-wrap text-slate-800">{result.reply_text}</p>
      {result.action_card ? <ActionCardView card={result.action_card} /> : null}
      {result.relationship_scripts ? (
        <div className="mt-4 grid gap-2 text-sm">
          <p>温和版：{result.relationship_scripts.gentle}</p>
          <p>直接版：{result.relationship_scripts.direct}</p>
          <p>边界版：{result.relationship_scripts.boundary}</p>
        </div>
      ) : null}
      <div className="mt-4">{children}</div>
    </Card>
  )
}

function EncouragementPhraseList({
  phrases,
  onUse,
  onDelete,
}: {
  phrases: EncouragementPhrase[]
  onUse: (phrase: string) => void | Promise<void>
  onDelete: (id: number) => Promise<void>
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">鼓励短句库</h3>
          <p className="mt-1 text-sm text-slate-500">保存能真正接住你的说法，低能量时不用重新组织语言。</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">{phrases.length} 条</span>
      </div>
      <div className="mt-4 space-y-3">
        {phrases.length ? (
          phrases.map((item) => (
            <article key={item.id ?? item.createdAt} className="rounded-2xl border border-white/70 bg-white/70 p-3 text-sm shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                  {encouragementStyleOptions.find((option) => option.value === item.style)?.label ?? item.style} · {item.source === 'ai' ? 'AI' : '本地'}
                </span>
                <span className="text-[11px] text-slate-400">{new Date(item.createdAt).toLocaleString()}</span>
              </div>
              <blockquote className="mt-2 rounded-2xl bg-rose-50/70 p-3 font-semibold leading-6 text-slate-800">{item.phrase}</blockquote>
              <p className="mt-2 line-clamp-2 text-xs text-slate-400">来源：{item.inputSummary}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onUse(item.phrase)}
                  className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold text-white"
                >
                  设为常用
                </button>
                {item.id ? (
                  <button
                    type="button"
                    onClick={() => onDelete(item.id as number)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500 hover:border-red-100 hover:text-red-600"
                  >
                    删除短句
                  </button>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-400">暂无短句。生成鼓励师回复后，可以把一句真正有用的话保存下来。</p>
        )}
      </div>
    </Card>
  )
}

function CreationPlanList({
  plans,
  onComplete,
  onDelete,
}: {
  plans: CreationPlan[]
  onComplete: (id: number) => Promise<void>
  onDelete: (id: number) => Promise<void>
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">切回创作计划</h3>
          <p className="mt-1 text-sm text-slate-500">保存最近可复用的小行动，下次空转时直接从一个低门槛版本开始。</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">{plans.length} 条</span>
      </div>
      <div className="mt-4 space-y-3">
        {plans.length ? (
          plans.map((plan) => (
            <article key={plan.id ?? plan.createdAt} className="rounded-2xl border border-white/70 bg-white/70 p-3 text-sm shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                  {plan.switchTarget} · 能量 {plan.energyLevel}/5 · {plan.source === 'ai' ? 'AI' : '本地'}
                </span>
                <span className="text-[11px] text-slate-400">{new Date(plan.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-2 font-semibold text-slate-800">{plan.actionCard.title}</p>
              <p className="mt-1 text-xs text-slate-500">
                {plan.actionCard.estimated_minutes} 分钟 · {plan.actionCard.difficulty} · 空转 {plan.idleDuration}
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-600">
                {plan.actionCard.steps.slice(0, 3).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="mt-2 line-clamp-2 text-xs text-slate-400">来源：{plan.inputSummary}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {plan.id && plan.status !== 'completed' ? (
                  <button
                    type="button"
                    onClick={() => onComplete(plan.id as number)}
                    className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                  >
                    标记做了一点
                  </button>
                ) : null}
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${plan.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {plan.status === 'completed' ? '已完成一点' : '待尝试'}
                </span>
                {plan.id ? (
                  <button
                    type="button"
                    onClick={() => onDelete(plan.id as number)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500 hover:border-red-100 hover:text-red-600"
                  >
                    删除计划
                  </button>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-400">暂无切回创作计划。生成创造动力建议后，可以保存一张下次复用的小行动卡。</p>
        )}
      </div>
    </Card>
  )
}

function RelationshipDraftList({
  drafts,
  onDelete,
}: {
  drafts: RelationshipDraft[]
  onDelete: (id: number) => Promise<void>
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">关系表达草稿</h3>
          <p className="mt-1 text-sm text-slate-500">保存后的说法会留在本地，适合冷静之后再挑一版微调。</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">{drafts.length} 条</span>
      </div>
      <div className="mt-4 space-y-3">
        {drafts.length ? (
          drafts.map((draft) => {
            const selectedText = draft[draft.selectedVersion]
            return (
              <article key={draft.id ?? draft.createdAt} className="rounded-2xl border border-white/70 bg-white/70 p-3 text-sm shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                    {relationshipScriptLabels[draft.selectedVersion]} · {draft.source === 'ai' ? 'AI' : '本地'}
                  </span>
                  <span className="text-[11px] text-slate-400">{new Date(draft.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-2 text-slate-700">{selectedText}</p>
                <p className="mt-2 line-clamp-2 text-xs text-slate-400">来源：{draft.inputSummary}</p>
                {draft.id ? (
                  <button
                    type="button"
                    onClick={() => onDelete(draft.id as number)}
                    className="mt-3 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500 hover:border-red-100 hover:text-red-600"
                  >
                    删除草稿
                  </button>
                ) : null}
              </article>
            )
          })
        ) : (
          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-400">暂无草稿。生成关系分析后，可以把温和版、直接版或边界版保存下来。</p>
        )}
      </div>
    </Card>
  )
}

function ActionCardView({ card }: { card: ActionCard }) {
  return (
    <div className="mt-4 rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm">
      <p className="font-semibold">{card.title}</p>
      <p className="text-sm text-slate-500">
        {card.estimated_minutes} 分钟 · {card.difficulty}
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
        {card.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  )
}

function getEmotionWeather(mood: string) {
  const text = mood.toLowerCase()
  if (!text.trim()) return '待记录'
  if (/(开心|轻松|平静|满足|稳定|ok|good)/i.test(text)) return '晴'
  if (/(焦虑|烦|压力|紧张|累|疲|崩|难受|sad|anxious|tired)/i.test(text)) return '阴雨'
  return '多云'
}

function getReviewStreak(reviews: DailyReview[]) {
  const days = new Set(
    reviews.map((review) => {
      const date = new Date(review.createdAt)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }),
  )
  let streak = 0
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  while (days.has(cursor.getTime())) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

function filterReviews(reviews: DailyReview[], search: string, sourceFilter: 'all' | 'ai' | 'local') {
  const keyword = search.trim().toLowerCase()
  return reviews.filter((review) => {
    if (sourceFilter !== 'all' && review.source !== sourceFilter) return false
    if (!keyword) return true
    return [review.mood, review.pressure, review.win, review.tomorrow, review.summary]
      .join('\n')
      .toLowerCase()
      .includes(keyword)
  })
}

function ReviewHistory({
  reviews,
  search,
  sourceFilter,
  onSearch,
  onSourceFilter,
  onEdit,
  onDelete,
}: {
  reviews: DailyReview[]
  search: string
  sourceFilter: 'all' | 'ai' | 'local'
  onSearch: (value: string) => void
  onSourceFilter: (value: 'all' | 'ai' | 'local') => void
  onEdit: (review: DailyReview) => void
  onDelete: (id: number) => Promise<void>
}) {
  const [expandedId, setExpandedId] = useState<number | null>(reviews[0]?.id ?? null)
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="font-semibold">复盘历史</h3>
          <p className="mt-1 text-sm text-slate-500">支持按关键词搜索、按 AI/本地来源筛选，也可以回填编辑。</p>
        </div>
        <label className="block text-sm font-semibold text-slate-600" htmlFor="review-search">
          搜索
          <input
            id="review-search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="情绪、压力源、小胜利..."
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-2 text-sm font-normal outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 sm:w-56"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {[
          ['all', '全部'],
          ['ai', 'AI 总结'],
          ['local', '本地模板'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onSourceFilter(value as 'all' | 'ai' | 'local')}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              sourceFilter === value ? 'bg-slate-950 text-white' : 'bg-white/80 text-slate-600 ring-1 ring-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-3">
        {reviews.length ? (
          reviews.map((review) => (
            <article key={review.id} className="rounded-2xl border border-white/70 bg-white/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-400">{new Date(review.createdAt).toLocaleString()}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">{review.summary.slice(0, 80)}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => onEdit(review)}
                    className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === review.id ? null : (review.id ?? null))}
                    className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600"
                  >
                    {expandedId === review.id ? '收起' : '详情'}
                  </button>
                  {review.id ? (
                    <button
                      type="button"
                      onClick={() => onDelete(review.id as number)}
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-red-50 hover:text-red-600"
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              </div>
              {expandedId === review.id ? (
                <div className="mt-3 grid gap-2 rounded-2xl bg-white/70 p-3 text-sm text-slate-600">
                  <p>
                    <span className="font-semibold">情绪：</span>
                    {review.mood || '未填写'}
                  </p>
                  <p>
                    <span className="font-semibold">压力源：</span>
                    {review.pressure || '未填写'}
                  </p>
                  <p>
                    <span className="font-semibold">小胜利：</span>
                    {review.win || '未填写'}
                  </p>
                  <p>
                    <span className="font-semibold">明天一步：</span>
                    {review.tomorrow || '未填写'}
                  </p>
                  <p className="whitespace-pre-wrap">
                    <span className="font-semibold">总结：</span>
                    {review.summary}
                  </p>
                </div>
              ) : null}
            </article>
          ))
        ) : (
          <p className="text-sm text-slate-500">还没有复盘记录。</p>
        )}
      </div>
    </Card>
  )
}

function ActionTaskManager({
  tasks,
  onComplete,
  onSimplify,
  onDelete,
}: {
  tasks: ActionTask[]
  onComplete: (id: number) => Promise<void>
  onSimplify: (id: number) => Promise<void>
  onDelete: (id: number) => Promise<void>
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">行动卡历史</h3>
          <p className="mt-1 text-sm text-slate-500">查看最近 20 张本地行动卡，确认它们是完成、待尝试，还是已经换成更轻版本。</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">{tasks.length} 张</span>
      </div>
      <div className="mt-4 space-y-3">
        {tasks.length ? (
          tasks.map((task) => {
            const state = getActionLoopState(task)
            return (
              <article key={task.id ?? task.createdAt} className="rounded-2xl border border-white/70 bg-white/70 p-3 text-sm shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    state.key === 'completed'
                      ? 'bg-emerald-50 text-emerald-700'
                      : state.key === 'simplified'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}>
                    {state.label}
                  </span>
                  <span className="text-[11px] text-slate-400">{new Date(task.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-2 font-semibold text-slate-800">{task.actionCard.title}</p>
                <p className="mt-1 line-clamp-2 text-slate-500">{task.taskText}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {task.reason} · {task.actionCard.estimated_minutes} 分钟 · {task.actionCard.difficulty}
                </p>
                {task.resultNote ? <p className="mt-2 rounded-2xl bg-slate-50 p-2 text-xs text-slate-500">{task.resultNote}</p> : null}
                <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-slate-500">
                  {task.actionCard.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {task.id ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {task.status !== 'completed' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onComplete(task.id as number)}
                          className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          标记完成
                        </button>
                        <button
                          type="button"
                          onClick={() => onSimplify(task.id as number)}
                          className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                        >
                          换更轻版本
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onDelete(task.id as number)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500 hover:border-red-100 hover:text-red-600"
                    >
                      删除行动卡
                    </button>
                  </div>
                ) : null}
              </article>
            )
          })
        ) : (
          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-400">还没有行动卡。完成一次拖延急救或创造动力后会出现在这里。</p>
        )}
      </div>
    </Card>
  )
}

function SummaryTags({ title, tags }: { title: string; tags: string[] }) {
  return (
    <div>
      <p className="font-semibold">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {tags.length ? (
          tags.map((tag) => (
            <span key={tag} className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
              {tag}
            </span>
          ))
        ) : (
          <span className="text-slate-400">暂无</span>
        )}
      </div>
    </div>
  )
}

function CountPills({ title, counts, prefix = '' }: { title: string; counts: Record<string, number>; prefix?: string }) {
  const entries = Object.entries(counts)
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {entries.length ? (
          entries.map(([key, count]) => (
            <span key={key} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
              {prefix}
              {key} · {count}
            </span>
          ))
        ) : (
          <span className="text-xs text-slate-400">暂无</span>
        )}
      </div>
    </div>
  )
}

function DiagnosticItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-0.5 truncate font-semibold text-slate-700">{value}</p>
    </div>
  )
}

function LocalRecordManager({
  records,
  totalCount,
  sceneFilter,
  onSceneFilter,
  onDelete,
}: {
  records: LocalRecord[]
  totalCount: number
  sceneFilter: 'all' | CoachScene
  onSceneFilter: (scene: 'all' | CoachScene) => void
  onDelete: (id: number) => Promise<void>
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold">本地记录管理</h3>
          <p className="mt-1 text-sm text-slate-500">查看最近 50 条本地记录，按场景筛选或删除单条记录。</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
            {records.length}/{totalCount} 条
          </span>
          <label className="sr-only" htmlFor="local-record-scene">
            本地记录场景
          </label>
          <select
            id="local-record-scene"
            value={sceneFilter}
            onChange={(event) => onSceneFilter(event.target.value as 'all' | CoachScene)}
            className="rounded-full border border-slate-200 bg-white/70 px-3 py-2 text-xs font-semibold outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          >
            <option value="all">全部场景</option>
            {sceneCards.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {records.length ? (
          records.map((record) => (
            <article key={record.id ?? record.createdAt} className="rounded-2xl border border-white/70 bg-white/68 p-3 text-sm shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${sceneStyles[record.scene]?.badge ?? 'bg-slate-100 text-slate-600'}`}>
                  {sceneCards.find((item) => item.id === record.scene)?.title ?? record.scene}
                </span>
                <span className="text-[11px] text-slate-400">{new Date(record.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-2 line-clamp-2 font-medium text-slate-700">{record.input}</p>
              <p className="mt-1 line-clamp-2 text-slate-500">{record.result.reply_text}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">L{record.result.risk_level}</span>
                {record.result.emotion_labels.slice(0, 3).map((label) => (
                  <span key={label} className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                    {label}
                  </span>
                ))}
                {record.id ? (
                  <button
                    type="button"
                    onClick={() => onDelete(record.id as number)}
                    className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500 hover:border-red-100 hover:text-red-600"
                  >
                    删除本地记录
                  </button>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-400">暂无符合筛选条件的本地记录。</p>
        )}
      </div>
    </Card>
  )
}

function RiskEventList({ events, onDelete }: { events: RiskEvent[]; onDelete: (id: number) => Promise<void> }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">安全事件</h3>
          <p className="mt-1 text-sm text-slate-500">高风险输入不会保存原文；这里只保留场景、风险级别和时间戳。</p>
        </div>
        <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">{events.length} 条</span>
      </div>
      <div className="mt-4 space-y-3">
        {events.length ? (
          events.map((event) => (
            <article key={event.id ?? event.createdAt} className="rounded-2xl border border-red-100 bg-red-50/70 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700">
                  {sceneCards.find((item) => item.id === event.scene)?.title ?? event.scene} · L{event.riskLevel}
                </span>
                <span className="text-[11px] text-slate-400">{new Date(event.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-2 text-xs text-red-700">已隐藏原文。请优先使用安全支持或联系现实中的可信任联系人。</p>
              {event.id ? (
                <button
                  type="button"
                  onClick={() => onDelete(event.id as number)}
                  className="mt-3 rounded-full border border-red-100 bg-white px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
                >
                  删除安全事件
                </button>
              ) : null}
            </article>
          ))
        ) : (
          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-400">暂无安全事件。</p>
        )}
      </div>
    </Card>
  )
}

function RecentList({ records }: { records: Array<{ id?: number; scene: CoachScene; input: string; result: CoachResult; createdAt: number }> }) {
  return (
    <Card>
      <h3 className="font-semibold">最近对话</h3>
      <div className="mt-3 space-y-3">
        {records.length ? (
          records.map((record) => (
            <article key={record.id} className="rounded-2xl border border-white/70 bg-white/60 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">{record.scene}</p>
              <p className="mt-1 line-clamp-1 text-sm font-medium">{record.input}</p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{record.result.reply_text}</p>
            </article>
          ))
        ) : (
          <p className="text-sm text-slate-500">还没有记录。先从一个场景开始。</p>
        )}
      </div>
    </Card>
  )
}

function ReviewInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <label className="mt-4 block text-sm font-semibold text-slate-600">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input-zone mt-2 min-h-20 w-full rounded-2xl border border-slate-200 bg-white/70 p-4 font-normal shadow-inner shadow-slate-900/[0.02] outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
      />
    </label>
  )
}

function BottomTabs({ active, onChange }: { active: AppTab; onChange: (tab: AppTab) => void }) {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 px-3 pt-2">
      <div className="mobile-nav mx-auto grid max-w-3xl grid-cols-4 gap-1 rounded-[1.7rem] border border-white/80 bg-white/78 p-1.5 shadow-[0_-18px_60px_rgba(15,23,42,0.12)] backdrop-blur-2xl">
        {tabItems.map((tab) => {
          const Icon = tab.icon
          const isActive = tab.id === active
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`pressable tap-target relative rounded-2xl px-2 py-2 text-xs font-semibold ${
                isActive
                  ? 'nav-active bg-gradient-to-br from-slate-950 to-slate-800 text-white shadow-lg shadow-slate-900/15'
                  : 'text-slate-500 hover:bg-white/85 hover:text-slate-800'
              }`}
            >
              {isActive ? <span className="absolute inset-x-5 -top-1 h-1 rounded-full bg-gradient-to-r from-amber-300 to-orange-400" /> : null}
              <Icon className="mx-auto mb-1" size={20} />
              {tab.title}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function InfoCard({
  icon: Icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon
  title: string
  body: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-amber-50 p-2 text-amber-700">
          <Icon size={20} />
        </div>
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{body}</p>
          {actionLabel ? (
            <button type="button" onClick={onAction} className="pressable mt-3 rounded-full bg-slate-950 px-4 py-2 text-sm text-white shadow-lg shadow-slate-900/15">
              {actionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

function SettingRow({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: LucideIcon
  title: string
  body: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <Icon className="mt-1 text-amber-700" size={20} />
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-slate-500">{body}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (checked: boolean) => void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`pressable h-8 w-14 rounded-full p-1 shadow-inner transition ${checked ? 'bg-emerald-500 shadow-emerald-700/10' : 'bg-slate-300 shadow-slate-500/10'}`}
      aria-pressed={checked}
      aria-label={ariaLabel}
    >
      <span className={`block h-6 w-6 rounded-full bg-white shadow-sm transition ${checked ? 'translate-x-6' : ''}`} />
    </button>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`glass-card surface-card transition-card rounded-[1.7rem] p-5 ${className}`}>{children}</div>
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  )
}

function StatusPill({ icon: Icon, text, tone = 'neutral' }: { icon?: LucideIcon; text: string; tone?: 'neutral' | 'ok' | 'warn' }) {
  const toneClass = {
    neutral: 'border-white/70 bg-white/75 text-slate-600',
    ok: 'border-emerald-100 bg-emerald-50/85 text-emerald-700',
    warn: 'border-amber-100 bg-amber-50/85 text-amber-800',
  }[tone]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 font-semibold shadow-sm backdrop-blur ${toneClass}`}>
      {Icon ? <Icon size={14} /> : null}
      {text}
    </span>
  )
}

function MiniStat({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
      <p className="text-xs text-slate-300">{title}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  )
}

function QuickStartRail() {
  return (
    <Card className="quick-rail p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">Tiny Loop</p>
          <h3 className="mt-1 text-lg font-black text-slate-950">一次只处理一个微行动闭环</h3>
        </div>
        <p className="max-w-md text-sm text-slate-500">
          适合在 Android 手机上快速开始，也适合 Web/PWA 远程更新后直接继续用。
        </p>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {quickStartSteps.map((step) => (
          <div key={step.index} className="rounded-[1.2rem] border border-white/70 bg-white/58 p-3 shadow-sm">
            <span className="inline-flex rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-black text-white">
              {step.index}
            </span>
            <p className="mt-2 font-semibold">{step.title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{step.body}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

function DialLink({ number, label }: { number: string; label: string }) {
  return (
    <a href={`tel:${number}`} className="flex items-center justify-between rounded-2xl bg-red-50 p-4 font-semibold text-red-700">
      <span>{label}</span>
      <Phone size={18} />
    </a>
  )
}

function localActionResult(prefix: string): CoachResult {
  return {
    reply_text: `${prefix}\n现在只做一件事：打开相关文件或页面，不要求继续。`,
    emotion_labels: ['stuck'],
    need_labels: ['start'],
    risk_level: 0,
    action_card: {
      title: '只打开相关文件',
      estimated_minutes: 1,
      difficulty: 'very_low',
      steps: ['找到相关文件或页面', '打开它', '停在这里也算完成'],
    },
    relationship_scripts: null,
    quick_replies: ['我做完了', '再简单一点'],
  }
}

function simplerActionCard(): ActionCard {
  return {
    title: '只碰一下任务',
    estimated_minutes: 1,
    difficulty: 'very_low',
    steps: ['把任务相关入口放到眼前', '只做一个点击或打开动作', '完成后立刻停下'],
  }
}

function localReviewResult(mood: string, tomorrow: string): CoachResult {
  return {
    reply_text: `今天先承认已经发生的努力。你记录到的主要状态是：${mood || '有点复杂'}。明天不需要证明什么，只从“${tomorrow || '一个 2 分钟动作'}”开始。`,
    emotion_labels: ['reflective'],
    need_labels: ['rest', 'clarity'],
    risk_level: 0,
    action_card: {
      title: '写下明天最小一步',
      estimated_minutes: 2,
      difficulty: 'low',
      steps: ['打开备忘录', '写一句明天要做的小动作', '把它放到容易看到的位置'],
    },
    relationship_scripts: null,
    quick_replies: ['保存复盘'],
  }
}

function localGenericResult(scene: CoachScene, replyText: string): CoachResult {
  if (scene === 'relationship') {
    return {
      reply_text: replyText,
      emotion_labels: ['uncertainty'],
      need_labels: ['clarity', 'boundary'],
      risk_level: 0,
      action_card: null,
      relationship_scripts: {
        gentle: '刚才那件事我有点在意，你方便的时候回我一下就好。',
        direct: '我想确认一下，你现在是不方便回复，还是暂时不想聊这个？',
        boundary: '如果你现在不方便聊可以直接告诉我，我能接受。但长时间没有回应会让我有些困扰。',
      },
      quick_replies: ['保存温和版', '换一个更直接的版本'],
    }
  }
  if (scene === 'creation') {
    return {
      reply_text: replyText,
      emotion_labels: ['tired'],
      need_labels: ['agency'],
      risk_level: 0,
      action_card: {
        title: '写下 50 字想法',
        estimated_minutes: 3,
        difficulty: 'low',
        steps: ['把手机放远一点', '打开备忘录', '写下刚才冒出来的一件事'],
      },
      relationship_scripts: null,
      quick_replies: ['好一点', '没变化'],
    }
  }
  return {
    reply_text: replyText,
    emotion_labels: ['self_doubt'],
    need_labels: ['confidence'],
    risk_level: 0,
    action_card: {
      title: '写下一句中性事实',
      estimated_minutes: 2,
      difficulty: 'very_low',
      steps: ['打开备忘录', '写一句你已经知道的事实', '不要急着说服自己'],
    },
    relationship_scripts: null,
    quick_replies: ['温柔一点', '理性分析'],
  }
}
