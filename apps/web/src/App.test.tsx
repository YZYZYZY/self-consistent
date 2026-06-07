import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { db, exportAllData, saveActionTask, saveConversationTurn, saveDailyReview, saveLocalRecord } from './lib/db'
import {
  deleteServerRecord,
  deleteServerRecords,
  exportServerBackup,
  exportServerRecords,
  getDiagnostics,
  getModelProviders,
  getReadiness,
  getServerRecordCursorPage,
  getServerRecordStats,
  requestCoachTurn,
  restoreServerBackup,
  runServerMaintenance,
  setApiBaseUrlOverride,
  updateModelRuntimeConfig,
  updatePromptConfig,
} from './lib/api'
import { readPreference, savePreference, scheduleReminder, scheduleReviewReminder, startNotificationRouting } from './lib/mobile'
import { useAppStore } from './store/appStore'

const mobileMockState = vi.hoisted(() => ({
  notificationRoute: undefined as
    | ((target: { tab: 'home' | 'chat' | 'review' | 'mine'; scene: string; kind: string }) => void)
    | undefined,
}))

vi.mock('./lib/mobile', () => ({
  getRuntimeSurface: vi.fn(() => 'Web / PWA'),
  getNetworkStatus: vi.fn(async () => ({ connected: true, connectionType: 'wifi' })),
  readPreference: vi.fn(async () => null),
  savePreference: vi.fn(async () => undefined),
  scheduleReviewReminder: vi.fn(async () => undefined),
  scheduleReminder: vi.fn(async () => undefined),
  cancelReminder: vi.fn(async () => undefined),
  startNotificationRouting: vi.fn(async (callback) => {
    mobileMockState.notificationRoute = callback
    return vi.fn()
  }),
}))

vi.mock('./lib/api', () => ({
  getApiBaseUrl: vi.fn(async () => 'http://localhost:8000'),
  getHealth: vi.fn(async () => ({
    status: 'ok',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    active_provider_configured: true,
    configured_providers: 1,
  })),
  getDiagnostics: vi.fn(async () => ({
    status: 'ok',
    version: '0.1.0',
    server_time: 1_800_000_000,
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    configured_providers: 1,
    active_provider_configured: true,
    database: {
      connected: true,
      kind: 'sqlite',
      path_configured: true,
      journal_mode: 'wal',
      busy_timeout_ms: 5000,
      foreign_keys: true,
      record_enabled: true,
      page_count: 8,
      page_size: 4096,
      freelist_count: 1,
      schema_version: 1,
    },
    deployment_checks: [
      {
        key: 'model_credentials',
        label: 'Active model credentials',
        status: 'ok',
        detail: 'Active provider is callable.',
      },
      {
        key: 'cors',
        label: 'CORS origins',
        status: 'warn',
        detail: 'CORS still includes localhost/test origins.',
      },
    ],
  })),
  getReadiness: vi.fn(async () => ({
    status: 'ok',
    database_connected: true,
    schema_version: 1,
    expected_schema_version: 1,
    record_enabled: true,
  })),
  getModelProviders: vi.fn(async () => [
    {
      id: 'deepseek',
      label: 'DeepSeek',
      configured: true,
      active: true,
      base_url: 'https://api.deepseek.com',
      openai_compatible: true,
    },
    {
      id: 'qwen',
      label: 'Qwen / 通义千问',
      configured: false,
      active: false,
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      openai_compatible: true,
    },
  ]),
  getModelRuntimeConfig: vi.fn(async () => ({
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    customized: false,
    updated_at: null,
  })),
  getPromptConfigs: vi.fn(async () => [
    {
      key: 'procrastination',
      content: '行动必须在 3 分钟以内，先降低启动门槛，并返回 JSON。',
      customized: false,
      updated_at: null,
    },
    {
      key: 'daily_review',
      content: '总结今天状态，给明天一个小行动，并返回 JSON。',
      customized: false,
      updated_at: null,
    },
  ]),
  getServerProfileSummary: vi.fn(async () => ({
    total_records: 1,
    top_scenes: { creation: 1 },
    emotion_labels: ['stuck'],
    need_labels: ['start'],
    recent_patterns: ['最近有服务端记录。'],
    suggested_focus: '下一阶段优先照顾“start”这个需求。',
  })),
  getServerRecordStats: vi.fn(async () => ({
    total_records: 1,
    latest_created_at: 1_800_000_000,
    scene_counts: { creation: 1 },
    risk_counts: { 0: 1 },
    max_page_size: 200,
  })),
  getServerRecordPage: vi.fn(async () => ({
    records: [
      {
        id: 1,
        scene: 'creation',
        input: 'make a sketch',
        output: {
          reply_text: '先画一条线。',
          emotion_labels: ['stuck'],
          need_labels: ['start'],
          risk_level: 0,
          action_card: null,
          relationship_scripts: null,
          quick_replies: [],
        },
        risk_level: 0,
        created_at: 1_800_000_000,
      },
    ],
    total_records: 1,
    limit: 5,
    offset: 0,
    next_offset: null,
    has_more: false,
  })),
  getServerRecordCursorPage: vi.fn(async () => ({
    records: [
      {
        id: 1,
        scene: 'creation',
        input: 'make a sketch',
        output: {
          reply_text: '先画一条线。',
          emotion_labels: ['stuck'],
          need_labels: ['start'],
          risk_level: 0,
          action_card: null,
          relationship_scripts: null,
          quick_replies: [],
        },
        risk_level: 0,
        created_at: 1_800_000_000,
      },
    ],
    limit: 5,
    cursor: null,
    next_cursor: null,
    has_more: false,
  })),
  deleteServerRecord: vi.fn(async () => ({ deleted: 1 })),
  deleteServerRecords: vi.fn(async () => ({ deleted: 1 })),
  exportServerRecords: vi.fn(async () => ({
    exported_at: 1_800_000_000,
    total_records: 1,
    records: [
      {
        id: 1,
        scene: 'creation',
        input: 'make a sketch',
        output: {
          reply_text: '先画一条线。',
          emotion_labels: ['stuck'],
          need_labels: ['start'],
          risk_level: 0,
          action_card: null,
          relationship_scripts: null,
          quick_replies: [],
        },
        risk_level: 0,
        created_at: 1_800_000_000,
      },
    ],
  })),
  exportServerBackup: vi.fn(async () => ({
    exported_at: 1_800_000_000,
    schema_version: 1,
    max_record_limit: null,
    total_records: 1,
    records_included: 1,
    record_stats: {
      total_records: 1,
      latest_created_at: 1_800_000_000,
      scene_counts: { creation: 1 },
      risk_counts: { 0: 1 },
      max_page_size: 200,
    },
    prompt_overrides: [{ key: 'creation', content: 'Return JSON.', updated_at: 1_800_000_000 }],
    runtime_model_config: { provider: 'deepseek', model: 'deepseek-v4-flash', updated_at: 1_800_000_000 },
    records: [
      {
        id: 1,
        scene: 'creation',
        input: 'make a sketch',
        output: {
          reply_text: 'Draw one line.',
          emotion_labels: ['stuck'],
          need_labels: ['start'],
          risk_level: 0,
          action_card: null,
          relationship_scripts: null,
          quick_replies: [],
        },
        risk_level: 0,
        created_at: 1_800_000_000,
      },
    ],
  })),
  restoreServerBackup: vi.fn(async () => ({
    mode: 'merge',
    records_imported: 1,
    records_skipped: 0,
    prompt_overrides_imported: 1,
    runtime_model_config_imported: true,
    record_stats: {
      total_records: 1,
      latest_created_at: 1_800_000_000,
      scene_counts: { creation: 1 },
      risk_counts: { 0: 1 },
      max_page_size: 200,
    },
  })),
  runServerMaintenance: vi.fn(async () => ({
    optimized: true,
    vacuumed: false,
    records_pruned: 0,
    prune_before_timestamp: null,
    wal_checkpoint: [0, 0, 0],
    page_count_before: 8,
    page_count_after: 8,
    freelist_count_before: 2,
    freelist_count_after: 0,
    database_size_bytes_before: 32_768,
    database_size_bytes_after: 32_768,
  })),
  setApiBaseUrlOverride: vi.fn(async (value: string) => (value.startsWith('http') ? value : `http://${value}`)),
  updateModelRuntimeConfig: vi.fn(async (provider: string, model: string) => ({
    provider,
    model,
    customized: true,
    updated_at: 1_800_000_000,
  })),
  updatePromptConfig: vi.fn(async (key: string, content: string) => ({
    key,
    content,
    customized: true,
    updated_at: 1_800_000_000,
  })),
  requestCoachTurn: vi.fn(async () => ({
    reply_text: '先打开相关文件。',
    emotion_labels: ['stuck'],
    need_labels: ['start'],
    risk_level: 0,
    action_card: {
      title: '只打开相关文件',
      estimated_minutes: 1,
      difficulty: 'very_low',
      steps: ['打开文件'],
    },
    relationship_scripts: null,
    quick_replies: ['我做完了'],
  })),
}))

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

