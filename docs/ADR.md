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

---

## ADR-014 — URL messages bypass LLM intent router; `accepts_urls` forward-compat field in registry

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 12 (Fix 1)

### Context
During acceptance testing, Instagram URLs sent to the bot were classified as `unknown` by the LLM intent router instead of being routed to the `places` capability. The underlying issue: a pure URL is structural input (like an image), not natural language. Asking Claude Haiku to classify `https://www.instagram.com/reel/ABC/` as a capability is unreliable — the URL syntax provides no natural-language signal.

### Decision
Add `accepts_urls?: boolean` to the `Capability` type. Set `places: { accepts_urls: true }`. In `index.ts`, before the LLM router: if the trimmed message text is a pure URL (starts with `http://` or `https://` and contains no spaces), find the first capability with `accepts_urls === true` and dispatch directly. This mirrors the image bypass pattern (ADR-012).

### Alternatives considered
- Add Instagram URL keywords to the intent router's positive examples: fragile, only fixes IG, misses other URL forms.
- Special-case Instagram URL in index.ts without a registry field: works but doesn't generalize; future capabilities with URL inputs would need the same special case.
- Lower the confidence threshold for URLs: still relies on LLM to pattern-match URLs, which is hit-or-miss.

### Consequences
- All pure URL messages bypass the LLM router. Mixed messages ("幫我看 https://example.com 怎樣") still go through the router.
- Generalizes forward: any future capability that handles URLs can set `accepts_urls: true`.
- Cost: one `isHttpUrl` check per text message — negligible.

---

## ADR-015 — Google Places `locationBias` hardcoded to Taipei; TW country safety net

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 12 (Fix 3)

### Context
During acceptance testing, querying "東京迪士尼" correctly triggered a non-TW result. But more subtly, generic queries like "樂園" could return overseas results (Tokyo Disneyland) if the user's intent is clearly Taiwan family destinations. The bot should prefer Taiwan results for ambiguous queries.

### Decision
1. Add `locationBias` to the `textSearch` request body: a 50km circle centered on Taipei Main Station (25.0478, 121.5170). This is a bias, not a strict filter — Google can still return non-TW results if the query is specifically about overseas locations.
2. Add `isTaiwanAddress` post-filter: candidates whose `formattedAddress` doesn't include '台灣', 'Taiwan', 'TW', a Taiwanese postal code prefix, or a known Taiwan city name are filtered out and logged as warnings. Phase 0+1 hardcode; Phase 2 to be user-configurable.

### Alternatives considered
- `languageRestriction: 'zh-TW'` field: only affects language of response text, not result geography.
- `regionCode: 'TW'` field: not available in Places API (New) textSearch body.
- Asking Claude to validate the result is in Taiwan: adds an extra LLM call and latency for each search.

### Consequences
- False negatives: if user intentionally queries an overseas place (planning a Japan trip), the result is filtered and they receive a "not found" response. Acceptable for Phase 0+1 family Taiwan bot.
- The center point (Taipei Main Station) biases toward northern Taiwan. Family's `home_lat`/`home_lng` should replace this in Phase 2.

---

## ADR-016 — Unified `extract → resolveGooglePlace → dedup → write` pipeline for Stories A, D, F

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 12 (Fix 4)

### Context
In the original Phase 0+1 implementation, only Stories B and C (which start from Google Places) could run the dedup check, because only they had a `google_place_id`. Stories A (blog URL), D (Instagram), and F (Image) extracted place info via Claude but wrote to Notion without any dedup check — so the same place could be saved multiple times if the user sent both a blog URL and a photo of the same venue.

### Decision
Create `src/capabilities/places/resolve-google-place.ts` with `resolveGooglePlace(place, env)`. After Claude extraction, all three flows (A, D, F) call this function, which runs a Google Places textSearch using `name + region`, applies a fuzzy name match on the top result, then fetches full details to get `google_place_id`, `lat`, `lng`, and `address`. If resolution succeeds, the enriched fields overwrite the Claude-extracted values before Notion write. Then `checkDuplicate` is called normally with the resolved `google_place_id`.

