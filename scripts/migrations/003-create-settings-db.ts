/**
 * Migration 003 — Create Settings DB (spec §2.3)
 *
 * Creates the Settings database under NOTION_PARENT_PAGE_ID with:
 *   Name (Title)            — LINE userId (primary key, bot-readable)
 *   Display Name (Rich text) — human-readable name ("老婆", "PM")
 *   Home Address (Rich text) — human-readable address string
 *   Home Lat (Number)        — latitude
 *   Home Lng (Number)        — longitude
 *   Configured At (Date)     — when home was last set
 *
 * Idempotent: ensureDatabase finds the existing DB if already created.
 */

import type { Migration } from './_types'
import { ensureDatabase } from './_helpers'

export const migration: Migration = {
  id: '003-create-settings-db',
  description: 'Create Settings DB for per-user home location and preferences (spec §2.3)',

  async up(env) {
    const properties: Record<string, unknown> = {
      Name: { title: {} },
      'Display Name': { rich_text: {} },
      'Home Address': { rich_text: {} },
      'Home Lat': { number: { format: 'number' } },
      'Home Lng': { number: { format: 'number' } },
      'Configured At': { date: {} },
    }

    const { id, created } = await ensureDatabase(
      env.NOTION_PARENT_PAGE_ID,
      'Settings',
      properties,
      env.NOTION_TOKEN,
    )

    const plainId = id.replace(/-/g, '')
    if (created) {
      console.log(`    ✦ Created Settings DB`)
      console.log(`      ID: ${plainId}`)
    } else {
      console.log(`    ↳ Settings DB already exists (${plainId})`)
    }
  },
}
