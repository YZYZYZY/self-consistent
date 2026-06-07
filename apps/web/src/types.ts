export type CoachScene =
  | 'procrastination'
  | 'encouragement'
  | 'creation'
  | 'relationship'
  | 'daily_review'

export type AppTab = 'home' | 'chat' | 'review' | 'mine'
export type RiskLevel = 0 | 1 | 2 | 3 | 4
export type ActionStatus = 'proposed' | 'completed' | 'simplified' | 'skipped'
export type ReminderKind = 'daily_review' | 'start_action' | 'encouragement' | 'relationship_cooldown'
export type MainChallenge =
  | 'procrastination'
  | 'self_doubt'
  | 'doomscrolling'
  | 'relationship'
  | 'emotion'
  | 'unsure'
export type EncouragementStyle = 'gentle' | 'rational' | 'direct' | 'light'
export type AppTheme = 'warm' | 'calm' | 'focus'
export type FontDensity = 'comfortable' | 'compact' | 'large'

export interface ActionCard {
  title: string
  estimated_minutes: number
  difficulty: string
  steps: string[]
}

export interface RelationshipScripts {
  gentle: string
  direct: string
  boundary: string
}

export interface RelationshipDraft {
  id?: number
  conversationId?: number | null
  source: 'ai' | 'local'
  inputSummary: string
  gentle: string
  direct: string
  boundary: string
  selectedVersion: keyof RelationshipScripts
  note?: string
  createdAt: number
  updatedAt: number
}

export interface CreationPlan {
  id?: number
  conversationId?: number | null
  source: 'ai' | 'local'
  inputSummary: string
  switchTarget: string
  idleDuration: string
  energyLevel: string
  actionCard: ActionCard
  status: ActionStatus
  createdAt: number
  updatedAt: number
}

export interface EncouragementPhrase {
  id?: number
  conversationId?: number | null
  source: 'ai' | 'local'
  phrase: string
  inputSummary: string
  style: EncouragementStyle
  createdAt: number
  updatedAt: number
}

export interface CoachResult {
  reply_text: string
  emotion_labels: string[]
  need_labels: string[]
  risk_level: RiskLevel
  action_card?: ActionCard | null
  relationship_scripts?: RelationshipScripts | null
  quick_replies: string[]
}

export interface Conversation {
  id?: number
  scene: CoachScene
  title: string
  createdAt: number
  updatedAt: number
}

export interface Message {
  id?: number
  conversationId: number
  role: 'user' | 'assistant' | 'system'
  content: string
  riskLevel: RiskLevel
  createdAt: number
}

export interface ActionTask {
  id?: number
  source: 'ai' | 'local'
  taskText: string
  reason: string
  actionCard: ActionCard
  status: ActionStatus
  resultNote?: string
  createdAt: number
  updatedAt: number
}

export interface DailyReview {
  id?: number
  mood: string
  pressure: string
  win: string
  tomorrow: string
  summary: string
  source: 'ai' | 'local'
  createdAt: number
  updatedAt: number
}

export interface LocalRecord {
  id?: number
  scene: CoachScene
  input: string
  result: CoachResult
  createdAt: number
}

export interface RiskEvent {
  id?: number
  scene: CoachScene
  riskLevel: RiskLevel
  createdAt: number
}

export interface ProfileSummary {
  generatedAt: number
  totalRecords: number
  topScenes: Array<{ scene: CoachScene; count: number }>
  emotionLabels: string[]
  needLabels: string[]
  recentPatterns: string[]
  suggestedFocus: string
  actionCompletionRate: number | null
  reviewStreakDays: number
  nextMicroAction: string
}

export interface ModelProviderStatus {
  id: string
  label: string
  configured: boolean
  active: boolean
  base_url: string
  openai_compatible: boolean
}

export interface ModelRuntimeConfig {
  provider: string
  model: string
  customized: boolean
  updated_at?: number | null
}

export interface HealthResult {
  status: string
  provider: string
  model: string
  active_provider_configured: boolean
  configured_providers: number
}

export interface ReadinessResult {
  status: string
  database_connected: boolean
  schema_version?: number | null
  expected_schema_version: number
  record_enabled: boolean
}

export interface ApiDiagnostics {
  status: string
  version: string
  server_time: number
  provider: string
  model: string
  configured_providers: number
  active_provider_configured: boolean
  database: {
    connected: boolean
    kind: string
    path_configured: boolean
    journal_mode: string
    busy_timeout_ms: number
    foreign_keys: boolean
    record_enabled: boolean
    page_count: number
    page_size: number
    freelist_count: number
    mmap_size?: number | null
    wal_autocheckpoint?: number | null
    schema_version?: number | null
  }
  deployment_checks?: Array<{
    key: string
    label: string
    status: 'ok' | 'warn'
    detail: string
  }>
}

export interface PromptConfig {
  key: string
  content: string
  customized: boolean
  updated_at?: number | null
}

export interface ServerAIRecord {
  id: number
  scene: string
  input: string
  output: CoachResult
  risk_level: number
  created_at: number
}

export interface ServerRecordExport {
  exported_at: number
  total_records: number
  records: ServerAIRecord[]
}

export interface ServerBackup {
  exported_at: number
  schema_version: number
  max_record_limit: number | null
  total_records: number
  records_included: number
  record_stats: ServerRecordStats
  prompt_overrides: Array<{
    key: string
    content: string
    updated_at: number
  }>
  runtime_model_config?: {
    provider: string
    model: string
    updated_at: number
  } | null
  records: ServerAIRecord[]
}

export interface ServerRestoreResult {
  mode: 'merge' | 'replace'
  records_imported: number
  records_skipped: number
  prompt_overrides_imported: number
  runtime_model_config_imported: boolean
  record_stats: ServerRecordStats
}

export interface ServerMaintenanceResult {
  optimized: boolean
  vacuumed: boolean
  records_pruned: number
  prune_before_timestamp?: number | null
  wal_checkpoint: number[]
  page_count_before: number
  page_count_after: number
  freelist_count_before: number
  freelist_count_after: number
  database_size_bytes_before: number
  database_size_bytes_after: number
}

export interface ServerRecordPage {
  records: ServerAIRecord[]
  total_records: number
  limit: number
  offset: number
  next_offset?: number | null
  has_more: boolean
}

export interface ServerRecordCursorPage {
  records: ServerAIRecord[]
  limit: number
  cursor?: string | null
  next_cursor?: string | null
  has_more: boolean
}

export interface ServerRecordStats {
  total_records: number
  latest_created_at?: number | null
  scene_counts: Record<string, number>
  risk_counts: Record<string, number>
  max_page_size: number
}

export interface ServerProfileSummary {
  total_records: number
  top_scenes: Record<string, number>
  emotion_labels: string[]
  need_labels: string[]
  recent_patterns: string[]
  suggested_focus: string
}
