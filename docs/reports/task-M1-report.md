# Execution Report — Task M1: 001-add-visit-summary-fields

## Summary

Created `scripts/migrations/_helpers.ts` (shared helpers for all future migrations) and `scripts/migrations/001-add-visit-summary-fields.ts` (first real migration). Migration adds three properties to the existing Place DB. All 4 acceptance tests passed against live Notion. 246 tests pass. TypeScript clean.

## Files Changed

- `scripts/migrations/_helpers.ts` (new) — shared helpers: `notionHeaders`, `getDatabase`, `addPropertiesIfMissing`, `findChildDatabase`, `createDatabase`, `ensureDatabase`
- `scripts/migrations/001-add-visit-summary-fields.ts` (new) — migration 001
- `docs/log.md` (modified) — prepended Task M1 entry
- `docs/reports/task-M1-report.md` (this file)

## Local Decisions Made

- **`_helpers.ts` for shared helpers, not inline in 001**: M2 will also need `findChildDatabase` + `ensureDatabase` (creating Visits + Settings DBs). Extracting now avoids copy-paste in M2. Five helpers were added: `getDatabase`, `addPropertiesIfMissing`, `findChildDatabase`, `createDatabase`, `ensureDatabase`. All use raw fetch + Notion API 2022-06-28 (ADR-017) — no SDK dependency in helpers at all.

- **`addPropertiesIfMissing` does one GET then one PATCH for all missing fields**: Rather than calling the API N times (one per property), it reads the schema once and batches all missing properties into a single PATCH call. More efficient and atomic for the user — all three fields appear in Notion at the same time. Returned `{ added, skipped }` arrays drive per-property log output in the migration's `up()`.

- **`ensureDatabase` wraps `findChildDatabase` + `createDatabase`**: M2 calls `ensureDatabase` which returns `{ id, created: boolean }`. The `created` flag lets M2 log "created" vs. "already existed" without re-querying.

## Tests

- No new unit tests — this is a script, not Workers code. `npm test` still passes: **246 passed (246)** across 20 test files.
- TypeScript: `tsc --noEmit -p scripts/tsconfig.json` clean.

## Live Acceptance Tests

**Test 1 — dry-run lists 001 as pending:**
```
$ npx tsx scripts/migrations/_runner.ts --dry-run
🗃   Migrations DB found  (c14ca6facb3742208fc1080b367692c8)
✓   Already applied (0): none
📂  Loaded 1 migration(s): 001-add-visit-summary-fields
📋  Pending (1): 001-add-visit-summary-fields
🏁  Dry run complete. No changes were made.
```

**Test 2 — actual run adds 3 properties:**
```
$ npx tsx scripts/migrations/_runner.ts
▶   001-add-visit-summary-fields: Add Last Visited (Date), Visit Count (Number), Avg Rating (Number) to Place DB
    ✦ Added:   Last Visited
    ✦ Added:   Visit Count
    ✦ Added:   Avg Rating
    ✅  done
🏁  Done. 1/1 migration(s) applied.
```
→ Verified in Notion UI: Last Visited (Date), Visit Count (Number), Avg Rating (Number) all visible in Place DB.

**Test 3 — re-run shows nothing to do:**
```
$ npx tsx scripts/migrations/_runner.ts
✓   Already applied (1): 001-add-visit-summary-fields
✅  No pending migrations. Nothing to do.
```

**Test 4 — idempotent with a fake 4th property (--only flag):**
```
$ npx tsx scripts/migrations/_runner.ts --only 001-add-visit-summary-fields
    ✦ Added:   _Test Idempotent Field
    ↳ Skipped (exists): Last Visited
    ↳ Skipped (exists): Visit Count
    ↳ Skipped (exists): Avg Rating
    ✅  done
```
→ 3 existing skipped, 1 new added. `_Test Idempotent Field` then deleted from Notion via API and removed from migration file.

## Spec Deviations / Ambiguities

None. Properties match spec §2.1 exactly (Last Visited → Date, Visit Count → Number, Avg Rating → Number). Property API names used as-is per spec table.

## Blocking Questions for PM

None. Ready for Task M2 (002-create-visits-db + 003-create-settings-db).
