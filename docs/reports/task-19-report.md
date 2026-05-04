# Task 19 Execution Report — Observability

## Summary

Added a structured event logging system (ULID-keyed KV events + ring buffer) and instrumented 10 flows. Added `/review` slash command for PM_LINE_USER_ID. Non-fatal by design: KV failures are swallowed with console.error.

---

## Files Changed

| File | Change |
|---|---|
| `src/lib/ulid.ts` | New: ULID generator using Web Crypto + Crockford base32 |
| `src/lib/observability.ts` | New: `logEvent(env, event)` — KV write + ring buffer |
| `src/core/places-intent-classifier.ts` | Replaced console.log → `logEvent` (`places.intent_classify` / `places.intent_unknown`) |
| `src/capabilities/places/flow-e-search.ts` | Replaced two console.log calls → single `logEvent` (`places.search`) |
| `src/capabilities/places/flow-a-url.ts` | Added outer try/catch + `logEvent` (`places.add.url`, `places.dedup_hit`) |
| `src/capabilities/places/flow-b-text.ts` | Same pattern (`places.add.text`, `places.dedup_hit`) |
| `src/capabilities/places/flow-c-maps.ts` | Same pattern (`places.add.url` with `meta.flow:'maps'`, `places.dedup_hit`) |
| `src/capabilities/places/flow-d-instagram.ts` | Same pattern + early-return paths (`places.add.instagram`, `places.dedup_hit`) |
| `src/capabilities/places/flow-image.ts` | Same pattern + size/no-place paths (`places.add.image`, `places.dedup_hit`) |
| `src/capabilities/places/flow-edit.ts` | Added `logEvent` to `performEdit` (`places.edit`) |
| `src/capabilities/places/flow-delete.ts` | Added `logEvent` to `doDelete` (`places.delete`) |
| `src/capabilities/places/flow-visit.ts` | Added `logEvent` to `recordVisitAndReply` (`places.visit.log`) |
| `src/core/slash-commands.ts` | Added `case 'review':` + `handleReview` function |
| `tests/unit/ulid.test.ts` | New: 5 tests |
| `tests/unit/observability.test.ts` | New: 7 tests |
| `tests/unit/slash-commands.test.ts` | Extended: 6 /review tests |

---

## Implementation Notes

### `src/lib/ulid.ts`

Crockford base32 alphabet (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`). Time component: 10 chars encoding `Date.now()` big-endian base32. Random component: 16 chars from `crypto.getRandomValues(new Uint8Array(16))`, each `byte % 32` — uniform since 256 = 8 × 32.

### `src/lib/observability.ts`

`logEvent` is non-fatal: the entire body runs in a single try/catch that console.errors on failure. Sequence:
1. `generateUlid()`
2. `put event:{ulid}` with `expirationTtl: 604800` (7 days)
3. `get events:recent` → parse → prepend → slice(0, 100) → `put events:recent`

`LogEventInput` uses `?: T | undefined` for all optional fields to satisfy `exactOptionalPropertyTypes: true`.

### Event type mapping

| Flow | Event type | Notes |
|---|---|---|
| places-intent-classifier | `places.intent_classify` or `places.intent_unknown` | Split by whether intent is 'unknown' (ADR-033) |
| flow-e-search | `places.search` | After Notion query; includes filters + result_count |
| flow-a-url | `places.add.url` | Dedup hit → `places.dedup_hit` with meta.flow:'url' |
| flow-b-text | `places.add.text` | Same dedup pattern |
| flow-c-maps | `places.add.url` (meta.flow:'maps') | Reuses url type (ADR-034) |
| flow-d-instagram | `places.add.instagram` | Short/missing OG → outcome:'unknown'; extraction fail → outcome:'error' |
| flow-image | `places.add.image` | Size too large → outcome:'unknown'; no place detected → outcome:'unknown' |
| performEdit | `places.edit` | All-failed → outcome:'error'; any applied → outcome:'success' |
| doDelete | `places.delete` | Archive fail → outcome:'error'; success after KV cleanup |
| recordVisitAndReply | `places.visit.log` | createVisit fail → outcome:'error'; success includes has_rating in meta |

### Add flow instrumentation (ADR-035)

Each add flow (A/B/C/D/image) wraps its body in outer try/catch:
- Dedup early return: `logEvent(dedup_hit)` before `sendReply`
- Success: `logEvent(places.add.*)` after final `sendReply`
- Catch: `logEvent(outcome:'error', error: err.message.slice(0,100))` then `throw err`

### `/review` command

1. Checks `userId === env.PM_LINE_USER_ID` — rejects with "這指令僅限管理員。"
2. Reads `events:recent` KV → ULIDs
3. Parallel `Promise.all` fetch of all `event:{ulid}` keys
4. Computes: total, time range, type counts (desc), outcome %, avg/p95 duration, last-10 errors, last-5 unknown intent previews
5. Assembles markdown, truncates at 4500 chars + "…（以下省略）"

---

## ADRs Recorded

- **ADR-033** — Split intent_classify vs intent_unknown as separate event types
- **ADR-034** — Use places.add.url for Google Maps URL flow (flow-c)
- **ADR-035** — Outer try/catch wrapper for add flow instrumentation

---

## Test Results

```
Test Files  42 passed (42)
     Tests  505 passed (505)
```

18 new tests across 3 files. All regression tests pass.

---

## Acceptance Checklist

1. ✓ KV event entries written with `event:{ulid}` key on each flow trigger
2. ✓ `/review` to PM → summary with type counts, outcome %, avg/p95, errors, unknown intents
3. ✓ `/review` to other user → "這指令僅限管理員。"
4. ✓ `events:recent` ring buffer capped at 100 entries (sliced in logEvent)
5. ✓ 7-day TTL set via `expirationTtl: 604800`
6. ✓ KV failure non-fatal: entire logEvent body is in try/catch, console.errors only
7. ✓ Regression: 487 pre-existing tests + 18 new = 505 all pass

---

## What's Next

Task 19 is the last queued task. Session complete pending user acceptance.