async function completeOnboarding(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '继续' }))
  await user.click(screen.getByRole('button', { name: '继续' }))
  await user.click(screen.getByRole('button', { name: '继续' }))
  await user.click(screen.getByRole('button', { name: '我知道了，开始' }))
}

describe('App', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    vi.mocked(readPreference).mockResolvedValue(null)
    vi.mocked(getModelProviders).mockResolvedValue([
      {
        id: 'deepseek',
        label: 'DeepSeek',
        configured: true,
        active: true,
        base_url: 'https://api.deepseek.com',
        openai_compatible: true,
      },
      {
        id: 'qwen',
        label: 'Qwen / 通义千问',
        configured: false,
        active: false,
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        openai_compatible: true,
      },
    ])
    mobileMockState.notificationRoute = undefined
    useAppStore.setState({
      tab: 'home',
      scene: 'procrastination',
      onboardingComplete: false,
      historyEnabled: true,
      serverRecordEnabled: true,
      profileEnabled: true,
      mainChallenge: 'procrastination',
      encouragementStyle: 'rational',
      appTheme: 'warm',
      fontDensity: 'comfortable',
      reminderEnabled: true,
      reminderTime: '21:30',
      apiBaseUrl: '',
    })
    await db.delete()
    await db.open()
  })

  it('shows onboarding before first use', async () => {
    renderApp()

    expect(await screen.findByText('首次引导')).toBeInTheDocument()
    expect(await screen.findByText('模型：deepseek-v4-flash / 已配置')).toBeInTheDocument()
    expect(screen.getByText('先把目标说小一点。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()
  })

  it('shows and dismisses the brand splash once per session', async () => {
    const user = userEvent.setup()
    renderApp()

    expect(await screen.findByText('Micro Action Coach')).toBeInTheDocument()
    expect(screen.getByText('先碰一下，就算开始。拖延、复盘、关系表达和低能量时刻，都先降到一个可行动的小版本。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '直接进入' }))

    await waitFor(() => expect(screen.queryByText('Micro Action Coach')).not.toBeInTheDocument())
    expect(window.sessionStorage.getItem('brandSplashSeen')).toBe('true')
  })

  it('schedules the default review reminder after onboarding', async () => {
    const user = userEvent.setup()
    renderApp()

    await completeOnboarding(user)

    await waitFor(() => expect(scheduleReviewReminder).toHaveBeenCalledWith('21:30'))
  })

  it('restores the daily review reminder for returning users', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => {
      if (key === 'onboardingComplete') return 'true'
      if (key === 'reminderTime') return '22:15'
      return null
    })

    renderApp()

    await waitFor(() => expect(scheduleReviewReminder).toHaveBeenCalledWith('22:15'))
  })

  it('opens safety support from the header', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByText('安全支持'))

    expect(screen.getByText('心理援助热线 12356')).toBeInTheDocument()
    expect(screen.getByText('紧急危险 110')).toBeInTheDocument()
    expect(screen.getByText('医疗急救 120')).toBeInTheDocument()
  })

  it('routes notification taps into the daily review tab', async () => {
    renderApp()

    await waitFor(() => expect(startNotificationRouting).toHaveBeenCalled())
    act(() => {
      mobileMockState.notificationRoute?.({ tab: 'review', scene: 'daily_review', kind: 'daily_review' })
    })

    expect(await screen.findByText('每日复盘')).toBeInTheDocument()
  })

  it('shows the daily loop status from the latest action and today review', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const now = Date.now()
    await saveActionTask({
      source: 'local',
      taskText: '写报告',
      reason: '太大了',
      actionCard: {
        title: '打开文件',
        estimated_minutes: 1,
        difficulty: 'low',
        steps: ['打开文档'],
      },
      status: 'completed',
      resultNote: '已经打开了文件',
      createdAt: now,
      updatedAt: now,
    })
    await saveDailyReview({
      mood: '松了一点',
      pressure: '报告',
      win: '打开了文件',
      tomorrow: '写标题',
      summary: '今天先接上启动感。',
      source: 'local',
      createdAt: now,
      updatedAt: now,
    })

    renderApp()

    expect(await screen.findByText('今日闭环')).toBeInTheDocument()
    expect(await screen.findByText('行动和复盘都接上了。')).toBeInTheDocument()
    expect(await screen.findByText('打开文件 · 1 分钟')).toBeInTheDocument()
    expect(await screen.findByText('明天的一小步：写标题')).toBeInTheDocument()
  })

  it('sends history preference with daily review requests', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'historyEnabled' ? 'false' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '复盘' }))
    await user.type(await screen.findByLabelText('主要情绪'), '有点累')
    await user.click(screen.getByRole('button', { name: '生成复盘总结' }))

    await waitFor(() =>
      expect(requestCoachTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          scene: 'daily_review',
          context: expect.objectContaining({ historyEnabled: false, serverRecordEnabled: true }),
        }),
      ),
    )
  })

  it('can disable server-side records while still calling AI', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))
    await user.click(await screen.findByRole('button', { name: '切换服务端记录' }))
    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: /我又拖延了/ }))
    await user.type(await screen.findByLabelText(/现在卡住的任务/), '写一个很短的草稿')
    await user.click(screen.getByRole('button', { name: '太大了' }))
    await user.click(screen.getByRole('button', { name: '生成 3 分钟行动' }))

    expect(savePreference).toHaveBeenCalledWith('serverRecordEnabled', 'false')
    await waitFor(() =>
      expect(requestCoachTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          scene: 'procrastination',
          context: expect.objectContaining({ historyEnabled: true, serverRecordEnabled: false }),
        }),
      ),
    )
    expect(await screen.findByText('只打开相关文件')).toBeInTheDocument()
  })

  it('requires a procrastination reason and lowers difficulty after missed action', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: /我又拖延了/ }))
    await user.type(await screen.findByLabelText(/现在卡住的任务/), '打开报告文档')
    expect(screen.getByRole('button', { name: '生成 3 分钟行动' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '怕做不好' }))
    await user.click(screen.getByRole('button', { name: '生成 3 分钟行动' }))
    await user.click(await screen.findByRole('button', { name: '我没做' }))

    expect(await screen.findByText(/已记录“我没做”/)).toBeInTheDocument()
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.actionTasks).toHaveLength(1)
      expect(exported.actionTasks[0]).toMatchObject({
        reason: '怕做不好',
        status: 'simplified',
        resultNote: '用户反馈没做，已自动降低难度。',
      })
      expect(exported.actionTasks[0].actionCard.estimated_minutes).toBe(1)
    })
  })

  it('saves a completed procrastination action and conversation locally', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: /我又拖延了/ }))
    await user.type(await screen.findByLabelText(/现在卡住的任务/), '打开报告文档')
    await user.click(screen.getByRole('button', { name: '怕做不好' }))
    await user.click(screen.getByRole('button', { name: '生成 3 分钟行动' }))
    await user.click(await screen.findByRole('button', { name: '我做完了' }))

    expect(await screen.findByText(/已记录完成/)).toBeInTheDocument()
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.records).toHaveLength(1)
      expect(exported.conversations).toHaveLength(1)
      expect(exported.messages).toHaveLength(2)
      expect(exported.actionTasks).toHaveLength(1)
      expect(exported.actionTasks[0]).toMatchObject({
        taskText: '打开报告文档',
        reason: '怕做不好',
        status: 'completed',
      })
    })
  })

  it('stores only a minimal risk event for high-risk procrastination input', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: /我又拖延了/ }))
    await user.type(await screen.findByLabelText(/现在卡住的任务/), '我想自杀，今晚已经准备了具体方法')
    await user.click(screen.getByRole('button', { name: '太大了' }))
    await user.click(screen.getByRole('button', { name: '生成 3 分钟行动' }))

    expect(await screen.findByText('心理援助热线 12356')).toBeInTheDocument()
    expect(requestCoachTurn).not.toHaveBeenCalled()
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.records).toEqual([])
      expect(exported.conversations).toEqual([])
      expect(exported.messages).toEqual([])
      expect(exported.actionTasks).toEqual([])
      expect(exported.riskEvents).toHaveLength(1)
      expect(exported.riskEvents[0]).toMatchObject({ scene: 'procrastination', riskLevel: 4 })
    })
  })

  it('does not save high-risk daily review text as an ordinary review', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '复盘' }))
    await user.type(await screen.findByLabelText('主要情绪'), '我想自杀，今晚已经准备了具体方法')
    await user.click(screen.getByRole('button', { name: '生成复盘总结' }))

    expect(await screen.findByText('心理援助热线 12356')).toBeInTheDocument()
    expect(requestCoachTurn).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '保存复盘' }))
    expect(await screen.findByText(/高风险内容不会保存为普通复盘/)).toBeInTheDocument()

    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.dailyReviews).toEqual([])
      expect(exported.records).toEqual([])
      expect(exported.conversations).toEqual([])
      expect(exported.messages).toEqual([])
      expect(exported.riskEvents).toHaveLength(1)
      expect(exported.riskEvents[0]).toMatchObject({ scene: 'daily_review', riskLevel: 4 })
    })
  })

  it('saves a daily review directly with a local template summary', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '复盘' }))
    await user.type(await screen.findByLabelText('压力源'), '会议太多')
    await user.type(await screen.findByLabelText('明天的一小步'), '只打开文档')
    await user.click(screen.getByRole('button', { name: '保存复盘' }))

    expect(requestCoachTurn).not.toHaveBeenCalled()
    expect(await screen.findByText('已保存今天的复盘。')).toBeInTheDocument()
    expect((await screen.findAllByText(/明天不需要证明什么/)).length).toBeGreaterThan(0)
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.dailyReviews).toHaveLength(1)
      expect(exported.dailyReviews[0]).toMatchObject({
        pressure: '会议太多',
        tomorrow: '只打开文档',
        source: 'local',
      })
      expect(exported.dailyReviews[0].summary).toContain('只打开文档')
    })
  })

  it('uses local fallback and still saves a daily review when active provider is not configured', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    vi.mocked(getModelProviders).mockResolvedValue([
      {
        id: 'deepseek',
        label: 'DeepSeek',
        configured: false,
        active: true,
        base_url: 'https://api.deepseek.com',
        openai_compatible: true,
      },
    ])
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '复盘' }))
    await user.type(await screen.findByLabelText('主要情绪'), '有点累')
    await user.click(screen.getByRole('button', { name: '生成复盘总结' }))

    expect(await screen.findByText(/后端当前模型还没有配置 API Key/)).toBeInTheDocument()
    expect(requestCoachTurn).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '保存复盘' }))

    expect(await screen.findByText('已保存今天的复盘。')).toBeInTheDocument()
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.dailyReviews).toHaveLength(1)
      expect(exported.dailyReviews[0]).toMatchObject({
        mood: '有点累',
        source: 'local',
      })
      expect(exported.dailyReviews[0].summary).toContain('后端当前模型还没有配置 API Key')
    })
  })

  it('shows model provider status in mine tab', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))

    expect(await screen.findByText('模型代理')).toBeInTheDocument()
    expect(screen.getAllByText('DeepSeek').length).toBeGreaterThan(0)
    expect(screen.getByText('当前')).toBeInTheDocument()
    expect(screen.getByText('已配置')).toBeInTheDocument()
  })

  it('can update runtime API base URL in mine tab', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))
    const input = await screen.findByLabelText('API Base URL')
    await user.clear(input)
    await user.type(input, '192.168.1.5:8000')
    await user.click(screen.getByRole('button', { name: '保存并重连' }))

    expect(setApiBaseUrlOverride).toHaveBeenCalledWith('192.168.1.5:8000')
    await waitFor(() => expect(getDiagnostics).toHaveBeenCalled())
    expect(await screen.findByText(/后端诊断完成/)).toBeInTheDocument()
  })

  it('runs backend diagnostics in mine tab', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))
    await user.click(await screen.findByRole('button', { name: '诊断连接' }))

    expect(getDiagnostics).toHaveBeenCalled()
    expect(getReadiness).toHaveBeenCalled()
    expect(await screen.findByText('后端诊断')).toBeInTheDocument()
    expect(screen.getByText('0.1.0')).toBeInTheDocument()
    expect(screen.getByText('readyz')).toBeInTheDocument()
    expect(screen.getByText('ok · schema v1/1')).toBeInTheDocument()
    expect(screen.getByText('已连接 · wal')).toBeInTheDocument()
    expect(screen.getByText('DB pages')).toBeInTheDocument()
    expect(screen.getByText('8 x 4096B')).toBeInTheDocument()
    expect(screen.getByText('free pages')).toBeInTheDocument()
    expect(screen.getByText('开启保存')).toBeInTheDocument()
    expect(screen.getByText('部署预检')).toBeInTheDocument()
    expect(screen.getByText('Active model credentials')).toBeInTheDocument()
    expect(screen.getByText('CORS origins')).toBeInTheDocument()
  })

  it('can update runtime model config in mine tab', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))
    const modelInput = await screen.findByLabelText('Model')
    await user.clear(modelInput)
    await user.type(modelInput, 'deepseek-test-model')
    await user.click(screen.getByRole('button', { name: '保存模型配置' }))

    expect(updateModelRuntimeConfig).toHaveBeenCalledWith('deepseek', 'deepseek-test-model', '')
    expect(await screen.findByText('已切换模型：deepseek / deepseek-test-model')).toBeInTheDocument()
  })

  it('can update prompt config in mine tab', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))
    const promptInput = await screen.findByLabelText('提示词内容')
    await user.clear(promptInput)
    await user.type(promptInput, '只允许生成 30 秒版本的行动，并返回 JSON。')
    await user.click(screen.getByRole('button', { name: '保存提示词' }))

    expect(updatePromptConfig).toHaveBeenCalledWith(
      'procrastination',
      '只允许生成 30 秒版本的行动，并返回 JSON。',
      '',
    )
    expect(await screen.findByText('已更新 拖延急救 的提示词。')).toBeInTheDocument()
  })

  it('shows and clears server records in mine tab', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))

    expect(await screen.findByText('服务端数据')).toBeInTheDocument()
    expect(screen.getByText('make a sketch')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清理服务端记录' }))

    expect(deleteServerRecords).toHaveBeenCalledWith('')
    expect(await screen.findByText('已清理 1 条服务端记录。')).toBeInTheDocument()
  })

  it('deletes a single server record in mine tab', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))

    expect(await screen.findByText('make a sketch')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '删除服务端记录' }))

    expect(deleteServerRecord).toHaveBeenCalledWith(1, '')
    expect(await screen.findByText('已删除这条服务端记录。')).toBeInTheDocument()
  })

  it('exports server records from mine tab', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:server-records'),
      revokeObjectURL: vi.fn(),
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))
    await user.click(await screen.findByRole('button', { name: '导出当前筛选' }))

    expect(exportServerRecords).toHaveBeenCalledWith(undefined, '')
    expect(clickSpy).toHaveBeenCalled()
    expect(await screen.findByText('已导出 1 条服务端记录。')).toBeInTheDocument()
  })

  it('exports full server backup from mine tab', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:server-backup'),
      revokeObjectURL: vi.fn(),
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const user = userEvent.setup()
    renderApp()

    if (!screen.queryByText('服务端数据')) {
      await user.click(await screen.findByRole('button', { name: '我的' }))
    }
    await user.click(await screen.findByRole('button', { name: '导出完整备份' }))

    expect(exportServerBackup).toHaveBeenCalledWith('')
    expect(clickSpy).toHaveBeenCalled()
    expect(await screen.findByText(/已导出完整服务端备份/)).toBeInTheDocument()
  })

  it('imports full server backup from mine tab', async () => {
    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    const user = userEvent.setup()
    const backup = {
      exported_at: 1_800_000_000,
      schema_version: 1,
      max_record_limit: null,
      total_records: 1,
      records_included: 1,
      record_stats: {
        total_records: 1,
        latest_created_at: 1_800_000_000,
        scene_counts: { creation: 1 },
        risk_counts: { 0: 1 },
        max_page_size: 200,
      },
      prompt_overrides: [{ key: 'creation', content: 'Return JSON.', updated_at: 1_800_000_000 }],
      runtime_model_config: { provider: 'deepseek', model: 'deepseek-v4-flash', updated_at: 1_800_000_000 },
      records: [],
    }
    renderApp()

    if (!screen.queryByText('服务端数据')) {
      await user.click(await screen.findByRole('button', { name: '我的' }))
    }
    await user.click(await screen.findByRole('button', { name: '导入完整备份' }))
    const input = await screen.findByLabelText('选择服务端备份 JSON')
    await user.upload(input, new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' }))

    expect(inputClickSpy).toHaveBeenCalled()
    expect(restoreServerBackup).toHaveBeenCalledWith(expect.objectContaining({ schema_version: 1 }), 'merge', '')
    expect(await screen.findByText(/已合并导入服务端备份/)).toBeInTheDocument()
  })

  it('runs server database maintenance from mine tab', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    if (!screen.queryByText('服务端数据')) {
      await user.click(await screen.findByRole('button', { name: '我的' }))
    }
    await user.click(await screen.findByRole('button', { name: '优化数据库' }))

    expect(runServerMaintenance).toHaveBeenCalledWith('')
    expect(await screen.findByText(/已优化服务端 SQLite/)).toBeInTheDocument()
  })

  it('prunes old server records from mine tab', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    vi.mocked(runServerMaintenance).mockResolvedValueOnce({
      optimized: true,
      vacuumed: false,
      records_pruned: 3,
      prune_before_timestamp: 1_790_000_000,
      wal_checkpoint: [0, 0, 0],
      page_count_before: 8,
      page_count_after: 7,
      freelist_count_before: 2,
      freelist_count_after: 0,
      database_size_bytes_before: 32_768,
      database_size_bytes_after: 28_672,
    })
    const user = userEvent.setup()
    renderApp()

    if (!screen.queryByText('服务端数据')) {
      await user.click(await screen.findByRole('button', { name: '我的' }))
    }
    await user.click(await screen.findByRole('button', { name: '清理 90 天前记录' }))

    expect(runServerMaintenance).toHaveBeenCalledWith('', false, 90)
    expect(await screen.findByText(/已清理/)).toBeInTheDocument()
    expect(await screen.findByText(/3 条/)).toBeInTheDocument()
  })

  it('clears local data from mine tab after confirmation', async () => {
    const now = Date.now()
    await saveLocalRecord({
      scene: 'creation',
      input: 'make one sketch',
      result: {
        reply_text: 'draw one line',
        emotion_labels: ['tired'],
        need_labels: ['agency'],
        risk_level: 0,
        action_card: null,
        relationship_scripts: null,
        quick_replies: [],
      },
      createdAt: now,
    })
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))
    await user.click(await screen.findByRole('button', { name: '清理本地数据' }))

    expect(await screen.findByText('已清理本地记录、对话、行动卡、复盘历史、切回创作计划、鼓励短句库、关系表达草稿和安全事件。')).toBeInTheDocument()
    const exported = await exportAllData()
    expect(exported.records).toEqual([])
  })

  it('imports local data JSON from mine tab', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    const user = userEvent.setup()
    const now = Date.now()
    const file = new File(
      [
        JSON.stringify({
          exportedAt: new Date(now).toISOString(),
          records: [
            {
              id: 77,
              scene: 'creation',
              input: 'imported local sketch',
              result: {
                reply_text: 'imported reply',
                emotion_labels: ['tired'],
                need_labels: ['agency'],
                risk_level: 0,
                action_card: null,
                relationship_scripts: null,
                quick_replies: [],
              },
              createdAt: now,
            },
          ],
          conversations: [],
          messages: [],
          actionTasks: [],
          dailyReviews: [],
          creationPlans: [],
          encouragementPhrases: [],
          relationshipDrafts: [],
          riskEvents: [],
        }),
      ],
      'micro-action-coach-export.json',
      { type: 'application/json' },
    )
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))
    await user.upload(await screen.findByLabelText('选择本地数据 JSON'), file)

    expect(confirmSpy).toHaveBeenCalled()
    expect(await screen.findByText(/已导入本地数据：1 条记录/)).toBeInTheDocument()
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.records).toHaveLength(1)
      expect(exported.records[0]).toMatchObject({ id: 77, input: 'imported local sketch' })
    })
  })

  it('filters and deletes individual local records in mine tab', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const now = Date.now()
    await saveLocalRecord({
      scene: 'creation',
      input: 'make one sketch',
      result: {
        reply_text: 'draw one line',
        emotion_labels: ['tired'],
        need_labels: ['agency'],
        risk_level: 0,
        action_card: null,
        relationship_scripts: null,
        quick_replies: [],
      },
      createdAt: now,
    })
    await saveLocalRecord({
      scene: 'relationship',
      input: 'relationship moment',
      result: {
        reply_text: 'separate fact from guess',
        emotion_labels: ['uncertain'],
        need_labels: ['boundary'],
        risk_level: 0,
        action_card: null,
        relationship_scripts: null,
        quick_replies: [],
      },
      createdAt: now + 1,
    })
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))
    expect(await screen.findByText('本地记录管理')).toBeInTheDocument()
    await user.selectOptions(await screen.findByLabelText('本地记录场景'), 'creation')
    expect(await screen.findByText('make one sketch')).toBeInTheDocument()
    expect(screen.queryByText('relationship moment')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '删除本地记录' }))

    expect(await screen.findByText('已删除这条本地记录。')).toBeInTheDocument()
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.records).toHaveLength(1)
      expect(exported.records[0].scene).toBe('relationship')
    })
  })

  it('updates and deletes local action cards in mine tab', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    window.sessionStorage.setItem('brandSplashSeen', 'true')
    const now = Date.now()
    await saveActionTask({
      source: 'local',
      taskText: '写一个报告提纲',
      reason: '太大了',
      actionCard: {
        title: '只打开提纲文件',
        estimated_minutes: 1,
        difficulty: 'very_low',
        steps: ['找到提纲文件', '打开它'],
      },
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
    })
    await saveActionTask({
      source: 'local',
      taskText: '整理一张素材卡',
      reason: '创造动力',
      actionCard: {
        title: '写 50 个字',
        estimated_minutes: 3,
        difficulty: 'low',
        steps: ['打开备忘录', '写 50 个字'],
      },
      status: 'proposed',
      createdAt: now + 1,
      updatedAt: now + 1,
    })
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))
    expect(await screen.findByText('行动卡历史')).toBeInTheDocument()
    expect(await screen.findByText('只打开提纲文件')).toBeInTheDocument()
    expect(await screen.findByText('写一个报告提纲')).toBeInTheDocument()

    const completeButtons = await screen.findAllByRole('button', { name: '标记完成' })
    await user.click(completeButtons[0])
    expect(await screen.findByText('已把这张行动卡标记为完成。')).toBeInTheDocument()

    const simplifyButtons = await screen.findAllByRole('button', { name: '换更轻版本' })
    const simplifyButton = simplifyButtons[simplifyButtons.length - 1]
    await user.click(simplifyButton)
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.actionTasks.some((task) => task.status === 'simplified')).toBe(true)
    })

    const deleteButtons = await screen.findAllByRole('button', { name: '删除行动卡' })
    await user.click(deleteButtons[1])
    expect(await screen.findByText('已删除这张行动卡。')).toBeInTheDocument()
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.actionTasks).toHaveLength(1)
      expect(exported.actionTasks.some((task) => task.status === 'completed')).toBe(true)
      expect(exported.actionTasks.some((task) => task.status === 'simplified')).toBe(false)
    })
  })

  it('loads more server records in mine tab', async () => {
    vi.mocked(getServerRecordStats).mockResolvedValueOnce({
      total_records: 12,
      latest_created_at: 1_800_000_000,
      scene_counts: { creation: 12 },
      risk_counts: { 0: 12 },
      max_page_size: 200,
    })
    vi.mocked(getServerRecordCursorPage)
      .mockResolvedValueOnce({
        records: Array.from({ length: 5 }, (_, index) => ({
          id: index + 1,
          scene: 'creation',
          input: `make a sketch ${index}`,
          output: {
            reply_text: '先画一条线。',
            emotion_labels: ['stuck'],
            need_labels: ['start'],
            risk_level: 0,
            action_card: null,
            relationship_scripts: null,
            quick_replies: [],
          },
          risk_level: 0,
          created_at: 1_800_000_000 - index,
        })),
        limit: 5,
        cursor: null,
        next_cursor: '1799999996:5',
        has_more: true,
      })
      .mockResolvedValueOnce({
        records: [],
        limit: 5,
        cursor: '1799999996:5',
        next_cursor: null,
        has_more: false,
      })
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))
    await user.click(await screen.findByRole('button', { name: '加载更多' }))

    await waitFor(() => expect(getServerRecordCursorPage).toHaveBeenCalledWith(5, '1799999996:5', undefined))
  })

  it('filters server records by scene in mine tab', async () => {
    vi.mocked(getServerRecordStats).mockResolvedValueOnce({
      total_records: 12,
      latest_created_at: 1_800_000_000,
      scene_counts: { creation: 7, procrastination: 5 },
      risk_counts: { 0: 12 },
      max_page_size: 200,
    })
    vi.mocked(getServerRecordCursorPage)
      .mockResolvedValueOnce({
        records: [],
        limit: 5,
        cursor: null,
        next_cursor: null,
        has_more: false,
      })
      .mockResolvedValueOnce({
        records: [
          {
            id: 10,
            scene: 'creation',
            input: 'make a small sketch',
            output: {
              reply_text: '先画一条线。',
              emotion_labels: ['stuck'],
              need_labels: ['start'],
              risk_level: 0,
              action_card: null,
              relationship_scripts: null,
              quick_replies: [],
            },
            risk_level: 0,
            created_at: 1_800_000_000,
          },
        ],
        limit: 5,
        cursor: null,
        next_cursor: null,
        has_more: false,
      })
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))
    await user.selectOptions(await screen.findByLabelText('服务端记录场景'), 'creation')

    await waitFor(() => expect(getServerRecordCursorPage).toHaveBeenCalledWith(5, '', 'creation'))
    expect(await screen.findByText('make a small sketch')).toBeInTheDocument()
  })

  it('shows a PWA update prompt and applies the update', async () => {
    const update = vi.fn(async () => undefined)
    const user = userEvent.setup()
    renderApp()

    act(() => {
      window.dispatchEvent(new CustomEvent('micro-action-coach:pwa-update', { detail: update }))
    })

    expect(await screen.findByText('发现新版本')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '立即更新' }))

    expect(update).toHaveBeenCalledWith(true)
  })

  it('searches and edits daily review history', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    await saveDailyReview({
      mood: '有点累',
      pressure: '会议太多',
      win: '写完一段',
      tomorrow: '打开文档',
      summary: '旧总结：会议很多，但还是推进了一点。',
      source: 'local',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '复盘' }))
    await user.type(await screen.findByLabelText('搜索'), '会议')
    expect(await screen.findByText(/旧总结/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '编辑' }))
    expect(await screen.findByLabelText('主要情绪')).toHaveValue('有点累')
    await user.clear(screen.getByLabelText('小胜利'))
    await user.type(screen.getByLabelText('小胜利'), '修改后的小胜利')
    await user.click(screen.getByRole('button', { name: '更新复盘' }))

    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.dailyReviews[0].win).toBe('修改后的小胜利')
    })
  })

  it('sends structured encouragement fields to the model proxy', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: /我需要一点勇气/ }))
    await user.type(await screen.findByLabelText('支持我的证据'), '我上周完成过一个小版本')
    await user.type(await screen.findByLabelText('我希望听到的话'), '慢一点也算前进')
    await user.click(screen.getByRole('button', { name: '生成教练回复' }))

    await waitFor(() =>
      expect(requestCoachTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          scene: 'encouragement',
          text: expect.stringContaining('支持我的证据：我上周完成过一个小版本'),
          context: expect.objectContaining({ selectedContext: expect.any(String), encouragementStyle: 'rational' }),
        }),
      ),
    )
  })

  it('sends structured creation fields to the model proxy', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: /我不想刷手机了/ }))
    await user.click(await screen.findByRole('button', { name: '写 50 个字' }))
    await user.selectOptions(await screen.findByLabelText('刷手机/空转时长'), '30-60 分钟')
    await user.selectOptions(await screen.findByLabelText('当前能量等级'), '2')
    await user.type(await screen.findByPlaceholderText('写下你刚刚在刷什么、刷了多久、现在的能量大概几分。'), '一直在刷短视频，不想打开草稿')
    await user.click(screen.getByRole('button', { name: '生成教练回复' }))

    await waitFor(() =>
      expect(requestCoachTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          scene: 'creation',
          text: expect.stringContaining('切换目标：写 50 个字'),
          context: expect.objectContaining({ selectedContext: '写 50 个字', encouragementStyle: 'rational' }),
        }),
      ),
    )
    const request = vi.mocked(requestCoachTurn).mock.calls.at(-1)?.[0]
    expect(request?.text).toContain('刚才刷手机/空转时长：30-60 分钟')
    expect(request?.text).toContain('当前能量等级：2/5')
    expect(request?.text).toContain('我刚才在刷或逃避的内容：一直在刷短视频，不想打开草稿')
  })

  it.each([
    {
      cardName: /我需要一点勇气/,
      inputLabel: '支持我的证据',
      scene: 'encouragement',
    },
    {
      cardName: /我不想刷手机了/,
      inputPlaceholder: '写下你刚刚在刷什么、刷了多久、现在的能量大概几分。',
      scene: 'creation',
    },
  ] as const)('stores only a minimal risk event for high-risk $scene input', async ({ cardName, inputLabel, inputPlaceholder, scene }) => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: cardName }))
    const input = inputLabel ? await screen.findByLabelText(inputLabel) : await screen.findByPlaceholderText(inputPlaceholder)
    await user.type(input, '今晚我想自杀，已经准备了具体方法')
    await user.click(screen.getByRole('button', { name: '生成教练回复' }))

    expect(await screen.findByText('心理援助热线 12356')).toBeInTheDocument()
    expect(requestCoachTurn).not.toHaveBeenCalled()
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.records).toEqual([])
      expect(exported.conversations).toEqual([])
      expect(exported.messages).toEqual([])
      expect(exported.actionTasks).toEqual([])
      expect(exported.creationPlans).toEqual([])
      expect(exported.encouragementPhrases).toEqual([])
      expect(exported.relationshipDrafts).toEqual([])
      expect(exported.riskEvents).toHaveLength(1)
      expect(exported.riskEvents[0]).toMatchObject({ scene, riskLevel: 4 })
    })
  })

  it('saves, completes, and deletes a creation switch-back plan', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    window.sessionStorage.setItem('brandSplashSeen', 'true')
    vi.mocked(requestCoachTurn).mockResolvedValueOnce({
      reply_text: '先切回一个很小的主动输出。',
      emotion_labels: ['tired'],
      need_labels: ['agency'],
      risk_level: 0,
      action_card: {
        title: '写 50 个字',
        estimated_minutes: 3,
        difficulty: 'low',
        steps: ['打开备忘录', '写 50 个字'],
      },
      relationship_scripts: null,
      quick_replies: ['好一点', '没变化'],
    })
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: /我不想刷手机了/ }))
    await user.selectOptions(await screen.findByLabelText('刷手机/空转时长'), '30-60 分钟')
    await user.selectOptions(await screen.findByLabelText('当前能量等级'), '2')
    await user.type(await screen.findByPlaceholderText('写下你刚刚在刷什么、刷了多久、现在的能量大概几分。'), '一直在刷短视频，不想打开草稿')
    await user.click(screen.getByRole('button', { name: '生成教练回复' }))
    await user.click(await screen.findByRole('button', { name: '保存切回计划' }))

    expect(await screen.findByText(/已保存切回创作计划/)).toBeInTheDocument()
    expect((await screen.findAllByText('写 50 个字')).length).toBeGreaterThan(0)
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.creationPlans).toHaveLength(1)
      expect(exported.creationPlans[0]).toMatchObject({
        inputSummary: expect.stringContaining('一直在刷短视频'),
        idleDuration: '30-60 分钟',
        energyLevel: '2',
        status: 'proposed',
      })
    })

    await user.click(screen.getByRole('button', { name: '计划做了一点' }))
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.creationPlans[0].status).toBe('completed')
    })

    await user.click(screen.getByRole('button', { name: '删除计划' }))
    expect(await screen.findByText('已删除这条切回创作计划。')).toBeInTheDocument()
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.creationPlans).toEqual([])
    })
  })

  it('saves, reuses, and deletes encouragement phrases in mine tab', async () => {
    const preferences: Record<string, string> = { onboardingComplete: 'true' }
    vi.mocked(readPreference).mockImplementation(async (key) => preferences[key] ?? null)
    vi.mocked(savePreference).mockImplementation(async (key, value) => {
      preferences[key] = value
    })
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: /我需要一点勇气/ }))
    await user.type(await screen.findByLabelText('我希望听到的话'), '慢一点也算前进')
    await user.click(screen.getByRole('button', { name: '生成教练回复' }))
    await user.click(await screen.findByRole('button', { name: '保存鼓励短句' }))

    expect(savePreference).toHaveBeenCalledWith('savedEncouragementPhrase', '慢一点也算前进')
    expect(await screen.findByText(/已保存这句鼓励短句/)).toBeInTheDocument()
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.encouragementPhrases).toHaveLength(1)
      expect(exported.encouragementPhrases[0]).toMatchObject({
        phrase: '慢一点也算前进',
        style: 'rational',
      })
    })
    await user.click(await screen.findByRole('button', { name: '我的' }))
    expect(await screen.findByText('鼓励短句')).toBeInTheDocument()
    expect(await screen.findByText('鼓励短句库')).toBeInTheDocument()
    expect((await screen.findAllByText('慢一点也算前进')).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: '设为常用' }))
    expect(savePreference).toHaveBeenCalledWith('savedEncouragementPhrase', '慢一点也算前进')
    expect(await screen.findByText('已设为当前常用鼓励短句。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '清除短句' }))
    expect(savePreference).toHaveBeenCalledWith('savedEncouragementPhrase', '')
    expect(await screen.findByText('已清除保存的鼓励短句。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '删除短句' }))
    expect(await screen.findByText('已删除这句鼓励短句。')).toBeInTheDocument()
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.encouragementPhrases).toEqual([])
    })
  })

  it('lets generic coach action cards be marked as a lighter version', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    vi.mocked(requestCoachTurn).mockResolvedValueOnce({
      reply_text: '先切回一个很小的主动输出。',
      emotion_labels: ['tired'],
      need_labels: ['agency'],
      risk_level: 0,
      action_card: {
        title: '写 50 个字',
        estimated_minutes: 3,
        difficulty: 'low',
        steps: ['打开备忘录', '写 50 个字'],
      },
      relationship_scripts: null,
      quick_replies: ['好一点', '没变化'],
    })
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: /我不想刷手机了/ }))
    await user.type(await screen.findByPlaceholderText('写下你刚刚在刷什么、刷了多久、现在的能量大概几分。'), '刷了短视频半小时')
    await user.click(screen.getByRole('button', { name: '生成教练回复' }))
    await user.click(await screen.findByRole('button', { name: '换更轻版本' }))

    await waitFor(async () => {
      const exported = await exportAllData()
      const simplifiedTask = exported.actionTasks.find((task) => task.reason === '创造动力' && task.status === 'simplified')
      expect(simplifiedTask).toMatchObject({
        reason: '创造动力',
        status: 'simplified',
      })
      expect(simplifiedTask?.actionCard).toMatchObject({
        title: '更轻版本：打开备忘录',
        estimated_minutes: 1,
        difficulty: 'very_low',
      })
    })
  })

  it('continues a selected conversation instead of creating a new one', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const now = Date.now()
    const conversationId = await saveConversationTurn(
      {
        scene: 'encouragement',
        title: '旧鼓励会话',
        createdAt: now,
        updatedAt: now,
      },
      [
        { role: 'user', content: '旧问题：我怕开始', riskLevel: 0, createdAt: now },
        { role: 'assistant', content: '旧回复：先做一个小版本', riskLevel: 0, createdAt: now + 1 },
      ],
    )
    useAppStore.setState({ tab: 'chat', scene: 'encouragement' })
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByText('旧鼓励会话'))
    expect(await screen.findByText('正在继续此对话')).toBeInTheDocument()
    await user.type(await screen.findByLabelText('支持我的证据'), '我已经打开了文档')
    await user.click(screen.getByRole('button', { name: '生成教练回复' }))

    await waitFor(() =>
      expect(requestCoachTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          scene: 'encouragement',
          context: expect.objectContaining({
            conversationId,
            recentMessages: expect.arrayContaining([expect.objectContaining({ content: '旧问题：我怕开始' })]),
          }),
        }),
      ),
    )
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.conversations).toHaveLength(1)
      expect(exported.messages).toHaveLength(4)
    })
  })

  it('clears selected conversation after delete or new conversation', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const now = Date.now()
    const conversationId = await saveConversationTurn(
      {
        scene: 'encouragement',
        title: '准备删除的鼓励会话',
        createdAt: now,
        updatedAt: now,
      },
      [
        { role: 'user', content: '旧问题：我怕开始', riskLevel: 0, createdAt: now },
        { role: 'assistant', content: '旧回复：先做一个小版本', riskLevel: 0, createdAt: now + 1 },
      ],
    )
    useAppStore.setState({ tab: 'chat', scene: 'encouragement' })
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByText('准备删除的鼓励会话'))
    expect(await screen.findByText('正在继续此对话')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(screen.queryByText('准备删除的鼓励会话')).not.toBeInTheDocument())
    expect(screen.queryByText('正在继续此对话')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新建对话' }))
    await user.type(await screen.findByLabelText('支持我的证据'), '我已经打开了文档')
    await user.click(screen.getByRole('button', { name: '生成教练回复' }))

    await waitFor(() =>
      expect(requestCoachTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          scene: 'encouragement',
          context: expect.not.objectContaining({ conversationId }),
        }),
      ),
    )
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.conversations).toHaveLength(1)
      expect(exported.messages).toHaveLength(2)
      expect(exported.conversations[0].id).not.toBe(conversationId)
    })
  })

  it('searches and filters conversation history', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const now = Date.now()
    await saveConversationTurn(
      {
        scene: 'creation',
        title: '短视频切换会话',
        createdAt: now,
        updatedAt: now,
      },
      [
        { role: 'user', content: '我刷了短视频半小时', riskLevel: 0, createdAt: now },
        { role: 'assistant', content: '先写 50 个字。', riskLevel: 0, createdAt: now + 1 },
      ],
    )
    await saveConversationTurn(
      {
        scene: 'relationship',
        title: '晚间沟通会话',
        createdAt: now + 2,
        updatedAt: now + 2,
      },
      [
        { role: 'user', content: '对方临时取消', riskLevel: 0, createdAt: now + 2 },
        { role: 'assistant', content: '先分清事实和猜测。', riskLevel: 0, createdAt: now + 3 },
      ],
    )
    useAppStore.setState({ tab: 'chat', scene: 'encouragement' })
    const user = userEvent.setup()
    renderApp()

    expect(await screen.findByText('晚间沟通会话')).toBeInTheDocument()
    expect(screen.getByText('短视频切换会话')).toBeInTheDocument()
    expect(screen.getByText('2/2 条')).toBeInTheDocument()

    await user.type(screen.getByLabelText('搜索对话'), '临时取消')
    expect(await screen.findByText('晚间沟通会话')).toBeInTheDocument()
    expect(screen.queryByText('短视频切换会话')).not.toBeInTheDocument()
    expect(screen.getByText('1/2 条')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('搜索对话'))
    await user.selectOptions(screen.getByLabelText('对话场景'), 'creation')
    expect(await screen.findByText('短视频切换会话')).toBeInTheDocument()
    expect(screen.queryByText('晚间沟通会话')).not.toBeInTheDocument()
  })

  it('does not send selected conversation history when profile context is disabled', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => {
      if (key === 'onboardingComplete') return 'true'
      if (key === 'profileEnabled') return 'false'
      return null
    })
    const now = Date.now()
    await saveConversationTurn(
      {
        scene: 'encouragement',
        title: '旧鼓励会话',
        createdAt: now,
        updatedAt: now,
      },
      [
        { role: 'user', content: '旧问题：我怕开始', riskLevel: 0, createdAt: now },
        { role: 'assistant', content: '旧回复：先做一个小版本', riskLevel: 0, createdAt: now + 1 },
      ],
    )
    useAppStore.setState({ tab: 'chat', scene: 'encouragement' })
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByText('旧鼓励会话'))
    await user.type(await screen.findByLabelText('支持我的证据'), '我已经打开了文档')
    await user.click(screen.getByRole('button', { name: '生成教练回复' }))

    await waitFor(() => expect(requestCoachTurn).toHaveBeenCalled())
    const request = vi.mocked(requestCoachTurn).mock.calls.at(-1)?.[0]
    expect(request?.context).toMatchObject({ historyEnabled: true, profileEnabled: false })
    expect(request?.context).not.toHaveProperty('conversationId')
    expect(request?.context).not.toHaveProperty('recentMessages')
  })

  it('sends relationship fact and need fields to the model proxy', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: /帮我分析一段关系/ }))
    await user.type(await screen.findByLabelText('事实'), '对方连续两次临时取消')
    await user.type(await screen.findByLabelText('需要/边界'), '我需要提前一天确认')
    await user.click(screen.getByRole('button', { name: '生成教练回复' }))

    await waitFor(() =>
      expect(requestCoachTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          scene: 'relationship',
          text: expect.stringContaining('事实：对方连续两次临时取消'),
        }),
      ),
    )
    expect(requestCoachTurn).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('我的需要/边界：我需要提前一天确认') }))
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.records.some((record) => record.scene === 'relationship')).toBe(true)
      expect(exported.actionTasks.some((task) => task.reason === '人际关系分析')).toBe(true)
    })
  })

  it('stores only a minimal risk event for high-risk relationship input', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: /帮我分析一段关系/ }))
    await user.type(await screen.findByLabelText('事实'), '今晚我想自杀，已经准备了具体方法')
    await user.click(screen.getByRole('button', { name: '生成教练回复' }))

    expect(await screen.findByText('心理援助热线 12356')).toBeInTheDocument()
    expect(requestCoachTurn).not.toHaveBeenCalled()
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.records).toEqual([])
      expect(exported.conversations).toEqual([])
      expect(exported.messages).toEqual([])
      expect(exported.actionTasks).toEqual([])
      expect(exported.relationshipDrafts).toEqual([])
      expect(exported.riskEvents).toHaveLength(1)
      expect(exported.riskEvents[0]).toMatchObject({ scene: 'relationship', riskLevel: 4 })
    })
  })

  it('saves relationship expression drafts locally', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    vi.mocked(requestCoachTurn).mockResolvedValueOnce({
      reply_text: '先把事实和猜测分开，再选一版表达。',
      emotion_labels: ['uncertain'],
      need_labels: ['boundary'],
      risk_level: 0,
      action_card: null,
      relationship_scripts: {
        gentle: '我有点在意这件事，想和你确认一下。',
        direct: '我需要提前一天确认安排，否则我会很被动。',
        boundary: '如果临时取消成为常态，我会重新安排自己的时间。',
      },
      quick_replies: [],
    })
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: /帮我分析一段关系/ }))
    await user.type(await screen.findByLabelText('事实'), '对方连续两次临时取消')
    await user.type(await screen.findByLabelText('需要/边界'), '我需要提前一天确认')
    await user.click(screen.getByRole('button', { name: '生成教练回复' }))
    await user.click(await screen.findByRole('button', { name: '存为温和版草稿' }))

    expect(await screen.findByText('已保存温和版表达草稿。')).toBeInTheDocument()
    await waitFor(async () => {
      const exported = await exportAllData()
      expect(exported.relationshipDrafts).toHaveLength(1)
      expect(exported.relationshipDrafts[0]).toMatchObject({
        selectedVersion: 'gentle',
        gentle: '我有点在意这件事，想和你确认一下。',
      })
    })
  })

  it('updates visual theme and font density preferences in mine tab', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '我的' }))
    expect(await screen.findByText('主题')).toBeInTheDocument()
    await user.selectOptions(document.getElementById('app-theme') as HTMLSelectElement, 'calm')
    await user.selectOptions(document.getElementById('font-density') as HTMLSelectElement, 'large')

    expect(savePreference).toHaveBeenCalledWith('appTheme', 'calm')
    expect(savePreference).toHaveBeenCalledWith('fontDensity', 'large')
    await waitFor(() => expect(document.querySelector('main')?.className).toContain('theme-calm'))
    expect(document.querySelector('main')?.className).toContain('density-large')
    expect(await screen.findByText('关于与免责声明')).toBeInTheDocument()
    expect(screen.getByText(/不是心理治疗/)).toBeInTheDocument()
  })

  it('schedules relationship cooldown reminders from relationship results', async () => {
    vi.mocked(readPreference).mockImplementation(async (key) => (key === 'onboardingComplete' ? 'true' : null))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '首页' }))
    await user.click(await screen.findByRole('button', { name: /帮我分析一段关系/ }))
    await user.type(await screen.findByLabelText('事实'), '对方连续两次临时取消')
    await user.click(screen.getByRole('button', { name: '生成教练回复' }))
    await user.click(await screen.findByRole('button', { name: '设置冷静提醒' }))

    expect(scheduleReminder).toHaveBeenCalledWith('relationship_cooldown', '20:30')
    expect(await screen.findByText(/已设置 20:30 关系冷静提醒/)).toBeInTheDocument()
  })
})
