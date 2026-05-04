/**
 * Migration 002 — Create Visits DB (spec §2.2)
 *
 * Creates the Visits database under NOTION_PARENT_PAGE_ID with:
 *   Name (Title)        — "{place_name} - {date}" — composed at write time by flow-visit
 *   Place (Relation)    — single-property relation to the Place DB
 *   Visited On (Date)   — required, the visit date
 *   Rating (Number)     — 1-5, nullable
 *   Notes (Rich text)   — free text
 *   Logged By (Rich text) — LINE userId
 *   Created Time (Created time) — automatic
 *
 * Idempotent: ensureDatabase finds the existing DB if already created.
 */

import type { Migration } from './_types'
import { ensureDatabase } from './_helpers'

export const migration: Migration = {
  id: '002-create-visits-db',
  description: 'Create Visits DB with relation to Place DB (spec §2.2)',

  async up(env) {
    const properties: Record<string, unknown> = {
      Name: { title: {} },
      Place: {
        relation: {
          database_id: env.NOTION_DB_ID,
          type: 'single_property',
          single_property: {},
        },
      },
      'Visited On': { date: {} },
      Rating: { number: { format: 'number' } },
      Notes: { rich_text: {} },
      'Logged By': { rich_text: {} },
      'Created Time': { created_time: {} },
    }

    const { id, created } = await ensureDatabase(
      env.NOTION_PARENT_PAGE_ID,
      'Visits',
      properties,
      env.NOTION_TOKEN,
    )

    const plainId = id.replace(/-/g, '')
    if (created) {
      console.log(`    ✦ Created Visits DB`)
      console.log(`      ID: ${plainId}`)
    } else {
      console.log(`    ↳ Visits DB already exists (${plainId})`)
    }
  },
}
