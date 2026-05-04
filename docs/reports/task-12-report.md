# Execution Report — Task 12: Acceptance Test Fixes

## Summary

Applied 5 acceptance-test fixes: URL bypass router, search keyword expansion, Google Places Taiwan geo-bias + safety net, unified Google Places resolution pipeline for Stories A/D/F, and search-parser meta-word prompt update. 246 tests pass (25 new). TypeScript clean.

## Files Changed

- `src/capabilities/_registry.ts` (modified) — added `accepts_urls?: boolean` to `Capability` type; `places` set to `accepts_urls: true`
- `src/index.ts` (modified) — added URL bypass block (Priority 2, between slash commands and LLM router): pure URL messages dispatch directly to first capability with `accepts_urls === true`
- `src/capabilities/places/input-detect.ts` (modified) — expanded `QUESTION_WORDS` list with `幫我`, `找`, `找個`, `找一個`, `有什麼`, `給我`, `我想去`, `我要去`
- `src/integrations/google-places.ts` (modified) — added `DEFAULT_LAT/LNG` (Taipei), `LOCATION_BIAS_RADIUS_M` (50km), `TW_CITY_PREFIXES`, `isTaiwanAddress()`; `textSearch` now sends `locationBias` in request body and post-filters non-TW results
- `src/capabilities/places/resolve-google-place.ts` (new) — `resolveGooglePlace(place, env)`: textSearch by name+region → fuzzy name match → getPlaceDetails → returns `{ google_place_id, lat, lng, address }` or `null`
- `src/capabilities/places/flow-a-url.ts` (modified) — added `resolveGooglePlace` + `checkDuplicate` + `writeDedupKV` steps after extraction; imports updated
- `src/capabilities/places/flow-d-instagram.ts` (modified) — same resolve/dedup pipeline as flow-a
- `src/capabilities/places/flow-image.ts` (modified) — same resolve/dedup pipeline as flow-a
- `src/capabilities/places/search-parser.ts` (modified) — system prompt updated with explicit rule: do NOT put meta-words (附近/推薦/幫我/找/有什麼/適合) in `free_text_keywords`
- `docs/ADR.md` (modified) — ADR-014 (URL bypass router), ADR-015 (geo bias + TW filter), ADR-016 (unified resolve pipeline, supersedes ADR-010)

## Local Decisions Made

- **`isTaiwanAddress` uses Chinese city prefix list**: Google returns Chinese-format addresses when `languageCode: zh-TW` is set, so addresses like `台北市士林區...` won't contain 'Taiwan' or 'TW'. Added `TW_CITY_PREFIXES` array of all 22 Taiwan municipalities/counties to catch these. Postal-code prefix check retained as a fallback for English-format addresses.
- **Fuzzy name match in `resolveGooglePlace`**: Google's canonical name may not exactly match Claude's extracted name (e.g., "兒童新樂園" vs "臺北市立兒童新樂園"). Match passes if extracted name contains Google name or vice versa (substring, case-insensitive). Close enough for a family-scale bot.
- **Resolution errors are non-fatal**: `resolveGooglePlace` catches all errors and returns `null`, so a transient Google API failure doesn't block the reply. Story A/D/F still complete without `google_place_id` — no dedup in that case, which is acceptable.
- **ADR-010 superseded**: ADR-010 recorded that Stories A and D had no dedup because there was no `google_place_id`. ADR-016 supersedes this for the cases where `resolveGooglePlace` succeeds.

## Tests

- New: `resolve-google-place.test.ts` (9 tests — happy path, no match, error handling)
- Modified: `flow-a-url.test.ts` (+3 dedup tests; mocks for `resolveGooglePlace` + `checkDuplicate`)
- Modified: `flow-d-instagram.test.ts` (+1 dedup test; same mocks)
- Modified: `flow-image.test.ts` (+2 dedup/resolve tests; same mocks)
- Modified: `google-places.test.ts` (+2 tests — locationBias in request body, non-TW filter)
- Modified: `input-detect.test.ts` (+7 tests — new `isSearchQuery` keywords)
- Modified: `search-parser.test.ts` (+1 test — meta-words not in free_text_keywords)
- Run result: **246 passed (246)** across 20 test files
- TypeScript: `tsc --noEmit` clean

## Spec Deviations / Ambiguities

- **Fix 3 "safety net": filter by `plus_code` or `formatted_address`** — spec said to use `plus_code`. The Places API (New) doesn't return `plus_code` in the search field mask. Used `formattedAddress` instead, which is already in `SEARCH_FIELDS`. This is functionally equivalent.
- **`isSearchQuery` false-positive risk for `找`**: The word `找` alone could match "找到了" in non-search contexts. However, per spec the conservative principle holds: false negatives (failing to detect search) send to Story B which gracefully handles unexpected input. The risk of `找` false-positives is low because it doesn't naturally appear in place names.

## Manual Acceptance Test

1. IG URL → routes to flow-d (not `unknown`) ✓ (covered by URL bypass router)
2. `幫我找附近的公園` → `isSearchQuery = true` → routes to Story E
3. `幫我找一個樂園` → Story E → query searches Taiwan results (Tokyo Disneyland filtered out)
4. Same place via blog URL + screenshot → second submission triggers dedup card
5. `東京迪士尼` → textSearch returns result, TW filter eliminates it → "找不到" response
6. Regression: Stories A/B/C/E original acceptance cases unaffected

## Blocking Questions for PM

None. Ready for deploy + acceptance test.
