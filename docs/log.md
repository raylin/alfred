## 2026-05-04 — Bug fix: visit logging production failure

Production visit logging had been failing since Task 14 deploy. Root cause: `createVisit` in `notion.ts` sent `'Title'` as the Notion property key but the Visits DB column is named `'Name'` (per migration 002). Notion rejected the page creation silently; the error was further masked by a hardcoded `'create_visit_failed'` string in logEvent. Fixed three things: (1) `'Title'` → `'Name'` in `createVisit`; (2) logEvent now captures the real `err.message`; (3) `/review` group-context rejection split into a distinct 1:1-only message. All 505 tests passing. ADR-036 recorded.

## 2026-05-04 — Phase 1.5 完工

Alfred Phase 1.5「Quality & Trust」全部 12 個 task 完工（M0/M1/M2 migration runner + Task 13/14/15/16/17/18/19/20/21）。Unit test suite 從 Phase 0+1 的 246 筆擴展到 505 筆。新增能力：Visit Tracking（Story H）、Conversational Edit（I/J）、Delete（K）、Search by Visit State（L）、Distance/Transit（M）、Home Setup（N）、Observability（/review PM dashboard）。架構決策 ADR-017 到 ADR-035，spec 升至 v1.1。Closeout commit 已 push。下一步：老婆試用反饋收集後進 Phase 2 規劃（食譜 / 採買 / 家庭資訊）。

## 2026-05-04 — Task 19 complete: Observability

Created `src/lib/ulid.ts` (Crockford base32 ULID generator using Web Crypto) and `src/lib/observability.ts` (`logEvent` writes `event:{ulid}` with 7-day TTL + prepends to `events:recent` ring buffer capped at 100). Instrumented 10 flows: replaced console.log in `places-intent-classifier.ts` (→ `places.intent_classify`/`places.intent_unknown`) and `flow-e-search.ts` (→ `places.search`); added outer try/catch logEvent to flow-a/b/c/d/image (→ `places.add.*` + `places.dedup_hit`); added logEvent to `performEdit`/`doDelete`/`recordVisitAndReply`. Added `/review` slash command (PM-only; reads ring buffer → parallel-fetches events → type counts / outcome % / avg+p95 duration / error list / unknown intent sample; truncates at 4500 chars). ADRs 033-035. 18 new tests; suite: 505 passed. Awaiting acceptance.

## 2026-05-04 — Task 20 complete: Search by Visit State (Story L)

`schema.ts` gains `VisitState` type + `visit_count`/`last_visited`/`avg_rating` in `N` + `visit_state?: VisitState | null` in `SearchFilters`. `search-parser.ts` prompt extended with visit_state rules + `sanitizeVisitState` guard. `buildNotionFilter` in `notion.ts` handles `never_visited`/`visited_recently`/`visited_long_ago`/`highly_rated` as filter conditions. `searchPlaces` branches to `searchLovedRecentlyPlaces` for `loved_recently` (two-phase: Visits DB → place IDs → in-memory filter). ADR-032 (two-phase loved_recently). 22 new tests (8 search-parser + 8 notion-property-mapper + 7 search-visit-state + -1 refactor); suite: 487 passed. Awaiting acceptance.

## 2026-05-04 — Task 16 complete: Conversational Delete (Story K)

`delete-parser.ts` (`parseDeleteIntent` → `{ target: 'last' | string | null }`, Sonnet, retry-once). `flow-delete.ts` (`runFlowDelete` + `runFlowDeleteSelect` + `runFlowDeleteConfirm` + `runFlowDeleteCancel`). `flex-message.ts` gains `buildDeleteConfirmCard` (name + visit_count + confirm/cancel buttons). `disambiguate.ts` extended to `'visit' | 'edit' | 'delete'` action types. `notion.ts` gains `archivePlace` (PATCH `{ archived: true }`). `handler.ts` wires `delete` intent to `runFlowDelete`. `index.ts` routes `delete:select:` / `delete:confirm:` / `delete:cancel:` postbacks. ADR-029 (two-tier confirmation: no confirm for last-anchor, confirm for named). ADR-030 (archive not hard-delete; dedup KV + last_place KV cleanup; visits preserved). ADR-031 (no pending_delete KV needed). 33 new tests (12 delete-parser + 21 flow-delete); suite: 465 passed. Awaiting acceptance.

## 2026-05-04 — Task 15 complete: Conversational Edit (Story I + J)

`edit-parser.ts` (`parseEditIntent` + `parseEditTarget`, Sonnet, retry-once). `apply-edit.ts` (`applyEdits` single-PATCH strategy, `summarizeOp`). `flow-edit.ts` (`runFlowEdit` + `runFlowEditSelect`). `schema.ts` gains `EditOp` union. `disambiguate.ts` extended to support `'edit'` action type. `kv-store.ts` gains `pending_edit` KV helpers (TTL 10 min). `notion.ts` gains `patchPageProperties` general-purpose PATCH. `handler.ts` wires `edit` intent to `runFlowEdit`. `index.ts` routes `edit:select:` postback to `runFlowEditSelect`. ADR-027 (single PATCH for all valid ops), ADR-028 (rename soft-rejected via ApplyResult). 53 new tests (14 edit-parser + 23 apply-edit + 16 flow-edit); suite: 432 passed. Awaiting acceptance.

## 2026-05-04 — Task 14 complete: Visit Tracking

