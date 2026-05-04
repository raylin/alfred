# alfred

Family LINE Bot (阿福) — Phase 0+1: places capability.

Production URL: `https://alfred.raylin.cc`

## Quickstart

### Prerequisites

- Node.js 20+
- Cloudflare account with `raylin.cc` zone
- `wrangler` (installed as dev dep — use `npx wrangler`)

### Install

```bash
npm install
```

### Notion Setup

The Place DB must be created before deploying. The schema has 30 properties —
use the provided script instead of the Notion UI.

**1. Create a Notion integration**

Go to https://www.notion.so/my-integrations → create internal integration "Alfred Bot" → copy the token.

**2. Create a parent page**

In Notion, create an empty page (e.g. "Alfred"). Copy its page ID from the URL
(the 32-char hex after the last `/`).

**3. Create `.env.local`** (gitignored)

```
NOTION_TOKEN=secret_xxxx
NOTION_PARENT_PAGE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**4. Run the setup script**

```bash
npx tsx scripts/setup-notion-db.ts
```

This creates the `Alfred — 親子景點` database with all 30 properties and prints its ID.
Running it again when the DB already exists is safe (idempotent).

**5. Store the DB ID as a secret**

```bash
npx wrangler secret put NOTION_DB_ID
# paste the ID printed by the script
```

**6. Connect the integration to the database**

In Notion, open the Alfred DB → ⋯ → Connections → add "Alfred Bot".

#### Manual Views (API limitation)

The Notion API does not support creating or configuring views. Create these four views manually:

| View name | Type | Filter / Group |
|---|---|---|
| 待我審核 | Gallery | Status = draft, sorted by Created Time ↓ |
| 已確認 | Table | Status = confirmed |
| 依區域 | Gallery | Status = confirmed, grouped by Region |
| 依年齡 | Table | Status = confirmed, filterable by Age Min/Max |

### Set secrets

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put NOTION_DB_ID          # from setup script above
npx wrangler secret put GOOGLE_PLACES_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
```

### Set up KV namespace

Already provisioned. See `wrangler.toml` for the namespace ID.

### Dev

```bash
npm run dev
```

Health check: `curl http://localhost:8787/health`

### Test

```bash
npm test
```

### Deploy

```bash
npm run deploy
```

## Architecture

See `docs/alfred-phase-0-1-spec.md` for the full spec.

Stack: Cloudflare Workers + Hono + TypeScript · Notion DB · Cloudflare KV · Claude API · Google Places API
