# Task 20 Execution Report — Search by Visit State (Story L)

## Summary

Extended search-parser and Notion query to support five `visit_state` filter values. Four are implemented as Notion filter conditions (single query). `loved_recently` uses a two-phase approach: Visits DB → place IDs → Places DB with in-memory filter.

---

## Files Changed

| File | Change |
|---|---|
| `src/capabilities/places/schema.ts` | Added `VisitState` type; added `visit_count`/`last_visited`/`avg_rating` to `N`; added `visit_state?: VisitState \| null` to `SearchFilters` |
| `src/capabilities/places/search-parser.ts` | Updated prompt with visit_state rules; added `visit_state` to `RawParsed`; added `sanitizeVisitState` guard |
| `src/integrations/notion.ts` | Added `daysAgo` helper; added visit_state conditions to `buildNotionFilter`; branched `searchPlaces` for `loved_recently`; added `searchLovedRecentlyPlaces` |
| `tests/unit/search-parser.test.ts` | Added `visit_state` to `makeRaw` helper; added 8 visit_state test cases |
| `tests/unit/notion-property-mapper.test.ts` | Added 8 `buildNotionFilter` tests for visit_state conditions |
| `tests/unit/search-visit-state.test.ts` | New: 7 integration tests for `searchPlaces` with visit_state |

---

## Implementation Notes

### visit_state filter conditions in `buildNotionFilter`

| `visit_state` | Notion filter added |
|---|---|
| `never_visited` | OR(Visit Count is_empty, Visit Count = 0) |
| `visited_recently` | Last Visited on_or_after `daysAgo(30)` |
| `visited_long_ago` | Last Visited on_or_before `daysAgo(180)` AND Visit Count > 0 |
| `highly_rated` | Avg Rating >= 4.5 AND Visit Count >= 1 |
| `loved_recently` | Not added here — handled by `searchLovedRecentlyPlaces` |
| `null` | Nothing added |

### `loved_recently` — Two-Phase Query (ADR-032)

1. Query Visits DB: `Rating = 5 AND Visited On >= 30 days ago` (page_size 50)
2. Extract unique Place IDs from `Place` relation field
3. If empty → return []
4. Query Places DB with other filters (visit_state cleared), page_size = max(limit×4, 20)
5. In-memory filter: keep only places in the loved ID set
6. Slice to `limit`

### `search-parser.ts` — Prompt Extension

Added `visit_state` to the JSON schema and rules section. Explicit instruction: "visit-related 措辭優先使用 visit_state，不要把造訪語氣詞放進 free_text_keywords". `sanitizeVisitState` validates the LLM response against the valid set of values and returns `null` for invalid/unexpected values.

---

## ADR Recorded

**ADR-032** — `loved_recently` as two-phase query (Visits → Place IDs → in-memory filter)

---

## Test Results

```
Test Files  40 passed (40)
     Tests  487 passed (487)
```

22 new tests across 3 files. All regression tests pass.

---

## Acceptance Checklist

1. ✓ `never_visited`: Visit Count is_empty OR = 0 filter applied
2. ✓ `loved_recently`: Visits DB queried for Rating=5 + last 30 days; results filtered in-memory
3. ✓ `visited_long_ago`: Last Visited on_or_before 180 days + Visit Count > 0
4. ✓ Pure attribute search: visit_state null, behavior unchanged from Task 9
5. ✓ Zero results: existing graceful loosening behavior unchanged (no changes to flow-e-search.ts)
6. ✓ Full regression: 40 test files, 487 tests pass

---

## What's Next

Task 19 (Observability).
