import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/notion', () => ({
  patchPageProperties: vi.fn().mockResolvedValue(undefined),
  getPlaceByNotionPageId: vi.fn(),
}))

import { applyEdits, summarizeOp } from '../../src/capabilities/places/apply-edit'
import { patchPageProperties, getPlaceByNotionPageId } from '../../src/integrations/notion'
import type { EditOp } from '../../src/capabilities/places/schema'

const mockPatch = vi.mocked(patchPageProperties)
const mockGetPlace = vi.mocked(getPlaceByNotionPageId)

const mockEnv = { NOTION_TOKEN: 'test-token' } as unknown as Env

const BASE_PLACE = {
  name: '大湖公園',
  notion_page_id: 'page-aaa',
  internal_id: 'int-001',
  summary: '很棒的公園',
  categories: ['公園', '自然'] as string[],
  seasons: ['春', '夏'] as string[],
  ai_inferred_fields: [],
  source_type: ['自行記錄'] as string[],
  indoor_outdoor: '室外' as const,
  address: null,
  region: '台北' as const,
  longitude: null, latitude: null, google_place_id: null,
  age_min: 3, age_max: 6,
  stroller_friendly: null, parking_friendly: null,
  has_restroom: null, has_nursing_room: null,
  energy_level: null, stay_minutes: null,
  reservation_needed: null, crowded_on_weekends: null,
  fee_type: null, fee_details: null,
  source_url: null, created_by: null,
  status: 'draft' as const,
}

beforeEach(() => vi.clearAllMocks())

describe('applyEdits — scalar types', () => {
  it('applies number op (Age Min)', async () => {
    const edits: EditOp[] = [{ property: 'Age Min', value: 5 }]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(result.applied).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
    expect(mockPatch).toHaveBeenCalledWith('page-aaa', {
      'Age Min': { number: 5 },
    }, mockEnv)
  })

  it('applies number null (clear Stay Minutes)', async () => {
    const edits: EditOp[] = [{ property: 'Stay Minutes', value: null }]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(result.applied).toHaveLength(1)
    expect(mockPatch).toHaveBeenCalledWith('page-aaa', {
      'Stay Minutes': { number: null },
    }, mockEnv)
  })

  it('applies select op (Indoor/Outdoor)', async () => {
    const edits: EditOp[] = [{ property: 'Indoor/Outdoor', value: '室內' }]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(result.applied).toHaveLength(1)
    expect(mockPatch).toHaveBeenCalledWith('page-aaa', {
      'Indoor/Outdoor': { select: { name: '室內' } },
    }, mockEnv)
  })

  it('applies status op', async () => {
    const edits: EditOp[] = [{ property: 'Status', value: 'confirmed' }]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(result.applied).toHaveLength(1)
    expect(mockPatch).toHaveBeenCalledWith('page-aaa', {
      'Status': { status: { name: 'confirmed' } },
    }, mockEnv)
  })

  it('applies checkbox op (Stroller Friendly)', async () => {
    const edits: EditOp[] = [{ property: 'Stroller Friendly', value: true }]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(result.applied).toHaveLength(1)
    expect(mockPatch).toHaveBeenCalledWith('page-aaa', {
      'Stroller Friendly': { checkbox: true },
    }, mockEnv)
  })
})

describe('applyEdits — multi-select', () => {
  it('set replaces entirely without fetching current place', async () => {
    const edits: EditOp[] = [{ property: 'Categories', op: 'set', values: ['沙坑'] }]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(mockGetPlace).not.toHaveBeenCalled()
    expect(result.applied).toHaveLength(1)
    expect(mockPatch).toHaveBeenCalledWith('page-aaa', {
      'Categories': { multi_select: [{ name: '沙坑' }] },
    }, mockEnv)
  })

  it('add fetches current place and merges values', async () => {
    mockGetPlace.mockResolvedValueOnce(BASE_PLACE as never)
    const edits: EditOp[] = [{ property: 'Categories', op: 'add', values: ['沙坑'] }]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(mockGetPlace).toHaveBeenCalledWith('page-aaa', mockEnv)
    expect(result.applied).toHaveLength(1)
    expect(mockPatch).toHaveBeenCalledWith('page-aaa', {
      'Categories': { multi_select: [{ name: '公園' }, { name: '自然' }, { name: '沙坑' }] },
    }, mockEnv)
  })

  it('remove fetches current place and subtracts values', async () => {
    mockGetPlace.mockResolvedValueOnce(BASE_PLACE as never)
    const edits: EditOp[] = [{ property: 'Categories', op: 'remove', values: ['自然'] }]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(result.applied).toHaveLength(1)
    expect(mockPatch).toHaveBeenCalledWith('page-aaa', {
      'Categories': { multi_select: [{ name: '公園' }] },
    }, mockEnv)
  })

  it('add deduplicates if value already present', async () => {
    mockGetPlace.mockResolvedValueOnce(BASE_PLACE as never)
    const edits: EditOp[] = [{ property: 'Categories', op: 'add', values: ['公園'] }]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(result.applied).toHaveLength(1)
    expect(mockPatch).toHaveBeenCalledWith('page-aaa', {
      'Categories': { multi_select: [{ name: '公園' }, { name: '自然' }] },
    }, mockEnv)
  })
})

