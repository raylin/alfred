import { createClient, chatJson, MODELS } from '../../integrations/anthropic'
import type { EditOp, Place } from './schema'
import type { Env } from '../../core/env'

const EDITABLE_PROPERTIES = `
可以編輯的屬性（使用 Notion API 名稱）：
- Age Min / Age Max / Stay Minutes: { "property": "Age Min"|"Age Max"|"Stay Minutes", "value": number | null }
- Indoor/Outdoor: { "property": "Indoor/Outdoor", "value": "室內"|"半室內"|"室外" }
- Energy Level: { "property": "Energy Level", "value": "放電型"|"適中"|"安靜型" }
- Fee Type: { "property": "Fee Type", "value": "免費"|"部分收費"|"全部收費" }
- Region: { "property": "Region", "value": "台北"|"新北"|"基隆"|"桃園"|"新竹"|"苗栗"|"台中"|"宜蘭"|"花蓮"|"其他" }
- Status: { "property": "Status", "value": "draft"|"confirmed"|"archived" }
- Categories/Seasons/Source Type: { "property": "Categories"|"Seasons"|"Source Type", "op": "add"|"remove"|"set", "values": string[] }
- 布林屬性: { "property": "Stroller Friendly"|"Parking Friendly"|"Has Restroom"|"Has Nursing Room"|"Reservation Needed"|"Crowded On Weekends", "value": true|false }
- Summary/Fee Details: { "property": "Summary"|"Fee Details", "op": "append"|"replace", "value": string }
- 改名（不支援，但請回傳以便提示）: { "property": "Name", "value": "新名字" }

Seasons 合法值："春"|"夏"|"秋"|"冬"|"全年"
`

function buildCurrentPlaceContext(place: Place): string {
  return JSON.stringify({
    'Categories（分類）': place.categories,
    'Indoor/Outdoor（室內外）': place.indoor_outdoor,
    'Age Min（年齡下限）': place.age_min,
    'Age Max（年齡上限）': place.age_max,
    'Seasons（季節）': place.seasons,
    'Energy Level（體力消耗）': place.energy_level,
    'Fee Type（收費）': place.fee_type,
    'Fee Details（收費說明）': place.fee_details,
    'Region（地區）': place.region,
    'Status（狀態）': place.status,
    'Stroller Friendly（推車）': place.stroller_friendly,
    'Parking Friendly（停車）': place.parking_friendly,
    'Has Restroom（廁所）': place.has_restroom,
    'Has Nursing Room（哺乳室）': place.has_nursing_room,
    'Stay Minutes（建議停留分鐘）': place.stay_minutes,
    'Reservation Needed（需預約）': place.reservation_needed,
    'Crowded On Weekends（假日人多）': place.crowded_on_weekends,
    'Summary（簡述）': place.summary,
    'Source Type（來源）': place.source_type,
  }, null, 2)
}

function buildSystemPrompt(place: Place): string {
  return `你是一個幫忙解析景點編輯指令的助手。

當前景點：${place.name}
當前狀態：
${buildCurrentPlaceContext(place)}
${EDITABLE_PROPERTIES}
根據用戶指令，回傳 JSON array of operations。無法解析 → 回傳 []。
只回傳 JSON array，不要其他文字。`
}

function isValidEditOp(op: unknown): op is EditOp {
  if (typeof op !== 'object' || op === null) return false
  const o = op as Record<string, unknown>
  if (typeof o['property'] !== 'string') return false
  return true
}

function sanitize(raw: unknown): EditOp[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isValidEditOp)
}

export async function parseEditIntent(
  message: string,
  currentPlace: Place,
  env: Env,
): Promise<EditOp[]> {
  const client = createClient(env)
  const system = buildSystemPrompt(currentPlace)
  const attempt = async () => sanitize(await chatJson<unknown>(client, MODELS.extraction, system, message))

  try {
    return await attempt()
  } catch {
    try {
      return await attempt()
    } catch {
      return []
    }
  }
}

// --- Edit target extraction (Story J: "大湖公園改成室內") ---

export type EditTarget = {
  target_place_name: string | null
  edit_message: string
}

const EDIT_TARGET_SYSTEM = `你是助手，幫忙從用戶的編輯訊息裡分離「景點名稱」和「編輯指令」。

回傳 JSON：{ "target_place_name": string | null, "edit_message": string }

範例：
- "大湖公園改成室內" → { "target_place_name": "大湖公園", "edit_message": "改成室內" }
- "把動物園的狀態設成 confirmed" → { "target_place_name": "動物園", "edit_message": "狀態設成 confirmed" }
- "改成 5-10 歲" → { "target_place_name": null, "edit_message": "改成 5-10 歲" }
- "加標籤沙坑" → { "target_place_name": null, "edit_message": "加標籤沙坑" }

只回傳 JSON。`

function sanitizeEditTarget(raw: unknown, fallback: string): EditTarget {
  if (typeof raw !== 'object' || raw === null) {
    return { target_place_name: null, edit_message: fallback }
  }
  const r = raw as Record<string, unknown>
  return {
    target_place_name: typeof r['target_place_name'] === 'string' && r['target_place_name'].length > 0
      ? r['target_place_name'] as string
      : null,
    edit_message: typeof r['edit_message'] === 'string' && r['edit_message'].length > 0
      ? r['edit_message'] as string
      : fallback,
  }
}

export async function parseEditTarget(message: string, env: Env): Promise<EditTarget> {
  const client = createClient(env)
  const attempt = async () =>
    sanitizeEditTarget(
      await chatJson<unknown>(client, MODELS.extraction, EDIT_TARGET_SYSTEM, message),
      message,
    )

  try {
    return await attempt()
  } catch {
    try {
      return await attempt()
    } catch {
      return { target_place_name: null, edit_message: message }
    }
  }
}
