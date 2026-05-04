# 2026-05-04 14:30 — Initial Phase 0+1 Spec from PM Claude

# Alfred — Phase 0+1 Spec

**Project:** alfred
**Capability:** places (家庭親子景點記錄)
**Bot face name:** 阿福
**Production URL:** `https://alfred.raylin.cc`
**Last updated:** 2026-05-04

---

## TL;DR

Build a LINE Bot at `alfred.raylin.cc` that:

1. Accepts three input types from wife / PM (URL, plain text, Google Maps URL) in 1:1 OR group chat
2. AI-extracts place info, saves to a single shared Notion Place DB as `draft`
3. Returns a Flex Message preview with link to Notion for editing
4. Answers natural-language search questions via Notion query
5. Single shared environment, single shared Notion DB (no multi-tenant yet)

Stack: Cloudflare Workers + Hono + TypeScript, Notion as primary DB, KV for ephemeral state, Claude API for extraction & intent parsing, Google Places API for normalization.

Architecture is intentionally structured around future "capabilities" (modular folders), so Phase 2+ can add shopping lists, reminders, etc. without restructuring.

---

## 0. Project Context

**Alfred** is a family LINE Bot intended as a long-term platform for family-shared knowledge and assistance. The first capability — `places` — helps record kid-friendly destinations and find them later.

Future phases (not in scope here) may add other capabilities. Code should be structured so capabilities are pluggable.

**Primary user:** PM's wife. She'll mostly interact via LINE input + Notion browsing/editing.
**Secondary user:** PM. Will use both LINE and Notion.
**Out of scope this phase:** sister's family, multi-Space, visits, recommendations, photos, conversational LINE editing.

---

## 1. Goals & Non-Goals

### 1.1 Goals (Phase 0+1)

1. Wife can forward any of three input types to 阿福 in LINE and have a kid-friendly place automatically structured and saved to a shared Notion DB:
   - Blog / article URL
   - Plain-text place name
   - Google Maps share URL
2. Wife can edit / refine the resulting Notion entry on her own time. Notion is the editing surface, not LINE.
3. Wife can ask 阿福 in natural language to find places matching criteria.
4. PM and wife can both interact with 阿福 in 1:1 chat and in a shared LINE group; both see the same data.

### 1.2 Non-Goals (Explicitly Excluded)

- Multi-family / multi-Space (everyone shares one Notion DB)
- "I've been here" / Visit tracking
- Recommendations based on weather / season / visit history
- Photo upload management (photos stay in Notion, manually added)
- LINE-side conversational editing of saved entries (Phase 1.5)
- Sister's family integration (Phase 4)
- Dev / staging environment split (single environment)

### 1.3 Design Principles for This Phase

- **Schema-flexible:** adding a Notion property must NOT require code change. Bot does best-effort match; missing properties silently skipped.
- **Capability-modular:** all places-specific code under `src/capabilities/places/`. Future capabilities will sit alongside.
- **Low-friction input:** typing indicator only, no "received!" text bubble. Three messages max per flow (input → typing → result).
- **Notion-first editing:** never build Flex Message edit buttons. Notion is where editing happens.
- **Forward-compatible storage:** every Place entry has `internal_id` (UUID) joining Notion ↔ KV; KV holds `raw_extraction` and `last_bot_message_id` for Phase 1.5 to use.

---

## 2. User Stories & Flows

### Story A — Blog / Article URL

```
Wife: [forwards https://mommytime.blog/taipei-kids-park to 阿福]
阿福: [LINE typing indicator on for 5–15s]
阿福: [Flex Message: extracted draft with Notion link]
        ↓
     (Notion entry already exists as `draft`)
```

### Story B — Plain Text Name

```
Wife: 大湖公園划船
阿福: [typing indicator]
阿福: [Flex Message with location confirmation + draft]
```

Bot uses Google Places Text Search to resolve name → place_id → details. If multiple candidates with similar name, pick top result and surface "找到的是:[address],不是的話告訴我" in the card subtitle.

### Story C — Google Maps URL

```
Wife: [shares Google Maps URL to 阿福]
阿福: [typing indicator]
阿福: [Flex Message; most fields from Google, fewer AI推測 badges]
```

### Story D — Browse in Notion

Pure Notion. Wife uses Notion app's gallery / table / map (embed) views and filters. Out of bot scope but listed because it informs DB schema design (must look good in gallery view).

### Story E — Natural Language Search

```
Wife: 下雨天三歲適合的台北景點
阿福: [typing indicator]
阿福: [Flex carousel with top 3-5 matches, each with Notion link]
```

