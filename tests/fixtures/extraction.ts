import type { GooglePlacesContext } from '../../src/capabilities/places/extract'

// Simulates a rich, detailed blog post — Claude can extract everything confidently
export const RICH_RAW_RESPONSE = {
  name: '兒童新樂園',
  categories: ['遊樂園'],
  indoor_outdoor: '半室內',
  address: '台北市士林區承德路五段55號',
  region: '台北',
  age_min: 3,
  age_max: 12,
  seasons: ['全年'],
  stroller_friendly: true,
  parking_friendly: true,
  has_restroom: true,
  has_nursing_room: null,
  energy_level: '放電型',
  stay_minutes: 240,
  reservation_needed: false,
  crowded_on_weekends: true,
  fee_type: '部分收費',
  fee_details: '入園免費，設施每項 20-80 元',
  summary: '台北市政府營運的中型遊樂園，設施分齡、價格平實，適合學齡前到小學階段的孩子放電一整個下午。',
  ai_inferred_fields: [],
}

// Simulates a vague blog post — Claude infers several fields with low confidence
export const VAGUE_RAW_RESPONSE = {
  name: '板橋某公園',
  categories: ['公園'],
  indoor_outdoor: '室外',
  address: null,
  region: '新北',
  age_min: 2,
  age_max: 8,
  seasons: ['全年'],
  stroller_friendly: null,
  parking_friendly: null,
  has_restroom: null,
  has_nursing_room: null,
  energy_level: '放電型',
  stay_minutes: null,
  reservation_needed: null,
  crowded_on_weekends: null,
  fee_type: '免費',
  fee_details: null,
  summary: '板橋區一座適合幼兒的戶外公園，適合親子在此玩耍放電。',
  ai_inferred_fields: ['Age Min', 'Age Max', 'Energy Level', 'Region'],
}

export const FIXTURE_BLOG_URL = 'https://mommytime.blog/taipei-kids-park'
export const FIXTURE_BLOG_HTML = `
兒童新樂園位於台北市士林區承德路五段55號，鄰近捷運芝山站。
園區適合3至12歲孩童，入園免費，各項遊樂設施單次收費20至80元不等。
設有多處廁所及大型停車場，推車可直接進入各遊樂區。
建議停留時間約4小時，假日人潮較多建議提早前往。
`

export const FIXTURE_GOOGLE_PLACES_CONTEXT: GooglePlacesContext = {
  name: '兒童新樂園',
  address: '111台北市士林區承德路五段55號',
  types: 'amusement_park, point_of_interest',
  rating: 4.2,
  hours: '週一至週五 09:00–17:00，週末 09:00–20:00',
  website: 'https://tcap.taipei/',
  editorialSummary: '大型戶外遊樂場，提供各種適合孩童的遊樂設施',
}
