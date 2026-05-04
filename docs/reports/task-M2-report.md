# Execution Report — Task M2: Create Visits + Settings DBs

## Summary

Created `002-create-visits-db.ts` and `003-create-settings-db.ts` migrations using the `_helpers.ts` shared layer. Added `formatVisitTitle` helper + unit test. Added `discoverDbIds` (DB ID discovery with KV cache) to `notion.ts` and added `NOTION_PARENT_PAGE_ID` to the Workers Env type. 8 new tests; 254 total. All 6 acceptance tests passed live. TypeScript clean.

## Files Changed

- `scripts/migrations/002-create-visits-db.ts` (new) — creates Visits DB with 7 properties + Place relation
- `scripts/migrations/003-create-settings-db.ts` (new) — creates Settings DB with 6 properties
- `src/lib/visit-title.ts` (new) — `formatVisitTitle(placeName, date)` helper
- `src/core/env.ts` (modified) — added `NOTION_PARENT_PAGE_ID: string` to Env type
- `src/integrations/notion.ts` (modified) — added `DbIds` type and `discoverDbIds(env)` function
- `tests/unit/visit-title.test.ts` (new) — 3 tests for formatVisitTitle
- `tests/unit/db-discovery.test.ts` (new) — 5 tests for discoverDbIds (KV hit/miss, error paths)
- `scripts/verify-db-discovery.ts` (new) — live smoke-test script
- `docs/ADR.md` (modified) — ADR-019 (DB discovery via Notion scan + KV cache)
- `docs/log.md` + `docs/reports/task-M2-report.md`

## Local Decisions Made

- **ADR-019 — Option B (DB discovery)**: `discoverDbIds` in `notion.ts` checks KV `system:db_ids` first (24h TTL); on miss, scans `NOTION_PARENT_PAGE_ID` children for the 3 known DB titles. Eliminates manual `wrangler secret put` for Visits/Settings IDs. DB titles must remain stable. `NOTION_PARENT_PAGE_ID` must now be set as a Cloudflare secret before deploying Phase 1.5 features.

- **Relation property requires `type: "single_property"` and `single_property: {}`**: The Notion API 2022-06-28 returned a 400 validation error when only `database_id` was provided in the relation config. Added `type: 'single_property'` + `single_property: {}` to satisfy the API. Added comment to `_helpers.ts` note.

- **`formatVisitTitle` lives in `src/lib/`**: Consistent with `distance-format.ts` location (per spec §4.1). Will be imported by `flow-visit.ts` in Task 18.

- **`verify-db-discovery.ts` as acceptance script (not unit test)**: The Workers KV is not accessible in script context. Rather than create a complex mock-only unit test for end-to-end discovery, a small script that calls `findChildDatabase` directly from `_helpers.ts` verifies the Notion API calls work correctly against real Notion.

## Tests

- `visit-title.test.ts`: 3 tests — format output, locale characters, date format preserved
- `db-discovery.test.ts`: 5 tests — KV miss → scan → cache; KV hit → skip fetch; missing DB throws; API error throws; headers verified
- Run result: **254 passed (254)** across 22 test files
- TypeScript: `tsc --noEmit` clean

## Live Acceptance Tests

**1. Dry-run lists 002 + 003 as pending:**
```
📋  Pending (2): 002-create-visits-db, 003-create-settings-db
🏁  Dry run complete. No changes were made.
```

**2. Actual run creates both DBs:**
```
▶   002-create-visits-db: Create Visits DB with relation to Place DB (spec §2.2)
    ✦ Created Visits DB
      ID: 356d06a9b2ec81fba700dc75bfedfd72
▶   003-create-settings-db: Create Settings DB ...
    ✦ Created Settings DB
      ID: 356d06a9b2ec81e2821dd243807b1489
🏁  Done. 2/2 migration(s) applied.
```

**3. Re-run: Already applied (3) — Nothing to do** ✓

**4. Visits DB schema verified via Notion API:**
```
Created Time: created_time
Logged By: rich_text
Name: title
Notes: rich_text
Place: relation → c5b49359-9d3d-44a6-89d4-932bd8a1d2e8  ← Place DB ✓
Rating: number
Visited On: date
```
Settings DB: all 6 properties present (Name/title, Display Name, Home Address, Home Lat, Home Lng, Configured At)

**5. Re-run shows "Already applied (3)"** ✓

**6. DB discovery finds all 3:**
```
$ npx tsx scripts/verify-db-discovery.ts
  ✅  places    "Alfred — 親子景點" → c5b493599d3d44a689d4932bd8a1d2e8
  ✅  visits    "Visits" → 356d06a9b2ec81fba700dc75bfedfd72
  ✅  settings  "Settings" → 356d06a9b2ec81e2821dd243807b1489
🏁  All 3 databases found. Discovery logic works.
```

## Action Required Before Phase 1.5 Deploy

`NOTION_PARENT_PAGE_ID` has been added to `Env` type. Must be stored as a Cloudflare secret before features that use `discoverDbIds` are deployed:

```bash
npx wrangler secret put NOTION_PARENT_PAGE_ID
# paste: 356d06a9b2ec8009838cd212d2f17715
```

## Spec Deviations / Ambiguities

- **Notion API requires `single_property: {}` in relation config**: Not mentioned in spec §2.2, discovered via API 400 error. Added to migration; no spec change needed (it's an implementation detail).
- **Visits DB title format confirmed by PM**: `{place_name} - {date}` (e.g., "大湖公園 - 2026-05-12") per PM clarification in task handoff. Implemented in `formatVisitTitle`; will be used by `flow-visit.ts` in Task 18.

## Blocking Questions for PM

None. Migration infrastructure complete (M0 → M1 → M2 done). Next: Task 18 (Home Setup / Story N) — prerequisite for Task 17 (Distance/Transit).