Bot uses Claude (Haiku) to parse intent into Notion query filters, runs query, returns carousel. If 0 matches, response: "目前 Notion 裡沒有完全符合的,要不要放寬條件?" If too many (>10), reply with top 5 and a hint to narrow.

### Story F — Group Chat Use

PM and wife are both in a 2-person LINE group with 阿福 added. Any of A/B/C/E works in group exactly as in 1:1. Bot replies to the same chat (group or 1:1). Bot does NOT distinguish behaviors between 1:1 and group in Phase 0+1.

---

## 3. Architecture

### 3.1 Tech Stack

| Layer | Choice |
|---|---|
| Hosting | Cloudflare Workers |
| Router | Hono |
| Language | TypeScript (strict mode) |
| Structured DB | Notion (Place DB) |
| Ephemeral KV | Cloudflare KV |
| Extraction LLM | Claude Sonnet (latest, via `@anthropic-ai/sdk`) |
| Intent routing LLM | Claude Haiku (latest) |
| Place resolution | Google Places API (Text Search + Place Details) |
| Domain | `alfred.raylin.cc` (Cloudflare-managed, configured via `wrangler.toml` routes) |
| Repo | GitHub (single repo, no monorepo tooling) |
| Tests | Vitest with `@cloudflare/vitest-pool-workers` |

### 3.2 Project Structure

```
alfred/
├── src/
│   ├── index.ts                    Hono app, LINE webhook entry, signature verify
│   ├── core/
│   │   ├── intent-router.ts        Classifies incoming message → capability (Phase 0+1: only `places`)
│   │   ├── line-signature.ts       LINE webhook signature verification middleware
│   │   └── env.ts                  Typed env binding (LINE_*, NOTION_*, ANTHROPIC_API_KEY, GOOGLE_PLACES_API_KEY, KV)
│   ├── capabilities/
│   │   ├── _registry.ts            Future capability registry (Phase 0+1: just exports `places`)
│   │   └── places/
│   │       ├── handler.ts          Capability entry: dispatch input type → flow
│   │       ├── schema.ts           Place TypeScript types + Notion property mapping
│   │       ├── input-detect.ts     Detect input type (URL / plain text / Google Maps URL)
│   │       ├── flow-a-url.ts       Story A
│   │       ├── flow-b-text.ts      Story B
│   │       ├── flow-c-maps.ts      Story C
│   │       ├── flow-e-search.ts    Story E
│   │       ├── extract.ts          Claude extraction wrapper
│   │       ├── search-parser.ts    Claude (Haiku) intent parser for search
│   │       ├── flex-message.ts     Build LINE Flex Message JSON for draft / search results
│   │       └── duplicate-check.ts  Check Notion for existing place by google_place_id or name
│   ├── integrations/
│   │   ├── line.ts                 reply / push / loading / signature
│   │   ├── notion.ts               Place DB CRUD; property mapper
│   │   ├── anthropic.ts            Thin wrapper, model selection helpers
│   │   └── google-places.ts        Text search, place details, URL parsing
│   └── lib/
│       ├── url-utils.ts            URL detection, Google Maps URL parsing, fetch with timeout
│       ├── html-extract.ts         Strip HTML to readable text for Claude
│       └── uuid.ts                 UUID v4 generation
├── tests/
│   ├── unit/
│   └── integration/
├── docs/
│   └── alfred-phase-0-1-spec.md    (this doc)
├── wrangler.toml
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
└── README.md
```

### 3.3 Data Flow

```
LINE webhook
   ↓
[verify signature, parse event]
   ↓
[start LINE typing indicator]
   ↓
[intent-router: classify message → capability "places"]
   ↓
[places/handler: detect input type]
   ↓
   ├─ URL → flow-a-url
   ├─ Google Maps URL → flow-c-maps
   ├─ Plain text → flow-b-text or flow-e-search
   │      (decide: if message contains question words / filter keywords, → search;
   │       otherwise → text input flow)
   ↓
[fetch external data: blog HTML / Google Places]
   ↓
[Claude extraction → structured Place JSON with confidences]
   ↓
[duplicate check: query Notion by google_place_id]
   ↓
[write to Notion as `draft`; write KV (raw_extraction, last_bot_message_id)]
   ↓
[build Flex Message]
   ↓
[LINE reply API with Flex Message]
```

---

## 4. Notion Place DB Schema

