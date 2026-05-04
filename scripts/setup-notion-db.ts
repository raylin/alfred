/**
 * One-time setup script: creates the Alfred Place DB in Notion with all §4.1 properties.
 * Idempotent — skips creation if a database named "Alfred — 親子景點" already exists
 * under the same parent page.
 *
 * Usage:
 *   1. Add NOTION_TOKEN and NOTION_PARENT_PAGE_ID to .env.local
 *   2. npx tsx scripts/setup-notion-db.ts
 *   3. Copy printed DB ID → npx wrangler secret put NOTION_DB_ID
 *
 * Note: Notion API 2025-09-03 places properties under initial_data_source.properties
 * (not the top-level properties field used in older API versions).
 */

import { config } from 'dotenv'
import { Client, isFullBlock } from '@notionhq/client'

config({ path: '.env.local' })

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`❌  Missing ${name}. Add it to .env.local and retry.`)
    process.exit(1)
  }
  return v
}

const notion = new Client({ auth: requireEnv('NOTION_TOKEN') })
const parentPageId = requireEnv('NOTION_PARENT_PAGE_ID')
const DB_TITLE = 'Alfred — 親子景點'

// Color type matching Notion SDK SelectColor
type Color =
  | 'default' | 'gray' | 'brown' | 'orange' | 'yellow'
  | 'green' | 'blue' | 'purple' | 'pink' | 'red'

function opt(name: string, color: Color) {
  return { name, color }
}

// --- Idempotency check ---

async function findExistingDb(): Promise<string | null> {
  let cursor: string | undefined
  do {
    const res = await notion.blocks.children.list({
      block_id: parentPageId,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    for (const block of res.results) {
      if (isFullBlock(block) && block.type === 'child_database') {
        if (block.child_database.title === DB_TITLE) return block.id
      }
    }
    cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined
  } while (cursor)
  return null
}

// --- Property definitions (§4.1) ---
// Uses `any` cast because Notion SDK types require mutable arrays but `as const` makes them
// readonly — acceptable in a setup script where runtime correctness matters more than strict typing.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProperties(): any {
  return {
    // Required: exactly one title property
    'Name': { title: {} },

    // Status (Notion Status type, not Select)
    'Status': {
      status: {
        options: [
          opt('draft', 'gray'),
          opt('confirmed', 'green'),
          opt('archived', 'red'),
        ],
      },
    },

    // Multi-selects
    'Categories': {
      multi_select: {
        options: [
          opt('公園', 'green'),
          opt('餐廳', 'orange'),
          opt('步道', 'blue'),
          opt('動物園', 'brown'),
          opt('遊樂園', 'yellow'),
          opt('博物館', 'purple'),
          opt('圖書館', 'blue'),
          opt('親子館', 'pink'),
          opt('觀光工廠', 'gray'),
          opt('沙灘', 'yellow'),
          opt('露營地', 'green'),
          opt('室內遊戲場', 'pink'),
          opt('其他', 'default'),
        ],
      },
    },
    'Seasons': {
      multi_select: {
        options: [
          opt('春', 'green'),
          opt('夏', 'yellow'),
          opt('秋', 'orange'),
          opt('冬', 'blue'),
          opt('全年', 'gray'),
        ],
      },
    },
    'Source Type': {
      multi_select: {
        options: [
          opt('部落格', 'blue'),
          opt('Google Maps', 'green'),
          opt('朋友推薦', 'pink'),
          opt('自己探索', 'purple'),
          opt('官方網站', 'gray'),
        ],
      },
    },
    // Options populated at runtime by the bot
    'AI Inferred Fields': { multi_select: { options: [] } },

    // Selects
    'Indoor/Outdoor': {
      select: {
        options: [
          opt('室內', 'blue'),
          opt('半室內', 'yellow'),
          opt('室外', 'green'),
        ],
      },
    },
    'Region': {
      select: {
        options: [
          opt('台北', 'blue'),
          opt('新北', 'blue'),
          opt('基隆', 'gray'),
          opt('桃園', 'green'),
          opt('新竹', 'green'),
          opt('苗栗', 'brown'),
          opt('台中', 'orange'),
          opt('宜蘭', 'green'),
          opt('花蓮', 'blue'),
          opt('其他', 'default'),
        ],
      },
    },
    'Energy Level': {
      select: {
        options: [
          opt('放電型', 'red'),
          opt('適中', 'yellow'),
          opt('安靜型', 'blue'),
        ],
      },
    },
    'Fee Type': {
      select: {
        options: [
          opt('免費', 'green'),
          opt('部分收費', 'yellow'),
          opt('全部收費', 'orange'),
        ],
      },
    },

    // Rich text
    'Address': { rich_text: {} },
    'Google Place ID': { rich_text: {} },
    'Fee Details': { rich_text: {} },
    'Summary': { rich_text: {} },
    'Internal ID': { rich_text: {} },
    'Created By': { rich_text: {} },

    // Numbers
    'Longitude': { number: { format: 'number' } },
    'Latitude': { number: { format: 'number' } },
    'Age Min': { number: { format: 'number' } },
    'Age Max': { number: { format: 'number' } },
    'Stay Minutes': { number: { format: 'number' } },

    // URL
    'Source URLs': { url: {} },

    // Checkboxes
    'Stroller Friendly': { checkbox: {} },
    'Parking Friendly': { checkbox: {} },
    'Has Restroom': { checkbox: {} },
    'Has Nursing Room': { checkbox: {} },
    'Reservation Needed': { checkbox: {} },
    'Crowded On Weekends': { checkbox: {} },

    // Automatic timestamps
    'Created Time': { created_time: {} },
    'Last Edited': { last_edited_time: {} },
  }
}

// --- Main ---

async function main() {
  console.log(`\n🔍  Checking for existing "${DB_TITLE}"...`)
  const existingId = await findExistingDb()

  if (existingId) {
    const plainId = existingId.replace(/-/g, '')
    console.log(`\n⚠️   Database already exists — skipping creation (idempotent).`)
    printDbId(plainId)
    return
  }

  console.log(`📝  Creating database with ${Object.keys(buildProperties()).length} properties...`)
  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    icon: { type: 'emoji', emoji: '📍' },
    title: [{ type: 'text', text: { content: DB_TITLE } }],
    initial_data_source: { properties: buildProperties() },
  })

  const plainId = db.id.replace(/-/g, '')
  console.log(`\n✅  Database created!`)
  printDbId(plainId)

  console.log(`\n📌  Views (待我審核 / 已確認 / 依區域 / 依年齡) cannot be created via API.`)
  console.log(`    See README → Notion Setup → Manual Views for step-by-step instructions.\n`)
}

function printDbId(id: string) {
  console.log(`\n    Database ID: ${id}`)
  console.log(`\n    Run:  npx wrangler secret put NOTION_DB_ID`)
  console.log(`          (paste the ID above when prompted)\n`)
}

main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`\n❌  Script failed: ${msg}\n`)
  process.exit(1)
})
