# Execution Report — Task 7: Story B — Plain Text Input

## Summary

Built the Story B pipeline: plain text input → Google Places textSearch → getPlaceDetails → Claude extraction → Notion write → KV writes → Flex Message reply. Also built shared KV infrastructure (`kv-store.ts`) used by Stories A, B, and C, and added `isSearchQuery` routing in `input-detect.ts` to distinguish "add new place" from "search" intent. `handler.ts` now routes text through isSearchQuery: search queries get "搜尋功能尚未開放" (Task 9 stub), plain names go to Story B.

## Files Changed

- `src/capabilities/places/kv-store.ts` (new) — `writeRawExtraction` (90-day TTL) + `writeUserLastPlace` (24-hour TTL)
- `src/capabilities/places/flow-a-url.ts` (modified) — switched to shared KV helpers; added optional `userId`/`chatId` params for `user:last_place` write
- `src/capabilities/places/input-detect.ts` (modified) — added `isSearchQuery(text)` (question marks + question words)
- `src/capabilities/places/flex-message.ts` (modified) — `buildDraftCard(place, note?)` accepts optional disambiguation note
- `src/capabilities/places/flow-b-text.ts` (new) — Story B end-to-end
- `src/capabilities/places/handler.ts` (modified) — added Story B/C routing; accepts `LineSource`; passes userId/chatId to flows; search stub
- `src/index.ts` (modified) — imports `LineSource`; passes `event.source` to `dispatchCapability`
- `docs/ADR.md` (modified) — ADR-006 appended
- `tests/unit/kv-store.test.ts` (new) — 4 tests
- `tests/unit/flow-b-text.test.ts` (new) — 14 tests
- `tests/unit/input-detect.test.ts` (modified) — 8 new `isSearchQuery` tests (16 total)
- `tests/unit/flex-message.test.ts` (modified) — 2 new note tests (14 total)
- `tests/unit/flow-a-url.test.ts` (modified) — fixed `as unknown as` cast (pre-existing TS error, now surfaced with stricter checking)

## Local Decisions Made

- **`kv-store.ts` shared helper:** Both `writeRawExtraction` and `writeUserLastPlace` are separate exported functions, each wrapping a single `KV.put`. Flows call them in sequence inside a single try/catch (best-effort). If the first write fails, the second is skipped — acceptable since both are non-critical.
- **`isSearchQuery` word list:** `['嗎', '哪', '哪裡', '哪邊', '哪個', '怎麼', '什麼', '推薦', '有沒有']` plus `?`/`？`. Conservative list; false negatives (undetected search) → Story B (still useful), false positives (over-detected search) → stub message. Can expand in Task 9.
- **Disambiguation note position:** The note appears at the top of the flex body, followed by a separator, then the standard rows. This makes the disambiguation most visible without disrupting the data layout.
- **`google_place_id`, `lat`, `lng` merged after extraction:** `extractFromGooglePlaces` returns a `Place` without these fields (they aren't in `GooglePlacesContext`). Flow B & C spread the fields from `PlaceDetails` onto the returned place before calling `createPlace`. This avoids changing `extract.ts` which is a shared component.

## Tests

- Added: `kv-store.test.ts` (4), `flow-b-text.test.ts` (14), 8 new in `input-detect.test.ts`, 2 new in `flex-message.test.ts`
- Run result: **149 passed (149)** across 13 test files
- TypeScript: `tsc --noEmit` clean

## Spec Deviations / Ambiguities

- **`raw_claude_response` not captured:** The spec amendment lists `raw_claude_response` in the raw KV value without `?` (suggesting required), but `extract.ts` doesn't surface the raw Claude response string. Stored in `RawExtractionData` as optional. Deferred; same decision as Task 6 report noted.
- **Story B `source_type`:** Spec doesn't specify source_type for plain-text input. Used `['Google Maps']` since the authoritative data source is Google Places. Consistent with Story C.
- **Search stub:** Search queries route to "搜尋功能尚未開放" per Task 7 handoff instructions. Task 9 will replace this.

## Blocking Questions for PM

None. Task 8 (Story C) is also complete — see task-08-report.md.
