import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/capabilities/places/edit-parser', () => ({
  parseEditIntent: vi.fn(),
  parseEditTarget: vi.fn(),
}))
vi.mock('../../src/capabilities/places/apply-edit', () => ({
  applyEdits: vi.fn(),
  summarizeOp: vi.fn((op: { property: string }) => op.property),
}))
vi.mock('../../src/capabilities/places/disambiguate', () => ({
  buildDisambiguateCard: vi.fn().mockReturnValue({ type: 'flex', altText: 'disambig', contents: {} }),
}))
vi.mock('../../src/integrations/notion', () => ({
  getPlaceByNotionPageId: vi.fn(),
  findPlaceByInternalId: vi.fn(),
  searchPlaces: vi.fn(),
}))
vi.mock('../../src/integrations/line', () => ({
  sendReply: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/capabilities/places/kv-store', () => ({
  writePendingEdit: vi.fn().mockResolvedValue(undefined),
  readPendingEdit: vi.fn().mockResolvedValue(null),
  clearPendingEdit: vi.fn().mockResolvedValue(undefined),
}))

import { runFlowEdit, runFlowEditSelect } from '../../src/capabilities/places/flow-edit'
import { parseEditIntent, parseEditTarget } from '../../src/capabilities/places/edit-parser'
import { applyEdits } from '../../src/capabilities/places/apply-edit'
import { getPlaceByNotionPageId, findPlaceByInternalId, searchPlaces } from '../../src/integrations/notion'
import { sendReply } from '../../src/integrations/line'
import { writePendingEdit, readPendingEdit, clearPendingEdit } from '../../src/capabilities/places/kv-store'

const mockParseIntent = vi.mocked(parseEditIntent)
const mockParseTarget = vi.mocked(parseEditTarget)
const mockApplyEdits = vi.mocked(applyEdits)
const mockGetPlace = vi.mocked(getPlaceByNotionPageId)
const mockFindByInternal = vi.mocked(findPlaceByInternalId)
const mockSearch = vi.mocked(searchPlaces)
const mockReply = vi.mocked(sendReply)
const mockWritePendingEdit = vi.mocked(writePendingEdit)
const mockReadPendingEdit = vi.mocked(readPendingEdit)
const mockClearPendingEdit = vi.mocked(clearPendingEdit)

const mockKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() }
const mockEnv = {
  LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
  ALFRED_KV: mockKv,
} as unknown as Env

function makeSamplePlace(overrides: Record<string, unknown> = {}) {
  return {
    name: '大湖公園',
    notion_page_id: 'page-aaa',
    internal_id: 'int-001',
    summary: '',
    categories: ['公園'] as string[],
    seasons: ['全年'] as string[],
    ai_inferred_fields: [],
    source_type: [] as string[],
    indoor_outdoor: '室外' as const,
    address: null, region: '台北' as const,
    longitude: null, latitude: null, google_place_id: null,
    age_min: 3, age_max: 6,
    stroller_friendly: null, parking_friendly: null,
    has_restroom: null, has_nursing_room: null,
    energy_level: null, stay_minutes: null,
    reservation_needed: null, crowded_on_weekends: null,
    fee_type: null, fee_details: null,
    source_url: null, created_by: null,
    status: 'draft' as const,
    ...overrides,
  }
}

const SUCCESS_RESULT = { applied: [{ property: 'Age Min', value: 5 }], failed: [] }

beforeEach(() => {
  vi.clearAllMocks()
  mockKv.get.mockResolvedValue(null)
  mockApplyEdits.mockResolvedValue(SUCCESS_RESULT as never)
})

// ---------------------------------------------------------------------------
// runFlowEdit — Story I: last_place anchor (within 5 min)
// ---------------------------------------------------------------------------

describe('runFlowEdit — Story I (last_place anchor)', () => {
  beforeEach(() => {
    mockKv.get.mockResolvedValueOnce(JSON.stringify({
      internal_id: 'int-001',
      sent_at: new Date().toISOString(),
    }))
    mockFindByInternal.mockResolvedValueOnce(makeSamplePlace() as never)
    mockParseIntent.mockResolvedValueOnce([{ property: 'Age Min', value: 5 }])
  })

  it('skips parseEditTarget when anchor is found', async () => {
    await runFlowEdit('改成 5 歲以上', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockParseTarget).not.toHaveBeenCalled()
    expect(mockParseIntent).toHaveBeenCalledWith('改成 5 歲以上', expect.objectContaining({ name: '大湖公園' }), mockEnv)
  })

  it('replies with success summary', async () => {
    await runFlowEdit('改成 5 歲以上', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('✓ 已更新') }),
    ]), 'test-token', 'chat1')
  })
})

