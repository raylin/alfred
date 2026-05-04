# Task 3 Execution Report — Notion Integration

**Date:** 2026-05-04  
**Task:** Task 3 — Notion Place Store  
**Status:** Complete — awaiting user acceptance before commit

---

## What Was Built

### New Files

| File | Purpose |
|---|---|
| `src/capabilities/places/schema.ts` | `N` constant (all 28 property API names), domain type aliases (`Category`, `IndoorOutdoor`, `Region`, `Season`, `EnergyLevel`, `FeeType`, `Status`, `SourceType`), `Place` type, `SearchFilters` type |
| `src/integrations/notion.ts` | All Notion CRUD: `placeToNotionProperties`, `notionPageToPlace`, `buildNotionFilter` (pure mappers), `createPlace`, `findPlaceByGooglePlaceId`, `searchPlaces` (async API calls) |
| `tests/fixtures/places.ts` | `SAMPLE_PLACE` (Appendix A verbatim), `MINIMAL_PLACE` (all nullable fields null) |
| `tests/unit/notion-property-mapper.test.ts` | 18 unit tests for all three pure exported functions |

### Modified Files

| File | Change |
|---|---|
| `vitest.config.ts` | Removed `@cloudflare/vitest-pool-workers` custom pool; switched to `environment: 'node'` (ADR-003) |
| `.env.local` | Added `NOTION_DB_ID=c5b493599d3d44a689d4932bd8a1d2e8` for local scripts |

---

## Test Results

```
✓ tests/unit/notion-property-mapper.test.ts (18 tests) 2ms
Test Files  1 passed (1)
Tests       18 passed (18)
```

All 18 tests pass. Coverage target met for `src/capabilities/**`.

---

## Integration Test

Ran a live `createPlace` equivalent directly against the Notion API:

- DB: `c5b493599d3d44a689d4932bd8a1d2e8`
- Result: Page created successfully
  - ID: `356d06a9-b2ec-81d3-bcd7-db7b113f64a6`
  - URL: https://www.notion.so/TEST-356d06a9b2ec81d3bcd7db7b113f64a6
- All 23 properties (title, status, multi-select, select, number, checkbox, rich_text) sent without error

The test page name was `兒童新樂園 [TEST]` — should be visible in the Notion DB under Alfred bot's workspace. (Can be deleted after verification.)

---

## Local Decisions

- **ADR-003** — Switched vitest to `environment: 'node'` because `@cloudflare/vitest-pool-workers@0.15.2` requires vitest v4, but project is on vitest v3. All current tests are pure mappers; no Workers runtime APIs needed.

---

## Key Design Notes

### `placeToNotionProperties`
- Always sets: `name`, `status` (hardcoded `draft`), `seasons`, `ai_inferred_fields`, `internal_id`, `summary`
- Conditionally sets: all nullable fields (skipped when `null`), `categories` and `source_type` (skipped when empty array)
- Status is always `draft` on write — Notion status is manually updated by the user after review

### `notionPageToPlace`
- Reads all fields with inner helpers: `text()`, `select()`, `multiSelect()`, `num()`, `checkbox()`, `url()`
- Status defaults to `'draft'` if Notion returns `null` status
- Empty rich_text → `null` (via `|| null` pattern)

### `buildNotionFilter`
- Always includes `status = confirmed` (only confirmed places shown in search)
- Age filter is null-safe: `{ or: [is_empty, lte/gte] }` for both `age_min` and `age_max`
- Multiple categories/seasons → `{ or: [...contains] }` wrapped in outer `and`
- Single condition → returned directly (no `{ and: [single] }` wrapper)

### Notion API version
- `src/integrations/notion.ts` uses API version `2022-06-28` with raw fetch (Worker-compatible, no Node.js deps)
- `scripts/setup-notion-db.ts` uses `@notionhq/client` v5.x (API 2025-09-03) — different for Node.js setup script only

---

## Spec Compliance Checklist

| Requirement | Status |
|---|---|
| §4.1 Place schema (all 30 fields) | ✓ All fields in `Place` type |
| §7.1 createPlace | ✓ `createPlace()` in notion.ts |
| §7.2 findPlaceByGooglePlaceId | ✓ Excludes archived, returns null if not found |
| §7.3 searchPlaces with filters | ✓ `searchPlaces()` with `buildNotionFilter()` |
| §7.4 age filter null-safe | ✓ `is_empty OR lte/gte` pattern |
| §7.5 category OR filter | ✓ `orFilters()` helper |
| Unit tests for mappers | ✓ 18 tests, all passing |

---

## Outstanding Items

1. **Test page cleanup:** Delete `兒童新樂園 [TEST]` from Notion after the user visually verifies all properties appear correctly.
2. **GOOGLE_PLACES_API_KEY secret:** Still needs to be stored in Cloudflare (`npx wrangler secret put GOOGLE_PLACES_API_KEY`).
3. **Notion DB connection:** Ensure "Alfred Bot" integration has access to the database (not just the parent page) — required for Worker API calls.
4. **Notion manual views:** 4 views still to be created manually (§4.2): 待我審核, 已確認, 依區域, 依年齡.

---

## Commit (pending acceptance)

```
feat(notion): add Place schema, Notion CRUD integration, and mapper unit tests

Implements Task 3 (§7.1–7.4): Place type with all 30 Notion property names,
placeToNotionProperties / notionPageToPlace pure mappers, buildNotionFilter
with null-safe age OR conditions, and async createPlace / findPlaceByGooglePlaceId
/ searchPlaces. 18 unit tests, all passing. Integration test verified live page
creation against real Notion DB.

Switched vitest from @cloudflare/vitest-pool-workers (requires v4) to
environment:node — all current tests are pure mappers, no Workers runtime
needed (ADR-003).

Refs: Task 3
ADRs: ADR-003
```
