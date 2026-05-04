# Architecture Decision Records

This file records all local engineering decisions made during Alfred development.
Format: append-only. Never delete or renumber entries.

---

## ADR-001 — Use type predicate for LINE message content narrowing

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 2

### Context
LINE webhook message events carry a `message` field that is either a text message or another type (image, sticker, etc.). TypeScript's discriminated union narrowing breaks when one union member uses `type: string` (the catch-all), because `string` is a supertype of any literal — so `message.type === 'text'` can't exclude the catch-all member. The result: `message.text` is inaccessible even inside the narrowed branch.

### Decision
Export a `isTextMessage(msg): msg is LineTextMessageContent` type predicate from `src/integrations/line.ts`. Callers use this predicate instead of inline `=== 'text'` checks.

### Alternatives considered
- Remove the catch-all type and only list known message types — would break silently when LINE adds new message types.
- Use `as` type assertion — suppresses the error but bypasses type safety.
- Use `in` operator narrowing (`'text' in message`) — would work, but predicate is more explicit and reusable.

### Consequences
- Type-safe access to `message.text` without casts.
- Callers must import `isTextMessage`; slightly more verbose than an inline check.
- Future message types (image, location) handled by adding additional predicates as needed.

---

## ADR-002 — Script-based Notion DB creation instead of manual UI

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Intercalated (between Task 1 and Task 2; user request)

### Context
Spec §8.3 assumes the Place DB is created by hand in the Notion UI. The schema has 30 properties with precise API names, types, and select/multi-select options. Hand-keying all of this is slow, error-prone, and produces a result that can't be audited or reproduced. The PM hit this friction directly.

### Decision
One-time setup script at `scripts/setup-notion-db.ts`, run via `npx tsx`. It reads `NOTION_TOKEN` and `NOTION_PARENT_PAGE_ID` from `.env.local`, calls `notion.databases.create` with the full §4.1 schema, and prints the DB ID. Idempotent: if a database with the same title already exists under the parent page, it skips creation and prints the existing ID.

Note: Notion API version 2025-09-03 (used by `@notionhq/client` v5.x) requires properties to be passed under `initial_data_source.properties` rather than the top-level `properties` field documented in older API references.

### Alternatives considered
- Manual Notion UI — original spec approach; error-prone for 30 properties, not reproducible.
- Notion template sharing — can't programmatically configure options, no version control.
- Terraform/Pulumi with a Notion provider — no stable official provider exists.

### Consequences
- DB schema is version-controlled and reproducible in `scripts/setup-notion-db.ts`.
- Future property additions can be done by updating the script and calling `notion.databases.update`.
- Adds `@notionhq/client`, `dotenv`, `tsx`, `@types/node` as devDependencies (Node.js only; Worker runtime uses raw fetch for Notion).
- Views (§4.2) still require manual creation — Notion API does not support view management.
- `scripts/tsconfig.json` overrides Workers types with Node types, scoped to the `scripts/` directory.

---

## ADR-003 — Use standard vitest node environment instead of Cloudflare Workers pool

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 3

### Context
`@cloudflare/vitest-pool-workers@0.15.2` (required for its security advisory fix over 0.8.x) declares `vitest@^4.1.0` as a peer dependency. The project targets `vitest@^3.1.0`. Running tests with the custom pool at v3 produces "must export a function as default export" — a hard crash before any test executes. Task 3's unit tests are pure mappers with no Workers runtime APIs.

