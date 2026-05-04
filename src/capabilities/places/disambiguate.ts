import type { LineFlexMessage } from '../../integrations/line'
import type { Place } from './schema'

export function buildDisambiguateCard(places: Place[], actionType: 'visit' | 'edit' | 'delete'): LineFlexMessage {
  const buttons = places.slice(0, 5).map(p => ({
    type: 'button',
    style: 'secondary' as const,
    height: 'sm' as const,
    margin: 'sm' as const,
    action: {
      type: 'postback',
      label: p.name.slice(0, 20),
      data: `${actionType}:select:${p.notion_page_id}`,
    },
  }))

  return {
    type: 'flex',
    altText: '你說的是哪個地方？',
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: 'md',
        spacing: 'sm',
        contents: [
          { type: 'text', text: '你說的是哪個地方？', weight: 'bold', size: 'md', color: '#111111' },
          { type: 'separator', margin: 'sm' },
          ...buttons,
        ],
      },
    },
  }
}
