/**
 * Alfred Migration Runner
 *
 * Usage:
 *   npx tsx scripts/migrations/_runner.ts             # run all pending
 *   npx tsx scripts/migrations/_runner.ts --dry-run   # list pending, no changes
 *   npx tsx scripts/migrations/_runner.ts --only 001-add-visit-summary-fields
 *
 * Each migration file must export:
 *   export const migration: Migration = { id, description, up }
 *
 * up() must be idempotent — running it twice must be safe.
 */

import { config } from 'dotenv'
import { Client, isFullBlock } from '@notionhq/client'
import { readdirSync } from 'fs'
import { join } from 'path'
import type { Migration, ScriptEnv } from './_types'

config({ path: '.env.local' })

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`❌  Missing ${name}. Add it to .env.local and retry.`)
    process.exit(1)
  }
  return v
}

// SDK client — used only for blocks.children.list and databases.create (ADR-017)
// Querying pages uses raw fetch with Notion API 2022-06-28 (same as production notion.ts)
const notion = new Client({ auth: requireEnv('NOTION_TOKEN') })

const env: ScriptEnv = {
  NOTION_TOKEN: requireEnv('NOTION_TOKEN'),
  NOTION_PARENT_PAGE_ID: requireEnv('NOTION_PARENT_PAGE_ID'),
  NOTION_DB_ID: requireEnv('NOTION_DB_ID'),
}

// --- CLI flags ---
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const onlyIdx = args.indexOf('--only')
const onlyId: string | null = onlyIdx >= 0 ? (args[onlyIdx + 1] ?? null) : null

const MIGRATIONS_DB_TITLE = 'Migrations'
const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'  // keep in sync with src/integrations/notion.ts

function notionHeaders() {
  return {
    Authorization: `Bearer ${env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }
}

// --- Load migration modules from this directory ---
async function loadMigrations(): Promise<Migration[]> {
  const files = readdirSync(__dirname)
    .filter(f => f.endsWith('.ts') && !f.startsWith('_'))
    .sort()

  const migrations: Migration[] = []
  for (const file of files) {
    const mod = (await import(join(__dirname, file))) as { migration?: Migration }
    if (!mod.migration) {
      console.warn(`⚠️   ${file} does not export a "migration" — skipping`)
      continue
    }
    migrations.push(mod.migration)
  }
  return migrations
}

// --- Migrations DB: find ---
async function findMigrationsDb(): Promise<string | null> {
  let cursor: string | undefined
  do {
    const res = await notion.blocks.children.list({
      block_id: env.NOTION_PARENT_PAGE_ID,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    for (const block of res.results) {
      if (isFullBlock(block) && block.type === 'child_database') {
        if (block.child_database.title === MIGRATIONS_DB_TITLE) return block.id
      }
    }
    cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined
  } while (cursor)
  return null
}

// --- Migrations DB: create ---
async function createMigrationsDb(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: env.NOTION_PARENT_PAGE_ID },
    title: [{ type: 'text', text: { content: MIGRATIONS_DB_TITLE } }],
    initial_data_source: {
      properties: {
        Name: { title: {} },
        Description: { rich_text: {} },
        'Applied At': { date: {} },
      },
    },
  } as any)
  return db.id
}

async function ensureMigrationsDb(): Promise<string> {
  const existing = await findMigrationsDb()
  if (existing) {
    console.log(`🗃   Migrations DB found  (${existing.replace(/-/g, '')})`)
    return existing
  }
  console.log(`📝  Creating Migrations DB under parent page...`)
  const id = await createMigrationsDb()
  console.log(`✅  Migrations DB created (${id.replace(/-/g, '')})`)
  console.log()
  console.log(`    ⚠️  Action required: open Notion → Migrations DB → ⋯ → Connections`)
  console.log(`       → add "Alfred Bot", then re-run this command.`)
  console.log()
  process.exit(0)
}

// --- Read applied migration IDs from Migrations DB (raw fetch, Notion API 2022-06-28) ---
async function readApplied(dbId: string): Promise<Set<string>> {
  const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Migrations DB query failed (${res.status}): ${body}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as { results: any[] }
  const ids = new Set<string>()
  for (const page of data.results) {
    const title = page.properties?.Name?.title?.[0]?.plain_text ?? ''
    if (title) ids.add(title)
  }
  return ids
}

// --- Record a migration as applied (raw fetch, Notion API 2022-06-28) ---
async function recordApplied(dbId: string, migration: Migration): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const res = await fetch(`${NOTION_API}/pages`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties: {
        Name: { title: [{ text: { content: migration.id } }] },
        Description: { rich_text: [{ text: { content: migration.description } }] },
        'Applied At': { date: { start: today } },
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to record migration (${res.status}): ${body}`)
  }
}

// --- Main ---
async function main() {
  console.log('\n🔄  Alfred Migration Runner')
  if (dryRun) console.log('    Mode: DRY RUN (no changes will be made)')
  if (onlyId) console.log(`    Mode: ONLY ${onlyId}`)
  console.log()

  // Step 1: Ensure Migrations DB exists (spec §3.3 step 1) — done before loading files
  const migrationsDbId = await ensureMigrationsDb()
  const applied = await readApplied(migrationsDbId)
  console.log(`✓   Already applied (${applied.size}): ${[...applied].join(', ') || 'none'}`)
  console.log()

  // Step 2: Load migration files
  const allMigrations = await loadMigrations()
  if (allMigrations.length === 0) {
    console.log('📂  No migration files found. Nothing to do.')
    return
  }
  console.log(`📂  Loaded ${allMigrations.length} migration(s): ${allMigrations.map(m => m.id).join(', ')}`)
  console.log()

  // Step 3: Determine pending
  let toRun: Migration[]
  if (onlyId) {
    const found = allMigrations.find(m => m.id === onlyId)
    if (!found) {
      console.error(`❌  Migration not found: "${onlyId}"`)
      console.error(`    Available: ${allMigrations.map(m => m.id).join(', ')}`)
      process.exit(1)
    }
    toRun = [found]
  } else {
    toRun = allMigrations.filter(m => !applied.has(m.id))
  }

  if (toRun.length === 0) {
    console.log('✅  No pending migrations. Nothing to do.')
    return
  }

  console.log(`📋  Pending (${toRun.length}): ${toRun.map(m => m.id).join(', ')}`)
  console.log()

  if (dryRun) {
    console.log('🏁  Dry run complete. No changes were made.')
    return
  }

  // Step 4: Run sequentially; abort on first failure
  let ran = 0
  for (const migration of toRun) {
    console.log(`▶   ${migration.id}: ${migration.description}`)
    try {
      await migration.up(env)
      await recordApplied(migrationsDbId, migration)
      console.log(`    ✅  done\n`)
      ran++
    } catch (err) {
      console.error(`    ❌  failed — aborting. Subsequent migrations were NOT run.`)
      console.error(err)
      process.exit(1)
    }
  }

  console.log(`🏁  Done. ${ran}/${toRun.length} migration(s) applied.`)
}

main().catch(err => {
  console.error('Unexpected runner error:', err)
  process.exit(1)
})