`visit-parser.ts` (Sonnet, retry-once, null-field fallback). `visit-summary.ts` (query Visits DB → patch Place summary, non-fatal). `disambiguate.ts` (`buildDisambiguateCard`, postback `visit:select:{notion_page_id}`). `flow-visit.ts` (`runFlowVisit` + `runFlowVisitSelect`). `notion.ts` gains `createVisit`, `queryVisitsForPlace`, `patchVisitRating`, `patchPlaceSummary`, `getPlaceByNotionPageId`, `findPlaceByInternalId`. `kv-store.ts` gains `pending_rating` + `pending_visit` KV helpers (TTL 10 min each). `handler.ts` adds pending_rating intercept (1-5 → patch rating; 「跳過」→ clear) and replaces visit stub with `runFlowVisit`. `index.ts` routes `visit:select:` postback to `runFlowVisitSelect`. ADR-025 (pending_visit KV for disambiguation context), ADR-026 (notion_page_id in postback). 53 new tests; suite: 379 passed. Awaiting acceptance.

## 2026-05-04 — Task 13 complete: Within-Places Intent Classifier

`src/core/places-intent-classifier.ts` added (Haiku LLM, 7-intent enum, context-aware, confidence threshold 0.6, safe default on failure). `handler.ts` text dispatch replaced: removed `isSearchQuery`, added `readPlacesContext` (5-min KV window), switch on classifier output (add/search→flows, edit/delete/visit→stubs, setup→guidance, unknown→handler). `input-detect.ts` cleaned: `isSearchQuery` + `QUESTION_WORDS` removed (ADR-024). 18 new tests; -15 isSearchQuery tests; suite: 326 passed. ADR-024 recorded. Awaiting acceptance.

## 2026-05-04 — Task 17 complete: Distance / Transit Display

`src/integrations/routes-api.ts` added: `computeRouteMatrix` (batch, KV cache 24h) + `computeSingleRoute`. `src/lib/distance-format.ts` added: `formatMinutes` + `formatRouteRow`. `src/capabilities/places/flex-message.ts`: `buildDraftCard` + `buildSearchCarousel` gain optional `distance` param. All 5 add flows (A/B/C/D/image) compute distance post-Notion-write (ADR-022). `flow-e-search.ts` gains `userId` param, batch route matrix, distance tie-breaking (ADR-023). `handler.ts` passes `userId` to `runFlowE`. 36 new tests; suite: 323 passed. ADR-022 + ADR-023 recorded. Awaiting acceptance.

## 2026-05-04 — Task 18 amendment complete: flag-based home update mechanism

`markHomeUpdatePending` / `isHomeUpdatePending` / `consumeHomeUpdatePending` added to `home-store.ts` (KV flag TTL 5 min). `/setup` with existing home now sets the flag + replies with 5-minute update prompt. `runFlowSetup` checks `consumeHomeUpdatePending` first; if flag set, location updates home instead of setting current_origin. 7 new tests; suite: 287 passed. ADR-021 recorded. Awaiting user acceptance before Task 17.

## 2026-05-04 — Task 18 complete: Home Setup Flow

`src/integrations/line.ts` adds `LineLocationMessageContent` + `isLocationMessage`. `src/integrations/notion.ts` adds `SettingsRow`, `getSettingsByLineUserId`, `upsertSettings`. `src/capabilities/places/home-store.ts` created with 8 exported functions (KV layer for home/current_origin/prompted). `src/capabilities/places/flow-setup.ts` implements ADR-020 (first location = home, subsequent = 2h origin override). `src/core/slash-commands.ts` adds `/setup`, `/home`, `/here`. `src/index.ts` wires first-time home guidance and location message routing. 26 new unit tests; suite: 280 passed. ADR-020 recorded. Awaiting user acceptance.

## 2026-05-04 — Task M2 complete: Visits + Settings DBs created

`scripts/migrations/002-create-visits-db.ts` (7 properties, Place relation to Place DB) and `003-create-settings-db.ts` (6 properties) created via `ensureDatabase` helper. `src/lib/visit-title.ts` adds `formatVisitTitle`. `src/integrations/notion.ts` gains `discoverDbIds` (KV cache + Notion parent-page scan, ADR-019). `src/core/env.ts` adds `NOTION_PARENT_PAGE_ID`. 8 new tests (254 total). All 6 acceptance tests passed live. Notion: Visits + Settings DBs visible with correct schemas; Place relation verified. `scripts/verify-db-discovery.ts` confirms all 3 DBs discoverable. Migration phase complete; next: Task 18 (Home Setup).

## 2026-05-04 — Task M1 complete: 001-add-visit-summary-fields migration

`scripts/migrations/_helpers.ts` added (shared helpers: `notionHeaders`, `getDatabase`, `addPropertiesIfMissing`, `findChildDatabase`, `createDatabase`, `ensureDatabase` — all raw fetch, Notion API 2022-06-28). `scripts/migrations/001-add-visit-summary-fields.ts` adds Last Visited / Visit Count / Avg Rating to Place DB. Idempotent: reads schema once, batches missing properties in one PATCH, skips existing ones. All 4 acceptance tests passed live against Notion. 246 tests pass. Awaiting user acceptance.

## 2026-05-04 — Task M0 complete: Migration Runner Infrastructure

`scripts/migrations/_types.ts` (ScriptEnv + Migration interface) and `scripts/migrations/_runner.ts` built. Runner finds or auto-creates a `Migrations` DB under `NOTION_PARENT_PAGE_ID`, reads applied migration IDs via raw fetch (Notion API 2022-06-28, ADR-017), then runs pending migrations sequentially and records each in the DB. Supports `--dry-run` and `--only <id>` CLI flags. Migrations DB placed under NOTION_PARENT_PAGE_ID (ADR-018). `npx tsx scripts/migrations/_runner.ts --dry-run` connects, finds the DB, and reports 0 pending. README updated with migration instructions. 246 tests pass. Awaiting user acceptance.