### Alternatives considered
- Store a name-based hash in KV for dedup: fragile (name variations, typos). Google Place ID is the canonical dedup key.
- Run dedup only for B/C and accept duplicates for A/D/F: leaves the most common cross-flow duplicate case (blog + screenshot of same place) undetected.
- Call resolution only for high-confidence extractions (based on `ai_inferred_fields`): adds complexity; resolution failure already returns null gracefully.

### Consequences
- One extra Google Places textSearch per A/D/F flow success (~$0.002 per call, negligible at family scale).
- If Claude extracted the wrong name, resolution may match a different place — wrong `google_place_id` attached. The fuzzy match (extracted name contains Google name, or vice versa) mitigates this, but doesn't eliminate it.
- Resolution failure is non-fatal: returns null, flow continues without `google_place_id`, no dedup for that entry.
- ADR-010 ("Story A and Story D: no dedup") is now superseded by this ADR for the cases where resolution succeeds.

---

## ADR-017 — Migration runner uses raw fetch for Notion queries; SDK only for create/list

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task M0

### Context
`@notionhq/client` v5.20.0 uses Notion API version `2025-09-03`, which renamed `databases.query` to `dataSources.query` with a `data_source_id` parameter. Databases created via `databases.create` (legacy endpoint) are not accessible via the new `dataSources.query` endpoint — the SDK returns a 404 "object not found" error even though the integration created the database itself. The production `src/integrations/notion.ts` uses raw fetch with Notion API version `2022-06-28`, which is stable and has no such issue.

### Decision
In `scripts/migrations/_runner.ts`, use the Notion SDK (`@notionhq/client`) only for `blocks.children.list` (finding the Migrations DB) and `databases.create` (creating it). For reading applied migrations and recording new ones, use raw `fetch` calls to `https://api.notion.com/v1` with `Notion-Version: 2022-06-28`, matching the production integration.

### Alternatives considered
- Pass `notionVersion: '2022-06-28'` to the SDK Client constructor: the v5 TypeScript types don't expose `databases.query`, so it would require `as any` casts throughout.
- Use `dataSources.create` (new API) instead of `databases.create`: `dataSources.create` requires a parent `database_id`, not a `page_id` — the Migrations DB must sit under the parent page, not inside another database.
- Share the newly created DB manually before first query (require user action after auto-create): poor UX and error-prone; raw fetch avoids the need entirely.

### Consequences
- `NOTION_VERSION = '2022-06-28'` is duplicated between scripts runner and `src/integrations/notion.ts`. Acceptable — these are different contexts (scripts vs. Workers).
- If Notion ever deprecates the 2022-06-28 API, both the runner and the production integration need updating.
- Migrations can be queried immediately after auto-creation without manual "share with integration" step.

---

## ADR-018 — Migrations DB lives under NOTION_PARENT_PAGE_ID (same parent as Place DB)

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task M0

### Context
The spec (§3.3) says the Migrations DB should live under "Alfred — 設定" page. However, Phase 1.5 blocking question 3 confirmed that we reuse the existing `NOTION_PARENT_PAGE_ID` (ID: `356d06a9b2ec8009838cd212d2f17715`) rather than creating a new "Alfred — 設定" page. This is the same parent page that houses the Place DB.

### Decision
`ensureMigrationsDb` in `_runner.ts` looks for and creates the Migrations DB under `NOTION_PARENT_PAGE_ID`. No separate "Alfred — 設定" page is created.

### Alternatives considered
- Create "Alfred — 設定" page first, then put Migrations DB under it: adds another Notion setup step and another env var.
- Store migration applied state in a local JSON file: doesn't require Notion at all, but breaks if run from multiple machines.

### Consequences
- The Migrations DB sits alongside the Place DB under one parent page — simpler mental model.
- If Phase 5 requires multi-Notion-workspace, the assumption of a single parent page will need revisiting.

---

## ADR-019 — DB ID discovery via Notion parent-page scan + KV cache (Option B)

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task M2

