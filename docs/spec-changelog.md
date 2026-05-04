# Alfred Phase 0+1 — Spec Changelog

This file records all amendments to `docs/alfred-phase-0-1-spec.md` that accumulated during execution of Phase 0+1 tasks. It is append-only; future phases will add their own sections.

---

## Phase 0+1 Closeout Amendments — 2026-05-04

Applied to spec version 1.1 (final Phase 0+1 document).

### CL-001 — Model string: claude-sonnet-4-7 → claude-sonnet-4-6

**Section:** §7.1 Model Selection
**Trigger:** Task 4 execution
**Change:** The spec originally specified `claude-sonnet-4-7`. At implementation time, that model string was not yet available via the SDK; the correct string in production is `claude-sonnet-4-6`. Spec updated to match the actually-deployed model string.

---

### CL-002 — KV schema: remove `last_bot_msg`; update `user:last_place` value; add `name` to dedup

**Section:** §5 Cloudflare KV Schema
**Trigger:** Task 7+8 (ADR-006) and Task 10 (duplicate-check.ts)
**Change (three parts):**
1. Removed `place:{internal_id}:last_bot_msg` key. Decision: LINE Reply API does not return the sent message ID; this key was not implementable. Superseded by the user-side `user:{line_user_id}:last_place` key (ADR-006).
2. Updated `user:{line_user_id}:last_place` value from `{internal_id, sent_at}` to `{internal_id, sent_at, chat_id}`. `chat_id` needed so Phase 1.5 can push the edit reply to the correct conversation.
3. Updated `dedup:{google_place_id}` value from `{notion_page_id, internal_id}` to `{notion_page_id, internal_id, name}`. `name` needed to render the dedup card ("「{name}」已經存過了") without a Notion read-back.

---

### CL-003 — Source Type per-story rules

**Section:** §4.1 Properties (Source Type row)
**Trigger:** Task 7+8 (ADR-007)
**Change:** `Source Type` is semantic provenance — how the user discovered the place — not which API the bot used to look it up. Added per-story assignment rules:
- Story A (blog URL): `['部落格']`
- Story B (plain text): `[]` — source unknown; family fills in at review time
- Story C (Google Maps URL): `['Google Maps']` — user explicitly shared a Maps link
- Story D (Instagram URL): `[]` — source unknown at bot level
- Story F (Image): `[]` — source unknown (screenshot may be from any context)

---

### CL-004 — Intent router and registry implementation notes

**Section:** §3.2 Project Structure
**Trigger:** Task 5.5 (ADR-004), Task 11 (ADR-012)
**Change:**
1. `core/intent-router.ts`: Implementation is LLM-based (Claude Haiku), not keyword-based. Confidence threshold 0.6. Image messages bypass the router entirely and dispatch directly to the first capability with `accepts_images === true`.
2. `capabilities/_registry.ts`: `Capability` type now includes `accepts_images?: boolean` field. `places` capability has `accepts_images: true` for forward-compatible image dispatch to future capabilities.
3. File tree updated to include new files added during execution: `flow-d-instagram.ts`, `flow-image.ts`, `kv-store.ts`, `duplicate-check.ts`, `errors.ts`.

---

### CL-005 — Task list: add Task 5.5, update Task 10, add Task 11 (Image Input)

**Section:** §9 Task Breakdown
**Trigger:** Tasks 5.5, 10, 11
**Change:**
- Added **Task 5.5 — LLM Intent Router** (inserted between Task 5 and Task 6): Claude Haiku-based capability classifier with 0.6 confidence threshold, slash command priority layer, capability registry.
- Expanded **Task 10 — Error Handling & Edge Cases** scope to include: Instagram URL fallback flow (Story D), duplicate check with KV + Notion, KV write decoupling (independent try/catch per write), reply-token-expired push fallback.
- Replaced old **Task 11 — Tests** (coverage-focused catch-all) with **Task 11 — Image Input** (Story F): LINE Content API fetch, Claude Vision extraction, `no_place_detected` fallback, raw KV stores metadata not base64.
- Old Task 12 (Deploy) renumbered to Task 12; content unchanged.

---

### CL-006 — User Stories: add Story D (Instagram), Story F (Image Input), Story G (IG→Image transition)

**Section:** §2 User Stories & Flows
**Trigger:** Tasks 10, 11
**Change:**
- **Story D** changed from "Browse in Notion" (pure-Notion, out of bot scope) to **Instagram URL** — bot detects `instagram.com` URL, fetches OG tags with `facebookexternalhit` UA, extracts if description ≥ 30 chars, else sends fallback message directing user to send a screenshot.
- Added **Story F — Image Input**: bot receives a LINE image message (screenshot, sign photo, magazine clipping), fetches binary from LINE Content API, passes to Claude Vision (Sonnet), extracts place info, saves to Notion + KV, replies with Flex card. If Claude cannot identify a place, sends "看起來不是景點相關的圖" fallback.
- Added **Story G — IG URL → Image Transition**: describes the end-to-end flow where user pastes an IG URL (Story D fallback), receives "截圖傳給我" message, then sends screenshot (Story F), which works correctly.
- Old "Story F — Group Chat Use" renumbered to **Story H**.

---

### CL-007 — Error handling table: IG and image error rows

**Section:** §6.9 Error Handling
**Trigger:** Tasks 10, 11
**Change:** Added three new rows to the error handling table:
- Instagram URL with insufficient OG content → `IG 連結我目前還沒辦法直接讀，可以截圖傳給我，或直接告訴我地點名稱。`
- Image > 5MB (Claude Vision API limit) → `圖片太大了，可以截小一點再傳嗎？或直接告訴我地點名稱。`
- Image received but no place detected (Claude returns `{ error: "no_place_detected" }`) → `看起來不是景點相關的圖，可以再試一次，或直接告訴我地點名稱。`