describe('applyEdits — rich text', () => {
  it('replace sets text directly without fetching current place', async () => {
    const edits: EditOp[] = [{ property: 'Summary', op: 'replace', value: '新摘要' }]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(mockGetPlace).not.toHaveBeenCalled()
    expect(result.applied).toHaveLength(1)
    expect(mockPatch).toHaveBeenCalledWith('page-aaa', {
      'Summary': { rich_text: [{ type: 'text', text: { content: '新摘要' } }] },
    }, mockEnv)
  })

  it('append fetches current and concatenates', async () => {
    mockGetPlace.mockResolvedValueOnce(BASE_PLACE as never)
    const edits: EditOp[] = [{ property: 'Summary', op: 'append', value: '補充說明' }]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(mockGetPlace).toHaveBeenCalled()
    expect(result.applied).toHaveLength(1)
    expect(mockPatch).toHaveBeenCalledWith('page-aaa', {
      'Summary': { rich_text: [{ type: 'text', text: { content: '很棒的公園\n補充說明' } }] },
    }, mockEnv)
  })
})

describe('applyEdits — Name (rename rejection)', () => {
  it('puts Name op in failed with rename_not_supported without calling Notion', async () => {
    const edits: EditOp[] = [{ property: 'Name', value: '新名字' }]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(result.applied).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].error).toBe('rename_not_supported')
    expect(mockPatch).not.toHaveBeenCalled()
  })

  it('applies other ops while rejecting Name op', async () => {
    const edits: EditOp[] = [
      { property: 'Name', value: '新名字' },
      { property: 'Age Min', value: 5 },
    ]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(result.applied).toHaveLength(1)
    expect(result.applied[0].property).toBe('Age Min')
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].error).toBe('rename_not_supported')
    expect(mockPatch).toHaveBeenCalledWith('page-aaa', { 'Age Min': { number: 5 } }, mockEnv)
  })
})

describe('applyEdits — PATCH failure', () => {
  it('moves all applied ops to failed when PATCH throws', async () => {
    mockPatch.mockRejectedValueOnce(new Error('Notion 502'))
    const edits: EditOp[] = [
      { property: 'Age Min', value: 5 },
      { property: 'Age Max', value: 10 },
    ]
    const result = await applyEdits('page-aaa', edits, mockEnv)
    expect(result.applied).toHaveLength(0)
    expect(result.failed).toHaveLength(2)
    expect(result.failed[0].error).toContain('Notion 502')
  })
})

describe('applyEdits — batching', () => {
  it('sends multiple ops in a single PATCH call', async () => {
    const edits: EditOp[] = [
      { property: 'Age Min', value: 3 },
      { property: 'Age Max', value: 8 },
      { property: 'Indoor/Outdoor', value: '室內' },
    ]
    await applyEdits('page-aaa', edits, mockEnv)
    expect(mockPatch).toHaveBeenCalledTimes(1)
    expect(mockPatch).toHaveBeenCalledWith('page-aaa', {
      'Age Min': { number: 3 },
      'Age Max': { number: 8 },
      'Indoor/Outdoor': { select: { name: '室內' } },
    }, mockEnv)
  })
})

describe('summarizeOp', () => {
  it('summarizes Age Min', () => {
    expect(summarizeOp({ property: 'Age Min', value: 5 })).toBe('年齡下限 5 歲')
    expect(summarizeOp({ property: 'Age Min', value: null })).toBe('年齡下限 清除 歲')
  })

  it('summarizes Age Max', () => {
    expect(summarizeOp({ property: 'Age Max', value: 10 })).toBe('年齡上限 10 歲')
  })

  it('summarizes Stay Minutes', () => {
    expect(summarizeOp({ property: 'Stay Minutes', value: 60 })).toBe('建議停留 60 分鐘')
    expect(summarizeOp({ property: 'Stay Minutes', value: null })).toBe('清除停留時間')
  })

  it('summarizes select ops', () => {
    expect(summarizeOp({ property: 'Indoor/Outdoor', value: '室內' })).toBe('室內')
    expect(summarizeOp({ property: 'Energy Level', value: '放電型' })).toBe('放電型')
  })

  it('summarizes Status', () => {
    expect(summarizeOp({ property: 'Status', value: 'confirmed' })).toBe('狀態→confirmed')
  })

  it('summarizes multi-select ops', () => {
    expect(summarizeOp({ property: 'Categories', op: 'add', values: ['沙坑'] })).toBe('分類新增：沙坑')
    expect(summarizeOp({ property: 'Categories', op: 'remove', values: ['公園'] })).toBe('分類移除：公園')
    expect(summarizeOp({ property: 'Seasons', op: 'set', values: ['春', '夏'] })).toBe('季節設定：春、夏')
    expect(summarizeOp({ property: 'Source Type', op: 'add', values: ['官網'] })).toBe('來源新增：官網')
  })

  it('summarizes checkbox ops', () => {
    expect(summarizeOp({ property: 'Stroller Friendly', value: true })).toBe('推車友善')
    expect(summarizeOp({ property: 'Stroller Friendly', value: false })).toBe('推車不友善')
    expect(summarizeOp({ property: 'Has Restroom', value: true })).toBe('廁所：有')
    expect(summarizeOp({ property: 'Reservation Needed', value: false })).toBe('需要預約：否')
  })

  it('summarizes rich text ops', () => {
    expect(summarizeOp({ property: 'Summary', op: 'append', value: '補充' })).toBe('簡述補充')
    expect(summarizeOp({ property: 'Summary', op: 'replace', value: '全新' })).toBe('簡述更新')
    expect(summarizeOp({ property: 'Fee Details', op: 'append', value: '補' })).toBe('收費說明補充')
  })
})