The wife will use this Notion DB heavily. Schema needs to look good in:
- Gallery view (cover photo + title + key tags)
- Table view (everything visible, sortable)
- Map view (via Notion's gallery + a map embed link in each entry — optional)

### 4.1 Properties

| 顯示名稱 | API name | Type | Options / Format | Notes |
|---|---|---|---|---|
| 名稱 | `Name` | Title | — | The Notion title field. Place's display name. |
| 狀態 | `Status` | Status | `draft` (default), `confirmed`, `archived` | Wife flips draft → confirmed after review. |
| 種類 | `Categories` | Multi-select | 公園 / 餐廳 / 步道 / 動物園 / 遊樂園 / 博物館 / 圖書館 / 親子館 / 觀光工廠 / 沙灘 / 露營地 / 室內遊戲場 / 其他 | Bot may add new options if Notion API supports it; if not, falls back to "其他" + tag in description. |
| 地點類型 | `Indoor/Outdoor` | Select | 室內 / 半室內 / 室外 | |
| 地址 | `Address` | Rich text | — | Human-readable address from Google Places. |
| 區域 | `Region` | Select | 台北 / 新北 / 基隆 / 桃園 / 新竹 / 苗栗 / 台中 / 宜蘭 / 花蓮 / 其他 | Auto-derived from address. |
| 經度 | `Longitude` | Number | — | For future distance queries. |
| 緯度 | `Latitude` | Number | — | |
| Google Place ID | `Google Place ID` | Rich text | — | Unique identifier for dedup. |
| 適合年齡 (最小) | `Age Min` | Number | 0–18 | |
| 適合年齡 (最大) | `Age Max` | Number | 0–18 | |
| 季節 | `Seasons` | Multi-select | 春 / 夏 / 秋 / 冬 / 全年 | Default 全年 if uncertain. |
| 推車友善 | `Stroller Friendly` | Checkbox | — | |
| 停車友善 | `Parking Friendly` | Checkbox | — | |
| 廁所 | `Has Restroom` | Checkbox | — | |
| 哺乳室 | `Has Nursing Room` | Checkbox | — | |
| 體力消耗 | `Energy Level` | Select | 放電型 / 適中 / 安靜型 | For future scoring. |
| 建議停留 | `Stay Minutes` | Number | minutes | |
| 需要預約 | `Reservation Needed` | Checkbox | — | |
| 假日易爆滿 | `Crowded On Weekends` | Checkbox | — | |
| 收費 | `Fee Type` | Select | 免費 / 部分收費 / 全部收費 | |
| 收費細節 | `Fee Details` | Rich text | — | "入園免費,設施計次 $50/次" |
| 簡述 | `Summary` | Rich text | — | AI-generated 1-2 sentence summary. |
| 來源網址 | `Source URLs` | URL | — | Single primary URL. |
| 來源類型 | `Source Type` | Multi-select | 部落格 / Google Maps / 朋友推薦 / 自己探索 / 官方網站 | |
| AI 推測欄位 | `AI Inferred Fields` | Multi-select | (auto-populated by bot with field names that had low confidence) | E.g., `Age Min, Age Max, Seasons` — wife knows what to verify. |
| 內部 ID | `Internal ID` | Rich text | UUID v4 | Joins Notion ↔ KV. Hidden from default views. |
| 建立者 (LINE) | `Created By` | Rich text | LINE userId | Hidden from default views. For Phase 3. |
| 建立時間 | `Created Time` | Created time | automatic | |
| 最後修改 | `Last Edited` | Last edited time | automatic | |

### 4.2 Default Views to Set Up

1. **待我審核** (`Status = draft`) — gallery view, sorted by Created Time desc
2. **已確認** (`Status = confirmed`) — table view, sortable
3. **依區域** (`Status = confirmed`, group by Region) — gallery view
4. **依年齡** (`Status = confirmed`, filter by Age range) — table view

Wife will refine these herself; Claude Code creates them as starting points.

### 4.3 Schema Evolution

When wife adds new properties via Notion UI, the bot must NOT break:
- Bot writes only properties it knows about
- Reading Notion → Place: ignore unknown properties
- All schema constants live in `src/capabilities/places/schema.ts` — adding a new field is a one-file change

---

## 5. Cloudflare KV Schema

KV namespace: `ALFRED_KV`

| Key pattern | Value | TTL | Purpose |
|---|---|---|---|
| `place:{internal_id}:raw` | JSON: `{ raw_input, raw_html, raw_claude_response, extracted_at }` | 90 days | Phase 1.5 conversational re-extraction |
| `place:{internal_id}:last_bot_msg` | JSON: `{ message_id, chat_id, sent_at }` | 7 days | Phase 1.5 "modify last entry" |
| `user:{line_user_id}:last_place` | `{internal_id, sent_at}` | 24 hours | Phase 1.5 "改成 5-10 歲" needs to know which place was last touched |
| `dedup:{google_place_id}` | `{notion_page_id, internal_id}` | 30 days | Fast duplicate check before hitting Notion API |

KV reads / writes are best-effort; failures must NOT break the user-facing flow.

---

## 6. LINE Bot Specs

### 6.1 LINE Channel Setup

In LINE Developers Console:
- **Channel type:** Messaging API
- **Bot display name:** 阿福
- **Bot icon:** TBD (PM provides; suggest a butler / helper themed image)
- **Webhook URL:** `https://alfred.raylin.cc/line/webhook`
- **Use webhook:** ON
- **Auto-reply messages:** OFF
- **Greeting messages:** Optional — if ON, set to: `阿福已加入。傳網址、地點名稱或 Google Maps 連結給我,我會幫忙整理進 Notion。輸入問題(例如「下雨天三歲適合的景點」)就會幫你搜尋。`
- **Allow bot to join group / multi-person chats:** ON

### 6.2 Webhook Signature Verification

Required. Use `LINE_CHANNEL_SECRET` to verify `x-line-signature` header per LINE docs. Reject 401 if invalid. Use Hono middleware so every handler is protected.

### 6.3 Loading / Typing Indicator

Use LINE's chat loading animation API: `POST /v2/bot/chat/loading/start` immediately after parsing the event, before any slow operation. The animation auto-times-out at 60s, which is safely above our worst-case latency.

### 6.4 Reply vs Push

Use **reply API** (not push) for all responses to user messages. Reply API:
- Free (doesn't count against monthly quota)
- Requires the original `replyToken` from the webhook event
- Token expires in ~30s, so all processing must finish in time (use `ctx.waitUntil` to return webhook 200 quickly while continuing work)

If reply token expires (e.g., extraction took >30s), fall back to push API but log a warning.

### 6.5 Message Flow Timing

```
T+0ms      Webhook received → verify signature → parse event → return 200
T+10ms     ctx.waitUntil() begins async work
T+50ms     POST /v2/bot/chat/loading/start
T+50ms-15s Process: fetch URL / Google Places / Claude / Notion write / KV write
T+15s-25s  POST /v2/bot/message/reply with Flex Message
```

### 6.6 Flex Message: Draft Card

For Stories A / B / C output. Structure:

```typescript
{
  type: "flex",
  altText: "已整理:" + place.name,
  contents: {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        // Status row: 「● 已整理完畢 · 已存進 Notion」 in green
        // Title: place.name
        // Subtitle: categories.join(" · ") + " · " + indoor_outdoor
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        // Field rows. For each non-null field:
        //   { layout: "horizontal", contents: [
        //       { text: 顯示名稱, color: secondary, flex: 2 },
        //       { text: value, color: primary, flex: 5,
        //         optional: append small "AI 推測" badge if in ai_inferred_fields
        //       }
        //   ]}
        // Show in this priority order if not null:
        //   位置 (Region + Address short), 適合年齡, 季節, 收費, 停車, 簡述
      ]
    },
    footer: {
      type: "box",
      contents: [
        // Primary button: "在 Notion 開啟編輯" → Notion page URL
      ]
    }
  }
}
```

Match the mockup we already aligned on. Implementation in `flex-message.ts`.

### 6.7 Flex Message: Search Results Carousel

For Story E. Top 3-5 results as bubble carousel. Each bubble:
- Title: place name
- Subtitle: 1-line: categories + region + age range
- Body: 2-3 most relevant matched fields (e.g., if user said "室內", highlight indoor)
- Button: "在 Notion 開啟"

If 0 results: simple text reply (not Flex), suggesting how to broaden.

### 6.8 Welcome Message

When 阿福 is added to a 1:1 or group (LINE event types `follow` and `join`):

```
阿福已加入這個對話。

可以丟以下任何一種給我,我會幫忙整理:
- 部落格或介紹文章的網址
- 地點名稱(例如:大湖公園)
- Google Maps 分享連結

要找之前存過的地方,直接問我就好,例如:
「下雨天三歲適合的景點」

整理結果都會存進共享的 Notion,可以隨時編輯。
```

### 6.9 Error Handling

| Situation | Response |
|---|---|
| URL fetch fails (timeout, 404, blocked) | `這個網址我打不開耶,可以試試直接告訴我地點名稱嗎?` |
| Google Places: no results | `找不到「{query}」這個地方,可以再具體一點嗎?(例如加上區域或更完整的名稱)` |
| Google Places: multiple ambiguous results | Pick top result; in Flex Message subtitle: `找到的是:{address},不是的話告訴我正確的地點。` |
| Claude extraction fails / returns invalid JSON | `整理時遇到狀況,請再傳一次。如果一直失敗,可以直接在 Notion 手動建立。` Log error. |
| Notion write fails | `已經整理好了,但寫入 Notion 失敗。錯誤:{message}。` Log error. |
| Duplicate detected (same google_place_id, status != archived) | `Notion 裡已經有「{name}」了(建立於 {date})。要更新還是不用?` Reply with two buttons: "更新" / "不用". (For Phase 0+1, both buttons just send canned text replies — actual update logic is Phase 1.5.) |
| Search returns 0 results | `沒有完全符合的耶,要不要放寬條件?例如不限室內外。` |
| Reply token expired | Fall back to push API with same content. Log warning. |

---

## 7. Claude Extraction Specs

### 7.1 Model Selection

- **Extraction (Stories A/B/C):** Claude Sonnet (latest). Use `claude-sonnet-4-7` — verify exact model string at runtime via product-self-knowledge or Anthropic docs.
- **Search intent parsing (Story E):** Claude Haiku (latest, `claude-haiku-4-5-20251001` or newer). Cheap and fast for simple JSON extraction.

### 7.2 Extraction System Prompt

```
你是阿福,一個幫忙整理親子景點資訊的助手。輸入會是部落格文章原文、地點名稱,或 Google Maps 資訊。請輸出一個 JSON,符合以下 schema。

Output schema (strict, no extra fields, no markdown wrappers):

{
  "name": string,                              // 景點名稱
  "categories": string[],                      // 從 [公園, 餐廳, 步道, 動物園, 遊樂園, 博物館, 圖書館, 親子館, 觀光工廠, 沙灘, 露營地, 室內遊戲場, 其他] 選一或多個
  "indoor_outdoor": "室內" | "半室內" | "室外" | null,
  "address": string | null,
  "region": "台北" | "新北" | "基隆" | "桃園" | "新竹" | "苗栗" | "台中" | "宜蘭" | "花蓮" | "其他" | null,
  "age_min": number | null,                    // 0-18
  "age_max": number | null,                    // 0-18
  "seasons": ("春"|"夏"|"秋"|"冬"|"全年")[],   // 預設 ["全年"] 若無資訊
  "stroller_friendly": boolean | null,
  "parking_friendly": boolean | null,
  "has_restroom": boolean | null,
  "has_nursing_room": boolean | null,
  "energy_level": "放電型" | "適中" | "安靜型" | null,
  "stay_minutes": number | null,
  "reservation_needed": boolean | null,
  "crowded_on_weekends": boolean | null,
  "fee_type": "免費" | "部分收費" | "全部收費" | null,
  "fee_details": string | null,
  "summary": string,                           // 1-2 句中文簡述
  "ai_inferred_fields": string[]               // 列出推測信心低的欄位 API name
                                               // (e.g. ["Age Min", "Age Max", "Seasons"])
                                               // 高信心或從原文明確抽取的不放進這裡
}

規則:
- 不確定的欄位用 null,不要硬猜。null 比錯的資訊好。
- ai_inferred_fields 列出「有給值但信心不高」的欄位,例如年齡是從文章語氣推測而非明確寫出。
- summary 不超過 80 字,重點是這地方對親子的特色,不是地址或營業時間。
- 只回 JSON,不要前後加任何文字、不要用 markdown code fence。
```

### 7.3 Extraction User Prompt (per input type)

**Story A (URL):**
```
來源:部落格文章 ({url})

文章原文:
{stripped_html_text}
```

**Story B (text + Google Places lookup):**
```
來源:使用者輸入「{user_input}」,Google Places 找到以下地點。

地點名稱:{google_name}
地址:{google_address}
類型:{google_types}
評分:{google_rating}
營業時間:{google_hours}
官方網站:{google_website}
編輯摘要:{google_editorial_summary}

請根據以上資訊填 schema。沒有的欄位用 null。
```

**Story C (Google Maps URL):**
Same as Story B but `user_input` is replaced with `Google Maps URL: {url}`.

### 7.4 Search Intent Parser (Story E)

System prompt:

```
你把使用者問題轉成 Notion 篩選條件。輸出 JSON,schema:

{
  "filters": {
    "indoor_outdoor": "室內" | "半室內" | "室外" | null,
    "age": number | null,
    "region": string | null,
    "categories": string[] | null,
    "seasons": string[] | null,
    "fee_type": string | null,
    "energy_level": string | null,
    "free_text_keywords": string[]   // 篩選不到的字詞,fallback 到 Notion full-text 搜尋
  },
  "query_intent_summary": string  // 一句話複述使用者意圖,用於回覆開頭
}

規則:
- 推不出來的就 null。
- categories 從 [公園, 餐廳, 步道, 動物園, 遊樂園, 博物館, 圖書館, 親子館, 觀光工廠, 沙灘, 露營地, 室內遊戲場] 選。
- 「下雨天」推測為 indoor_outdoor = "室內"。
- 「三歲」推測為 age = 3。
- 只回 JSON。
```

User prompt: just the user's raw text.

---

## 8. External Service Setup (Interactive)

Claude Code should walk PM through these in order, asking for credentials and storing them via `wrangler secret put`. PM is at his local machine with Cloudflare CLI logged in.

### 8.1 Cloudflare Workers + Domain

1. Confirm `wrangler` installed: `wrangler --version`. If not, install.
2. Confirm logged in: `wrangler whoami`.
3. Confirm Cloudflare account has `raylin.cc` zone.
4. Confirm KV namespace creation: `wrangler kv namespace create ALFRED_KV` → record namespace id, paste into `wrangler.toml`.
5. Configure `wrangler.toml` route: `alfred.raylin.cc/*` → service `alfred`.

### 8.2 LINE Developers Console

1. PM opens https://developers.line.biz/console/
2. Create new provider (or use existing) → create Messaging API channel
3. Channel name: `阿福` (or whatever PM prefers)
4. Once created, capture:
   - Channel secret → `wrangler secret put LINE_CHANNEL_SECRET`
   - Channel access token (long-lived) → `wrangler secret put LINE_CHANNEL_ACCESS_TOKEN`
5. In channel settings:
   - Webhook URL: `https://alfred.raylin.cc/line/webhook`
   - Use webhook: ON
   - Auto-reply: OFF
   - Greeting: optional
   - Allow bot to join group chats: ON

### 8.3 Notion

1. PM creates a new Notion workspace (or uses existing) and shares with wife.
2. Create a new page "Alfred — 親子景點" → embed a new database with the properties from §4.1.
3. Go to https://www.notion.so/my-integrations → create new internal integration "Alfred Bot" → copy token.
4. `wrangler secret put NOTION_TOKEN`
5. Back in Notion, on the Place DB page → ⋯ → Connections → add "Alfred Bot".
6. Capture the database ID (from URL: the 32-char hex after the workspace) → `wrangler secret put NOTION_DB_ID`.

### 8.4 Google Cloud Places API

1. PM opens https://console.cloud.google.com/
2. Create or select project → enable Places API (New).
3. Create API key → restrict by API (Places only) and by IP / referer if possible.
4. `wrangler secret put GOOGLE_PLACES_API_KEY`
5. Note: Google's free $200/month credit covers thousands of calls; alert if monthly usage approaches quota.

### 8.5 Anthropic API

1. PM opens https://console.anthropic.com/
2. Create API key → `wrangler secret put ANTHROPIC_API_KEY`

### 8.6 Final Verification

After all secrets are set, Claude Code runs `wrangler secret list` and confirms all 5 secrets present:
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `NOTION_TOKEN`
- `NOTION_DB_ID`
- `GOOGLE_PLACES_API_KEY`
- `ANTHROPIC_API_KEY`

---

## 9. Task Breakdown

Sequenced for incremental progress. Each task ends with a verifiable acceptance criterion.

### Task 1 — Project Bootstrap

- `npm create cloudflare@latest alfred` → choose Hono template
- TypeScript strict mode
- Configure `wrangler.toml` with route `alfred.raylin.cc/*`
- Add KV namespace binding `ALFRED_KV`
- Set up `vitest` with `@cloudflare/vitest-pool-workers`
- Initialize git, push to GitHub repo `alfred`
- Add `README.md` with quickstart
- Add `.env.example` listing required secrets

**Acceptance:** `wrangler dev` runs locally and serves a `GET /health` returning `{ ok: true }`. `npm test` runs (even with no tests yet). Repo on GitHub.

### Task 2 — LINE Webhook Skeleton

- `POST /line/webhook` route
- Signature verification middleware
- Parse LINE event types
- For text messages, echo back via reply API (placeholder; will be replaced)
- Welcome message on `follow` / `join` events
- Loading indicator usage on every text message

**Acceptance:** PM completes §8.2 setup. Sending any text to 阿福 in LINE returns the same text. Adding 阿福 to a group sends welcome message. Logs show signature verification passing.

### Task 3 — Notion Integration

- Implement `integrations/notion.ts`
- `createPlace(place: Place): Promise<{notion_page_id, url}>`
- `findPlaceByGooglePlaceId(id: string): Promise<Place | null>`
- `searchPlaces(filters: SearchFilters, limit: number): Promise<Place[]>`
- Property mapper handling all schema in §4.1
- Unit tests for property mapping (input Place → Notion property JSON)

**Acceptance:** Unit tests pass. Manually verify: create a sample Place via integration test → appears correctly in Notion DB with all properties populated. AI Inferred Fields multi-select shows correct tags.

### Task 4 — Claude Extraction Service

- `integrations/anthropic.ts` — thin SDK wrapper, model selection
- `capabilities/places/extract.ts` — extract from URL HTML or Google Places result
- Implement system prompt + user prompt templates per §7
- Strict JSON parsing with retry-once on parse failure
- Returns `Place` object + `ai_inferred_fields` array

**Acceptance:** Unit tests with fixture HTML / fixture Google Places JSON. Output JSON validates against TypeScript Place type. `ai_inferred_fields` is non-empty for low-confidence cases (test fixture with vague blog post).

### Task 5 — Google Places Integration

- `integrations/google-places.ts`
- `textSearch(query: string): Promise<PlaceCandidate[]>`
- `getPlaceDetails(place_id: string): Promise<PlaceDetails>`
- `parseGoogleMapsUrl(url: string): Promise<{place_id?: string, name?: string, lat?: number, lng?: number}>` — handle `goo.gl/maps/`, `maps.app.goo.gl`, full `google.com/maps` URLs (may need to follow redirects)

**Acceptance:** Unit tests for URL parsing covering 3-4 Google Maps URL formats. Integration test (mocked): text search → place details → returns expected shape.

### Task 6 — Story A: URL Input Flow

- `capabilities/places/flow-a-url.ts`
- Detect URL in message → fetch HTML → strip to text (`lib/html-extract.ts`, use `node-html-parser` or similar Workers-compatible) → extract → write Notion → write KV → reply Flex

**Acceptance:** Send a real parenting blog URL to 阿福 in LINE → receive Flex Message with sensible draft → verify Notion entry exists with `Status = draft` and `AI Inferred Fields` populated.

### Task 7 — Story B: Plain Text Input Flow

- `capabilities/places/flow-b-text.ts`
- Plain text → Google Places text search → first result → place details → Claude extract → Notion write → reply Flex
- If text looks like a question (contains `?`, `嗎`, `哪`, `怎麼`), DON'T enter this flow — defer to Story E (search). Decision logic in `input-detect.ts`.

**Acceptance:** Send `大湖公園划船` → Flex Message with location and AI推測 minimal (most fields from Google) → Notion entry exists.

### Task 8 — Story C: Google Maps URL Flow

- `capabilities/places/flow-c-maps.ts`
- Detect Google Maps URL → parse → place details → Claude extract → Notion write → reply Flex

**Acceptance:** Share a Google Maps location to 阿福 → Flex Message with proper draft → Notion entry exists with `Source Type = Google Maps`.

### Task 9 — Story E: Natural Language Search

- `capabilities/places/flow-e-search.ts`
- `search-parser.ts` calls Claude Haiku with prompt from §7.4
- Translate filters to Notion query
- Return top 3-5 results as carousel
- Handle 0 / >10 results per §6.9

**Acceptance:** With 5+ test entries in Notion, ask `下雨天三歲適合的景點` → carousel returns indoor places with overlapping age ranges.

### Task 10 — Error Handling & Edge Cases

- Implement all rows in §6.9
- Duplicate check via KV first, fall through to Notion
- All errors logged via `console.error` with structured context

**Acceptance:** Manually trigger each error case (bad URL, ambiguous name, duplicate) → bot responds per spec.

### Task 11 — Tests

- Unit tests for: `input-detect`, `url-utils`, `html-extract`, Notion property mapper, search filter parser
- Integration tests with mocked external services for each Story flow
- Coverage target: >70% for `capabilities/places/`

**Acceptance:** `npm test` passes. Coverage report generated.

### Task 12 — Deploy & Production Verification

- `wrangler deploy`
- Update LINE webhook URL to production
- End-to-end test: each Story in real LINE chat → real Notion DB
- Add 阿福 to PM-wife group; verify both can interact

**Acceptance:** All 4 stories work end-to-end in production. PM confirms Notion DB looks right. PM and wife both successfully interact in shared group.

---

## 10. Acceptance Criteria (Overall)

PM will validate the following with wife:

- [ ] Adding 阿福 to a 1:1 chat shows welcome message
- [ ] Adding 阿福 to a group with PM + wife shows welcome message
- [ ] Forwarding a parenting blog URL → Flex Message draft within 30s; Notion entry created
- [ ] Sending plain text place name → Flex Message draft; Google Places resolved correctly
- [ ] Sharing Google Maps URL → Flex Message draft; Notion entry uses Google data
- [ ] Asking natural-language question → carousel of relevant matches
- [ ] Wife can edit Notion entry from her phone via the link in Flex Message
- [ ] Wife can switch `Status` from draft to confirmed in Notion
- [ ] All AI推測 badges appear correctly on uncertain fields
- [ ] All error cases per §6.9 respond appropriately
- [ ] Bot in group works the same as 1:1 (both PM and wife can use)
- [ ] No errors in `wrangler tail` during normal use

---

## 11. Open Questions / Design Freedom

### Claude Code MAY decide on its own (no need to ask)

- File-level code organization within each module
- Function signatures and internal types beyond the spec'd boundaries
- Specific HTML-stripping library (must work on Workers runtime)
- Specific UUID library
- Vitest config details
- Logging format
- Error class hierarchy
- Notion DB initial views' exact configuration (PM will refine)

### Claude Code MUST ASK PM before proceeding

- If any §7 prompt produces consistently bad output and seems to need rewriting beyond minor tuning
- If the Notion schema in §4.1 has a property that Notion API doesn't support as described
- If Google Places API has a hard limit / pricing concern that would surface
- If the proposed `wrangler.toml` route configuration doesn't work with PM's existing `raylin.cc` setup
- If LINE Flex Message payload exceeds the 50KB limit (unlikely but possible with carousel)
- Any spec ambiguity that could be resolved two different ways

### Known to be Phase 1.5+, do NOT implement now

- Conversational LINE-side editing of saved entries
- Visit / been-there tracking
- Recommendations / scoring
- Photo handling
- Multi-Space / multi-family
- Sister's family integration
- Distance / travel time queries
- Weather integration

---

## 12. Execution Report Format

After completing each Task, Claude Code returns to PM with a report following this structure:

```markdown
# Execution Report — Task {N}: {title}

## Summary
{1-2 sentences of what was done}

## Files Changed
- `path/to/file.ts` (new)
- `path/to/other.ts` (modified)
- ...

## Local Decisions Made
- {Decision}: {Reasoning}
- ...

## Tests
- Added: {test files}
- Run result: {pass/fail counts}
- Coverage delta: {if relevant}

## Verification Performed
{What was tested manually, what was tested via integration tests}

## Spec Deviations / Ambiguities
- {Item}: {How it was resolved}
- (Or: "None.")

## Blocking Questions for PM
- {Question}: {Context for why it's blocking}
- (Or: "None.")

## Next Task
Task {N+1}: {title}. Ready to proceed.
```

PM forwards this report back to the design Claude session for validation, then either approves to continue or sends feedback to iterate.

---

## Appendix A — Sample Place JSON

For testing extraction output:

```json
{
  "name": "兒童新樂園",
  "categories": ["遊樂園"],
  "indoor_outdoor": "半室內",
  "address": "台北市士林區承德路五段55號",
  "region": "台北",
  "age_min": 3,
  "age_max": 12,
  "seasons": ["全年"],
  "stroller_friendly": true,
  "parking_friendly": true,
  "has_restroom": true,
  "has_nursing_room": true,
  "energy_level": "放電型",
  "stay_minutes": 240,
  "reservation_needed": false,
  "crowded_on_weekends": true,
  "fee_type": "部分收費",
  "fee_details": "入園免費,設施每項 20-80 元",
  "summary": "台北市政府營運的中型遊樂園,設施分齡、價格平實,適合學齡前到小學階段的孩子放電一整個下午。",
  "ai_inferred_fields": ["age_min", "age_max", "stay_minutes"]
}
```

## Appendix B — Sample Welcome Message Flex (optional alternative)

If the plain-text welcome in §6.8 feels too long, replace with a Flex bubble. Out of Phase 0+1 scope unless time allows.
