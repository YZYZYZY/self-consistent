import type {
  ApiDiagnostics,
  CoachResult,
  CoachScene,
  HealthResult,
  ModelProviderStatus,
  ModelRuntimeConfig,
  PromptConfig,
  ReadinessResult,
  ServerAIRecord,
  ServerBackup,
  ServerRecordExport,
  ServerRecordCursorPage,
  ServerRecordPage,
  ServerProfileSummary,
  ServerRecordStats,
  ServerMaintenanceResult,
  ServerRestoreResult,
} from '../types'
import { readPreference, savePreference } from './mobile'

const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const API_BASE_PREFERENCE_KEY = 'apiBaseUrl'
const API_TIMEOUT_MS = 12_000

export interface CoachRequest {
  scene: CoachScene
  text: string
  context?: Record<string, unknown>
}

export function normalizeApiBaseUrl(value: string) {
  const trimmed = value.trim()
  const withProtocol = trimmed && !/^https?:\/\//i.test(trimmed) ? `http://${trimmed}` : trimmed
  const candidate = withProtocol || DEFAULT_API_BASE
  const url = new URL(candidate)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('API 地址必须以 http:// 或 https:// 开头')
  }
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

export async function getApiBaseUrl() {
  const override = await readPreference(API_BASE_PREFERENCE_KEY)
  return normalizeApiBaseUrl(override || DEFAULT_API_BASE)
}

export async function setApiBaseUrlOverride(value: string) {
  const normalized = normalizeApiBaseUrl(value)
  await savePreference(API_BASE_PREFERENCE_KEY, normalized)
  return normalized
}

async function apiUrl(path: string) {
  return `${await getApiBaseUrl()}${path}`
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('后端响应超时，请检查网络或 API Base URL。', { cause: error })
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

async function readErrorMessage(response: Response) {
  const message = await response.text()
  if (!message) {
    return `请求失败：${response.status}`
  }
  try {
    const parsed = JSON.parse(message) as { detail?: unknown; message?: unknown; error?: unknown }
    const detail = parsed.detail ?? parsed.message ?? parsed.error
    if (typeof detail === 'string' && detail.trim()) {
      return detail
    }
    if (Array.isArray(detail) && detail.length > 0) {
      return detail
        .map((item) => {
          if (typeof item === 'string') return item
          if (item && typeof item === 'object' && 'msg' in item && typeof item.msg === 'string') return item.msg
          return JSON.stringify(item)
        })
        .join('；')
    }
    if (detail && typeof detail === 'object') {
      return JSON.stringify(detail)
    }
  } catch {
    return message
  }
  return message
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetchWithTimeout(await apiUrl(path))
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return response.json() as Promise<T>
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetchWithTimeout(await apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return response.json() as Promise<T>
}

export function requestCoachTurn(input: CoachRequest): Promise<CoachResult> {
  if (input.scene === 'daily_review') {
    return postJson('/api/ai/review', input)
  }
  if (input.scene === 'relationship') {
    return postJson('/api/ai/relationship', input)
  }
  if (input.scene === 'procrastination') {
    return postJson('/api/ai/action', input)
  }
  return postJson('/api/ai/chat', input)
}

export async function getHealth(): Promise<HealthResult> {
  return getJson('/health')
}

export async function getReadiness(): Promise<ReadinessResult> {
  return getJson('/readyz')
}

export async function getDiagnostics(): Promise<ApiDiagnostics> {
  return getJson('/api/diagnostics')
}

export async function getModelProviders(): Promise<ModelProviderStatus[]> {
  return getJson('/api/models/providers')
}

export async function getModelRuntimeConfig(): Promise<ModelRuntimeConfig> {
  return getJson('/api/models/config')
}

export async function updateModelRuntimeConfig(provider: string, model: string, adminToken = ''): Promise<ModelRuntimeConfig> {
  const response = await fetchWithTimeout(await apiUrl('/api/models/config'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken.trim() ? { 'X-Admin-Token': adminToken.trim() } : {}),
    },
    body: JSON.stringify({ provider, model }),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return response.json() as Promise<ModelRuntimeConfig>
}

export async function getPromptConfigs(): Promise<PromptConfig[]> {
  return getJson('/api/prompts')
}

export async function updatePromptConfig(key: string, content: string, adminToken = ''): Promise<PromptConfig> {
  const response = await fetchWithTimeout(await apiUrl(`/api/prompts/${encodeURIComponent(key)}`), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken.trim() ? { 'X-Admin-Token': adminToken.trim() } : {}),
    },
    body: JSON.stringify({ content }),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return response.json() as Promise<PromptConfig>
}

export async function getServerRecords(limit = 5, offset = 0, scene?: CoachScene): Promise<ServerAIRecord[]> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (scene) {
    params.set('scene', scene)
  }
  return getJson(`/api/records?${params.toString()}`)
}