### Decision
Remove the custom pool from `vitest.config.ts` and use `environment: 'node'` (vitest's built-in default). Drop `@cloudflare/vitest-pool-workers` from test config entirely for now.

### Alternatives considered
- Upgrade vitest to v4 — would require auditing all peer deps; risky mid-task churn.
- Downgrade pool workers to an older version — older versions had a security advisory (OS command injection in `wrangler pages deploy`).
- Pin `@cloudflare/vitest-pool-workers` but configure it only for Workers-specific test files — viable, but no Workers-API tests exist yet; premature complexity.

### Consequences
- All current tests run cleanly under Node.js environment (pure unit tests, no Workers APIs).
- Future tests that require Workers runtime (e.g., testing `crypto.subtle` or `KVNamespace`) will need the pool re-added — requires upgrading vitest to v4 at that point.
- `@cloudflare/vitest-pool-workers` remains in `package.json` as a devDependency but is not used in config.

---

## ADR-005 — Regex-based HTML stripping instead of node-html-parser

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 6

### Context
`lib/html-extract.ts` needs to convert raw blog HTML to clean text for Claude. The spec says "use `node-html-parser` or similar Workers-compatible". Two options: add the `node-html-parser` npm package, or use a regex pipeline.

### Decision
Use regex-based stripping: remove script/style/nav/footer blocks, collapse block tags to newlines, strip remaining tags, decode entities, normalise whitespace, truncate. No new npm dependency.

### Alternatives considered
- `node-html-parser` — pure JS, Workers-compatible, but adds a package; provides DOM-style access which isn't needed here (we only want text).
- `HTMLRewriter` (Cloudflare-native) — most efficient for Workers but streams HTML via a Response object, making it harder to unit test synchronously.

### Consequences
- Zero new dependencies; easier to test (pure function).
- Won't handle malformed HTML as gracefully as a real parser, but blog content is almost always valid enough for our use case.
- If edge cases arise (e.g., inline script with `>` chars), can swap to `node-html-parser` later — the public API (`stripHtml(html, maxLength)`) stays the same.

---

## ADR-004 — LLM-based intent router with 0.6 confidence threshold and parallel slash commands

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 5.5 (spec amendment, inserted before Task 6)

### Context
The original spec §3.2 designated `intent-router.ts` as "Phase 0+1: just routes to places". The PM amendment upgrades this to a proper LLM-based router so future capabilities can be added without code changes to the router. Three design questions needed answering: routing strategy, confidence threshold, and how to handle explicit user commands.

### Decision
1. **LLM-based routing (Claude Haiku):** Router sends message + capability registry to Haiku and gets back `{ capability, confidence }`. Registry-driven: adding a new capability only requires appending to `_registry.ts`, not modifying router code.
2. **Confidence threshold = 0.6:** Below this, the unknown handler replies and asks for clarification. 0.6 was chosen as the midpoint between "clearly relevant" and "clearly not relevant" — high enough to avoid routing noise like casual greetings, low enough not to miss obvious place-related queries.
3. **Slash commands alongside LLM router:** Deterministic commands (`/help`, `/place`) run at higher priority than the LLM router. Power users get a reliable override path; `/place` is a debugging fallback if the LLM misclassifies.

### Alternatives considered
- Keyword matching instead of LLM: brittle for Chinese (can't enumerate all phrasings), doesn't generalize to future capabilities, requires constant maintenance.
- Higher threshold (0.8+): too conservative — a message like "帶孩子去哪好" has uncertain wording but clear intent.
- Lower threshold (0.4): too permissive — off-topic messages like "謝謝" might get routed to places.
- No slash commands: removes the deterministic override path; hard to debug misclassifications in production.

### Consequences
- Adding a future capability requires only: (1) append to `_registry.ts`, (2) add dispatch branch in `dispatchCapability` in `index.ts`.
- Haiku API call on every text message adds ~200-500ms latency; acceptable given LINE loading indicator covers up to 60s.
- Confidence threshold is a tunable constant (`CONFIDENCE_THRESHOLD` in `intent-router.ts`); can adjust based on production routing logs.
- Observability: every routing decision logged as JSON (`type: intent_routing`) — useful for future accuracy analysis.

---

## ADR-006 — User-side KV key for last-place anchor (`user:{userId}:last_place`)

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 7+8 (spec amendment §5)

### Context
Phase 1.5 will allow users to edit the most recently added place with a message like "改成 5-10 歲". The bot needs an anchor: a pointer from "this user's current session" to the specific place they last added. Two design options were considered: (a) store the reply message ID alongside the place (`place:{id}:last_bot_msg`), or (b) store a user-side pointer to the place (`user:{userId}:last_place`).

### Decision
Use `user:{line_user_id}:last_place` with TTL 24 hours and value `{ internal_id, sent_at, chat_id }`.

### Alternatives considered
- `place:{internal_id}:last_bot_msg` keyed by place: LINE Reply API does not return a message ID for the sent reply. There is no standard way to obtain the outgoing message ID without using the push API (which has different rate limits and billing). Even if obtainable, message-side storage doesn't naturally answer "what was *this user's* last place".
- No KV at all, infer from Notion: querying Notion for "most recently created by this user" is slow and requires a createdBy field reliably set — not guaranteed in all flows.

### Consequences
- Phase 1.5 "edit last place" simply reads `user:{userId}:last_place`, resolves `internal_id` to a Notion page, and patches it.
- 24-hour TTL means the editing window is bounded — reasonable given parents typically review output immediately.
- `chat_id` stored for future use if group-chat context matters (e.g., different editing rules for family group vs. personal DM).
- If the user adds two places in quick succession, the key is overwritten: only the most recent is the "last place". This is the expected behavior.

---

## ADR-007 — Story B `source_type = []` (empty), not `['Google Maps']`

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 7 (post-acceptance fix)

### Context
Spec §4.1 defines `Source Type` as a multi-select Notion property that tracks *how the user discovered the place* (semantic provenance), not what data source the bot used to look it up. During Task 7 the engineer initially used `['Google Maps']` for Story B, conflating "we queried the Google Places API" with "the user found this on Google Maps". PM corrected this on acceptance.

### Decision
Story B (`flow-b-text.ts`): `source_type = []` — leave empty so the reviewing family member can fill in the semantic origin manually.
Story C (`flow-c-maps.ts`): `source_type = ['Google Maps']` — the user explicitly pasted a Google Maps URL, so the semantic source is known.

### Alternatives considered
- `['Google Maps']` for Story B: incorrect — user may have heard about the place from a friend, a blog, or direct knowledge. We have no signal.
- Infer from context (e.g. if user's text matches a known blog title, use `['部落格']`): too complex; deferred to Phase 2 if needed.

### Consequences
- Story B entries in Notion will have empty `Source Type` until the family reviews them — expected and acceptable.
- The `Source Type` filter in Notion views won't surface Story B entries when filtered by a specific source (e.g., "Google Maps only").
- Prevents future confusion where all plain-text-added places would incorrectly appear to have come from Google Maps.

---

## ADR-008 — Search ranking: last_edited_time desc + in-memory keyword scoring

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 9

### Context
Notion's database query API does not support relevance scoring. For Story E search results, we need a reasonable default ordering and a way to promote results that better match the user's free-text keywords.

### Decision
1. **Default sort:** `last_edited_time descending` — entries the wife recently reviewed/edited appear first. More curated entries are more useful.
2. **Keyword re-ranking:** when `free_text_keywords` is non-empty, sort the Notion results in-memory by keyword hit count (number of distinct keywords found across name + summary + address + categories + fee_details). Ties keep last_edited_time order from step 1.

### Alternatives considered
- Sort by `created_time` ascending — older entries first; counterproductive as they're less likely to be reviewed.
- Sort by name alphabetically — arbitrary; doesn't reflect curation quality.
- LLM re-ranking (pass results back to Claude for relevance scoring) — too slow and expensive for real-time search.

### Consequences
- Recently-confirmed places naturally rank higher, which matches wife's mental model ("I just confirmed that park last week").
- Keyword scoring is simple substring match — doesn't handle stemming or synonyms, but sufficient for Chinese place names/summaries.
- If all results have zero keyword score, order falls back to last_edited_time (from Notion sort).
- Search observability: every query logs `{ type: 'search_query', parsed_filters, query_intent_summary }` and `{ type: 'search_result', candidate_count }` for future quality analysis.

---

## ADR-009 — Instagram URL: OG fetch with facebookexternalhit UA, description length gate

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 10

### Context
Instagram blocks most crawlers with login redirects. Instagram Reels/posts serve OG meta tags (`og:title`, `og:description`) to the `facebookexternalhit` User-Agent used by the Facebook scraper. The `og:description` on Reels is often sparse (≤ 30 chars) — it may be just an emoji or a hashtag with no place name — so we can't blindly send it to Claude. We need a quality gate.

### Decision
`flow-d-instagram.ts`: fetch with `User-Agent: facebookexternalhit/1.1 ...` → regex-extract `og:description` → if length ≥ 30 chars, send to Claude (`extractFromHtml`) → Flex reply; else send fallback: "IG 連結我目前還沒辦法直接讀，可以截圖傳給我，或直接告訴我地點名稱。"

The fallback message references "截圖傳給我" intentionally — it primes users for the upcoming Task 11 (image input).

### Alternatives considered
- Parse og:title + og:description together: title is even more sparse (usually just place name). og:description alone carries more context.
- Use Puppeteer / headless browser: not available in Cloudflare Workers runtime.
- Require users to share a caption text instead of IG URL: higher user friction.
- Always attempt Claude even with short description: wastes ~$0.001 per request and produces poor extractions that the user then has to fix.

### Consequences
- Works for many IG posts that include a location description in the caption (≥ 30 chars).
- Fails gracefully for short-caption Reels — user gets a clear fallback with a workaround.
- No dedup check for Story D (no `google_place_id` available from OG tags alone) — same limitation as Story A.
- IG may change OG behavior at any time; the fallback path handles any future breakage safely.

---

## ADR-010 — Story A and Story D: no dedup check (no google_place_id)

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 10

### Context
Dedup relies on `google_place_id` as the stable unique identifier for a physical location. Story A (blog URL) and Story D (Instagram URL) extract from HTML/OG content, which never contains a `google_place_id`. Without this key, we cannot check KV or Notion for a prior entry.

### Decision
Skip the dedup check entirely for Stories A and D. Accept that duplicate entries may be created if the user submits a blog URL and an IG URL for the same place. Family can de-duplicate manually in Notion.

### Alternatives considered
- Use place name as dedup key: name is user-visible text with inconsistent formatting (spaces, Traditional/Simplified variants, abbreviations). High false-positive and false-negative rate.
- Call Google Places textSearch after Claude extraction to get a `google_place_id`, then check dedup: adds a Google Places API call to every Story A/D flow. Increases latency (~500ms) and API cost. Deferred to Phase 2 if dedup quality becomes a real problem.

### Consequences
- Story A and Story D may create duplicate Notion entries for the same physical place.
- Stories B and C (which have `google_place_id` from Google Places) are fully protected.
- The limitation is acceptable for Phase 0+1 given the low volume of family use.

---

## ADR-011 — Reply token expiry: push API fallback, not retry

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 10

### Context
LINE reply tokens expire ~30 seconds after the webhook event. For flows with heavy processing (Claude extraction + Google Places + Notion write), the token may expire before `sendReply` is called. The LINE API returns HTTP 400 with body `"Invalid reply token"` in this case. We need a recovery strategy.

### Decision
In `sendReply`, detect 400 + "Invalid reply token" and fall back to `sendPush(chatId, messages, accessToken)` if a `chatId` was provided by the caller. Callers (flow-a, flow-b, flow-c, flow-d) pass `chatId` as the optional 4th argument.

### Alternatives considered
- Retry `sendReply` with a new token: LINE tokens are single-use and expire — retrying the same token always fails.
- Store messages and retry on next user interaction: complex, bad UX (user doesn't know why there's no immediate response).
- Switch entirely to push API: push has different rate limits and billing implications. Reply API is free for bot replies; push is free for verified bots but rate-limited differently. Reply token is the preferred path when available.
- Do nothing (silently drop the message): bad UX — user sees nothing after submitting a place.

### Consequences
- Users in fast flows (Story B/C plain name lookup) almost never hit the 30s limit.
- Users in slow flows (Story A with slow blog fetch + Claude) may occasionally trigger the push fallback — they'll still receive the Flex card, just via push instead of reply.
- Story E (search) does not pass `chatId` to `sendReply` (search is fast — intent parse + Notion query fits well under 30s). No change needed.
- Push API requires the bot to be a friend of the user or a group member — this is already satisfied since we only have chatIds from events in active conversations.

---

## ADR-012 — Image messages bypass LLM intent router; `accepts_images` forward-compat field in registry

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 11

### Context
The LLM intent router (Haiku) classifies user messages by their text content. Image messages have no text, so the router cannot be used. A design decision is needed for: (a) how to dispatch image messages today, and (b) how to extend the registry for future capabilities that also handle images.

### Decision
1. **Direct dispatch:** In `index.ts`, detect `message.type === 'image'` before the text routing block. Skip `handleSlashCommand` and `routeIntent`; call `placesImageHandler` directly. This is the only places-capable path in Phase 0+1.
2. **`accepts_images?: boolean` in `Capability` type** in `_registry.ts`. The `places` capability is set to `accepts_images: true`. When a future capability (e.g., shopping receipts) also needs to handle images, `index.ts` will dispatch to the first capability with `accepts_images === true`. In Phase 0+1 with one capability, this is equivalent to hardcoding `places` — the field is a forward-compat annotation only, not yet used in dispatch logic.

### Alternatives considered
- Route image through Haiku with a "this is an image" text prompt: adds latency, wastes tokens, doesn't add value.
- Use image captioning first (a separate LLM call to describe the image), then route the description: even more latency; Claude Sonnet Vision can classify AND extract in a single call.
- Always route all media types to places: correct for Phase 0+1 but would silently swallow images if a second non-places capability is added without updating the dispatch logic.

### Consequences
- Image messages are dispatched to `places` with ~zero routing overhead.
- The `accepts_images` field makes the registry self-documenting and provides a migration path when a second image-capable capability is added.
- Non-image, non-text messages (stickers, audio, video, location) still hit the `!isTextMessage` guard and are silently ignored.

---

## ADR-013 — `raw_extraction` KV does not store base64 image body

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 11

### Context
`writeRawExtraction` stores input data and the Claude response in KV for debugging and future model improvement. For image messages, the naive approach is to include the base64-encoded image body in `raw_input`. A typical smartphone photo is 2–8 MB; base64 encoding adds ~33% overhead, bringing it to 2.7–11 MB. Cloudflare KV enforces a 25 MB per-value limit — a single large photo would exhaust 40–44% of that limit, and a burst of photos would fail or truncate.

### Decision
Store only metadata in `raw_input` (LINE message ID, MIME type, size_bytes) instead of the base64 body. Store the extracted `Place` JSON in `raw_claude_response`. Do not store the image itself.

### Alternatives considered
- Store image in R2 object storage instead of KV: architecturally correct but adds a new Cloudflare service binding (R2 bucket) and infra setup that isn't needed for Phase 0+1 debugging. Deferred to Phase 2 if image audit becomes necessary.
- Store image in KV with a per-photo check (skip if > 5MB): adds conditional logic and still risks large-photo failures.
- Don't write any raw extraction for images: loses the debugging trace entirely.

### Consequences
- The LINE message ID (`line_message_id`) allows the image to be re-fetched from LINE's Content API during its retention window (~1 week for standard bots, longer for PREMIUM).
- After retention expiry, the original image is unrecoverable from our storage — acceptable for Phase 0+1 debugging.
- KV value size for image `raw_extraction` entries is ~100 bytes (metadata + Place JSON), vs. up to 11 MB for the base64 body.
