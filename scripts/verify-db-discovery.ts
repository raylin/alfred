/**
 * Live smoke-test for the discoverDbIds logic.
 * Scans NOTION_PARENT_PAGE_ID for all Alfred databases and verifies all 3 are found.
 * Does not use KV cache (scripts have no Workers KV access).
 *
 * Usage:  npx tsx scripts/verify-db-discovery.ts
 */

import { config } from 'dotenv'
import { findChildDatabase } from './migrations/_helpers'

config({ path: '.env.local' })

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) { console.error(`❌  Missing ${name}`); process.exit(1) }
  return v
}

const token = requireEnv('NOTION_TOKEN')
const parentPageId = requireEnv('NOTION_PARENT_PAGE_ID')

const EXPECTED: Record<string, string> = {
  'Alfred — 親子景點': 'places',
  'Visits':            'visits',
  'Settings':          'settings',
}

async function main() {
  console.log('\n🔍  Verifying DB discovery under parent page...\n')

  const found: Record<string, string> = {}  // dbKey → id

  for (const [title, key] of Object.entries(EXPECTED)) {
    const id = await findChildDatabase(parentPageId, title, token)
    if (id) {
      console.log(`  ✅  ${key.padEnd(9)} "${title}" → ${id.replace(/-/g, '')}`)
      found[key] = id
    } else {
      console.log(`  ❌  ${key.padEnd(9)} "${title}" — NOT FOUND`)
    }
  }

  const missing = Object.keys(EXPECTED).filter(title => !found[EXPECTED[title]])
  console.log()
  if (missing.length === 0) {
    console.log(`🏁  All ${Object.keys(EXPECTED).length} databases found. Discovery logic works.\n`)
  } else {
    console.log(`❌  Missing: ${missing.join(', ')}`)
    process.exit(1)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