describe('runFlowEdit — anchor expired (> 5 min ago)', () => {
  it('falls back to parseEditTarget when anchor is stale', async () => {
    const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString()
    mockKv.get.mockResolvedValueOnce(JSON.stringify({ internal_id: 'int-001', sent_at: staleTime }))
    mockParseTarget.mockResolvedValueOnce({ target_place_name: '大湖公園', edit_message: '改成室內' })
    mockSearch.mockResolvedValueOnce([makeSamplePlace() as never])
    mockParseIntent.mockResolvedValueOnce([{ property: 'Indoor/Outdoor', value: '室內' }])

    await runFlowEdit('大湖公園改成室內', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockParseTarget).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// runFlowEdit — Story J: named edit (no anchor)
// ---------------------------------------------------------------------------

describe('runFlowEdit — Story J (no anchor, named edit)', () => {
  beforeEach(() => {
    mockKv.get.mockResolvedValue(null)
  })

  it('uses extracted edit_message for parseEditIntent', async () => {
    mockParseTarget.mockResolvedValueOnce({ target_place_name: '大湖公園', edit_message: '改成室內' })
    mockSearch.mockResolvedValueOnce([makeSamplePlace() as never])
    mockParseIntent.mockResolvedValueOnce([{ property: 'Indoor/Outdoor', value: '室內' }])

    await runFlowEdit('大湖公園改成室內', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockParseIntent).toHaveBeenCalledWith('改成室內', expect.any(Object), mockEnv)
  })

  it('replies asking for place name when target_place_name is null', async () => {
    mockParseTarget.mockResolvedValueOnce({ target_place_name: null, edit_message: '改成室內' })

    await runFlowEdit('改成室內', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('指名') }),
    ]), 'test-token', 'chat1')
    expect(mockApplyEdits).not.toHaveBeenCalled()
  })

  it('replies when 0 candidates found', async () => {
    mockParseTarget.mockResolvedValueOnce({ target_place_name: '神秘地點', edit_message: '改' })
    mockSearch.mockResolvedValueOnce([])

    await runFlowEdit('神秘地點改', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('神秘地點') }),
    ]), 'test-token', 'chat1')
    expect(mockApplyEdits).not.toHaveBeenCalled()
  })

  it('sends disambiguation card and stores pending_edit when multiple candidates', async () => {
    mockParseTarget.mockResolvedValueOnce({ target_place_name: '大湖', edit_message: '改成室內' })
    mockSearch.mockResolvedValueOnce([
      makeSamplePlace(),
      makeSamplePlace({ name: '大湖農場', notion_page_id: 'page-bbb' }),
    ] as never[])

    await runFlowEdit('大湖改成室內', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockWritePendingEdit).toHaveBeenCalledWith(mockEnv, 'u1', { edit_message: '改成室內' })
    expect(mockApplyEdits).not.toHaveBeenCalled()
  })

  it('handles searchPlaces failure gracefully', async () => {
    mockParseTarget.mockResolvedValueOnce({ target_place_name: '大湖公園', edit_message: '改成室內' })
    mockSearch.mockRejectedValueOnce(new Error('Notion down'))

    await runFlowEdit('大湖公園改成室內', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('狀況') }),
    ]), 'test-token', 'chat1')
  })
})

// ---------------------------------------------------------------------------
// runFlowEdit — performEdit outcomes
// ---------------------------------------------------------------------------

describe('runFlowEdit — performEdit: empty edits', () => {
  it('replies asking to be more specific when edits is empty', async () => {
    mockKv.get.mockResolvedValueOnce(JSON.stringify({
      internal_id: 'int-001',
      sent_at: new Date().toISOString(),
    }))
    mockFindByInternal.mockResolvedValueOnce(makeSamplePlace() as never)
    mockParseIntent.mockResolvedValueOnce([])

    await runFlowEdit('沙坑超棒', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('沒看出要改什麼') }),
    ]), 'test-token', 'chat1')
    expect(mockApplyEdits).not.toHaveBeenCalled()
  })
})

