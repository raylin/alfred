# Execution Report — Task 4: Claude Extraction Service

## Summary

Built the Anthropic SDK wrapper (`integrations/anthropic.ts`), UUID utility (`lib/uuid.ts`), and the extraction module (`capabilities/places/extract.ts`) that converts blog HTML or Google Places data into a structured `Place` via Claude Sonnet. 14 new unit tests cover all branches including retry-on-failure. TypeScript strict check passes clean.

## Files Changed

- `src/lib/uuid.ts` (new) — `generateUuid()` wrapper around `crypto.randomUUID()`
- `src/integrations/anthropic.ts` (new) — `createClient`, `chatJson<T>`, `MODELS` constants
- `src/capabilities/places/extract.ts` (new) — `extractFromHtml`, `extractFromGooglePlaces`, `callWithRetry`, `assemblePlace`
- `tests/fixtures/extraction.ts` (new) — `RICH_RAW_RESPONSE`, `VAGUE_RAW_RESPONSE`, fixture HTML, fixture Google Places context
- `tests/unit/extract.test.ts` (new) — 14 unit tests
- `src/integrations/notion.ts` (modified) — fixed `exactOptionalPropertyTypes` TypeScript error in `notionPageToPlace` (`as Place['status']` → `as Place['status'] & string`)

## Local Decisions Made

- **`chatJson` strips markdown code fences:** Claude occasionally wraps JSON in ` ```json ``` ` despite explicit instruction not to. Added a `.replace()` cleanup before `JSON.parse` for robustness. Trivial, no ADR needed.
- **`extractFromGooglePlaces` takes `sourceType` as a parameter:** Stories B and C both call this function but set different `source_type` values (plain-text → `[]` or `朋友推薦`, Maps URL → `['Google Maps']`). The caller (flow modules, Task 7/8) decides source_type; the extractor doesn't.
- **Model IDs:** Spec §7.1 says `claude-sonnet-4-7`. Per current runtime knowledge the latest available Sonnet is `claude-sonnet-4-6`, so that's what's used. If Sonnet 4.7 becomes available, change `MODELS.extraction` in `anthropic.ts` — one-line update.
- **`max_tokens: 2048`:** The spec doesn't specify; 1024 could truncate long JSON outputs. 2048 is safe overhead for a ~20-field JSON object.

## Tests

- Added: `tests/unit/extract.test.ts` (14 tests), `tests/fixtures/extraction.ts`
- Run result: **32 passed (32)** across 2 test files
- Coverage: all branches in `extract.ts` covered (success, retry, double-failure, empty-seasons default)

## Verification Performed

- `npm test` — 32 tests pass
- `npx tsc --noEmit` — zero TypeScript errors (also caught and fixed a pre-existing `exactOptionalPropertyTypes` error in `notion.ts`)
- No live API call made for Task 4 — extraction is unit-tested via mocked `chatJson`. Live extraction will be exercised in Task 6 (Story A end-to-end).

## Spec Deviations / Ambiguities

- **Model ID:** Used `claude-sonnet-4-6` instead of spec's `claude-sonnet-4-7` (not available per current runtime model list). One-line change if/when 4.7 becomes available.

## Blocking Questions for PM

None.