## 2026-05-04 — Phase 1.5 started: spec received and archived

Phase 1.5 spec received from PM Claude. Archived to docs/handoffs/2026-05-04-1540-phase-1-5-spec.md, saved as docs/alfred-phase-1-5-spec.md. Stories H-N, schema §2, migration runner §3, and task order M0→M1→M2→18→17→13→14→15→16→20→19→21 confirmed. Three blocking questions surfaced (Routes API key, /review PM userId, Alfred-設定 Notion page). Awaiting PM answers before starting Task M0.

## 2026-05-04 — Task 12 complete: 5 acceptance-test fixes

URL bypass router (ADR-014): pure URL messages skip LLM intent router, fixing IG URL → unknown bug. Search keyword expansion: added 幫我/找/找個/我想去/我要去/給我/有什麼 to isSearchQuery. Google Places locationBias (Taipei, 50km) + TW address safety net filters non-Taiwan results (ADR-015). resolveGooglePlace: Stories A/D/F now run Google Places textSearch after Claude extraction to get google_place_id + precise coords + dedup — supersedes ADR-010 (ADR-016). search-parser prompt updated to exclude meta-words from free_text_keywords. ADR-014/015/016 recorded. 246 tests pass (25 new). TypeScript clean. Awaiting acceptance + deploy.

## 2026-05-04 — Phase 0+1 complete: spec synced to v1.1

All 12 tasks shipped and deployed to alfred.raylin.cc. Spec changelog (docs/spec-changelog.md) records CL-001 through CL-007; alfred-phase-0-1-spec.md updated to version 1.1 with all amendments applied. Phase 0+1 is closed. Next: Task 12 acceptance tests and Phase 1.5 planning.

## 2026-05-04 15:00 — Task 11 complete: Image Input (Claude Vision)

fetchMessageContent in line.ts (binary → base64, LINE Content API at api-data.line.me). isImageMessage predicate. chatJsonWithImage in anthropic.ts. extractFromImage + NoPlaceDetectedError + IMAGE_SYSTEM_PROMPT in extract.ts. ImageRawInput in kv-store.ts (no base64 stored — ADR-013). flow-image.ts: size gate (5MB) → vision extract → Notion → KV → Flex or fallback text. placesImageHandler in handler.ts. index.ts: detects image messages before text routing, dispatches directly to placesImageHandler (skip intent router — ADR-012). _registry.ts: accepts_images: true on places. ADR-012 (image bypass router + accepts_images), ADR-013 (no base64 in KV). 221 tests pass (25 new). TypeScript clean. Awaiting user acceptance + deployment.

## 2026-05-04 15:00 — Task 10 complete: Error handling, IG fallback, KV decoupling, dedup

line.ts: sendPush added, sendReply extended with optional chatId → push fallback on 400/Invalid reply token (ADR-011). url-utils.ts: fetchWithTimeout accepts optional RequestInit for custom headers. duplicate-check.ts: KV fast path + Notion slow path, writeDedupKV. flow-b + flow-c: dedup check before extraction, writeDedupKV after Notion write, KV writes split into independent try/catch (ADR-010 for Story A/D limitation). flow-a: KV writes split. flow-d-instagram.ts (new): facebookexternalhit UA OG fetch → length gate → Claude extraction or fallback message (ADR-009). input-detect.ts: isInstagramUrl + 'instagram-url' InputType. handler.ts: instagram-url → runFlowD. index.ts: postback handling for dedup:update / dedup:skip (canned responses). flex-message.ts: buildDedupCard with postback buttons. ADR-009/010/011 recorded. 196 tests pass (28 new). TypeScript clean. Awaiting user acceptance + deployment.

## 2026-05-04 15:00 — Task 9 complete: Story E — Natural Language Search

search-parser.ts (Claude Haiku intent → SearchFilters), flow-e-search.ts (parse → Notion query → in-memory scoring → carousel), buildSearchCarousel in flex-message.ts, handler.ts routes isSearchQuery to runFlowE. notion.ts: status filter changed to does_not_equal archived (includes draft + confirmed), sort changed to last_edited_time desc. ADR-008 recorded. 18 new tests (9 search-parser + 9 flow-e-search); 168 total. TypeScript clean. Awaiting user acceptance + deployment.

## 2026-05-04 14:15 — Task 7+8 fix: Story B source_type corrected to []

Post-acceptance fix: changed flow-b-text.ts source_type from ['Google Maps'] to [] (empty). Spec §4.1 Source Type is semantic provenance (how user discovered the place), not API data source. Plain text input has unknown provenance — leave blank for family review. ADR-007 recorded. 1 new test added (150 total).

## 2026-05-04 14:10 — Task 7+8 complete: Story B (plain text) + Story C (Google Maps URL)

kv-store.ts (shared writeRawExtraction + writeUserLastPlace), flow-b-text.ts (textSearch → getPlaceDetails → Claude → Notion → KV → Flex), flow-c-maps.ts (parseGoogleMapsUrl → getPlaceDetails fallback to textSearch → Claude → Notion → KV → Flex). isSearchQuery added to input-detect.ts. buildDraftCard accepts optional disambiguation note. handler.ts now routes search queries to stub, plain text to Story B, Google Maps URLs to Story C, passing LineSource throughout. index.ts passes event.source to dispatchCapability. ADR-006 recorded. 41 new tests; 149 total. TypeScript clean. Awaiting user acceptance + deployment.