describe('runFlowEdit — performEdit: rename attempt', () => {
  beforeEach(() => {
    mockKv.get.mockResolvedValueOnce(JSON.stringify({
      internal_id: 'int-001',
      sent_at: new Date().toISOString(),
    }))
    mockFindByInternal.mockResolvedValueOnce(makeSamplePlace() as never)
    mockParseIntent.mockResolvedValueOnce([{ property: 'Name', value: '新名字' }])
  })

  it('replies with rename-not-supported message when only rename op', async () => {
    mockApplyEdits.mockResolvedValueOnce({
      applied: [],
      failed: [{ op: { property: 'Name', value: '新名字' }, error: 'rename_not_supported' }],
    } as never)

    await runFlowEdit('改名叫新名字', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('刪除') }),
    ]), 'test-token', 'chat1')
  })

  it('includes rename note when rename mixed with applied ops', async () => {
    mockApplyEdits.mockResolvedValueOnce({
      applied: [{ property: 'Age Min', value: 5 }],
      failed: [{ op: { property: 'Name', value: '新名字' }, error: 'rename_not_supported' }],
    } as never)

    await runFlowEdit('改名且年齡5', 'reply-token', mockEnv, 'u1', 'chat1')
    const call = mockReply.mock.calls[0]
    const text = (call[1][0] as { text: string }).text
    expect(text).toContain('✓ 已更新')
    expect(text).toContain('改名不支援')
  })
})

describe('runFlowEdit — performEdit: partial failure', () => {
  it('reports partial success with failed field list', async () => {
    mockKv.get.mockResolvedValueOnce(JSON.stringify({
      internal_id: 'int-001',
      sent_at: new Date().toISOString(),
    }))
    mockFindByInternal.mockResolvedValueOnce(makeSamplePlace() as never)
    mockParseIntent.mockResolvedValueOnce([
      { property: 'Age Min', value: 5 },
      { property: 'Age Max', value: 10 },
    ])
    mockApplyEdits.mockResolvedValueOnce({
      applied: [{ property: 'Age Min', value: 5 }],
      failed: [{ op: { property: 'Age Max', value: 10 }, error: 'validation_error' }],
    } as never)

    await runFlowEdit('改成 5-10 歲', 'reply-token', mockEnv, 'u1', 'chat1')
    const call = mockReply.mock.calls[0]
    const text = (call[1][0] as { text: string }).text
    expect(text).toContain('✓ 已更新')
    expect(text).toContain('沒改成功')
  })
})

// ---------------------------------------------------------------------------
// runFlowEditSelect
// ---------------------------------------------------------------------------

describe('runFlowEditSelect', () => {
  it('looks up place and applies pending edit', async () => {
    mockGetPlace.mockResolvedValueOnce(makeSamplePlace() as never)
    mockReadPendingEdit.mockResolvedValueOnce({ edit_message: '改成室內' })
    mockParseIntent.mockResolvedValueOnce([{ property: 'Indoor/Outdoor', value: '室內' }])

    await runFlowEditSelect('page-aaa', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockParseIntent).toHaveBeenCalledWith('改成室內', expect.objectContaining({ name: '大湖公園' }), mockEnv)
    expect(mockClearPendingEdit).toHaveBeenCalledWith(mockEnv, 'u1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('✓ 已更新') }),
    ]), 'test-token', 'chat1')
  })

  it('replies with error when place not found', async () => {
    mockGetPlace.mockResolvedValueOnce(null)
    await runFlowEditSelect('missing-page', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('找不到') }),
    ]), 'test-token', 'chat1')
    expect(mockParseIntent).not.toHaveBeenCalled()
  })

  it('replies asking to retype when no pending_edit', async () => {
    mockGetPlace.mockResolvedValueOnce(makeSamplePlace() as never)
    mockReadPendingEdit.mockResolvedValueOnce(null)

    await runFlowEditSelect('page-aaa', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('重新輸入') }),
    ]), 'test-token', 'chat1')
    expect(mockParseIntent).not.toHaveBeenCalled()
  })

  it('clears pending_edit after reading', async () => {
    mockGetPlace.mockResolvedValueOnce(makeSamplePlace() as never)
    mockReadPendingEdit.mockResolvedValueOnce({ edit_message: '改成室內' })
    mockParseIntent.mockResolvedValueOnce([{ property: 'Indoor/Outdoor', value: '室內' }])

    await runFlowEditSelect('page-aaa', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockClearPendingEdit).toHaveBeenCalledWith(mockEnv, 'u1')
  })
})
