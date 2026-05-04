# Task 18 Execution Report — Home Setup Flow

**Date:** 2026-05-04
**Engineer:** Claude Code
**Status:** Complete, awaiting acceptance

---

## What was built

### A — LineLocationMessageContent type + predicate (`src/integrations/line.ts`)

Added `LineLocationMessageContent` type with fields `type`, `id`, `title`, `address`, `latitude`, `longitude`. Added `isLocationMessage()` type predicate. Updated `LineMessageContent` union type to include the new type. 4 unit tests cover the predicate.

### B — Settings DB integration (`src/integrations/notion.ts`)

Added:
- `SettingsRow` type with `notion_page_id`, `line_user_id`, `display_name`, `home_address`, `home_lat`, `home_lng`, `configured_at`
- `getSettingsByLineUserId(env, userId)` — queries Settings DB via raw fetch with `Notion-Version: 2022-06-28`, returns first matching row or null
- `upsertSettings(env, row)` — find-then-PATCH or POST; returns the updated/created row

Both use `discoverDbIds` for Settings DB ID (already built in M2).

### C — Home store (`src/capabilities/places/home-store.ts`)

Full KV-layer implementation:
- `getHomeLocation` — KV fast path (`user:{id}:home`) → Settings DB slow path → null; backfills KV on DB hit
- `setHomeLocation` — writes KV (no TTL) + Settings DB upsert
- `getCurrentOrigin` — reads `user:{id}:current_origin`
- `setCurrentOrigin` — writes with `expirationTtl: 7200` (2h)
- `clearCurrentOrigin` — KV delete
- `getEffectiveOrigin` — priority: current_origin → home → `{ source: null }`
- `hasBeenPromptedRecently` — reads `user:{id}:home_prompted_at`
- `markHomeprompted` — writes `'1'` with `expirationTtl: 604800` (7d)

14 unit tests in `tests/unit/home-store.test.ts`.

### D — Slash commands (`src/core/slash-commands.ts`)

Added `userId?: string` as 4th parameter to `handleSlashCommand`. Added three new cases:
- `/setup` — shows current home address or setup prompt; error if not DM context
- `/home` — clears `current_origin`, confirms "切回家裡位置"; error if not DM
- `/here` — explains how to share location; does not require userId

8 new unit tests in `tests/unit/slash-commands.test.ts`.

### E — First-time home guidance (`src/index.ts`)

Inside the `message` event handler, before any message processing, checks `userId` (user DM source only). Runs `Promise.all([hasBeenPromptedRecently, getHomeLocation])`. If neither prompted nor home set, sends a push message explaining how to share home location, then calls `markHomeprompted`. Wrapped in try/catch so failures don't drop the main event.

### F — Flow setup (`src/capabilities/places/flow-setup.ts`)

`runFlowSetup(location, replyToken, env, userId)` implements ADR-020:
- No home → `setHomeLocation` + confirmation reply (mentions address)
- Home exists → `setCurrentOrigin` + "2 小時" reply

2 unit tests in `tests/unit/flow-setup.test.ts`.

### G — Location routing in index.ts

After the home guidance check, `isLocationMessage(message)` routes to `runFlowSetup` and `continue`s (skips all other processing). The `handleSlashCommand` call in the text branch now passes `userId`.

---

## Test summary

| File | Tests |
|---|---|
| `line-location-message.test.ts` | 4 |
| `home-store.test.ts` | 14 |
| `flow-setup.test.ts` | 2 |
| `slash-commands.test.ts` | 15 (8 new, 7 existing) |
| **Suite total** | **280 passed, 0 failed** |

---

## ADRs recorded

- **ADR-020**: First location message = home; subsequent = current_origin (2h override). Zero-friction heuristic. Flagged for PM review.

---

## Open question for PM Claude

ADR-020 documents the "first location = home" assumption. Is this the intended UX, or should the flow ask "是家還是目前位置?" with quick-reply buttons? Current implementation is zero-friction but ambiguous on first share.

---

## Acceptance tests

The following live tests should be run after deployment:

1. **First location → home**: Send location in DM → Alfred replies with home address confirmation, `user:U:home` KV key set, Settings DB row created.
2. **Second location → current_origin**: Send another location → Alfred replies with "2 小時", `user:U:current_origin` TTL 2h set, home unchanged.
3. **`/setup` with home set**: Reply shows home address.
4. **`/setup` no home**: Reply shows setup prompt.
5. **`/home` clears override**: After current_origin set, `/home` replies "切回家裡位置", KV key deleted.
6. **First-time prompt**: New user sends text → Alfred sends push asking to share home; a second text message does NOT trigger prompt again (7d TTL).
