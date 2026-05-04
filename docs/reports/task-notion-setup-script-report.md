# Execution Report — Intercalated Task: Notion DB Setup Script

*Sequencing: after Task 1 (Bootstrap), before Task 2 (LINE Webhook is already complete — this report covers the intercalated script task)*

## Summary

Wrote `scripts/setup-notion-db.ts`, a one-time idempotent Notion DB setup script that creates the full §4.1 schema (30 properties) via API. Eliminates manual UI creation of 28+ properties and produces a version-controlled, reproducible schema definition.

## Files Changed

- `scripts/setup-notion-db.ts` (new) — DB creation script
- `scripts/tsconfig.json` (new) — Node.js-scoped tsconfig for scripts directory
- `docs/ADR.md` (modified) — ADR-002 added
- `README.md` (modified) — Notion Setup section added with step-by-step instructions
- `package.json` (modified) — devDeps: `@notionhq/client`, `dotenv`, `tsx`, `@types/node`

## Local Decisions Made

- **`initial_data_source.properties` instead of top-level `properties`:** The Notion API version `2025-09-03` (used by `@notionhq/client` v5.x) moved properties into `initial_data_source`. This is undocumented in most guides that reference the older `2022-06-28` version. Discovered by reading the SDK's TypeScript types. (ADR-002)
- **`any` return type for `buildProperties()`:** TypeScript's `as const` makes arrays `readonly`, which is incompatible with Notion SDK's mutable array types. `SelectColor` is not re-exported from the main package. Using `any` in a one-off setup script is acceptable — runtime correctness matters more than compile-time strictness here.
- **Separate `scripts/tsconfig.json`:** The main `tsconfig.json` includes `@cloudflare/workers-types` as globals (no `process`, no `Buffer`). The setup script is Node.js code and needs `@types/node`. Scoping a separate tsconfig to `scripts/` avoids polluting Worker type context. (ADR-002)
- **`opt()` helper function for typed color values:** Avoids repetitive `as Color` casts on every option, keeps options readable.
- **Idempotency via `blocks.children.list`:** Checks the parent page's direct children for a `child_database` block with matching title. More reliable than `notion.search()` which may have indexing lag. Paginates via `has_more`/`next_cursor`.

## Tests

- Added: none (one-off script, not unit-tested)
- TypeScript: `npx tsc --noEmit -p scripts/tsconfig.json` exits 0
- Main project: `npx tsc --noEmit` still exits 0

## Verification Performed

- Type-check passes for both tsconfigs
- Script logic traced manually: env check → find existing → create with 30 properties → print ID
- Script has not been executed yet — pending PM running it with real credentials

## Spec Deviations / Ambiguities

**Views (§4.2):** The Notion API (`2025-09-03`) does not expose any endpoint to create or configure database views. The four default views (待我審核 / 已確認 / 依區域 / 依年齡) cannot be scripted. The README documents them as a manual step with a table showing each view's type and configuration.

## Proposed Spec Amendment for §8.3

PM should bring this back to PM Claude for incorporation into the spec:

> **§8.3 Notion — amended setup procedure:**
>
> Replace the manual-UI steps with the following:
>
> 1. PM creates a new Notion workspace (or uses existing) and shares with wife.
> 2. Create a new page "Alfred" (empty). Copy its page ID from the URL (32-char hex after last `/`).
> 3. Go to https://www.notion.so/my-integrations → create new internal integration "Alfred Bot" → copy token.
> 4. Create `.env.local` (gitignored) with `NOTION_TOKEN=` and `NOTION_PARENT_PAGE_ID=`.
> 5. Run: `npx tsx scripts/setup-notion-db.ts`
>    - Script creates `Alfred — 親子景點` database with all 30 properties.
>    - Prints the DB ID. Idempotent (safe to re-run).
> 6. `npx wrangler secret put NOTION_DB_ID` — paste the printed ID.
> 7. In Notion, open the Alfred DB → ⋯ → Connections → add "Alfred Bot".
> 8. **Manual step (API limitation):** Create the four default views per README → Notion Setup → Manual Views.

## Blocking Questions for PM

None.

## Next Task

Task 3: Notion Integration (`integrations/notion.ts` — CRUD, property mapper). Ready to proceed.
