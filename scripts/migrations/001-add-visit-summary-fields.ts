/**
 * Migration 001 — Add visit summary fields to Place DB (spec §2.1)
 *
 * Adds three properties to the existing Alfred — 親子景點 database:
 *   - Last Visited  (Date)    — most recent visit date, written by bot
 *   - Visit Count   (Number)  — total visits recorded
 *   - Avg Rating    (Number)  — average rating across all visits
 *
 * Idempotent: each property is only added if it doesn't already exist.
 */

import type { Migration } from './_types'
import { addPropertiesIfMissing } from './_helpers'

const PROPERTIES = [
  { name: 'Last Visited', config: { date: {} } },
  { name: 'Visit Count', config: { number: { format: 'number' } } },
  { name: 'Avg Rating', config: { number: { format: 'number' } } },
]

export const migration: Migration = {
  id: '001-add-visit-summary-fields',
  description: 'Add Last Visited (Date), Visit Count (Number), Avg Rating (Number) to Place DB',

  async up(env) {
    const { added, skipped } = await addPropertiesIfMissing(
      env.NOTION_DB_ID,
      PROPERTIES,
      env.NOTION_TOKEN,
    )

    for (const name of added) console.log(`    ✦ Added:   ${name}`)
    for (const name of skipped) console.log(`    ↳ Skipped (exists): ${name}`)
  },
}
