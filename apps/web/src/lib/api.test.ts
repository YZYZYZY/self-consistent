import { describe, expect, it, vi } from 'vitest'
import {
  deleteServerRecords,
  exportServerBackup,
  exportServerRecords,
  getApiBaseUrl,
  getDiagnostics,
  getReadiness,
  getServerRecordCursorPage,
  getServerRecordStats,
  getServerRecords,
  normalizeApiBaseUrl,
  restoreServerBackup,
  runServerMaintenance,
  setApiBaseUrlOverride,
  updateModelRuntimeConfig,
  updatePromptConfig,
} from './api'
import { readPreference, savePreference } from './mobile'

vi.mock('./mobile', () => ({
  readPreference: vi.fn(async () => null),
  savePreference: vi.fn(async () => undefined),
}))

describe('api base url', () => {
  it('normalizes host-only addresses for Android local network debugging', () => {
    expect(normalizeApiBaseUrl('192.168.1.5:8000/')).toBe('http://192.168.1.5:8000')
  })

  it('reads and saves runtime API base URL overrides', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('https://api.example.com/')

    await expect(getApiBaseUrl()).resolves.toBe('https://api.example.com')
    await expect(setApiBaseUrlOverride('api.example.com')).resolves.toBe('http://api.example.com')
    expect(savePreference).toHaveBeenCalledWith('apiBaseUrl', 'http://api.example.com')
  })

  it('sends admin token when updating prompt configs', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('http://localhost:8000')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        key: 'procrastination',
        content: '只允许生成 30 秒版本的行动，并返回 JSON。',
        customized: true,
        updated_at: 1,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await updatePromptConfig('procrastination', '只允许生成 30 秒版本的行动，并返回 JSON。', 'secret-token')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/prompts/procrastination',
      expect.objectContaining({
        method: 'PUT',
        signal: expect.any(Object),
        headers: expect.objectContaining({ 'X-Admin-Token': 'secret-token' }),
      }),
    )
  })

  it('sends admin token when updating runtime model config', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('http://localhost:8000')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        provider: 'qwen',
        model: 'qwen-plus',
        customized: true,
        updated_at: 1,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await updateModelRuntimeConfig('qwen', 'qwen-plus', 'secret-token')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/models/config',
      expect.objectContaining({
        method: 'PUT',
        signal: expect.any(Object),
        headers: expect.objectContaining({ 'X-Admin-Token': 'secret-token' }),
        body: JSON.stringify({ provider: 'qwen', model: 'qwen-plus' }),
      }),
    )
  })

  it('sends admin token when deleting server records', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('http://localhost:8000')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ deleted: 2 }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteServerRecords('secret-token')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/records',
      expect.objectContaining({
        method: 'DELETE',
        signal: expect.any(Object),
        headers: expect.objectContaining({ 'X-Admin-Token': 'secret-token' }),
      }),
    )
  })

  it('requests paged server records and stats', async () => {
    vi.mocked(readPreference)
      .mockResolvedValueOnce('http://localhost:8000')
      .mockResolvedValueOnce('http://localhost:8000')
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith('/api/records/stats')
          ? { total_records: 7, latest_created_at: 1, scene_counts: {}, risk_counts: {}, max_page_size: 200 }
          : [],
    }))
    vi.stubGlobal('fetch', fetchMock)

    await getServerRecords(10, 5, 'creation')
    await getServerRecordStats()

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8000/api/records?limit=10&offset=5&scene=creation',
      expect.objectContaining({ signal: expect.any(Object) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8000/api/records/stats',
      expect.objectContaining({ signal: expect.any(Object) }),
    )
  })

  it('requests cursor-paged server records', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('http://localhost:8000')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ records: [], limit: 5, cursor: '1800000000:10', next_cursor: null, has_more: false }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await getServerRecordCursorPage(5, '1800000000:10', 'creation')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/records/cursor?limit=5&cursor=1800000000%3A10&scene=creation',
      expect.objectContaining({ signal: expect.any(Object) }),
    )
  })

  it('exports server records with optional scene filter', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('http://localhost:8000')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ exported_at: 1, total_records: 0, records: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await exportServerRecords('creation', 'secret-token')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/records/export?scene=creation',
      expect.objectContaining({
        signal: expect.any(Object),
        headers: expect.objectContaining({ 'X-Admin-Token': 'secret-token' }),
      }),
    )
  })

  it('exports full server backup with admin token', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('http://localhost:8000')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        exported_at: 1,
        schema_version: 1,
        max_record_limit: null,
        total_records: 0,
        records_included: 0,
        record_stats: { total_records: 0, latest_created_at: null, scene_counts: {}, risk_counts: {}, max_page_size: 200 },
        prompt_overrides: [],
        runtime_model_config: null,
        records: [],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await exportServerBackup('secret-token')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/admin/backup',
      expect.objectContaining({
        signal: expect.any(Object),
        headers: expect.objectContaining({ 'X-Admin-Token': 'secret-token' }),
      }),
    )
  })

  it('restores full server backup with admin token', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('http://localhost:8000')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        mode: 'merge',
        records_imported: 1,
        records_skipped: 0,
        prompt_overrides_imported: 1,
        runtime_model_config_imported: true,
        record_stats: { total_records: 1, latest_created_at: 1, scene_counts: {}, risk_counts: {}, max_page_size: 200 },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await restoreServerBackup(
      {
        exported_at: 1,
        schema_version: 1,
        max_record_limit: null,
        total_records: 0,
        records_included: 0,
        record_stats: { total_records: 0, latest_created_at: null, scene_counts: {}, risk_counts: {}, max_page_size: 200 },
        prompt_overrides: [],
        runtime_model_config: null,
        records: [],
      },
      'merge',
      'secret-token',
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/admin/restore',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(Object),
        headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-Admin-Token': 'secret-token' }),
        body: expect.stringContaining('"mode":"merge"'),
      }),
    )
  })

  it('runs server maintenance with admin token', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('http://localhost:8000')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        optimized: true,
        vacuumed: false,
        wal_checkpoint: [0, 0, 0],
        page_count_before: 4,
        page_count_after: 4,
        freelist_count_before: 1,
        freelist_count_after: 0,
        database_size_bytes_before: 16_384,
        database_size_bytes_after: 16_384,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await runServerMaintenance('secret-token')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/admin/maintenance',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(Object),
        headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-Admin-Token': 'secret-token' }),
        body: JSON.stringify({ vacuum: false }),
      }),
    )
  })

  it('runs server maintenance with record pruning', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('http://localhost:8000')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        optimized: true,
        vacuumed: false,
        records_pruned: 2,
        prune_before_timestamp: 1_790_000_000,
        wal_checkpoint: [0, 0, 0],
        page_count_before: 4,
        page_count_after: 4,
        freelist_count_before: 1,
        freelist_count_after: 0,
        database_size_bytes_before: 16_384,
        database_size_bytes_after: 16_384,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await runServerMaintenance('secret-token', false, 90)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/admin/maintenance',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(Object),
        headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-Admin-Token': 'secret-token' }),
        body: JSON.stringify({ vacuum: false, prune_older_than_days: 90 }),
      }),
    )
  })

  it('surfaces FastAPI detail errors as readable messages', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('http://localhost:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        text: async () => JSON.stringify({ detail: 'Admin token required.' }),
      })),
    )

    await expect(runServerMaintenance('wrong-token')).rejects.toThrow('Admin token required.')
  })

  it('surfaces FastAPI validation errors without raw JSON noise', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('http://localhost:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        text: async () => JSON.stringify({ detail: [{ loc: ['body', 'model'], msg: 'Field required', type: 'missing' }] }),
      })),
    )

    await expect(updateModelRuntimeConfig('qwen', '')).rejects.toThrow('Field required')
  })

  it('requests backend diagnostics', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('http://localhost:8000')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 'ok',
        version: '0.1.0',
        server_time: 1,
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
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await getDiagnostics()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/diagnostics',
      expect.objectContaining({ signal: expect.any(Object) }),
    )
  })

  it('requests backend readiness', async () => {
    vi.mocked(readPreference).mockResolvedValueOnce('http://localhost:8000')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 'ok',
        database_connected: true,
        schema_version: 1,
        expected_schema_version: 1,
        record_enabled: true,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await getReadiness()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/readyz',
      expect.objectContaining({ signal: expect.any(Object) }),
    )
  })
})