export async function getServerRecordPage(limit = 5, offset = 0, scene?: CoachScene): Promise<ServerRecordPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (scene) {
    params.set('scene', scene)
  }
  return getJson(`/api/records/page?${params.toString()}`)
}

export async function getServerRecordCursorPage(limit = 5, cursor = '', scene?: CoachScene): Promise<ServerRecordCursorPage> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) {
    params.set('cursor', cursor)
  }
  if (scene) {
    params.set('scene', scene)
  }
  return getJson(`/api/records/cursor?${params.toString()}`)
}

export async function getServerRecordStats(): Promise<ServerRecordStats> {
  return getJson('/api/records/stats')
}

export async function exportServerRecords(scene?: CoachScene, adminToken = ''): Promise<ServerRecordExport> {
  const params = new URLSearchParams()
  if (scene) {
    params.set('scene', scene)
  }
  const path = params.size ? `/api/records/export?${params.toString()}` : '/api/records/export'
  const response = await fetchWithTimeout(await apiUrl(path), {
    headers: {
      ...(adminToken.trim() ? { 'X-Admin-Token': adminToken.trim() } : {}),
    },
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return response.json() as Promise<ServerRecordExport>
}

export async function exportServerBackup(adminToken = ''): Promise<ServerBackup> {
  const response = await fetchWithTimeout(await apiUrl('/api/admin/backup'), {
    headers: {
      ...(adminToken.trim() ? { 'X-Admin-Token': adminToken.trim() } : {}),
    },
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return response.json() as Promise<ServerBackup>
}

export async function restoreServerBackup(
  backup: ServerBackup,
  mode: 'merge' | 'replace' = 'merge',
  adminToken = '',
): Promise<ServerRestoreResult> {
  const response = await fetchWithTimeout(await apiUrl('/api/admin/restore'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken.trim() ? { 'X-Admin-Token': adminToken.trim() } : {}),
    },
    body: JSON.stringify({ mode, backup }),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return response.json() as Promise<ServerRestoreResult>
}

export async function runServerMaintenance(
  adminToken = '',
  vacuum = false,
  pruneOlderThanDays?: number,
): Promise<ServerMaintenanceResult> {
  const response = await fetchWithTimeout(await apiUrl('/api/admin/maintenance'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken.trim() ? { 'X-Admin-Token': adminToken.trim() } : {}),
    },
    body: JSON.stringify({ vacuum, prune_older_than_days: pruneOlderThanDays }),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return response.json() as Promise<ServerMaintenanceResult>
}

export async function getServerProfileSummary(): Promise<ServerProfileSummary> {
  return getJson('/api/profile/summary')
}

export async function deleteServerRecords(adminToken = ''): Promise<{ deleted: number }> {
  const response = await fetchWithTimeout(await apiUrl('/api/records'), {
    method: 'DELETE',
    headers: {
      ...(adminToken.trim() ? { 'X-Admin-Token': adminToken.trim() } : {}),
    },
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return response.json() as Promise<{ deleted: number }>
}

export async function deleteServerRecord(recordId: number, adminToken = ''): Promise<{ deleted: number }> {
  const response = await fetchWithTimeout(await apiUrl(`/api/records/${recordId}`), {
    method: 'DELETE',
    headers: {
      ...(adminToken.trim() ? { 'X-Admin-Token': adminToken.trim() } : {}),
    },
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  return response.json() as Promise<{ deleted: number }>
}
