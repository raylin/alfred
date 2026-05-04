# Execution Report — Task M0: Migration Runner Infrastructure

## Summary

Built `scripts/migrations/_types.ts` and `scripts/migrations/_runner.ts`. The runner auto-creates a `Migrations` DB in Notion under `NOTION_PARENT_PAGE_ID`, reads applied migration IDs, and runs pending migrations sequentially. Supports `--dry-run` and `--only <id>`. README updated with migration instructions. 246 tests pass (no new unit tests — this is script infrastructure, not Workers code). TypeScript clean.

## Files Changed

- `scripts/migrations/_types.ts` (new) — `ScriptEnv` type + `Migration` interface
- `scripts/migrations/_runner.ts` (new) — full runner: find/create Migrations DB, read applied IDs, run pending, record results
- `docs/ADR.md` (modified) — ADR-017 (raw fetch for Notion queries), ADR-018 (Migrations DB parent page)
- `docs/log.md` (modified) — prepended Task M0 entry
- `README.md` (modified) — added Migrations section under Quickstart

## Local Decisions Made

- **ADR-017 — Raw fetch for Notion queries**: `@notionhq/client` v5 (`Notion-Version: 2025-09-03`) moved `databases.query` to `dataSources.query`, which returns 404 for databases created via the legacy `databases.create` endpoint. Raw `fetch` with `Notion-Version: 2022-06-28` (same as production `notion.ts`) works correctly. SDK is kept only for `blocks.children.list` and `databases.create`.

- **ADR-018 — Migrations DB under NOTION_PARENT_PAGE_ID**: Spec §3.3 mentioned "Alfred — 設定" page, but Phase 1.5 blocking question 3 confirmed reusing `NOTION_PARENT_PAGE_ID` (same parent as Place DB). No new Notion page needed.

- **`migration` named export**: Each migration file must `export const migration: Migration = { ... }`. The runner imports dynamically and checks for this export. Files without it are warned and skipped.

- **Process exit after DB creation**: On first run, after `databases.create`, the runner prints a notice and exits cleanly. The DB is auto-connected to the integration in the legacy API (this was not an issue with the raw fetch 2022-06-28 approach — queries worked immediately after creation).

## Tests

- No new unit tests — migration runner is a Node script, not Workers code. `npm test` still passes: **246 passed (246)** across 20 test files.
- TypeScript: `tsc --noEmit -p scripts/tsconfig.json` clean.

## Live Acceptance

```
$ npx tsx scripts/migrations/_runner.ts --dry-run

🔄  Alfred Migration Runner
    Mode: DRY RUN (no changes will be made)

🗃   Migrations DB found  (c14ca6facb3742208fc1080b367692c8)
✓   Already applied (0): none

📂  No migration files found. Nothing to do.
```

Runner connects to Notion, finds the auto-created Migrations DB, reads 0 applied migrations. Exits cleanly. Migrations DB is visible in Notion under the parent page.

## Spec Deviations / Ambiguities

- **Acceptance test wording**: Spec says "列出 pending migrations" — with no migration files yet (those come in M1/M2), the output is "No migration files found. Nothing to do." This is correct: there are 0 pending migrations, which is what you'd list. The full pending-listing behavior will be exercised in Task M1 when the first migration file is added.

## Blocking Questions for PM

None. Ready to proceed to Task M1.