### Context
Phase 1.5 adds two new Notion DBs (Visits, Settings) whose IDs are created at migration time rather than known in advance. The question is how the Workers runtime learns these IDs. Option A: user runs `wrangler secret put NOTION_VISITS_DB_ID` and `NOTION_SETTINGS_DB_ID` after migration (consistent with existing `NOTION_DB_ID` precedent, but requires two manual steps per new DB). Option B: on cold start (KV miss), scan `NOTION_PARENT_PAGE_ID` block children to find all child databases by title, cache the map in KV with 24h TTL.

### Decision
Implement Option B (`discoverDbIds` in `src/integrations/notion.ts`). The function checks `ALFRED_KV.get('system:db_ids')` first; on miss, scans the Notion parent page, identifies the three databases by their human-readable titles, and writes the result to KV with `expirationTtl: 86400`. Returns `{ places, visits, settings }` DB ID map. `NOTION_PARENT_PAGE_ID` is added to the `Env` type and must be stored as a Cloudflare secret.

### Alternatives considered
- Option A (manual secrets): zero runtime complexity, but every new DB requires human action. Phase 1.5 adds 2 DBs; future phases may add more.
- Store in a Notion page property: too bespoke, extra Notion API call, no KV caching.
- Hard-code IDs in `wrangler.toml`: IDs change if DBs are recreated; not secret-safe.

### Consequences
- One extra KV `get` per cold start (< 1ms); on miss, one paginated Notion API call. Negligible at family scale.
- DB titles must remain stable (renaming "Visits" would break discovery until KV TTL expires). This is acceptable — titles are internal names, not user-facing.
- `NOTION_PARENT_PAGE_ID` must now be set as a Cloudflare secret before deploying Phase 1.5 features. Added to `src/core/env.ts`. Action required: `npx wrangler secret put NOTION_PARENT_PAGE_ID`.
- Future: Task 18+ will wire `discoverDbIds` into the request path when Visits/Settings DBs are first needed.

## ADR-020 — First location message sets home; subsequent ones set current_origin

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 18

### Context
When a user sends a LINE LocationMessage, `runFlowSetup` must decide what to do with it. The spec leaves open the question of how to distinguish "I'm sharing my home" from "I'm sharing where I am right now." Asking the user to confirm each time ("Is this your home or current location?") adds friction. We need a zero-friction rule.

### Decision
If the user has no home saved yet, the first location message is treated as home. If home already exists, the location is treated as a 2-hour `current_origin` override. This is implemented in `src/capabilities/places/flow-setup.ts` with a single `getHomeLocation` check — no user prompt required.

### Alternatives considered
- Always ask: "是家裡位置還是目前位置?" with quick-reply buttons — more explicit but requires a round-trip interaction.
- Always set home: breaks the use case of sharing a current location while traveling.
- Always set current_origin: user can never set home via location share (would need another mechanism).

### Consequences
- Zero UI friction for the common case (first setup → home, subsequent → current position).
- If a user accidentally shares a wrong location first, they must re-share to overwrite home. This is acceptable: `/setup` shows the current home address so they can detect the mistake.
- The ambiguity is resolved by the ordering heuristic rather than user intent; flagged to PM Claude for review.

## ADR-021 — Flag-based home update: /setup sets pending flag, next location consumes it

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 18 amendment

### Context
`runFlowSetup` (ADR-020) could not distinguish "user wants to update home" from "user is sharing current position" when home already exists. `/setup` was read-only for users with home already set, leaving no self-service update path.

### Decision
`/setup` with an existing home writes a `user:{id}:home_update_pending` KV flag with a 5-minute TTL, and replies with an update prompt. `runFlowSetup` calls `consumeHomeUpdatePending` first: if the flag exists it is deleted atomically (read-then-delete; deletion failure is non-fatal — TTL expires it) and the location is treated as a home update. If no flag, the existing ADR-020 logic applies: no home → first-time setup; home exists → current_origin 2h.

