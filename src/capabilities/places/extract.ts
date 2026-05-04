import type { Env } from '../../core/env'
import { createClient, chatJson, chatJsonWithImage, MODELS } from '../../integrations/anthropic'
import { generateUuid } from '../../lib/uuid'
import type { Place } from './schema'

// §7.2 system prompt for text-based extraction
const SYSTEM_PROMPT = `你是阿福，一個幫忙整理親子景點資訊的助手。輸入會是部落格文章原文、地點名稱，或 Google Maps 資訊。請輸出一個 JSON，符合以下 schema。

Output schema (strict, no extra fields, no markdown wrappers):

{
  "name": string,
  "categories": string[],
  "indoor_outdoor": "室內" | "半室內" | "室外" | null,
  "address": string | null,
  "region": "台北" | "新北" | "基隆" | "桃園" | "新竹" | "苗栗" | "台中" | "宜蘭" | "花蓮" | "其他" | null,
  "age_min": number | null,
  "age_max": number | null,
  "seasons": ("春"|"夏"|"秋"|"冬"|"全年")[],
  "stroller_friendly": boolean | null,
  "parking_friendly": boolean | null,
  "has_restroom": boolean | null,
  "has_nursing_room": boolean | null,
  "energy_level": "放電型" | "適中" | "安靜型" | null,
  "stay_minutes": number | null,
  "reservation_needed": boolean | null,
  "crowded_on_weekends": boolean | null,
  "fee_type": "免費" | "部分收費" | "全部收費" | null,
  "fee_details": string | null,
  "summary": string,
  "ai_inferred_fields": string[]
}

規則：
- 不確定的欄位用 null，不要硬猜。null 比錯的資訊好。
- ai_inferred_fields 列出「有給值但信心不高」的欄位，例如年齡是從文章語氣推測而非明確寫出。
- summary 不超過 80 字，重點是這地方對親子的特色，不是地址或營業時間。
- 只回 JSON，不要前後加任何文字、不要用 markdown code fence。`

type RawExtracted = {
  name: string
  categories: string[]
  indoor_outdoor: string | null
  address: string | null
  region: string | null
  age_min: number | null
  age_max: number | null
  seasons: string[]
  stroller_friendly: boolean | null
  parking_friendly: boolean | null
  has_restroom: boolean | null
  has_nursing_room: boolean | null
  energy_level: string | null
  stay_minutes: number | null
  reservation_needed: boolean | null
  crowded_on_weekends: boolean | null
  fee_type: string | null
  fee_details: string | null
  summary: string
  ai_inferred_fields: string[]
}

export type GooglePlacesContext = {
  name: string
  address: string
  types: string
  rating: number | null
  hours: string | null
  website: string | null
  editorialSummary: string | null
}

// Retry once on any failure per §7 spec requirement
async function callWithRetry(userPrompt: string, env: Env): Promise<RawExtracted> {
  const client = createClient(env)
  try {
    return await chatJson<RawExtracted>(client, MODELS.extraction, SYSTEM_PROMPT, userPrompt)
  } catch {
    return await chatJson<RawExtracted>(client, MODELS.extraction, SYSTEM_PROMPT, userPrompt)
  }
}

function assemblePlace(
  raw: RawExtracted,
  extra: {
    source_url: string | null
    source_type: Place['source_type']
    google_place_id?: string | null
    longitude?: number | null
    latitude?: number | null
  },
): Place {
  return {
    name:               raw.name,
    summary:            raw.summary,
    categories:         raw.categories as Place['categories'],
    seasons:            (raw.seasons.length > 0 ? raw.seasons : ['全年']) as Place['seasons'],
    ai_inferred_fields: raw.ai_inferred_fields,
    internal_id:        generateUuid(),
    source_type:        extra.source_type,
    indoor_outdoor:     raw.indoor_outdoor as Place['indoor_outdoor'],
    address:            raw.address,
    region:             raw.region as Place['region'],
    longitude:          extra.longitude ?? null,
    latitude:           extra.latitude ?? null,
    google_place_id:    extra.google_place_id ?? null,
    age_min:            raw.age_min,
    age_max:            raw.age_max,
    stroller_friendly:  raw.stroller_friendly,
    parking_friendly:   raw.parking_friendly,
    has_restroom:       raw.has_restroom,
    has_nursing_room:   raw.has_nursing_room,
    energy_level:       raw.energy_level as Place['energy_level'],
    stay_minutes:       raw.stay_minutes,
    reservation_needed: raw.reservation_needed,
    crowded_on_weekends:raw.crowded_on_weekends,
    fee_type:           raw.fee_type as Place['fee_type'],
    fee_details:        raw.fee_details,
    source_url:         extra.source_url,
    created_by:         null,
  }
}

