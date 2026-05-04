// All Notion property API names live here. Adding a new field = edit this file only.
export const N = {
  name:               'Name',
  status:             'Status',
  categories:         'Categories',
  indoor_outdoor:     'Indoor/Outdoor',
  address:            'Address',
  region:             'Region',
  longitude:          'Longitude',
  latitude:           'Latitude',
  google_place_id:    'Google Place ID',
  age_min:            'Age Min',
  age_max:            'Age Max',
  seasons:            'Seasons',
  stroller_friendly:  'Stroller Friendly',
  parking_friendly:   'Parking Friendly',
  has_restroom:       'Has Restroom',
  has_nursing_room:   'Has Nursing Room',
  energy_level:       'Energy Level',
  stay_minutes:       'Stay Minutes',
  reservation_needed: 'Reservation Needed',
  crowded_on_weekends:'Crowded On Weekends',
  fee_type:           'Fee Type',
  fee_details:        'Fee Details',
  summary:            'Summary',
  source_url:         'Source URLs',
  source_type:        'Source Type',
  ai_inferred_fields: 'AI Inferred Fields',
  internal_id:        'Internal ID',
  created_by:         'Created By',
} as const

export type Category =
  | '公園' | '餐廳' | '步道' | '動物園' | '遊樂園' | '博物館'
  | '圖書館' | '親子館' | '觀光工廠' | '沙灘' | '露營地' | '室內遊戲場' | '其他'

export type IndoorOutdoor = '室內' | '半室內' | '室外'
export type Region = '台北' | '新北' | '基隆' | '桃園' | '新竹' | '苗栗' | '台中' | '宜蘭' | '花蓮' | '其他'
export type Season = '春' | '夏' | '秋' | '冬' | '全年'
export type EnergyLevel = '放電型' | '適中' | '安靜型'
export type FeeType = '免費' | '部分收費' | '全部收費'
export type Status = 'draft' | 'confirmed' | 'archived'
export type SourceType = '部落格' | 'Google Maps' | '朋友推薦' | '自己探索' | '官方網站'

export type Place = {
  // Core — always present
  name: string
  summary: string
  categories: Category[]
  seasons: Season[]
  ai_inferred_fields: string[]
  internal_id: string
  source_type: SourceType[]

  // Nullable — may be unknown at extraction time
  indoor_outdoor: IndoorOutdoor | null
  address: string | null
  region: Region | null
  longitude: number | null
  latitude: number | null
  google_place_id: string | null
  age_min: number | null
  age_max: number | null
  stroller_friendly: boolean | null
  parking_friendly: boolean | null
  has_restroom: boolean | null
  has_nursing_room: boolean | null
  energy_level: EnergyLevel | null
  stay_minutes: number | null
  reservation_needed: boolean | null
  crowded_on_weekends: boolean | null
  fee_type: FeeType | null
  fee_details: string | null
  source_url: string | null
  created_by: string | null

  // Set by Notion after creation / read
  notion_page_id?: string
  notion_url?: string
  status?: Status
}

export type SearchFilters = {
  indoor_outdoor?: string | null
  age?: number | null
  region?: string | null
  categories?: string[] | null
  seasons?: string[] | null
  fee_type?: string | null
  energy_level?: string | null
  free_text_keywords?: string[]
}
