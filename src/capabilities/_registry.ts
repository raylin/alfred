export type Capability = {
  id: string
  description: string
  examples_positive: string[]
  examples_negative: string[]
  keywords: string[]
  accepts_images?: boolean
}

export const capabilities: Capability[] = [
  {
    id: 'places',
    accepts_images: true,
    description: '記錄或搜尋親子景點（公園、餐廳、遊樂場、步道等）',
    examples_positive: [
      '大湖公園划船',
      'https://mommytime.blog/taipei-kids-park',
      'https://maps.app.goo.gl/abc123',
      '下雨天三歲適合的台北景點',
      '台北室內親子餐廳推薦',
      '新北有什麼適合帶小孩去的地方',
    ],
    examples_negative: [
      '你好',
      '今天天氣如何',
      '幫我設定明天的提醒',
      '謝謝',
    ],
    keywords: [
      '公園', '餐廳', '步道', '遊樂', '景點', '帶小孩', '親子', '博物館',
      '圖書館', '動物園', '海灘', '露營', '推薦', '適合', '適合幾歲',
      'http', 'https', 'maps.app', 'goo.gl',
    ],
  },
]
