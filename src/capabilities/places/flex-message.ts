import type { LineFlexMessage } from '../../integrations/line'
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

export function buildDraftCard(place: Place): LineFlexMessage {
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
