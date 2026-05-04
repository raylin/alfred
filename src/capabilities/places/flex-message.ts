import type { LineFlexMessage } from '../../integrations/line'
import type { RouteResult } from '../../integrations/routes-api'
import { formatRouteRow } from '../../lib/distance-format'
import type { Place } from './schema'

type FlexComponent = Record<string, unknown>

function textRow(label: string, value: string, inferred: boolean): FlexComponent {
  const valueContents: FlexComponent[] = [
    { type: 'text', text: value, color: '#111111', size: 'sm', flex: 1, wrap: true },
  ]
  if (inferred) {
    valueContents.push({
      type: 'text', text: 'AI推測', color: '#AAAAAA', size: 'xxs', flex: 0, align: 'end',
    })
  }
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#888888', size: 'sm', flex: 2 },
      { type: 'box', layout: 'horizontal', flex: 5, contents: valueContents },
    ],
  }
}

function inferred(place: Place, ...fields: string[]): boolean {
  return fields.some(f => place.ai_inferred_fields.includes(f))
}

export function buildDraftCard(place: Place, note?: string, distance?: RouteResult | null): LineFlexMessage {
  // Header subtitle
  const subtitleParts: string[] = [...place.categories]
  if (place.indoor_outdoor) subtitleParts.push(place.indoor_outdoor)

  const headerContents: FlexComponent[] = [
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: '●', color: '#27AE60', size: 'xs', flex: 0 },
        { type: 'text', text: ' 已整理完畢 · 已存進 Notion', color: '#27AE60', size: 'xs', flex: 1 },
      ],
    },
    { type: 'text', text: place.name, size: 'lg', weight: 'bold', color: '#111111', wrap: true },
  ]
  if (subtitleParts.length > 0) {
    headerContents.push({
      type: 'text', text: subtitleParts.join(' · '), size: 'sm', color: '#888888', wrap: true,
    })
  }

  // Body rows (§6.6 priority order, skip null)
  const bodyContents: FlexComponent[] = []

  // Disambiguation note (Story B: multiple candidates)
  if (note) {
    bodyContents.push({ type: 'text', text: note, size: 'sm', color: '#888888', wrap: true })
    bodyContents.push({ type: 'separator' })
  }

  // 位置
  const locationParts: string[] = []
  if (place.region) locationParts.push(place.region)
  if (place.address) locationParts.push(place.address.slice(0, 20))
  if (locationParts.length > 0) {
    bodyContents.push(textRow('位置', locationParts.join(' · '), inferred(place, 'Region', 'Address')))
  }

  // 適合年齡
  if (place.age_min != null || place.age_max != null) {
    let ageText: string
    if (place.age_min != null && place.age_max != null) ageText = `${place.age_min} ~ ${place.age_max} 歲`
    else if (place.age_min != null) ageText = `${place.age_min} 歲以上`
    else ageText = `${place.age_max} 歲以下`
    bodyContents.push(textRow('適合年齡', ageText, inferred(place, 'Age Min', 'Age Max')))
  }

  // 季節
  if (place.seasons.length > 0) {
    bodyContents.push(textRow('季節', place.seasons.join('、'), inferred(place, 'Seasons')))
  }

  // 收費
  if (place.fee_type) {
    const feeText = place.fee_details
      ? `${place.fee_type} · ${place.fee_details.slice(0, 20)}`
      : place.fee_type
    bodyContents.push(textRow('收費', feeText, inferred(place, 'Fee Type')))
  }

  // 停車/推車
  const amenities: string[] = []
  if (place.parking_friendly) amenities.push('停車方便')
  if (place.stroller_friendly) amenities.push('推車友善')
  if (amenities.length > 0) {
    bodyContents.push(textRow('設施', amenities.join(' · '), false))
  }

  // 簡述
  if (place.summary) {
    bodyContents.push(textRow('簡述', place.summary, inferred(place, 'Summary')))
  }

  // Distance row (optional — added post-Notion write, ADR-022)
  if (distance) {
    const rowText = formatRouteRow(distance)
    if (rowText) {
      bodyContents.push({ type: 'separator', margin: 'sm' })
      bodyContents.push({ type: 'text', text: rowText, size: 'sm', color: '#555555', wrap: true })
    }
  }

  const notionUri = place.notion_url ?? `https://www.notion.so/${place.notion_page_id ?? ''}`

  return {
    type: 'flex',
    altText: `已整理：${place.name}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', paddingAll: 'md', backgroundColor: '#FFFFFF',
        contents: headerContents,
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'md',
        contents: bodyContents,
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#2196F3',
            action: { type: 'uri', label: '在 Notion 開啟編輯', uri: notionUri },
          },
        ],
      },
    },
  }
}

export function buildDedupCard(name: string): LineFlexMessage {
  return {
    type: 'flex',
    altText: `「${name}」已經存過了，要更新嗎？`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: `「${name}」已經存過了`, weight: 'bold', size: 'md', wrap: true, color: '#111111' },
          { type: 'text', text: '要更新資訊，還是跳過？', size: 'sm', color: '#888888', margin: 'sm', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        paddingAll: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: { type: 'postback', label: '更新', data: 'dedup:update' },
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: { type: 'postback', label: '不用', data: 'dedup:skip' },
          },
        ],
      },
    },
  }
}

function buildSearchBubble(place: Place, distance?: RouteResult | null): Record<string, unknown> {
  const metaParts: string[] = []
  if (place.categories.length > 0) metaParts.push(place.categories[0])
  if (place.region) metaParts.push(place.region)
  if (place.indoor_outdoor) metaParts.push(place.indoor_outdoor)

  const bodyContents: FlexComponent[] = []

  // Age range
  if (place.age_min != null || place.age_max != null) {
    let ageText: string
    if (place.age_min != null && place.age_max != null) ageText = `${place.age_min}–${place.age_max} 歲`
    else if (place.age_min != null) ageText = `${place.age_min} 歲以上`
    else ageText = `${place.age_max} 歲以下`
    bodyContents.push({ type: 'text', text: `年齡 ${ageText}`, size: 'xs', color: '#555555' })
  }

  // Fee
  if (place.fee_type) {
    bodyContents.push({ type: 'text', text: place.fee_type, size: 'xs', color: '#555555' })
  }

  // Address (short)
  if (place.address) {
    bodyContents.push({
      type: 'text',
      text: place.address.slice(0, 25),
      size: 'xs',
      color: '#888888',
      wrap: true,
    })
  }

  // Summary (if body is sparse)
  if (bodyContents.length < 2 && place.summary) {
    bodyContents.push({
      type: 'text',
      text: place.summary.slice(0, 60),
      size: 'xs',
      color: '#555555',
      wrap: true,
    })
  }

  // Distance row (optional)
  const distanceRowText = distance ? formatRouteRow(distance) : ''

  const notionUri = place.notion_url ?? `https://www.notion.so/${place.notion_page_id ?? ''}`

  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'md',
      spacing: 'xs',
      contents: [
        { type: 'text', text: place.name, weight: 'bold', size: 'md', wrap: true, color: '#111111' },
        ...(metaParts.length > 0
          ? [{ type: 'text', text: metaParts.join(' · '), size: 'xs', color: '#888888', wrap: true }]
          : []),
        ...(bodyContents.length > 0 ? [{ type: 'separator', margin: 'sm' }, ...bodyContents] : []),
        ...(distanceRowText ? [{ type: 'separator', margin: 'sm' }, { type: 'text', text: distanceRowText, size: 'xs', color: '#555555', wrap: true }] : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'sm',
      contents: [
        {
          type: 'button',
          style: 'link',
          height: 'sm',
          action: { type: 'uri', label: '在 Notion 開啟', uri: notionUri },
        },
      ],
    },
  }
}

