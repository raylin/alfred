# Task 14 Execution Report — Visit Tracking

**Date:** 2026-05-04
**Engineer:** Claude Code
**Status:** Complete, awaiting acceptance

---

## What was built

### A — `src/capabilities/places/visit-parser.ts` (new)

`parseVisitMessage(message, env): VisitParseResult` — Claude Sonnet call via `chatJson`. System prompt injects today's date for relative date resolution ("昨天" → YYYY-MM-DD). Retry-once on failure; both attempts failed → returns `{ place_query: null, visited_on: null, rating_signal: null, notes: null }` without blocking the flow.

`sanitize()` validates all fields: date must match `^\d{4}-\d{2}-\d{2}$`, rating_signal must be integer 1–5, notes must be non-empty string.

`MODELS.extraction` (claude-sonnet-4-6) used per spec §7.3.

---

### B — `src/capabilities/places/visit-summary.ts` (new)

`recomputePlaceSummary(placeNotionPageId, env): void` — calls `queryVisitsForPlace` then `patchPlaceSummary`. Full `try/catch` with `console.warn` on failure; does not throw so callers are never blocked.

---

### C — `src/capabilities/places/disambiguate.ts` (new)

`buildDisambiguateCard(places, action_type): LineFlexMessage` — vertical bubble with one postback button per candidate (capped at 5). Button label truncated to 20 chars.

Postback format: `visit:select:{notion_page_id}` (see ADR-026).

---

### D — `src/capabilities/places/flow-visit.ts` (new)

#### `runFlowVisit(message, replyToken, env, userId?, chatId?)`

1. `parseVisitMessage` → VisitParseResult
2. Resolve place:
   - `null` → ask "哪個地方"
   - `"last"` → read `user:{id}:last_place` KV, if present and < 24h old, call `findPlaceByInternalId` → if null, ask "哪個地方"
   - string → `searchPlaces({ free_text_keywords: [place_query] }, env, 5)`
     - 0 results → ask to add first
     - 1 result → proceed
     - 2+ results → write `pending_visit` KV (ADR-025), send `buildDisambiguateCard`
3. `createVisit` → Visits DB page
4. `recomputePlaceSummary` (non-fatal)
5. If `rating_signal == null` and `userId`: write `pending_rating` KV (TTL 10 min)
6. `buildVisitCard` → Flex reply (includes rating row if provided, asks for rating if null)

#### `runFlowVisitSelect(notionPageId, replyToken, env, userId?, chatId?)`

Called when user taps a disambiguation button. Reads and clears `pending_visit` KV, calls `getPlaceByNotionPageId`, then delegates to `recordVisitAndReply`.

---

### E — `src/integrations/notion.ts` (modified)

Added functions:
- `createVisit(row, env)` → `{ notion_page_id }` — creates Visits DB page; title formatted via `formatVisitTitle`; optional fields (rating, notes, logged_by) omitted when null
- `queryVisitsForPlace(placeNotionPageId, env)` → `VisitSummaryData` — paginated query on Place relation; computes last_visited (first result, sorted desc), visit_count, avg_rating (rounded to 1 decimal, null if no rated visits)
- `patchVisitRating(visitNotionPageId, rating, env)` — PATCH Rating only
- `patchPlaceSummary(placeNotionPageId, summary, env)` — PATCH Visit Count, Last Visited (if non-null), Avg Rating (if non-null)
- `getPlaceByNotionPageId(notionPageId, env)` — GET /pages/{id}, returns Place | null (catches errors)
- `findPlaceByInternalId(internalId, env)` — filter query on Internal ID field, returns Place | null

Also added `notionGet<T>` internal helper (GET with standard headers).

---

### F — `src/capabilities/places/kv-store.ts` (modified)

Added:
- `PendingRatingData`, `writePendingRating`, `readPendingRating`, `clearPendingRating` — TTL 600s
- `PendingVisitData`, `writePendingVisit`, `readPendingVisit`, `clearPendingVisit` — TTL 600s

`clear*` functions swallow delete errors (non-fatal; TTL handles expiry).

---

### G — `src/capabilities/places/flex-message.ts` (modified)

Added `buildVisitCard(placeName, visitedOn, notes, rating, askForRating)` — bubble with status line, place name, date, optional notes row, optional rating row, optional "想給幾顆星嗎？(回傳 1-5，或傳「跳過」)" prompt.

---

### H — `src/capabilities/places/handler.ts` (modified)

Before calling `classifyPlacesIntent`, checks `readPendingRating(env, userId)`:
- Input matches `/^[1-5]$/` → `patchVisitRating`, `clearPendingRating`, `recomputePlaceSummary`, reply "評了 N 顆星！"; `return`
- Input is `"跳過"` → `clearPendingRating`, reply "好，下次再評！"; `return`
- Anything else → fall through to intent classifier (pending_rating remains until TTL or next match)

`visit` intent case: replaced stub with `runFlowVisit`.

---

### I — `src/index.ts` (modified)

Added to postback handler:
```
} else if (data.startsWith('visit:select:')) {
  const notionPageId = data.slice('visit:select:'.length)
  await runFlowVisitSelect(notionPageId, event.replyToken, env, userId, chatId)
}
```

---

## Test summary

| File | Tests |
|---|---|
| `kv-store-pending.test.ts` | 10 (new) |
| `visit-parser.test.ts` | 11 (new) |
| `visit-summary.test.ts` | 3 (new) |
| `disambiguate.test.ts` | 5 (new) |
| `notion-visit.test.ts` | 11 (new) |
| `flow-visit.test.ts` | 13 (new) |
| **Suite total** | **379 passed, 0 failed** |

53 new tests added.

---

## ADRs recorded

**ADR-025**: Store pending visit parse context in `user:{id}:pending_visit` KV during disambiguation, consumed by `runFlowVisitSelect`. Rationale: no other mechanism to carry VisitParseResult through a postback event.

**ADR-026**: Use `notion_page_id` (not spec's `internal_id`) in `visit:select` postback data. Rationale: eliminates a Notion filter query on postback; `GET /pages/{id}` is simpler and faster.

---

## Open questions resolved

**OQ1** (pending_rating expired + user sends 1-5): KV returns null → pending_rating check is skipped → falls through to `classifyPlacesIntent` → likely `unknown` → `handleUnknown` gives friendly "我不太確定你的意思" guidance. No special code needed; the natural flow handles it correctly.

**OQ2** (last_place anchor > 24h): KV TTL expires the entry → `ALFRED_KV.get` returns null → `resolveLastPlace` returns null → reply "不太確定上次那個是哪個，可以告訴我地點名稱嗎？"

---

## Acceptance tests (run after deploy)

1. Send "我們今天去了兒童新樂園" → Visit flow runs → Visits DB page created → Place summary updated → confirmation Flex + rating prompt
2. Reply "5" to rating prompt → Visit Rating patched to 5 → Place Avg Rating updated → "評了 5 顆星！"
3. Reply "跳過" after a fresh visit → pending_rating cleared → "好，下次再評！"
4. Send "今天去了大湖" when 2+ places match → disambiguation card shown
5. Tap a place button → `runFlowVisitSelect` → visit recorded with original visit date/notes preserved
6. Send "我們今天去了上次那個地方" immediately after receiving a draft card → 'last' resolved → visit recorded
7. Send "3" with no pending_rating active → intent classifier → unknown → friendly reply (regression: not interpreted as a rating)