## 2026-05-04 18:20 — Task 5 complete: Google Places Integration

google-places.ts written: textSearch, getPlaceDetails, parseGoogleMapsUrl (full + short URLs via redirect: follow + res.url), toGooglePlacesContext. 16 unit tests covering 6 URL formats and mocked API responses. 69 tests total. GOOGLE_PLACES_API_KEY stored (6/6 secrets complete). Awaiting user acceptance.

## 2026-05-04 18:45 — Task 6 complete: Story A URL Input Flow

html-extract.ts, url-utils.ts, input-detect.ts, errors.ts, flex-message.ts, flow-a-url.ts, handler.ts built. sendReply updated to accept Flex Messages. index.ts wired to real placesHandler. ADR-005 (regex HTML strip). 39 new tests, 108 total. Awaiting user acceptance + manual LINE test.

## 2026-05-04 17:55 — Task 5 started: Google Places Integration

GOOGLE_PLACES_API_KEY stored as Cloudflare secret (6/6 secrets complete). Building google-places.ts: textSearch, getPlaceDetails, parseGoogleMapsUrl.

## 2026-05-04 17:40 — Task 5.5 complete: LLM Intent Router

_registry.ts, intent-router.ts (Haiku, confidence 0.6 threshold), unknown-handler.ts, slash-commands.ts (/help + /place), index.ts wired. ADR-004 recorded. 21 new tests, 53 total. TypeScript clean. Awaiting user acceptance before commit.

## 2026-05-04 17:15 — Task 5.5 started: LLM Intent Router spec amendment

Handoff archived (2026-05-04-1323-intent-router-amendment.md). Task 4 committed and pushed. Building _registry.ts, intent-router.ts, unknown-handler.ts, slash-commands.ts, and wiring index.ts.

## 2026-05-04 16:55 — Task 4 complete: Claude Extraction Service

anthropic.ts wrapper, extract.ts (extractFromHtml, extractFromGooglePlaces), and uuid.ts written. 14 unit tests pass (32 total). Also fixed a pre-existing exactOptionalPropertyTypes TS error in notion.ts. Model used: claude-sonnet-4-6 (spec says 4-7; not available — noted in report). Awaiting user acceptance before commit.

## 2026-05-04 16:30 — Task 4 started: Claude Extraction Service

Building anthropic.ts wrapper, extract.ts, uuid.ts lib, and unit tests. ANTHROPIC_API_KEY confirmed in Cloudflare secrets (5/6 total; GOOGLE_PLACES_API_KEY is Task 5).

## 2026-05-04 16:10 — Task 3 complete: Notion integration built and tested

Place schema (`src/capabilities/places/schema.ts`) and Notion CRUD module (`src/integrations/notion.ts`) written. 18 unit tests pass. Live integration test confirmed page creation in Notion DB. Vitest switched from `@cloudflare/vitest-pool-workers` (requires v4, incompatible) to `environment:node` (ADR-003). Awaiting user acceptance before commit.

## 2026-05-04 15:45 — Notion DB created; NOTION_DB_ID + NOTION_TOKEN stored

Script ran successfully. DB ID: c5b493599d3d44a689d4932bd8a1d2e8. Both NOTION_TOKEN and NOTION_DB_ID stored as Cloudflare secrets. 4/6 secrets now in place (missing: GOOGLE_PLACES_API_KEY, ANTHROPIC_API_KEY). Views still need manual creation in Notion UI.

## 2026-05-04 15:30 — Intercalated: Notion DB setup script complete

PM requested a script to replace §8.3's manual 28-property Notion UI setup. Wrote scripts/setup-notion-db.ts using @notionhq/client v5.x (Notion API 2025-09-03, which uses initial_data_source.properties instead of top-level properties). Idempotent, 30 properties, prints DB ID. Views still manual (API limitation). ADR-002 recorded. README updated. Proposed §8.3 spec amendment included in report for PM to bring back to PM Claude.

## 2026-05-04 15:10 — Task 2 deployed; awaiting LINE webhook URL configuration

Both LINE secrets stored in Cloudflare. KV namespace created (id: 1a7640431a8642239223d4243b55f375). Deployed to alfred.raylin.cc (custom domain, auto-provisioned DNS + TLS). Health endpoint verified via forced resolve. wrangler.toml updated from routes→custom_domain. Waiting for PM to set LINE webhook URL to https://alfred.raylin.cc/line/webhook for live echo test.

## 2026-05-04 15:00 — Task 2 code complete; blocked on wrangler login + LINE access token

LINE webhook skeleton built: signature verification middleware (Web Crypto), LINE API integration module, echo handler, welcome message on follow/join, loading indicator. TypeScript clean. Committed to main. Waiting for user to run `wrangler login` and provide LINE_CHANNEL_ACCESS_TOKEN before verification can proceed.

## 2026-05-04 14:45 — Task 1 complete: project bootstrapped and pushed to GitHub

Hono + Cloudflare Workers project scaffolded manually (existing docs dir made npm create unreliable). Health endpoint verified locally. `@cloudflare/vitest-pool-workers` upgraded to 0.15.2 to clear security advisory; vitest config updated to use the new pool API (no longer uses `defineWorkersConfig`). Committed and pushed to git@github.com:raylin/alfred.git on main. Ready for Task 2.

## 2026-05-04 14:30 — Session started; initial spec received and archived