export function buildVisitCard(
  placeName: string,
  visitedOn: string,
  notes: string | null,
  rating: number | null,
  askForRating: boolean,
): LineFlexMessage {
  const bodyContents: FlexComponent[] = [
    { type: 'text', text: '✅ 已記錄造訪', color: '#27AE60', size: 'sm' },
    { type: 'text', text: placeName, weight: 'bold', size: 'lg', wrap: true, color: '#111111', margin: 'xs' },
    { type: 'text', text: visitedOn, size: 'sm', color: '#888888' },
  ]

  if (notes) {
    bodyContents.push({ type: 'separator', margin: 'sm' })
    bodyContents.push({ type: 'text', text: notes, size: 'sm', color: '#555555', wrap: true })
  }

  if (rating != null) {
    bodyContents.push({
      type: 'text',
      text: `${'⭐'.repeat(rating)} ${rating} / 5`,
      size: 'sm',
      color: '#F39C12',
      margin: 'sm',
    })
  }

  if (askForRating) {
    bodyContents.push({ type: 'separator', margin: 'sm' })
    bodyContents.push({
      type: 'text',
      text: '想給幾顆星嗎？(回傳 1-5，或傳「跳過」)',
      size: 'sm',
      color: '#888888',
      wrap: true,
      margin: 'xs',
    })
  }

  return {
    type: 'flex',
    altText: `已記錄造訪：${placeName}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'md',
        spacing: 'xs',
        contents: bodyContents,
      },
    },
  }
}

export function buildSearchCarousel(places: Place[], distances?: (RouteResult | null)[]): LineFlexMessage {
  return {
    type: 'flex',
    altText: `找到 ${places.length} 個地點`,
    contents: {
      type: 'carousel',
      contents: places.map((p, i) => buildSearchBubble(p, distances?.[i])),
    },
  }
}

export function buildDeleteConfirmCard(
  placeName: string,
  notionPageId: string,
  visitCount: number,
): LineFlexMessage {
  const visitNote = visitCount > 0
    ? { type: 'text', text: `⚠️ 會一併失去 ${visitCount} 筆造訪記錄`, size: 'sm', color: '#888888', wrap: true }
    : { type: 'text', text: '尚無造訪記錄', size: 'sm', color: '#888888' }

  return {
    type: 'flex',
    altText: `刪除「${placeName}」？`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'md',
        spacing: 'sm',
        contents: [
          { type: 'text', text: `刪除「${placeName}」？`, weight: 'bold', size: 'md', color: '#111111' },
          visitNote,
          { type: 'separator', margin: 'sm' },
          {
            type: 'button',
            style: 'primary',
            color: '#E53E3E',
            height: 'sm',
            margin: 'sm',
            action: { type: 'postback', label: '確認刪除', data: `delete:confirm:${notionPageId}` },
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            margin: 'sm',
            action: { type: 'postback', label: '取消', data: `delete:cancel:${notionPageId}` },
          },
        ],
      },
    },
  }
}
