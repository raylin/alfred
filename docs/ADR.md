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
