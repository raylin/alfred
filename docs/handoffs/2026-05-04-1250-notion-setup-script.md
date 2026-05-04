# 2026-05-04 12:50 — Intercalated task: Notion DB setup script (between Task 1 and Task 2)

## Context
PM is stuck at §8.3 (Notion setup) — hand-crafting 28 properties in the UI is too painful and error-prone.

## Request
Write a one-off setup script: `scripts/setup-notion-db.ts`

**Requirements:**
1. Read `NOTION_TOKEN` and `NOTION_PARENT_PAGE_ID` from environment variables (.env.local)
2. Call Notion API `databases.create` with all 28 properties from spec §4.1 (correct types, select/multi-select options)
3. Print the new DB ID for `wrangler secret put NOTION_DB_ID`
4. Idempotent — if DB already exists (by title check), skip and print existing ID
5. Attempt §4.2's four default views; document if API doesn't support it

**Execution flow PM will use:**
- Create an empty Notion page "Alfred" manually, get its page ID
- Add `NOTION_TOKEN` and `NOTION_PARENT_PAGE_ID` to `.env.local` (gitignored)
- Run `npx tsx scripts/setup-notion-db.ts`
- Take printed DB ID → `wrangler secret put NOTION_DB_ID`

**Engineering tasks:**
1. Write ADR for script-vs-manual decision
2. Update README with this setup step
3. In execution report, propose §8.3 spec amendment text for PM to bring back to PM Claude
