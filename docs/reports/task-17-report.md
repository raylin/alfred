# Task 17 Execution Report — Distance / Transit Display

**Date:** 2026-05-04
**Engineer:** Claude Code
**Status:** Complete, awaiting acceptance

---

## What was built

### A — Routes API integration (`src/integrations/routes-api.ts`)

`computeRouteMatrix(origin, destinations[], env)` — batch API call for up to 5 destinations. Makes two parallel requests (DRIVE + TRANSIT) using `X-Goog-Api-Key` header. Parses response as JSON array or newline-delimited JSON (handles both formats). Per-destination KV cache with 24h TTL. Returns `(RouteResult | null)[]`.

`computeSingleRoute(origin, dest, env)` — wraps `computeRouteMatrix([dest])`. Returns `null` when both driving and transit are null (total failure/no coverage) or on any exception.

`RouteResult = { driving: RouteMode | null, transit: RouteMode | null }` — null per mode when condition ≠ ROUTE_EXISTS.

Logs all observed `condition` values (addresses spec open question 2 — transit no-route condition names now captured for PM review).

### B — KV cache

Key: `route:{lat4dp,lng4dp}:{lat4dp,lng4dp}` (lat/lng hash for both origin and dest — see ADR-022 for why not `dest_place_id`). TTL: 86400s. Cache hit skips both API calls.

### C — Distance formatter (`src/lib/distance-format.ts`)

`formatMinutes(min)` → `"22 分"` / `"1 小時 5 分"` / `"1 小時"`.
`formatRouteRow(route)` → `"🚗 22 分　　🚇 35 分"` / `"🚗 22 分"` / `""` (when both null).

### D — Flex Message updated (`src/capabilities/places/flex-message.ts`)

`buildDraftCard(place, note?, distance?)` — if `distance` is provided and `formatRouteRow` returns non-empty, adds separator + text row at bottom of body.
`buildSearchCarousel(places, distances?)` — threads distances through to each `buildSearchBubble`. Fully backward compatible (existing call sites without `distance` are unchanged).

### E — Flow integration (flows A/B/C/D/image)

After Notion write, before `sendReply`: calls `getEffectiveOrigin(env, userId)` → if source ≠ null and place has lat/lng → `computeSingleRoute` → passes `RouteResult | null` to `buildDraftCard`. All wrapped in `try/catch`; failure logs warning and sends card without distance row. Notion write is always unaffected (ADR-022).

### F — flow-e-search distance + tie-breaking

`runFlowE` gains `userId?: string` (4th param; `handler.ts` updated to pass it). After keyword ranking, gets effective origin, calls `computeRouteMatrix` for top 5. Re-sorts by: keyword score (primary) → driving duration (secondary, fallback transit, `Infinity` if both null) — ADR-023. Carousel built with `buildSearchCarousel(finalTop, finalDistances)`.

---

## Open questions answered in implementation

**OQ1 — Routes API failure trace:** `console.warn('[flow-X] distance computation failed (non-fatal)')` — logged but Notion write and card send always proceed.

**OQ2 — Transit no-route conditions:** All observed `condition` values are logged via `console.log({ type: 'routes_api_conditions', travelMode, conditions })`. PM can review live logs to determine which conditions represent "no transit in area" vs "API error". Currently, only `ROUTE_EXISTS` is treated as a valid route; all others produce `transit: null`.

**OQ3 — Distance row layout:** Single-line text `"🚗 22 分　　🚇 35 分"` with `wrap: true`. Fits within the `kilo` bubble width for typical durations. Multi-line only triggers for very long duration strings (> 2 hours) which are rare at family-outing scale.

---

## ADRs recorded

- **ADR-022**: Distance after Notion write (non-blocking); cache key uses lat/lng hash for both origin and dest.
- **ADR-023**: Driving duration as primary tie-break (Taiwan families drive; transit coverage sparse in target venues).

---

## Test summary

| File | New tests |
|---|---|
| `routes-api.test.ts` | 11 (new file) |
| `distance-format.test.ts` | 12 (new file) |
| `flex-message.test.ts` | +7 |
| `flow-e-search.test.ts` | +7 |
| **Suite total** | **323 passed, 0 failed** |

---

## Acceptance tests (run after deploy)

1. Add new place (any flow) with home set → card shows `🚗 X 分　　🚇 Y 分` at bottom
2. Search → carousel bubbles each show distance row
3. Location in a rural/mountain area → transit row hidden (only driving, or both hidden)
4. Same-score places in search → closer place appears first in carousel
5. No home + no current_origin → card renders normally without distance row, no error
6. Routes API responds with 4xx → card renders normally, `[flow-X] distance computation failed (non-fatal)` in logs, Notion entry present in database
