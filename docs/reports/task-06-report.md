# Execution Report — Task 6: Story A — URL Input Flow

## Summary

Built the complete Story A pipeline: URL fetch → HTML strip → Claude extraction → Notion write → KV write (best-effort) → Flex Message reply. Also built all shared infrastructure needed by future stories: `html-extract.ts`, `url-utils.ts`, `input-detect.ts`, `flex-message.ts`, `errors.ts`, and the places `handler.ts` dispatch hub. `index.ts` now routes places capability through the real handler. 39 new unit tests; 108 total.

## Files Changed

- `src/lib/html-extract.ts` (new) — `stripHtml(html, maxLength)`: regex-based HTML → text
- `src/lib/url-utils.ts` (new) — `isHttpUrl`, `isGoogleMapsUrl`, `fetchWithTimeout`
- `src/capabilities/places/errors.ts` (new) — `PlacesError` with `userMessage` property
- `src/capabilities/places/input-detect.ts` (new) — `detectInputType` → `'url' | 'google-maps-url' | 'text'`
- `src/capabilities/places/flex-message.ts` (new) — `buildDraftCard(place)` per spec §6.6
- `src/capabilities/places/flow-a-url.ts` (new) — Story A end-to-end
- `src/capabilities/places/handler.ts` (new) — dispatch hub; Story B/C/E stubs for Task 7-9
- `src/integrations/line.ts` (modified) — added `LineFlexMessage`, `LineMessage` union; `sendReply` now accepts both
- `src/index.ts` (modified) — `dispatchCapability` replaced TODO stub with real `placesHandler` call
- `docs/ADR.md` (modified) — ADR-005 appended
- `tests/unit/html-extract.test.ts` (new) — 10 tests
- `tests/unit/input-detect.test.ts` (new) — 8 tests
- `tests/unit/flex-message.test.ts` (new) — 12 tests
- `tests/unit/flow-a-url.test.ts` (new) — 9 tests

## Local Decisions Made

- **Regex-based HTML stripping (ADR-005):** No new package needed; `stripHtml` is a pure function that's easy to unit test. Swappable for `node-html-parser` if edge cases surface.
- **`PlacesError` in `errors.ts`:** Defined once, imported by all flow files and `handler.ts`. Avoids circular dependency if each flow tried to define it locally.
- **`handler.ts` catches `PlacesError` and sends user message:** Error handling centralised in handler; individual flow functions throw `PlacesError` with user-facing text, and caller (`handler.ts`) sends the reply. Keeps flow functions focused on happy path.
- **KV write uses `raw_place_json` instead of raw Claude response:** `extract.ts` doesn't surface the raw response string. Storing the assembled `Place` JSON is a reasonable proxy for Phase 1.5 re-extraction. Can be refined if Phase 1.5 needs the verbatim Claude output.
- **Content-type check before HTML parse:** If the URL returns a PDF or image, we fail early with the "打不開" message rather than passing binary data to `stripHtml` and Claude.

## Tests

- Added: `html-extract.test.ts` (10), `input-detect.test.ts` (8), `flex-message.test.ts` (12), `flow-a-url.test.ts` (9)
- Run result: **108 passed (108)** across 10 test files
- stderr in flow-a error tests: expected console.error calls, not failures

## Verification Performed

- `npm test` — 108 tests pass, TypeScript clean
- Manual deployment needed for full acceptance (see below)

## Manual Acceptance Test (for PM)

Deploy with `npx wrangler deploy`, then:
1. Send any parenting blog URL (e.g., a real article) to 阿福 in LINE
2. Expect: typing indicator → Flex Message card within ~20s
3. Check Notion DB: entry appears with `Status = draft`, all extracted fields visible
4. Check `AI Inferred Fields` multi-select has tags for low-confidence fields

## Spec Deviations / Ambiguities

- **Duplicate check skipped:** Spec §3.3 shows duplicate check before Notion write, but Task 10 owns that. Flow A proceeds without it for now.
- **`last_bot_msg` KV key not written:** The LINE reply message ID isn't captured (would require changing `sendReply` return type). Deferred to Task 10 or Phase 1.5.

## Blocking Questions for PM

None. Ready for Task 7 (Story B: Plain Text Input).