First session on the Alfred project. PM Claude's Phase 0+1 spec was received and archived to `docs/handoffs/2026-05-04-1430-initial-spec.md` and copied to `docs/alfred-phase-0-1-spec.md`. Project docs structure initialized (ADR.md, log.md, reports/). Picking up at Task 1 (Project Bootstrap). Awaiting PM confirmation to proceed.
## 2026-05-04 — Phase 1.5 完工

Alfred Phase 1.5「Quality & Trust」全部 12 個 task 完工（M0/M1/M2 migration runner + Task 13/14/15/16/17/18/19/20/21）。Unit test suite 從 Phase 0+1 的 246 筆擴展到 505 筆。新增能力：Visit Tracking（Story H）、Conversational Edit（I/J）、Delete（K）、Search by Visit State（L）、Distance/Transit（M）、Home Setup（N）、Observability（/review PM dashboard）。架構決策 ADR-017 到 ADR-035，spec 升至 v1.1。Closeout commit 已 push。下一步：老婆試用反饋收集後進 Phase 2 規劃（食譜 / 採買 / 家庭資訊）。

## 2026-05-04 — Task 19 complete: Observability

Created `src/lib/ulid.ts` (Crockford base32 ULID generator using Web Crypto) and `src/lib/observability.ts` (`logEvent` writes `event:{ulid}` with 7-day TTL + prepends to `events:recent` ring buffer capped at 100). Instrumented 10 flows: replaced console.log in `places-intent-classifier.ts` (→ `places.intent_classify`/`places.intent_unknown`) and `flow-e-search.ts` (→ `places.search`); added outer try/catch logEvent to flow-a/b/c/d/image (→ `places.add.*` + `places.dedup_hit`); added logEvent to `performEdit`/`doDelete`/`recordVisitAndReply`. Added `/review` slash command (PM-only; reads ring buffer → parallel-fetches events → type counts / outcome % / avg+p95 duration / error list / unknown intent sample; truncates at 4500 chars). ADRs 033-035. 18 new tests; suite: 505 passed. Awaiting acceptance.

## 2026-05-04 — Task 20 complete: Search by Visit State (Story L)

`schema.ts` gains `VisitState` type + `visit_count`/`last_visited`/`avg_rating` in `N` + `visit_state?: VisitState | null` in `SearchFilters`. `search-parser.ts` prompt extended with visit_state rules + `sanitizeVisitState` guard. `buildNotionFilter` in `notion.ts` handles `never_visited`/`visited_recently`/`visited_long_ago`/`highly_rated` as filter conditions. `searchPlaces` branches to `searchLovedRecentlyPlaces` for `loved_recently` (two-phase: Visits DB → place IDs → in-memory filter). ADR-032 (two-phase loved_recently). 22 new tests (8 search-parser + 8 notion-property-mapper + 7 search-visit-state + -1 refactor); suite: 487 passed. Awaiting acceptance.

## 2026-05-04 — Task 16 complete: Conversational Delete (Story K)

`delete-parser.ts` (`parseDeleteIntent` → `{ target: 'last' | string | null }`, Sonnet, retry-once). `flow-delete.ts` (`runFlowDelete` + `runFlowDeleteSelect` + `runFlowDeleteConfirm` + `runFlowDeleteCancel`). `flex-message.ts` gains `buildDeleteConfirmCard` (name + visit_count + confirm/cancel buttons). `disambiguate.ts` extended to `'visit' | 'edit' | 'delete'` action types. `notion.ts` gains `archivePlace` (PATCH `{ archived: true }`). `handler.ts` wires `delete` intent to `runFlowDelete`. `index.ts` routes `delete:select:` / `delete:confirm:` / `delete:cancel:` postbacks. ADR-029 (two-tier confirmation: no confirm for last-anchor, confirm for named). ADR-030 (archive not hard-delete; dedup KV + last_place KV cleanup; visits preserved). ADR-031 (no pending_delete KV needed). 33 new tests (12 delete-parser + 21 flow-delete); suite: 465 passed. Awaiting acceptance.

## 2026-05-04 — Task 15 complete: Conversational Edit (Story I + J)

`edit-parser.ts` (`parseEditIntent` + `parseEditTarget`, Sonnet, retry-once). `apply-edit.ts` (`applyEdits` single-PATCH strategy, `summarizeOp`). `flow-edit.ts` (`runFlowEdit` + `runFlowEditSelect`). `schema.ts` gains `EditOp` union. `disambiguate.ts` extended to support `'edit'` action type. `kv-store.ts` gains `pending_edit` KV helpers (TTL 10 min). `notion.ts` gains `patchPageProperties` general-purpose PATCH. `handler.ts` wires `edit` intent to `runFlowEdit`. `index.ts` routes `edit:select:` postback to `runFlowEditSelect`. ADR-027 (single PATCH for all valid ops), ADR-028 (rename soft-rejected via ApplyResult). 53 new tests (14 edit-parser + 23 apply-edit + 16 flow-edit); suite: 432 passed. Awaiting acceptance.

## 2026-05-04 — Task 14 complete: Visit Tracking

