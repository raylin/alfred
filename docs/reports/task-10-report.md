# Execution Report — Task 10: Error Handling, IG Fallback, KV Decoupling, Dedup

## Summary

Completed all six sub-tasks: (A) reply token expiry → push API fallback, (B) duplicate check with KV fast path + Notion slow path + dedup Flex card, (C) Instagram URL handling with facebookexternalhit OG fetch + length gate, (D) KV write decoupling across all three flows, plus new flow-d-instagram.ts, and (F) ADRs 009–011. 196 tests pass (28 new); TypeScript clean.

## Files Changed

- `src/integrations/line.ts` (modified) — added `LinePostbackEvent` type, added to `LineEvent` union, added `sendPush()`, modified `sendReply` to accept optional `chatId` for push fallback on 400 "Invalid reply token".
- `src/lib/url-utils.ts` (modified) — `fetchWithTimeout` now accepts optional `RequestInit` options (needed for IG's custom User-Agent header).
- `src/capabilities/places/duplicate-check.ts` (new) — `checkDuplicate(googlePlaceId, env)` → KV fast path then Notion slow path; `writeDedupKV(env, googlePlaceId, notionPageId, internalId, name)`. KV key `dedup:{google_place_id}`, 30-day TTL, value `{notion_page_id, internal_id, name}` (spec §5 extended with `name` for dedup card display).
- `src/capabilities/places/flex-message.ts` (modified) — added `buildDedupCard(name: string)`: Flex bubble with postback buttons `更新` (data: `dedup:update`) / `不用` (data: `dedup:skip`).
- `src/capabilities/places/flow-a-url.ts` (modified) — KV writes split into independent try/catch; `sendReply` now receives `chatId` for push fallback.
- `src/capabilities/places/flow-b-text.ts` (modified) — dedup check before extraction; `writeDedupKV` after Notion write; KV writes independent; `sendReply` receives `chatId`.
- `src/capabilities/places/flow-c-maps.ts` (modified) — same as flow-b.
- `src/capabilities/places/flow-d-instagram.ts` (new) — Story D: facebookexternalhit UA fetch → regex-extract `og:description` → length gate (≥ 30 chars) → `extractFromHtml` → Notion → KV → Flex; else fallback text "IG 連結我目前還沒辦法直接讀，可以截圖傳給我，或直接告訴我地點名稱。"
- `src/capabilities/places/input-detect.ts` (modified) — added `isInstagramUrl()`, added `'instagram-url'` to `InputType` union, `detectInputType` checks Instagram before generic URL.
- `src/capabilities/places/handler.ts` (modified) — `instagram-url` → `runFlowD`.
- `src/index.ts` (modified) — added `postback` event handling: `dedup:update` → push canned response; `dedup:skip` → push canned response.
- `docs/ADR.md` (modified) — ADR-009 (IG OG strategy), ADR-010 (Story A/D no-dedup limitation), ADR-011 (reply→push fallback).
- `tests/unit/duplicate-check.test.ts` (new) — 8 tests
- `tests/unit/flow-d-instagram.test.ts` (new) — 10 tests
- `tests/unit/input-detect.test.ts` (modified) — 6 new tests (isInstagramUrl + detectInputType Instagram cases)
- `tests/unit/flow-b-text.test.ts` (modified) — 3 new dedup tests; added `duplicate-check` mock
- `tests/unit/flow-c-maps.test.ts` (modified) — 2 new dedup tests; added `duplicate-check` mock

## Local Decisions Made

- **Dedup KV value includes `name`** — spec §5 says `{notion_page_id, internal_id}`, but `buildDedupCard` needs the place name to show the user which place was already saved. Extended value to `{notion_page_id, internal_id, name}`. Non-breaking addition.
- **KV `dedup:*` errors treated as "no duplicate"** — if KV is unavailable, `checkDuplicate` falls through to Notion. If Notion also errors, we return `{ found: false }` and let the flow proceed. This is intentional: false negatives (duplicate saved twice) are better than a broken bot that can't save new places.
- **IG OG regex**: two patterns handled (property before content and content before property) since HTML attribute order is not guaranteed.
- **Postback canned responses use `sendPush`** — postback events have a replyToken but by the time the user taps (after viewing the dedup card), it may be expired. Push is more reliable for postback responses.
- **Story D no dedup** — IG has no `google_place_id`. Accepted per ADR-010.

## Tests

- Added: `duplicate-check.test.ts` (8), `flow-d-instagram.test.ts` (10), 6 in input-detect, 3 in flow-b, 2 in flow-c
- Run result: **196 passed (196)** across 17 test files
- TypeScript: `tsc --noEmit` clean

## Spec Deviations / Ambiguities

- **KV dedup value extended with `name`** — documented above. Superset of spec §5, no conflict.
- **Postback canned response for `dedup:update`** — spec says Phase 0+1 canned; using "好，你可以到 Notion 手動更新，或等阿福之後支援自動更新。" to be informative while setting expectations.

## Manual Acceptance Test (for PM)

1. **Story D — IG with rich caption**: Send an IG Reel URL with a place description in the caption → expect Flex draft card saved to Notion.
2. **Story D — IG sparse**: Send an IG Reel URL with only emojis/hashtags → expect "IG 連結我目前還沒辦法直接讀，可以截圖傳給我，或直接告訴我地點名稱。"
3. **Dedup — Story B**: Send a plain text place name → save it → send the same place name again → expect dedup card with 更新/不用 buttons. Tap 不用 → expect push "好，跳過，不重複存。"
4. **Dedup — Story C**: Share a Google Maps URL of a saved place → expect dedup card.
5. **Push fallback**: Hard to test manually (requires >30s processing). ADR-011 documents the mechanism.
6. **Regression**: Stories A/B/C/E all still work as before.

## Blocking Questions for PM

None. Ready for deploy + acceptance test.
