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

### Set secrets

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put NOTION_DB_ID
npx wrangler secret put GOOGLE_PLACES_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
```

### Set up KV namespace

```bash
npx wrangler kv namespace create ALFRED_KV
# Copy the namespace ID into wrangler.toml [[kv_namespaces]] id field
```

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
