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