### Alternatives considered
- Quick-reply buttons in the location message asking intent: requires extra round-trip and user decision at location-share time.
- Dedicated `/update-home` command: redundant with `/setup`; `/setup` already implies configuration intent.
- Persistent `home_update_requested` without TTL: risks stale state if user doesn't follow through.

### Consequences
- `/setup` is now the single entry point for both first-time setup and home updates — no new commands needed.
- 5-minute window is forgiving for typical flows (open LINE → tap + → share location) while preventing accidental home overwrites from later location shares.
- `consumeHomeUpdatePending` read-then-delete is not atomic in KV, but double-consumption is safe: both calls would `setHomeLocation` to the same or a near-simultaneous location. Acceptable at family scale.

## ADR-022 — Distance computed after Notion write; cache key uses lat/lng hash for both origin and dest

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 17

### Context
Two sub-decisions are grouped here because they share the same rationale (non-blocking, pragmatic design).

**Sub-A: Distance after Notion write.** Distance computation (Routes API call) must happen somewhere in the add-flow pipeline. Placing it before Notion write would mean a Routes API failure could block the core flow (saving the place). Placing it after Notion write decouples the two operations: the place is always saved, and distance is best-effort enhancement.

**Sub-B: Cache key uses lat/lng hash, not google_place_id.** The spec suggested `route:{origin_hash}:{dest_place_id}`, but not all flow paths have a `google_place_id` at display time (flow-a from URL, flow-d from IG, flow-image may have no Place ID). Using lat/lng hash (`lat.toFixed(4),lng.toFixed(4)`) for both origin and destination provides universal coverage with ~11m precision — sufficient for family-scale route queries.

### Decision
**Sub-A:** Distance computation is placed immediately after all KV writes but before the final `sendReply`. It is wrapped in `try/catch`; failure logs a warning and the card is sent without a distance row.

**Sub-B:** Cache key format is `route:{lat4dp,lng4dp}:{lat4dp,lng4dp}`. TTL is 86400s (24h). Null results (`{ driving: null, transit: null }`) are cached so repeated requests for routes in no-coverage areas don't re-hit the API.

### Alternatives considered
- Distance before Notion write: tight coupling; API failure breaks the core flow.
- `google_place_id` as dest key: narrower coverage; doesn't work for places without Place ID.
- No caching: repeated searches for nearby places would hammer Routes API.

### Consequences
- Places without lat/lng (rare — only if both Google resolution and extraction failed) silently skip distance.
- Routes API failures produce a log warning; the card renders without a distance row. Notion write is always unaffected.
- `GOOGLE_PLACES_API_KEY` restriction on GCP must include Routes API (confirmed before Task 17 started).

## ADR-023 — Driving duration as primary distance tie-break in search results

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 17

### Context
When multiple search results have equal keyword relevance scores, a secondary sort criterion is needed. Two transit modes are available: driving and public transit. The question is which to use as the primary tie-break (with the other as fallback, and "no data" last).

### Decision
Use driving duration as the primary tie-break. Transit duration is the secondary fallback. Places where neither is available rank last. Implementation in `flow-e-search.ts` via `drivingMinutes()` helper (returns `Infinity` when both modes null).