`visit-parser.ts` (Sonnet, retry-once, null-field fallback). `visit-summary.ts` (query Visits DB → patch Place summary, non-fatal). `disambiguate.ts` (`buildDisambiguateCard`, postback `visit:select:{notion_page_id}`). `flow-visit.ts` (`runFlowVisit` + `runFlowVisitSelect`). `notion.ts` gains `createVisit`, `queryVisitsForPlace`, `patchVisitRating`, `patchPlaceSummary`, `getPlaceByNotionPageId`, `findPlaceByInternalId`. `kv-store.ts` gains `pending_rating` + `pending_visit` KV helpers (TTL 10 min each). `handler.ts` adds pending_rating intercept (1-5 → patch rating; 「跳過」→ clear) and replaces visit stub with `runFlowVisit`. `index.ts` routes `visit:select:` postback to `runFlowVisitSelect`. ADR-025 (pending_visit KV for disambiguation context), ADR-026 (notion_page_id in postback). 53 new tests; suite: 379 passed. Awaiting acceptance.

## 2026-05-04 — Task 13 complete: Within-Places Intent Classifier

`src/core/places-intent-classifier.ts` added (Haiku LLM, 7-intent enum, context-aware, confidence threshold 0.6, safe default on failure). `handler.ts` text dispatch replaced: removed `isSearchQuery`, added `readPlacesContext` (5-min KV window), switch on classifier output (add/search→flows, edit/delete/visit→stubs, setup→guidance, unknown→handler). `input-detect.ts` cleaned: `isSearchQuery` + `QUESTION_WORDS` removed (ADR-024). 18 new tests; -15 isSearchQuery tests; suite: 326 passed. ADR-024 recorded. Awaiting acceptance.

## 2026-05-04 — Task 17 complete: Distance / Transit Display

`src/integrations/routes-api.ts` added: `computeRouteMatrix` (batch, KV cache 24h) + `computeSingleRoute`. `src/lib/distance-format.ts` added: `formatMinutes` + `formatRouteRow`. `src/capabilities/places/flex-message.ts`: `buildDraftCard` + `buildSearchCarousel` gain optional `distance` param. All 5 add flows (A/B/C/D/image) compute distance post-Notion-write (ADR-022). `flow-e-search.ts` gains `userId` param, batch route matrix, distance tie-breaking (ADR-023). `handler.ts` passes `userId` to `runFlowE`. 36 new tests; suite: 323 passed. ADR-022 + ADR-023 recorded. Awaiting acceptance.

## 2026-05-04 — Task 18 amendment complete: flag-based home update mechanism

`markHomeUpdatePending` / `isHomeUpdatePending` / `consumeHomeUpdatePending` added to `home-store.ts` (KV flag TTL 5 min). `/setup` with existing home now sets the flag + replies with 5-minute update prompt. `runFlowSetup` checks `consumeHomeUpdatePending` first; if flag set, location updates home instead of setting current_origin. 7 new tests; suite: 287 passed. ADR-021 recorded. Awaiting user acceptance before Task 17.

## 2026-05-04 — Task 18 complete: Home Setup Flow

`src/integrations/line.ts` adds `LineLocationMessageContent` + `isLocationMessage`. `src/integrations/notion.ts` adds `SettingsRow`, `getSettingsByLineUserId`, `upsertSettings`. `src/capabilities/places/home-store.ts` created with 8 exported functions (KV layer for home/current_origin/prompted). `src/capabilities/places/flow-setup.ts` implements ADR-020 (first location = home, subsequent = 2h origin override). `src/core/slash-commands.ts` adds `/setup`, `/home`, `/here`. `src/index.ts` wires first-time home guidance and location message routing. 26 new unit tests; suite: 280 passed. ADR-020 recorded. Awaiting user acceptance.

## 2026-05-04 — Task M2 complete: Visits + Settings DBs created

`scripts/migrations/002-create-visits-db.ts` (7 properties, Place relation to Place DB) and `003-create-settings-db.ts` (6 properties) created via `ensureDatabase` helper. `src/lib/visit-title.ts` adds `formatVisitTitle`. `src/integrations/notion.ts` gains `discoverDbIds` (KV cache + Notion parent-page scan, ADR-019). `src/core/env.ts` adds `NOTION_PARENT_PAGE_ID`. 8 new tests (254 total). All 6 acceptance tests passed live. Notion: Visits + Settings DBs visible with correct schemas; Place relation verified. `scripts/verify-db-discovery.ts` confirms all 3 DBs discoverable. Migration phase complete; next: Task 18 (Home Setup).

## 2026-05-04 — Task M1 complete: 001-add-visit-summary-fields migration

`scripts/migrations/_helpers.ts` added (shared helpers: `notionHeaders`, `getDatabase`, `addPropertiesIfMissing`, `findChildDatabase`, `createDatabase`, `ensureDatabase` — all raw fetch, Notion API 2022-06-28). `scripts/migrations/001-add-visit-summary-fields.ts` adds Last Visited / Visit Count / Avg Rating to Place DB. Idempotent: reads schema once, batches missing properties in one PATCH, skips existing ones. All 4 acceptance tests passed live against Notion. 246 tests pass. Awaiting user acceptance.

## 2026-05-04 — Task M0 complete: Migration Runner Infrastructure

`scripts/migrations/_types.ts` (ScriptEnv + Migration interface) and `scripts/migrations/_runner.ts` built. Runner finds or auto-creates a `Migrations` DB under `NOTION_PARENT_PAGE_ID`, reads applied migration IDs via raw fetch (Notion API 2022-06-28, ADR-017), then runs pending migrations sequentially and records each in the DB. Supports `--dry-run` and `--only <id>` CLI flags. Migrations DB placed under NOTION_PARENT_PAGE_ID (ADR-018). `npx tsx scripts/migrations/_runner.ts --dry-run` connects, finds the DB, and reports 0 pending. README updated with migration instructions. 246 tests pass. Awaiting user acceptance.

## 2026-05-04 — Phase 1.5 started: spec received and archived

