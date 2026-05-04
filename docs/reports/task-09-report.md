# Execution Report — Task 9: Story E — Natural Language Search

## Summary

Built the Story E pipeline: natural language query → Claude Haiku intent parsing → Notion search (status: not archived, sort: last_edited_time desc) → in-memory keyword re-ranking → Flex carousel reply (top 5). Handles 0-result and >10-candidate cases per spec §6.9. Handler.ts search stub replaced with `runFlowE`.

## Files Changed

- `src/capabilities/places/search-parser.ts` (new) — `parseSearchIntent(userMessage, env)` → `{ filters: SearchFilters, query_intent_summary }`. Calls Claude Haiku, retries once on failure.
- `src/capabilities/places/flow-e-search.ts` (new) — Story E end-to-end. Fetches up to 20 candidates, re-ranks by keyword hits, caps display at 5, sends text header + carousel.
- `src/capabilities/places/flex-message.ts` (modified) — added `buildSearchBubble` + `buildSearchCarousel(places)`.
- `src/capabilities/places/handler.ts` (modified) — replaced search stub with `runFlowE` call.
- `src/integrations/notion.ts` (modified) — `buildNotionFilter`: status changed from `equals: 'confirmed'` to `does_not_equal: 'archived'`; `searchPlaces`: sort changed from name asc to `last_edited_time desc`.
- `docs/ADR.md` (modified) — ADR-008 appended.
- `tests/unit/search-parser.test.ts` (new) — 9 tests
- `tests/unit/flow-e-search.test.ts` (new) — 9 tests
- `tests/unit/notion-property-mapper.test.ts` (modified) — 2 filter tests updated to match `does_not_equal: 'archived'`

## Local Decisions Made

- **Status filter: `does_not_equal: 'archived'`** — includes both `confirmed` and `draft` so early-stage data (not yet confirmed by wife) still surfaces in search. The bot needs to be useful before all entries are confirmed.
- **Fetch 20, display 5** — fetching more than the display limit lets us detect ">10 candidates" for the narrow hint without a separate count query. 20 is sufficient to detect the threshold with one Notion API call.
- **In-memory keyword scoring** — Notion doesn't support relevance ranking. Keyword hit count across name + summary + address + categories + fee_details gives a simple relevance signal. Ties fall back to last_edited_time order from Notion sort.
- **Two-message reply (text + carousel)** — text header conveys intent summary / narrow hint clearly without needing a "header bubble" in the carousel (which adds Flex complexity). LINE allows up to 5 messages per reply.
- **Observability:** every search logs `{ type: 'search_query', parsed_filters, query_intent_summary }` and `{ type: 'search_result', candidate_count }` for future quality analysis.

## Tests

- Added: `search-parser.test.ts` (9), `flow-e-search.test.ts` (9)
- Updated: `notion-property-mapper.test.ts` (2 filter tests)
- Run result: **168 passed (168)** across 15 test files
- TypeScript: `tsc --noEmit` clean

## Spec Deviations / Ambiguities

- **`free_text_keywords` in Notion filter (AND logic):** `buildNotionFilter` requires ALL keywords to match (each keyword becomes an AND condition on name/summary). This is strict — if a keyword doesn't match any entry, 0 results. Alternative (OR) would be looser. Kept AND for precision; can relax in Task 10 if needed.
- **In-memory scoring scope:** Scoring checks keywords against name/summary/address/categories/fee_details. `Indoor/Outdoor`, `Region`, `Energy Level` not included since those are already handled by structured filters.

## Manual Acceptance Test (for PM)

With 5+ entries in Notion (mix of draft and confirmed):
1. Send `下雨天三歲適合的台北景點` → expect carousel of indoor places (age range covering 3) in Taipei region
2. Send `免費公園` → expect carousel of places with `fee_type = 免費` and category 公園
3. Send `找不到的奇怪地方xyz` → expect "沒有完全符合的耶，要不要放寬條件？"
4. If you have >10 confirmed+draft entries matching a broad query → expect narrow hint in header
5. Regression: send a place name (plain text, no question words) → expect Story B (add flow), NOT search

## Blocking Questions for PM

None. Ready for deploy + acceptance test.
