import { getPlaceByNotionPageId, patchPageProperties } from '../../integrations/notion'
import type { EditOp, Place } from './schema'
import type { Env } from '../../core/env'

export type ApplyResult = {
  applied: EditOp[]
  failed: { op: EditOp; error: string }[]
}

function isMultiSelectOp(op: EditOp): op is Extract<EditOp, { property: 'Categories' | 'Seasons' | 'Source Type' }> {
  return op.property === 'Categories' || op.property === 'Seasons' || op.property === 'Source Type'
}

function isRichTextOp(op: EditOp): op is Extract<EditOp, { property: 'Summary' | 'Fee Details' }> {
  return op.property === 'Summary' || op.property === 'Fee Details'
}

function getCurrentMultiSelect(place: Place, property: string): string[] {
  if (property === 'Categories') return place.categories as string[]
  if (property === 'Seasons') return place.seasons as string[]
  if (property === 'Source Type') return place.source_type as string[]
  return []
}

function getCurrentText(place: Place, property: string): string {
  if (property === 'Summary') return place.summary ?? ''
  if (property === 'Fee Details') return place.fee_details ?? ''
  return ''
}

function buildEntry(op: EditOp, currentPlace: Place | null): [string, unknown] {
  const prop = op.property

  if (prop === 'Name') {
    throw new Error('rename_not_supported')
  }

  // Numbers
  if (prop === 'Age Min' || prop === 'Age Max' || prop === 'Stay Minutes') {
    return [prop, { number: (op as { value: number | null }).value }]
  }

  // Selects
  if (prop === 'Indoor/Outdoor' || prop === 'Energy Level' || prop === 'Fee Type' || prop === 'Region') {
    return [prop, { select: { name: (op as { value: string }).value } }]
  }

  // Status (Notion status type, not select)
  if (prop === 'Status') {
    return [prop, { status: { name: (op as { value: string }).value } }]
  }

  // Checkboxes
  if (
    prop === 'Stroller Friendly' || prop === 'Parking Friendly' ||
    prop === 'Has Restroom' || prop === 'Has Nursing Room' ||
    prop === 'Reservation Needed' || prop === 'Crowded On Weekends'
  ) {
    return [prop, { checkbox: (op as { value: boolean }).value }]
  }

  // Multi-selects
  if (isMultiSelectOp(op)) {
    const msOp = op as { property: string; op: 'add' | 'remove' | 'set'; values: string[] }
    let finalValues: string[]
    if (msOp.op === 'set') {
      finalValues = msOp.values
    } else {
      if (!currentPlace) throw new Error('current page required for add/remove')
      const current = getCurrentMultiSelect(currentPlace, prop)
      if (msOp.op === 'add') {
        finalValues = [...new Set([...current, ...msOp.values])]
      } else {
        const removeSet = new Set(msOp.values)
        finalValues = current.filter(v => !removeSet.has(v))
      }
    }
    return [prop, { multi_select: finalValues.map(name => ({ name })) }]
  }

  // Rich text
  if (isRichTextOp(op)) {
    const rtOp = op as { property: string; op: 'append' | 'replace'; value: string }
    let finalText: string
    if (rtOp.op === 'replace') {
      finalText = rtOp.value
    } else {
      if (!currentPlace) throw new Error('current page required for append')
      const current = getCurrentText(currentPlace, prop)
      finalText = current ? `${current}\n${rtOp.value}` : rtOp.value
    }
    return [prop, { rich_text: [{ type: 'text', text: { content: finalText } }] }]
  }

  throw new Error(`unrecognized property: ${prop}`)
}

export async function applyEdits(
  notionPageId: string,
  edits: EditOp[],
  env: Env,
): Promise<ApplyResult> {
  const applied: EditOp[] = []
  const failed: { op: EditOp; error: string }[] = []

  // Separate rename ops (always rejected before any Notion call)
  const nameOps = edits.filter(op => op.property === 'Name')
  const realEdits = edits.filter(op => op.property !== 'Name')

  for (const op of nameOps) {
    failed.push({ op, error: 'rename_not_supported' })
  }

  if (realEdits.length === 0) return { applied, failed }

  // Fetch current place if any op needs it
  const needsFetch = realEdits.some(op =>
    (isMultiSelectOp(op) && (op as { op: string }).op !== 'set') ||
    (isRichTextOp(op) && (op as { op: string }).op === 'append'),
  )

  let currentPlace: Place | null = null
  if (needsFetch) {
    try {
      currentPlace = await getPlaceByNotionPageId(notionPageId, env)
    } catch (err) {
      console.warn('[apply-edit] getPlaceByNotionPageId failed', err)
    }
  }

  // Build payload
  const properties: Record<string, unknown> = {}
  for (const op of realEdits) {
    try {
      const [key, value] = buildEntry(op, currentPlace)
      properties[key] = value
      applied.push(op)
    } catch (err) {
      failed.push({ op, error: String(err) })
    }
  }

  if (applied.length === 0) return { applied, failed }

  // Single PATCH
  try {
    await patchPageProperties(notionPageId, properties, env)
  } catch (err) {
    const errMsg = String(err)
    for (const op of applied) {
      failed.push({ op, error: errMsg })
    }
    return { applied: [], failed }
  }

  return { applied, failed }
}

// --- Summary builder for reply ---

export function summarizeOp(op: EditOp): string {
  const p = op.property
  if (p === 'Age Min') return `年齡下限 ${(op as { value: number | null }).value ?? '清除'} 歲`
  if (p === 'Age Max') return `年齡上限 ${(op as { value: number | null }).value ?? '清除'} 歲`
  if (p === 'Stay Minutes') {
    const v = (op as { value: number | null }).value
    return v != null ? `建議停留 ${v} 分鐘` : '清除停留時間'
  }
  if (p === 'Indoor/Outdoor' || p === 'Energy Level' || p === 'Fee Type' || p === 'Region') {
    return (op as { value: string }).value
  }
  if (p === 'Status') return `狀態→${(op as { value: string }).value}`
  if (p === 'Categories' || p === 'Seasons' || p === 'Source Type') {
    const o = op as { property: string; op: string; values: string[] }
    const verb = o.op === 'add' ? '新增' : o.op === 'remove' ? '移除' : '設定'
    const label = p === 'Categories' ? '分類' : p === 'Seasons' ? '季節' : '來源'
    return `${label}${verb}：${o.values.join('、')}`
  }
  if (p === 'Stroller Friendly') return `推車${(op as { value: boolean }).value ? '友善' : '不友善'}`
  if (p === 'Parking Friendly') return `停車${(op as { value: boolean }).value ? '方便' : '不方便'}`
  if (p === 'Has Restroom') return `廁所：${(op as { value: boolean }).value ? '有' : '無'}`
  if (p === 'Has Nursing Room') return `哺乳室：${(op as { value: boolean }).value ? '有' : '無'}`
  if (p === 'Reservation Needed') return `需要預約：${(op as { value: boolean }).value ? '是' : '否'}`
  if (p === 'Crowded On Weekends') return `假日人多：${(op as { value: boolean }).value ? '是' : '否'}`
  if (p === 'Summary') return `簡述${(op as { op: string }).op === 'append' ? '補充' : '更新'}`
  if (p === 'Fee Details') return `收費說明${(op as { op: string }).op === 'append' ? '補充' : '更新'}`
  return p
}