Phase 1.5 spec received from PM Claude. Archived to docs/handoffs/2026-05-04-1540-phase-1-5-spec.md, saved as docs/alfred-phase-1-5-spec.md. Stories H-N, schema §2, migration runner §3, and task order M0→M1→M2→18→17→13→14→15→16→20→19→21 confirmed. Three blocking questions surfaced (Routes API key, /review PM userId, Alfred-設定 Notion page). Awaiting PM answers before starting Task M0.

## 2026-05-04 — Task 12 complete: 5 acceptance-test fixes

URL bypass router (ADR-014): pure URL messages skip LLM intent router, fixing IG URL → unknown bug. Search keyword expansion: added 幫我/找/找個/我想去/我要去/給我/有什麼 to isSearchQuery. Google Places locationBias (Taipei, 50km) + TW address safety net filters non-Taiwan results (ADR-015). resolveGooglePlace: Stories A/D/F now run Google Places textSearch after Claude extraction to get google_place_id + precise coords + dedup — supersedes ADR-010 (ADR-016). search-parser prompt updated to exclude meta-words from free_text_keywords. ADR-014/015/016 recorded. 246 tests pass (25 new). TypeScript clean. Awaiting acceptance + deploy.

## 2026-05-04 — Phase 0+1 complete: spec synced to v1.1

All 12 tasks shipped and deployed to alfred.raylin.cc. Spec changelog (docs/spec-changelog.md) records CL-001 through CL-007; alfred-phase-0-1-spec.md updated to version 1.1 with all amendments applied. Phase 0+1 is closed. Next: Task 12 acceptance tests and Phase 1.5 planning.

## 2026-05-04 15:00 — Task 11 complete: Image Input (Claude Vision)

fetchMessageContent in line.ts (binary → base64, LINE Content API at api-data.line.me). isImageMessage predicate. chatJsonWithImage in anthropic.ts. extractFromImage + NoPlaceDetectedError + IMAGE_SYSTEM_PROMPT in extract.ts. ImageRawInput in kv-store.ts (no base64 stored — ADR-013). flow-image.ts: size gate (5MB) → vision extract → Notion → KV → Flex or fallback text. placesImageHandler in handler.ts. index.ts: detects image messages before text routing, dispatches directly to placesImageHandler (skip intent router — ADR-012). _registry.ts: accepts_images: true on places. ADR-012 (image bypass router + accepts_images), ADR-013 (no base64 in KV). 221 tests pass (25 new). TypeScript clean. Awaiting user acceptance + deployment.

## 2026-05-04 15:00 — Task 10 complete: Error handling, IG fallback, KV decoupling, dedup

line.ts: sendPush added, sendReply extended with optional chatId → push fallback on 400/Invalid reply token (ADR-011). url-utils.ts: fetchWithTimeout accepts optional RequestInit for custom headers. duplicate-check.ts: KV fast path + Notion slow path, writeDedupKV. flow-b + flow-c: dedup check before extraction, writeDedupKV after Notion write, KV writes split into independent try/catch (ADR-010 for Story A/D limitation). flow-a: KV writes split. flow-d-instagram.ts (new): facebookexternalhit UA OG fetch → length gate → Claude extraction or fallback message (ADR-009). input-detect.ts: isInstagramUrl + 'instagram-url' InputType. handler.ts: instagram-url → runFlowD. index.ts: postback handling for dedup:update / dedup:skip (canned responses). flex-message.ts: buildDedupCard with postback buttons. ADR-009/010/011 recorded. 196 tests pass (28 new). TypeScript clean. Awaiting user acceptance + deployment.

## 2026-05-04 15:00 — Task 9 complete: Story E — Natural Language Search

search-parser.ts (Claude Haiku intent → SearchFilters), flow-e-search.ts (parse → Notion query → in-memory scoring → carousel), buildSearchCarousel in flex-message.ts, handler.ts routes isSearchQuery to runFlowE. notion.ts: status filter changed to does_not_equal archived (includes draft + confirmed), sort changed to last_edited_time desc. ADR-008 recorded. 18 new tests (9 search-parser + 9 flow-e-search); 168 total. TypeScript clean. Awaiting user acceptance + deployment.

## 2026-05-04 14:15 — Task 7+8 fix: Story B source_type corrected to []

Post-acceptance fix: changed flow-b-text.ts source_type from ['Google Maps'] to [] (empty). Spec §4.1 Source Type is semantic provenance (how user discovered the place), not API data source. Plain text input has unknown provenance — leave blank for family review. ADR-007 recorded. 1 new test added (150 total).

## 2026-05-04 14:10 — Task 7+8 complete: Story B (plain text) + Story C (Google Maps URL)

kv-store.ts (shared writeRawExtraction + writeUserLastPlace), flow-b-text.ts (textSearch → getPlaceDetails → Claude → Notion → KV → Flex), flow-c-maps.ts (parseGoogleMapsUrl → getPlaceDetails fallback to textSearch → Claude → Notion → KV → Flex). isSearchQuery added to input-detect.ts. buildDraftCard accepts optional disambiguation note. handler.ts now routes search queries to stub, plain text to Story B, Google Maps URLs to Story C, passing LineSource throughout. index.ts passes event.source to dispatchCapability. ADR-006 recorded. 41 new tests; 149 total. TypeScript clean. Awaiting user acceptance + deployment.

## 2026-05-04 18:20 — Task 5 complete: Google Places Integration