// Image extraction system prompt
const IMAGE_SYSTEM_PROMPT = `你是阿福，一個幫忙整理親子景點資訊的助手。圖片可能是：IG 截圖 / FB 截圖 / LINE 對話截圖、實體店家招牌或環境照片、雜誌剪報、傳單、菜單、官網截圖。

先判斷圖中是否有具體景點/店家資訊，有的話依下方 schema 抽取。
若整張圖看不出明確景點（例如純風景照、人像、迷因），回 { "error": "no_place_detected" }。

Output schema (strict, no extra fields, no markdown wrappers):

{
  "name": string,
  "categories": string[],
  "indoor_outdoor": "室內" | "半室內" | "室外" | null,
  "address": string | null,
  "region": "台北" | "新北" | "基隆" | "桃園" | "新竹" | "苗栗" | "台中" | "宜蘭" | "花蓮" | "其他" | null,
  "age_min": number | null,
  "age_max": number | null,
  "seasons": ("春"|"夏"|"秋"|"冬"|"全年")[],
  "stroller_friendly": boolean | null,
  "parking_friendly": boolean | null,
  "has_restroom": boolean | null,
  "has_nursing_room": boolean | null,
  "energy_level": "放電型" | "適中" | "安靜型" | null,
  "stay_minutes": number | null,
  "reservation_needed": boolean | null,
  "crowded_on_weekends": boolean | null,
  "fee_type": "免費" | "部分收費" | "全部收費" | null,
  "fee_details": string | null,
  "summary": string,
  "ai_inferred_fields": string[]
}

規則：
- 不確定的欄位用 null，不要硬猜。null 比錯的資訊好。
- ai_inferred_fields 列出「有給值但信心不高」的欄位。圖片來源通常信心較低，ai_inferred_fields 比較多是正常的。
- summary 不超過 80 字，重點是這地方對親子的特色，不是地址或營業時間。
- 只回 JSON，不要前後加任何文字、不要用 markdown code fence。`

type RawExtractedOrError = RawExtracted | { error: 'no_place_detected' }

export class NoPlaceDetectedError extends Error {
  constructor() {
    super('no_place_detected')
    this.name = 'NoPlaceDetectedError'
  }
}

async function callImageWithRetry(imageBase64: string, mimeType: string, env: Env): Promise<RawExtracted> {
  const client = createClient(env)

  async function attempt(): Promise<RawExtracted> {
    const result = await chatJsonWithImage<RawExtractedOrError>(client, MODELS.extraction, IMAGE_SYSTEM_PROMPT, imageBase64, mimeType)
    if ('error' in result && result.error === 'no_place_detected') throw new NoPlaceDetectedError()
    return result as RawExtracted
  }

  try {
    return await attempt()
  } catch (err) {
    if (err instanceof NoPlaceDetectedError) throw err
    return await attempt()
  }
}

// §7.3 — Story Image: LINE image message
export async function extractFromImage(
  imageBase64: string,
  mimeType: string,
  env: Env,
): Promise<Place> {
  const raw = await callImageWithRetry(imageBase64, mimeType, env)
  return assemblePlace(raw, { source_url: null, source_type: [] })
}

// §7.3 — Story A: blog/article URL
export async function extractFromHtml(
  url: string,
  htmlText: string,
  env: Env,
): Promise<Place> {
  const userPrompt = `來源：部落格文章 (${url})\n\n文章原文：\n${htmlText}`
  const raw = await callWithRetry(userPrompt, env)
  return assemblePlace(raw, { source_url: url, source_type: ['部落格'] })
}

// §7.3 — Story B (plain text) and Story C (Google Maps URL)
export async function extractFromGooglePlaces(
  userInput: string,
  context: GooglePlacesContext,
  sourceType: Place['source_type'],
  env: Env,
): Promise<Place> {
  const lines = [
    `來源：使用者輸入「${userInput}」，Google Places 找到以下地點。`,
    '',
    `地點名稱：${context.name}`,
    `地址：${context.address}`,
    `類型：${context.types}`,
    `評分：${context.rating ?? '無'}`,
    `營業時間：${context.hours ?? '無'}`,
    `官方網站：${context.website ?? '無'}`,
    `編輯摘要：${context.editorialSummary ?? '無'}`,
    '',
    '請根據以上資訊填 schema。沒有的欄位用 null。',
  ]
  const raw = await callWithRetry(lines.join('\n'), env)
  return assemblePlace(raw, {
    source_url:  context.website,
    source_type: sourceType,
  })
}
