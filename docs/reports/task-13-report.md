# Task 13 Execution Report — Within-Places Intent Classifier

**Date:** 2026-05-04
**Engineer:** Claude Code
**Status:** Complete, awaiting acceptance

---

## What was built

### A — `src/core/places-intent-classifier.ts` (new)

`classifyPlacesIntent(message, context, env)` — Haiku LLM call (reuses `createClient` + `chatJson` from `anthropic.ts`). Returns `{ intent, confidence, reasoning }`.

Intent enum: `'add' | 'search' | 'edit' | 'delete' | 'visit' | 'setup' | 'unknown'`

Context type: `{ just_replied_card_at?: string, last_place_internal_id?: string }`. When present, LLM receives a "【Context】剛傳了一張卡片" hint that biases toward edit/delete.

Guards:
- Invalid intent value → `SAFE_DEFAULT` (`unknown`, confidence 0)
- Missing `confidence` field → `SAFE_DEFAULT`
- API error / parse failure → `SAFE_DEFAULT` + `console.error`
- `confidence < 0.6` → force `unknown` (threshold applied after LLM response)

Observability: `console.log({ type: 'places.intent_classify', message_preview, intent, confidence, reasoning, has_context })` — ready for Task 19 upgrade.

### B — `src/capabilities/places/handler.ts` (rewritten text dispatch)

- Removed `isSearchQuery` import
- Added `readPlacesContext(env, userId)` — reads `user:{id}:last_place` KV; returns context if card was sent within 5 minutes, empty object otherwise
- Text path: `classifyPlacesIntent` → `switch (intent)`:
  - `search` → `runFlowE`
  - `add` → `runFlowB`
  - `edit` → stub reply "編輯功能即將推出"
  - `delete` → stub reply "刪除功能即將推出"
  - `visit` → stub reply "造訪記錄功能即將推出"
  - `setup` → guidance "打 /setup 或直接分享位置"
  - `unknown` → `handleUnknown`

URL/image dispatch paths are unchanged.

### C — `src/capabilities/places/input-detect.ts` (cleaned)

`isSearchQuery` and `QUESTION_WORDS` removed (ADR-024 Option A — clean removal). `detectInputType` and `isInstagramUrl` are retained (still used by handler).

### D — Tests removed

`isSearchQuery` describe block (15 tests) removed from `tests/unit/input-detect.test.ts`.

---

## Test summary

| File | Tests |
|---|---|
| `places-intent-classifier.test.ts` | 18 (new) |
| `input-detect.test.ts` | -15 (isSearchQuery tests removed) |
| **Suite total** | **326 passed, 0 failed** |

---

## ADR recorded

**ADR-024**: LLM classifier replaces keyword-based `isSearchQuery`. Rationale: keyword matching cannot scale to 7 intents. Haiku Tradeoffs documented.

---

## Acceptance tests (run after deploy)

1. Send "下雨天哪裡好玩" → classified as search, carousel reply (same as Phase 0+1)
2. Send "兒童新樂園" → classified as add, Notion entry created (same as Phase 0+1)
3. Send "我們今天去了大湖公園" → reply "造訪記錄功能即將推出"
4. Immediately after receiving a place card, send "改成 5-10 歲" → reply "編輯功能即將推出"
5. Send "刪掉剛剛那筆" → reply "刪除功能即將推出"
6. Phase 0+1 regression: URL/Google Maps/Instagram/Image inputs still work correctly