google-places.ts written: textSearch, getPlaceDetails, parseGoogleMapsUrl (full + short URLs via redirect: follow + res.url), toGooglePlacesContext. 16 unit tests covering 6 URL formats and mocked API responses. 69 tests total. GOOGLE_PLACES_API_KEY stored (6/6 secrets complete). Awaiting user acceptance.

## 2026-05-04 18:45 — Task 6 complete: Story A URL Input Flow

html-extract.ts, url-utils.ts, input-detect.ts, errors.ts, flex-message.ts, flow-a-url.ts, handler.ts built. sendReply updated to accept Flex Messages. index.ts wired to real placesHandler. ADR-005 (regex HTML strip). 39 new tests, 108 total. Awaiting user acceptance + manual LINE test.

## 2026-05-04 17:55 — Task 5 started: Google Places Integration

GOOGLE_PLACES_API_KEY stored as Cloudflare secret (6/6 secrets complete). Building google-places.ts: textSearch, getPlaceDetails, parseGoogleMapsUrl.

## 2026-05-04 17:40 — Task 5.5 complete: LLM Intent Router

_registry.ts, intent-router.ts (Haiku, confidence 0.6 threshold), unknown-handler.ts, slash-commands.ts (/help + /place), index.ts wired. ADR-004 recorded. 21 new tests, 53 total. TypeScript clean. Awaiting user acceptance before commit.

## 2026-05-04 17:15 — Task 5.5 started: LLM Intent Router spec amendment

Handoff archived (2026-05-04-1323-intent-router-amendment.md). Task 4 committed and pushed. Building _registry.ts, intent-router.ts, unknown-handler.ts, slash-commands.ts, and wiring index.ts.

## 2026-05-04 16:55 — Task 4 complete: Claude Extraction Service

anthropic.ts wrapper, extract.ts (extractFromHtml, extractFromGooglePlaces), and uuid.ts written. 14 unit tests pass (32 total). Also fixed a pre-existing exactOptionalPropertyTypes TS error in notion.ts. Model used: claude-sonnet-4-6 (spec says 4-7; not available — noted in report). Awaiting user acceptance before commit.

## 2026-05-04 16:30 — Task 4 started: Claude Extraction Service

Building anthropic.ts wrapper, extract.ts, uuid.ts lib, and unit tests. ANTHROPIC_API_KEY confirmed in Cloudflare secrets (5/6 total; GOOGLE_PLACES_API_KEY is Task 5).

## 2026-05-04 16:10 — Task 3 complete: Notion integration built and tested

Place schema (`src/capabilities/places/schema.ts`) and Notion CRUD module (`src/integrations/notion.ts`) written. 18 unit tests pass. Live integration test confirmed page creation in Notion DB. Vitest switched from `@cloudflare/vitest-pool-workers` (requires v4, incompatible) to `environment:node` (ADR-003). Awaiting user acceptance before commit.

## 2026-05-04 15:45 — Notion DB created; NOTION_DB_ID + NOTION_TOKEN stored

Script ran successfully. DB ID: c5b493599d3d44a689d4932bd8a1d2e8. Both NOTION_TOKEN and NOTION_DB_ID stored as Cloudflare secrets. 4/6 secrets now in place (missing: GOOGLE_PLACES_API_KEY, ANTHROPIC_API_KEY). Views still need manual creation in Notion UI.

## 2026-05-04 15:30 — Intercalated: Notion DB setup script complete

PM requested a script to replace §8.3's manual 28-property Notion UI setup. Wrote scripts/setup-notion-db.ts using @notionhq/client v5.x (Notion API 2025-09-03, which uses initial_data_source.properties instead of top-level properties). Idempotent, 30 properties, prints DB ID. Views still manual (API limitation). ADR-002 recorded. README updated. Proposed §8.3 spec amendment included in report for PM to bring back to PM Claude.

## 2026-05-04 15:10 — Task 2 deployed; awaiting LINE webhook URL configuration

Both LINE secrets stored in Cloudflare. KV namespace created (id: 1a7640431a8642239223d4243b55f375). Deployed to alfred.raylin.cc (custom domain, auto-provisioned DNS + TLS). Health endpoint verified via forced resolve. wrangler.toml updated from routes→custom_domain. Waiting for PM to set LINE webhook URL to https://alfred.raylin.cc/line/webhook for live echo test.

## 2026-05-04 15:00 — Task 2 code complete; blocked on wrangler login + LINE access token

LINE webhook skeleton built: signature verification middleware (Web Crypto), LINE API integration module, echo handler, welcome message on follow/join, loading indicator. TypeScript clean. Committed to main. Waiting for user to run `wrangler login` and provide LINE_CHANNEL_ACCESS_TOKEN before verification can proceed.

## 2026-05-04 14:45 — Task 1 complete: project bootstrapped and pushed to GitHub

Hono + Cloudflare Workers project scaffolded manually (existing docs dir made npm create unreliable). Health endpoint verified locally. `@cloudflare/vitest-pool-workers` upgraded to 0.15.2 to clear security advisory; vitest config updated to use the new pool API (no longer uses `defineWorkersConfig`). Committed and pushed to git@github.com:raylin/alfred.git on main. Ready for Task 2.

## 2026-05-04 14:30 — Session started; initial spec received and archived

First session on the Alfred project. PM Claude's Phase 0+1 spec was received and archived to `docs/handoffs/2026-05-04-1430-initial-spec.md` and copied to `docs/alfred-phase-0-1-spec.md`. Project docs structure initialized (ADR.md, log.md, reports/). Picking up at Task 1 (Project Bootstrap). Awaiting PM confirmation to proceed.