### Alternatives considered
- Transit as primary: more eco-friendly signal, but Taiwan families overwhelmingly drive to family destinations; transit coverage in suburban/mountain areas is sparse.
- Distance in meters instead of duration: duration is more user-relevant (travel time matters more than raw distance in Taiwan's urban/suburban mix).
- Equal-weight composite: more complex, harder to explain to PM; not specified.

### Consequences
- Results slightly favor car-accessible destinations in tie situations. Accepted: this matches the target family persona (owns a car or rents for outings).
- Transit users get accurate transit times displayed on the card even though driving wins ties.
- If PM review indicates transit should be primary, changing `drivingMinutes()` → `transitMinutes()` is a one-liner.

## ADR-024 — Replace keyword-based isSearchQuery with LLM within-places intent classifier

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 13

### Context
Phase 0+1 used `isSearchQuery()` (keyword matching on QUESTION_WORDS + punctuation) to split text input into "search" vs "add new place". Phase 1.5 adds edit, delete, visit, and setup intents, which keyword matching cannot reliably distinguish from each other or from add/search. A second LLM call (same Haiku model as the outer intent router) was added to classify within-places intent.

### Decision
`classifyPlacesIntent(message, context, env)` uses Claude Haiku to return `{ intent, confidence, reasoning }` from a fixed enum. `isSearchQuery` and `QUESTION_WORDS` are removed from `input-detect.ts` (Option A: clean removal). Handler reads `user:{id}:last_place` KV — if the card was sent within 5 minutes, the LLM receives context that biases toward edit/delete. `confidence < 0.6` forces `unknown` regardless of returned intent. parse failure / API error → `unknown` (safe default).

### Alternatives considered
- Expand `isSearchQuery` keyword list: brittle; cannot express edit/delete/visit without overlapping add/search.
- Rule-based decision tree: requires maintaining a complex branching set of Chinese patterns; fragile for novel phrasing.
- Keep keyword fallback alongside LLM: two conflicting signals; increases code complexity for marginal reliability gain.

### Consequences
- One additional Haiku call per text message in the places flow (~5-10ms, $0.001/1000 calls at current pricing). Acceptable for family-scale usage.
- edit/delete/visit intents are stubs at Task 13 (show "功能即將推出" messages). Tasks 14-16 will replace the stubs.
- If Haiku is unavailable, the safe default (`unknown`) triggers the generic "I don't understand" handler — no silent misbehavior.

## ADR-025 — Store pending visit parse context in KV during disambiguation

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 14

### Context
When `runFlowVisit` resolves a place_query to multiple candidates, it sends a disambiguation Flex card. The user taps a button (postback `visit:select:{page_id}`), at which point the handler needs to know the original visited_on, rating_signal, and notes from the parsed message. There is no mechanism to carry the parsed VisitParseResult through a postback.

### Decision
Before sending the disambiguation card, write `PendingVisitData { visited_on, rating_signal, notes }` to `user:{id}:pending_visit` KV with TTL 10 min. `runFlowVisitSelect` reads and deletes this key before recording the visit. If the key is missing (expired or no userId), defaults are used: today's date, null rating, null notes.

### Alternatives considered
- Encode parse result in postback data: postback data is limited to 300 bytes; structured JSON would be fragile and size-constrained.
- Re-parse the original message on postback: the original message text is not available in the postback event.
- Accept data loss (use defaults on disambiguation): simpler, but loses user-supplied date/notes which could be valuable.

### Consequences
- One additional KV write per disambiguation event (rare path).
- 10-minute TTL matches the pending_rating window; expired pending_visit defaults gracefully.

## ADR-027 — Single PATCH call for all valid edit ops in applyEdits

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 15

### Context
`applyEdits` must translate a list of `EditOp` values into Notion property updates. The naive approach is one PATCH per op; the alternative is building all ops into one payload and sending a single PATCH.

### Decision
Build all valid ops into one `Record<string, unknown>` payload and issue a single `PATCH /pages/{id}` call. If the PATCH fails, all ops move to `failed`. This is consistent with Notion's API design (properties is a map, not a list of commands).

### Alternatives considered
- One PATCH per op: more fine-grained failure isolation, but multiplies API calls and adds latency for multi-op edits.
- Transaction model: not available in Notion's API.

### Consequences
- Partial success at the network level is not possible: either all reach Notion or none do.
- Partial success at the validation level still happens (buildEntry can reject individual ops before the PATCH).
- Simpler code; single rate-limit exposure per user edit.

---

## ADR-028 — Rename detected by LLM, soft-rejected via ApplyResult

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 15

### Context
Task 15 spec (open question 1) asks whether rename should be a hard error at the parser or a soft suggestion. The LLM can detect rename intent ("改名叫X") and return `{ property: 'Name', value: 'X' }`. The question is where to reject it.

### Decision
Let `parseEditIntent` return the Name op if detected (for visibility). `applyEdits` immediately puts any Name op into `failed` with `error: 'rename_not_supported'` before any Notion call. `flow-edit` inspects `result.failed` for this error and replies "想改名的話，請刪除這筆重新加入。" — a helpful redirect rather than a silent failure.

### Alternatives considered
- Hard reject at parser (return [] for rename): parser never surfaced rename intent, so callers couldn't give a helpful message.
- Hard reject at applyEdits with a thrown error: would not allow mixed scenarios (rename + other edits).
- Allow rename: not supported because Notion title changes are complex and the spec explicitly says "reject".

### Consequences
- Users who attempt rename get a clear, actionable message.
- Mixed edits (rename + valid op) succeed partially; the rename note is appended to the success reply.
- Name op flows through the system but never reaches Notion.

---

## ADR-026 — Use notion_page_id (not internal_id) in visit:select postback

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 14

### Context
The Task 14 spec says `postback: visit:select:{internal_id}`. Resolving an internal_id (Alfred's UUID) to a Notion page requires a `rich_text: { equals: internalId }` filter query. Using `notion_page_id` directly allows a single `GET /pages/{id}` call instead.

### Decision
`buildDisambiguateCard` encodes `visit:select:{p.notion_page_id}` in button postback data. `runFlowVisitSelect` calls `getPlaceByNotionPageId` (GET /pages/{id}) which is simpler and faster than a filter query.

### Alternatives considered
- Follow spec (use internal_id): requires `findPlaceByInternalId` — an extra Notion filter query on postback.
- Store the full place list in KV: high payload, complexity not warranted.

### Consequences
- Slight deviation from spec naming (internal_id vs notion_page_id). Both are UUIDs; behavior is identical from the user's perspective.
- notion_page_id is always present on Place objects returned by searchPlaces, so no additional lookup is needed at disambiguation time.

---

## ADR-029 — No confirmation for last_place anchor delete; confirmation required for named delete

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 16

### Context
Deleting a place is destructive. The spec calls for a confirmation policy decision: should the "last_place" path (user says "重做" or "刪掉剛剛那筆") require a confirmation step, or should it delete immediately?

### Decision
Two confirmation tiers:
1. **last_place path** (5-minute anchor): no confirmation — delete immediately and reply "✓ 已刪除 X". The user just added the place and wants to undo it; the intent is unambiguous and a confirmation popup is friction.
2. **Named path** ("刪掉大湖公園") and **post-disambiguation**: always show a confirmation card with the place name, visit count, and "確認刪除"/"取消" buttons. The user may be referencing accumulated data; showing visit count makes the stakes clear.

### Alternatives considered
- Confirm both paths: safer but frustrating for the "重做" flow.
- No confirmation for either: simpler, but risks silent deletion of cherished records.
- Require `/confirm` text reply: doesn't work well on mobile without buttons.

### Consequences
- "重做" feels instant and natural.
- Named delete surface visit count ("⚠️ 會一併失去 X 筆造訪記錄") so user can see what they're losing.
- The two-tier policy requires checking whether we came via anchor or named path.

---

## ADR-030 — Archive (not hard-delete) places; three KV cleanup steps; visits preserved

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 16

### Context
Notion's API supports setting `archived: true` on a page (PATCH /pages/{id}). This is a soft-delete: the page disappears from queries but is recoverable from Notion UI for 30 days. The question is what to do with related state (dedup KV, last_place KV, Visits).

### Decision
1. **Archive, not hard delete**: `archivePlace` sends `PATCH /pages/{id}` with `{ archived: true }`. Archived pages are invisible to `searchPlaces` (Notion filter excludes archived by default).
2. **Dedup KV cleanup**: delete `dedup:{google_place_id}` immediately after archiving. Without this, the next add of the same location would hit the dedup check and show a false positive.
3. **last_place KV cleanup**: if `user:{userId}:last_place` points to the deleted place (same `internal_id`), delete it. Prevents a subsequent "重做" from trying to delete something already gone.
4. **Visits not deleted**: visit records remain in the Visits DB. The relation still points to the archived Place page, but `searchPlaces` won't surface it. This preserves history for potential future features (annual recap, stats).

### Alternatives considered
- Hard delete via Notion API: not supported (no DELETE /pages endpoint).
- Delete visits too: simpler DB state, but permanently loses visit history.
- No KV cleanup: dedup false positives on re-add; last_place pointing at dead page would error on next use.

### Consequences
- Place data is recoverable in Notion for 30 days.
- Next "add same place" works correctly (dedup KV cleared).
- "重做" won't try to re-delete an already-archived place.
- Visit history is preserved for potential future analytics.

---

## ADR-031 — No pending_delete KV; page_id in postback is sufficient

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 16

### Context
Edit and visit flows store disambiguation context in KV (`pending_edit`, `pending_visit`) because the postback only carries a page_id — the flow needs to recover the parsed message/visit data. Delete confirmation is different: the postback carries `delete:confirm:{page_id}` which is self-contained; no additional state is needed to execute the delete.

### Decision
Do not use a `pending_delete` KV. The confirmation card encodes `delete:confirm:{notionPageId}` and `delete:cancel:{notionPageId}` in postback data. `runFlowDeleteConfirm` looks up the place by page_id and executes the archive. `runFlowDeleteCancel` ignores the page_id and replies "好，沒刪。" No TTL-based expiry needed.

### Alternatives considered
- pending_delete KV with TTL: would let us expire old confirmation cards. But LINE does not invalidate old postback buttons; a user can tap a 30-min-old card and the page_id still works. Since archiving an already-archived page is idempotent, expiry adds complexity without meaningful protection.
- Store full place data in KV: heavier payload, not needed since getPlaceByNotionPageId is fast.

### Consequences
- Simpler implementation.
- If a user taps a stale confirmation card after the place was already deleted, `getPlaceByNotionPageId` returns null → friendly "找不到" reply. No incorrect behavior.

---

## ADR-032 — loved_recently implemented as two-phase query: Visits DB → Place IDs → in-memory filter

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 20

### Context
The `loved_recently` visit_state filter ("最近很愛的") requires finding places where a visit with Rating=5 occurred in the last 30 days. The Places DB stores summary fields (`Avg Rating`, `Last Visited`) computed by `recomputePlaceSummary`, but does not store the combination of "recent + 5-star". Notion's Places query API cannot express this condition from Place-side data alone.

### Decision
Two-phase approach (Option A from spec):
1. Query the Visits DB with `Rating = 5 AND Visited On >= 30 days ago` (page_size 50). Extract the Place page IDs from the `Place` relation property.
2. If no IDs → return []. Otherwise, query the Places DB normally (with any other filters like region/indoor_outdoor) using a larger page_size (max(limit*4, 20)) to compensate for in-memory filtering.
3. Filter results in-memory to only pages whose `notion_page_id` is in the loved set. Slice to `limit`.

### Alternatives considered
- Option B: degrade loved_recently to highly_rated in search-parser. Simpler but loses the "recency" dimension.
- Notion formula/rollup: would require DB schema changes outside our control.
- Store "recent loves" as a KV cache: adds write complexity, TTL management.

### Consequences
- `loved_recently` costs two Notion API calls instead of one.
- `discoverDbIds` is called (KV-cached 24h) to get the Visits DB ID.
- In-memory filter means the Places query over-fetches; with small datasets this is fine.
- All other visit_state values (never_visited, visited_recently, visited_long_ago, highly_rated) remain single-query via `buildNotionFilter`.

---

## ADR-033 — Split intent_classify vs intent_unknown as separate event types

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 19

### Context
The spec lists both `places.intent_classify` and `places.intent_unknown` as event type names for the observability system. The intent classifier returns one of 7 intents (add/search/edit/delete/visit/setup/unknown); "unknown" occurs when the LLM returns unknown or confidence < 0.6.

### Decision
Fire a single logEvent per classification call. If the final intent is 'unknown', use type `places.intent_unknown`; otherwise use `places.intent_classify`. Both carry intent, confidence, duration_ms, and a 50-char message_preview in meta.

### Alternatives considered
- Always use `places.intent_classify` with intent field differentiating. Simpler but makes the /review type-count table less immediately readable for operators (have to know to look at the intent field breakdown).
- Two separate events: one always for classify, one additional for unknown. Double-fires on unknown, wastes ring buffer slots.

### Consequences
- /review type-count immediately shows how often intent is unrecognized without drilling into event data.
- The 100-slot ring buffer only stores one event per classification call.

---

## ADR-034 — Use places.add.url event type for Google Maps URL flow (flow-c)

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 19

### Context
The spec lists event types: places.add.url, places.add.text, places.add.image, places.add.instagram. Flow C (Google Maps URL) is triggered by `inputType === 'google-maps-url'` and is a distinct flow from flow A (general URL). The spec does not explicitly name a `places.add.maps` type.

### Decision
Use `places.add.url` for flow C with `meta: { flow: 'maps' }` to distinguish it from flow A in detailed event queries while keeping the type-count dashboard simple. The meta field allows drilling down without polluting the type namespace with a type not in the spec.

### Alternatives considered
- places.add.maps: cleaner separation in type counts but not in spec; PM would need to know both types exist.
- Add to spec via handoff amendment: too much overhead for a minor naming choice.

### Consequences
- /review type-count shows places.add.url covering both URL and Google Maps flows. Detail is available in meta.flow.

---

## ADR-035 — Outer try/catch wrapper for add flow instrumentation

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Task 19

### Context
The five add flows (A/B/C/D/image) throw PlacesError at multiple points. To log error outcomes with per-flow duration, we need a single catch site that covers all throw points and re-throws for the caller (handler.ts) to surface the user-facing message.

### Decision
Wrap each add flow's entire body in a try/catch block. Log success before the final sendReply, log error outcome in the catch block (with sanitized error message), then re-throw. Dedup hits (early return) are logged separately as `places.dedup_hit` before the sendReply.

### Alternatives considered
- Log at each individual throw site: requires changes at N throw points; easy to miss new ones.
- Log in handler.ts catch: handler doesn't know which flow type or flow-specific duration.
- Log-then-return pattern (no re-throw): breaks the existing PlacesError propagation that handler.ts relies on for user-facing messages.

### Consequences
- One catch block per add flow.
- Error messages logged are PlacesError.message (Chinese UX strings) — no user input, safe to store.
- The pattern is consistent across all add flows.

---

## ADR-036 — Visits DB title property is 'Name', not 'Title'

- **Date:** 2026-05-04
- **Status:** accepted
- **Task:** Bug fix (visit logging production failure)

### Context
`createVisit` in `src/integrations/notion.ts` was sending `'Title'` as the property key for the Visits DB page title. Notion's API rejected this silently-ish (HTTP error), causing every visit log to fail in production. The Visits DB was created by migration `002-create-visits-db.ts` using `Name: { title: {} }`, so the property is named `'Name'`. The error was further obscured by the logEvent call logging a hardcoded string `'create_visit_failed'` instead of the actual Notion error message.

### Decision
- Change `'Title'` → `'Name'` in `createVisit`'s properties object.
- Change the hardcoded error string to `err instanceof Error ? err.message.slice(0, 150) : String(err).slice(0, 150)` so the real Notion rejection reason appears in `/review`.
- Split the `/review` guard from one rejection ("僅限管理員") into two: no userId (group/room context) → "只能在 1:1 對話使用"; wrong userId → "僅限管理員".

### Alternatives considered
- Rename the Visits DB column back to `Title`: would break migration idempotency and affect Notion UI already set up.
- Catch at a higher level and re-map the error: obscures root cause further.

### Consequences
- Visit logging now works correctly in production.
- The `/review` error detail for any future Notion failures will show the real HTTP error body instead of `'create_visit_failed'`.
- Group users who type `/review` get a clear 1:1-only message rather than a misleading "管理員" rejection.
- Lesson: generic error string constants in logEvent calls mask real failure reasons — always prefer `err.message` at the catch site.
