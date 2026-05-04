# 2026-05-04 19:00 — Task 14: Visit Tracking

Task 13 approved。接 Task 14 — Visit Tracking。

Spec 對照:Phase 1.5 spec §1 Story H + §2.2 (Visits DB) + §4.4 + §7.3 (Visit Parser)

A. Visit parser (src/capabilities/places/visit-parser.ts)
   parseVisitMessage(message, env): VisitParseResult
   { place_query: string | 'last' | null, visited_on: 'YYYY-MM-DD' | null, rating_signal: 1-5 | null, notes: string | null }
   Claude Sonnet, spec §7.3
   parse 失敗 retry once、失敗回 null fields 不擋 flow

B. Visit summary recompute (src/capabilities/places/visit-summary.ts)
   recomputePlaceSummary(placeInternalId, env): void
   Query Visits DB by Place relation → compute last_visited, visit_count, avg_rating → PATCH Place page
   失敗 log warning,不擋主流程

C. Visit flow (src/capabilities/places/flow-visit.ts)
   1. parseVisitMessage
   2. Resolve place:
      - 'last' → user:{id}:last_place anchor, no anchor → 問哪個地方
      - string → searchPlaces → 0/1/multi handling
      - null → 問哪個地方
   3. Build VisitRow → createVisit → recomputePlaceSummary
   4. Response Flex: 簡短卡片 + 詢問 rating if null
   5. user:{id}:pending_rating KV (TTL 10 min)

D. Pending rating handling in handler.ts
   先檢查 pending_rating
   數字 1-5 → patch Visit Rating + recompute
   跳過 → 清 pending_rating
   否 → 走 intent classifier

E. Disambiguate (src/capabilities/places/disambiguate.ts)
   buildDisambiguateCard(places, action_type): Flex
   postback: visit:select:{internal_id}
   handler postback: visit:select 路由

F. handler.ts
   visit intent → runFlowVisit
   postback: visit:select

G. Tests

Open questions:
1. pending_rating 過期 → 數字 1-5 走 intent classifier → unknown → 友善引導
2. last_place anchor 超過 24h → 「不太確定上次那個是哪個,可以講具體名稱嗎?」
