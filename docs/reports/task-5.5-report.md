# Execution Report — Task 5.5: LLM Intent Router (Spec Amendment)

## Summary

Upgraded `src/core/intent-router.ts` from a hardcoded "everything goes to places" stub to a full LLM-based router (Claude Haiku) with capability registry, confidence threshold gating, unknown handler, and slash command priority layer. `index.ts` wired to use all three. 21 new unit tests; 53 total. TypeScript clean.

## Files Changed

- `src/capabilities/_registry.ts` (new) — `Capability` type + `capabilities` array; currently one entry: `places` with description, positive/negative examples, keywords
- `src/core/intent-router.ts` (new) — `routeIntent(message, env)`: calls Haiku, returns capability id or null; confidence < 0.6 or API failure → null
- `src/core/unknown-handler.ts` (new) — `buildUnknownMessage()` + `handleUnknown(replyToken, accessToken)`; message lists enabled capabilities, hints at `/help`
- `src/core/slash-commands.ts` (new) — `handleSlashCommand(text, replyToken, env)`: `/help` sends help card, `/place <args>` returns `{ type: 'route', capability: 'places', input }`, unrecognized → null (falls through to LLM)
- `src/index.ts` (modified) — removed echo placeholder; wired slash commands → LLM router → capability dispatch → unknown handler; added `dispatchCapability()` with TODO stub for places flow (Task 6+)
- `tests/unit/intent-router.test.ts` (new) — 7 tests
- `tests/unit/slash-commands.test.ts` (new) — 9 tests
- `tests/unit/unknown-handler.test.ts` (new) — 5 tests
- `docs/ADR.md` (modified) — ADR-004 appended

## Local Decisions Made

- **`_registry.ts` `keywords` field:** Added beyond what the amendment spec'd, to give the Haiku system prompt more precision. Cheap to maintain, improves routing accuracy for edge cases.
- **Slash command falls through for unrecognized commands:** `/something-unknown` returns `null` (LLM router handles it) rather than "unknown command". Rationale: user might type `/yelp` or similar; LLM can classify it better than a hard rejection.
- **`dispatchCapability()` helper in index.ts:** Extracted dispatch logic into a named function so Task 6 only needs to replace one `await sendReply(...)` stub with the real places handler — minimal diff.
- **Observability via `console.log(JSON.stringify({...})):`** Cloudflare `wrangler tail` surfaces these as structured JSON; no additional logging library needed.

## Tests

- Added: `intent-router.test.ts` (7), `slash-commands.test.ts` (9), `unknown-handler.test.ts` (5)
- Run result: **53 passed (53)** across 5 test files
- Coverage: all routing branches covered (above/at/below threshold, API failure, each slash command, missing args)

## Verification Performed

- `npm test` — 53 tests pass; test stdout confirms observability JSON logs fire correctly
- `npx tsc --noEmit` — zero errors

## Spec Deviations / Ambiguities

None. Amendment implemented as specified.

## Blocking Questions for PM

None. Message copy in `buildUnknownMessage()` and `/help` text is a placeholder — PM mentioned they'll update the copy.
