# Execution Report — Task 8: Story C — Google Maps URL Input

## Summary

Built the Story C pipeline: Google Maps URL → `parseGoogleMapsUrl` → `getPlaceDetails` (with `textSearch` fallback when no place_id in URL) → Claude extraction → Notion write → KV writes → Flex Message reply. Story C uses `['Google Maps']` as source_type. `ai_inferred_fields` are expected to be minimal since most data comes from Google Places.

## Files Changed

- `src/capabilities/places/flow-c-maps.ts` (new) — Story C end-to-end
- `src/capabilities/places/handler.ts` (modified) — replaced google-maps-url stub with `runFlowC` call
- `tests/unit/flow-c-maps.test.ts` (new) — 13 tests

## Local Decisions Made

- **Fallback to `textSearch` when no `place_id`:** `parseGoogleMapsUrl` extracts `place_id` (ChIJ-style) from the URL data parameter. Some Google Maps share URLs omit this (e.g. simple lat/lng pins). When `place_id` is absent but `name` is present (from `/place/{name}/` path segment), Story C falls back to `textSearch(name)` and takes the top result. If both are absent, throws `PlacesError` with user-facing message.
- **Source Type `['Google Maps']`:** Per Task 8 handoff spec.
- **`google_place_id`, `lat`, `lng` merged post-extraction:** Same pattern as Story B — `extractFromGooglePlaces` doesn't have access to these, so they're spread in from `PlaceDetails` before `createPlace`.
- **No disambiguation note in Story C:** The URL identifies a specific place (unlike free-text), so showing a disambiguation note would be confusing. Story C omits the note even if a `textSearch` fallback occurred.

## Tests

- Added: `flow-c-maps.test.ts` (13)
- Run result: **149 passed (149)** across 13 test files
- TypeScript: `tsc --noEmit` clean

## Spec Deviations / Ambiguities

- **Short URL resolution in tests:** `parseGoogleMapsUrl` is fully mocked in tests; real short-URL redirect behavior is covered in `google-places.test.ts` from Task 5.

## Manual Acceptance Test (for PM)

Deploy with `npx wrangler deploy`, then:
1. **Story B:** Send a plain place name to 阿福 (e.g., "大湖公園"). Expect: loading indicator → Flex card. Check Notion for entry.
2. **Story B disambiguation:** Send a common name that returns multiple Google results. Expect: Flex card with note "找到的是：{address}，不是的話告訴我正確的地點。" at top.
3. **Story B search stub:** Send a question (e.g., "下雨天哪裡好玩？"). Expect: "搜尋功能尚未開放，敬請期待！"
4. **Story C:** Send a Google Maps share link (maps.app.goo.gl or full maps.google.com URL). Expect: loading indicator → Flex card. Check Notion for entry with `Source Type = Google Maps`.
5. **Story A regression:** Send a blog URL. Confirm still works.
6. Check KV: `place:{id}:raw` and `user:{userId}:last_place` written (use wrangler kv:key get or check via wrangler tail logs).

## Blocking Questions for PM

None. Both tasks complete, all tests pass. Ready for deploy + manual acceptance test.
