# Alfred — Phase 1.5 Spec

**Project:** alfred
**Phase:** 1.5 — Quality & Trust(完善景點到好用)
**Builds on:** `docs/alfred-phase-0-1-spec.md` (v1.1)
**Last updated:** 2026-05-04, version 1.0

---

## TL;DR

Phase 0+1 把景點 bot 做到「能用」。Phase 1.5 把它做到「好用」,讓老婆**不需要打開 Notion** 就能完成新增、修改、刪除、找出去過/沒去過的地方,並且每個景點都帶實用的距離 / 通勤時間資訊。

新增五塊功能 + 一塊 enabling infrastructure:

- **1.5a Visit Tracking** — 「我們今天去了大湖公園,小璃超愛」→ 阿福記下,未來搜尋可以分「去過 / 沒去過」「上次很愛」
- **1.5b Conversational Editing** — 「改成 5-10 歲」「刪掉剛剛那筆」「重做」「刪掉大湖公園」(都不需要進 Notion)
- **1.5c Search Intent Refinement** — LLM 分類取代 keyword;支援「附近」「市區」這類模糊詞;0 結果 graceful loosening
- **1.5d Observability** — 結構化 log、滾動事件流、雙週 PM review 機制
- **1.5e Distance / Transit** — 每個景點顯示「🚗 22 分 / 🚇 35 分」;支援家裡 + 當前位置兩種起點
- **Enabling: Migration Runner** — 每次 schema 變動都用 idempotent migration script 處理

非目標:
- 多家庭 / 姐姐家(Phase 5+)
- 食譜 / 採買(Phase 2)
- 家庭資訊基底(Phase 3)
- 主動推送 / 提醒(Phase 4)
- 「今晚吃什麼 / 週末去哪」決策層(Phase 5)

---

## 0. Context

接續 Phase 0+1 的架構與約定:
- LINE Messaging API + Hono on Cloudflare Workers
- Notion 為 Place DB、KV 為 ephemeral state
- Capability-modular 結構(`src/capabilities/places/...`)
- Intent router(LLM Haiku)→ capability dispatch
- 工作流程依 `CLAUDE.md` 定義(handoff 歸檔、ADR、log、git hygiene)

不重複 Phase 0+1 的所有約定,直接擴充。

---

## 1. User Stories

### Story H — Visit Logging

> 老婆晚上跟阿福說:「我們今天去了大湖公園,小璃超愛」
> 阿福:找到 Notion 裡的「大湖公園」 → 記下今天的 visit + 評分提示 →
> 「OK 已記錄。要給幾分?(1-5)」
> 老婆:「5」
> 阿福:「記下了。下次要找『最近很愛的地方』我會記得這個。」

變化:
- 沒講日期 → 預設今天
- 帶日期關鍵詞:「上禮拜五」「昨天」「上週末」 → LLM 解析
- 帶評分線索:「玩瘋了」「還好」「很無聊」 → bot 主動 suggest 評分,老婆確認或調整
- Notion 有歧義 → disambiguation 列出 candidates 讓老婆選

### Story I — Conversational Edit (Last Place Anchor)

> 阿福剛回完一張卡片(內容:三歲適合)
> 老婆:「改成 5-10 歲」
> 阿福:更新 Notion,簡短回覆「✓ 適合年齡改為 5-10 歲」

支援的編輯類型(自然語言):
- 適合年齡、室內外、季節、體力消耗、收費、停車、推車、廁所、哺乳室
- 「加 source 是 IG」「加標籤沙坑」「補充:離捷運近」
- 「Status 設成 confirmed」「不是公園是親子館」

不支援(Phase 1.5 不做):
- 改名(改名等於建新景點)
- 多輪複雜編輯(一句一指令)

### Story J — Conversational Edit (Named Place)

> 老婆:「大湖公園改成室內」(可能在另一輪對話、可能不是剛剛那筆)
> 阿福:Notion 找到「大湖公園」(若多筆 → disambiguation Flex)→ 確認 → 更新

### Story K — Delete / Start Over

> 老婆貼了個地點,阿福抽錯了重要欄位
> 老婆:「重做」or「刪掉剛剛那筆」
> 阿福:刪除 last_place anchor 對應的 Notion entry → 「✓ 已刪除大湖公園」

或指名刪除:
> 老婆:「刪掉那個西湖公園」
> 阿福:Notion 找到 → 確認(防誤刪 Flex 含「確認刪除 / 取消」postback)→ 刪除

### Story L — Search by Visit State

> 老婆:「沒去過的台北景點」/「最近一個月沒去過的常勝軍」/「上次小璃很愛的地方」
> 阿福:Story E 搜尋擴展,filters 包含 visit_state

### Story M — Distance-aware Display

> 老婆貼一個 URL → Flex 卡片底部多一行:`🚗 22 分 🚇 35 分`
> 沒有大眾運輸 → 只顯示 `🚗 45 分`
> 老婆 Story E 搜尋 → carousel 每張 bubble 都顯示距離,sort 為「精確度先,距離次」

### Story N — Set Home / Override Origin

**首次設定**:
> 老婆第一次跟阿福講話、且未設定 home → 阿福主動引導:
> 「我還不知道你住哪,要算距離得知道你家位置。可以分享一下嗎?(LINE 點 `+` → 位置)」

**手動觸發**:
> 老婆:「/setup」
> 阿福:「目前你的家:台北市內湖區...。要重新設定嗎?要的話分享你家位置給我。」

**臨時 override(出門在外)**:
> 老婆:在 LINE 分享當前位置
> 阿福:「OK,接下來 2 小時用你目前位置算距離。要回到家裡位置打 `/home`」

---

## 2. Schema Changes

### 2.1 Notion `Place` DB — New Properties

| 顯示名稱 | API name | Type | 用途 |
|---|---|---|---|
| 上次造訪 | `Last Visited` | Date | 從 Visits 衍生(API 端寫入,UI 顯示用) |
| 造訪次數 | `Visit Count` | Number | 從 Visits 衍生 |
| 平均評分 | `Avg Rating` | Number | 從 Visits 衍生 |

決定:Visit 用獨立 Notion DB(`Visits`),不是 Place 的 rollup,理由是 Notion 的 rollup 跨 DB 在 API 端不好處理,自己 maintain summary fields 更直接。

### 2.2 New Notion DB: `Visits`

| 顯示名稱 | API name | Type | 備註 |
|---|---|---|---|
| ID | `Name` | Title | UUID,作為 Notion title |
| 景點 | `Place` | Relation | 關聯到 Place DB |
| 造訪日期 | `Visited On` | Date | required |
| 評分 | `Rating` | Number | 1-5,nullable |
| 筆記 | `Notes` | Rich text | 自由文字 |
| 造訪者 | `Logged By` | Rich text | LINE userId,Phase 5 multi-family 用 |
| 建立時間 | `Created Time` | Created time | 自動 |

### 2.3 New Notion DB: `Settings`

存在「阿福 — 設定」page 底下。每個 user 一筆 row。

| 顯示名稱 | API name | Type | 備註 |
|---|---|---|---|
| LINE User ID | `Name` | Title | 老婆看不懂沒關係,主要 bot 用 |
| 顯示名稱 | `Display Name` | Rich text | 「老婆」「PM」這種,bot 也能用 |
| 家裡地址 | `Home Address` | Rich text | 老婆肉眼看 |
| 家裡緯度 | `Home Lat` | Number | |
| 家裡經度 | `Home Lng` | Number | |
| 設定時間 | `Configured At` | Date | |

### 2.4 KV New Keys

| Key pattern | Value | TTL | 用途 |
|---|---|---|---|
| `user:{line_user_id}:home` | `{ lat, lng, address, configured_at }` | none(persist) | Home cache,避免每次打 Notion;Settings DB 是 source of truth |
| `user:{line_user_id}:current_origin` | `{ lat, lng, set_at }` | 2 小時 | 臨時 override |
| `event:{ulid}` | structured event JSON | 7 天 | Observability ring buffer |
| `events:recent` | array of last 100 ULIDs | none | Index for PM review fetch |

---

## 3. Migration Runner Infrastructure

### 3.1 結構

```
scripts/
├── setup-notion-db.ts            # Phase 0+1 的 init script,保留
└── migrations/
    ├── _runner.ts                 # 共用 runner
    ├── _types.ts                  # Migration interface
    ├── 001-add-visit-summary-fields.ts
    ├── 002-create-visits-db.ts
    ├── 003-create-settings-db.ts
    └── ...
```

### 3.2 Migration Interface

```typescript
export interface Migration {
  id: string;                    // "001-add-visit-summary-fields"
  description: string;
  up(env: Env): Promise<void>;   // idempotent: 多次跑要 work
}
```

### 3.3 Runner 行為

1. 確保 Notion 有「Alfred — 設定」 page 底下有 `Migrations` DB,沒有就建
2. 從 `Migrations` DB 讀取已套用的 migration ID 集合
3. 從 `scripts/migrations/` 讀取所有 migrations(filename 排序)
4. 找出尚未套用的 → 一支支跑
5. 每支跑完寫一筆到 `Migrations` DB(`{id, description, applied_at}`)
6. 印出總結

### 3.4 失敗處理

- 一支 migration 失敗 → runner 中止,後續不跑
- 失敗的 migration 不寫入 Migrations DB(下次重跑會再嘗試)
- 因此每支 migration 必須 idempotent(`up()` 第二次跑也要 work)
- 寫法:每個 step 先檢查「是否已存在」再決定建立 or skip

### 3.5 執行

```bash
npx tsx scripts/migrations/_runner.ts                       # 跑所有 pending
npx tsx scripts/migrations/_runner.ts --dry-run             # 列出 pending,不跑
npx tsx scripts/migrations/_runner.ts --only 001-xxx        # 只跑指定的(debug 用)
```

### 3.6 關於現有 schema

Phase 0+1 已經建好 Place DB,不在 migration 系統內。Phase 1.5 第一支 migration `001-add-visit-summary-fields` 會把 Place DB 的三個 summary fields 補上。後續所有 schema 變更都用 migration。

---

## 4. New Capabilities / Modules

### 4.1 Project Structure 增量

```
src/
├── core/
│   ├── intent-router.ts                   (existing)
│   └── places-intent-classifier.ts        NEW — within-places intent: add/search/edit/delete/visit/setup
├── capabilities/places/
│   ├── (existing files)
│   ├── flow-edit.ts                       NEW — Story I/J
│   ├── flow-delete.ts                     NEW — Story K
│   ├── flow-visit.ts                      NEW — Story H
│   ├── flow-setup.ts                      NEW — Story N (home setup, /setup, /home)
│   ├── disambiguate.ts                    NEW — common: 多筆候選的 Flex disambiguation
│   ├── visit-summary.ts                   NEW — recompute Place's last_visited / visit_count / avg_rating
│   └── extract-edit-intent.ts             NEW — LLM 解析「改成 X」→ 對應 Notion property update
├── integrations/
│   ├── notion.ts                          MODIFIED — Visits DB, Settings DB CRUD
│   └── routes-api.ts                      NEW — Google Routes API (driving + transit)
├── lib/
│   ├── observability.ts                   NEW — structured event logging, ring buffer
│   └── distance-format.ts                 NEW — minutes formatter
```

### 4.2 Within-Places Intent Classifier

Phase 1.5 在 places capability 之內再加一層分類:

```typescript
type PlacesIntent =
  | 'add'           // 新增景點(URL / 文字 / Maps URL / image)
  | 'search'        // 搜尋
  | 'edit'          // 編輯既有 entry
  | 'delete'        // 刪除既有 entry
  | 'visit'         // 記錄造訪
  | 'setup'         // home location 設定
  | 'unknown';
```

實作:`src/core/places-intent-classifier.ts`,Haiku LLM call。

`src/capabilities/places/handler.ts` 接到 text 訊息(URL/Image bypass router 仍直接 add)→ 先過 places-intent-classifier → 對應 flow-* 模組。

舊的 keyword-based `isSearchQuery` 撤掉(以 LLM 取代)。

### 4.3 Conversational Edit Intent Parsing

`extract-edit-intent.ts`:輸入「改成 5-10 歲」+ 目標 Place 的當前狀態 → 輸出 Notion property update payload。

```typescript
type EditOp =
  | { property: 'Age Min' | 'Age Max'; value: number | null }
  | { property: 'Indoor/Outdoor'; value: '室內' | '半室內' | '室外' }
  | { property: 'Categories'; op: 'add' | 'remove' | 'set'; values: string[] }
  | { property: 'Status'; value: 'draft' | 'confirmed' | 'archived' }
  | { property: 'Summary' | 'Fee Details'; op: 'append' | 'replace'; value: string };
```

LLM(Sonnet)解析 → 回 JSON → bot 套用到 Notion。

### 4.4 Visit Recording

Story H 流程:

1. LLM 解析訊息:`{ place_query, visited_on, rating_signal, notes }`
   - place_query: "大湖公園" / "last"(上次那個) / null
   - visited_on: YYYY-MM-DD,沒講就今天
   - rating_signal: 1-5 從語氣推測,或 null
   - notes: 體驗描述
2. Resolve place(disambiguation 如有歧義)
3. 建立 Visit row in Visits DB
4. 觸發 `visit-summary.recompute(placeId)` 更新 Place 的 summary fields
5. 回:
   - 如有 rating_signal:「OK 已記錄。給 {n} 分對嗎?」
   - 如沒有:「OK 已記錄。要給幾分?(1-5,或回『跳過』)」

### 4.5 Distance / Transit

`integrations/routes-api.ts`:
- Google Routes API `computeRouteMatrix`
- 每次計算:driving + transit 兩種 mode
- Field mask 嚴格控制(只取 `duration` 跟 `distanceMeters`)
- 失敗 / 海外 / 無路線 → 回 null
- KV cache: `route:{origin_hash}:{dest_place_id}` TTL 24h

`lib/distance-format.ts`:
- minutes < 60 → "22 分"
- minutes >= 60 → "1 小時 5 分"
- transit 不可用 → 不顯示該行

新 Flex 卡片底部 row:
```
─────────────
🚗 22 分    🚇 35 分
```

排序:精確度先 > 距離次(tie-breaker)。Batch 計算 top 5 distances 一次 Routes API call。

### 4.6 Observability

`lib/observability.ts`:

```typescript
export async function logEvent(env: Env, event: {
  type: string;          // "places.search", "places.add", "places.edit", ...
  user_id: string;
  intent?: string;
  confidence?: number;
  filters?: object;
  result_count?: number;
  duration_ms: number;
  outcome: 'success' | 'error' | 'unknown';
  error?: string;
  meta?: object;
}): Promise<void>
```

- 寫 KV `event:{ulid}` (TTL 7 天)
- prepend 到 `events:recent` ring buffer(最後 100 筆)

新指令 `/review`(PM userId 硬式授權):
- 撈 `events:recent` 最近 100 筆
- 整理成 markdown summary
- push 訊息回給 PM

---

## 5. Setup / Home Location Flow

### 5.1 First-Time Trigger

Bot 收到任何 LINE event 時:
1. KV `user:{id}:home` 讀(快路徑)
2. KV miss → Settings DB 讀
3. Settings DB miss → 首次引導
4. 在處理當前 event 之前 push 引導訊息(不 block 當前 event)
5. 標記 KV `user:{id}:home_prompted_at`(TTL 7 天)避免重複提示

### 5.2 LocationMessage 處理

LINE 收到 LocationMessage:
1. 抽取 lat / lng / address
2. upsert Settings DB
3. 寫 KV cache
4. 回確認訊息(判斷是 home 設定 or current_origin override)

### 5.3 Slash Commands

- `/setup` — 顯示當前 home,提示重設
- `/home` — 清除 `current_origin`(回到家裡位置)
- `/here` — 提示分享位置以設定 current_origin

### 5.4 Origin 解析優先順序

1. KV `user:{id}:current_origin`(若存在且未過期)
2. KV `user:{id}:home`
3. Settings DB
4. 都沒有 → 距離計算 skip

---

## 6. Acceptance Criteria

完工檢查清單:

- [ ] Migration runner:跑完 init,Place DB 多三個 summary fields,Visits DB / Settings DB 都建好
- [ ] Story H:口語訊息「我們今天去了 X」能成功記 visit 並 update summary
- [ ] Story I:剛收一張卡片,「改成 X」能成功修改 last_place
- [ ] Story J:指名「X 改成 Y」disambiguation 流程正常
- [ ] Story K:「刪掉剛剛 / 重做」清掉 last_place 對應 Notion entry
- [ ] Story K:「刪掉 X」disambiguation + 確認 postback 流程正常
- [ ] Story L:搜尋「沒去過的」「最近很愛的」filter 有效
- [ ] Story M:Flex 卡片(新增 + 搜尋 carousel 都)顯示 distance row
- [ ] Story N:首次互動引導 home 設定;LocationMessage 正確 upsert;`/setup` `/home` 有效
- [ ] 海外 / 無大眾運輸 → distance row 隱藏對應線
- [ ] 排序:相同 ranking 下,distance 短的在前
- [ ] /review 指令 PM 端可拉 100 筆 event summary
- [ ] Phase 0+1 所有功能 regression 通過

---

## 7. Prompts(增量)

### 7.1 Within-Places Intent Classifier (Haiku)

```
你是阿福(家庭景點 bot)的訊息分類員。判斷使用者訊息屬於以下哪一類:

- add: 新增景點(通常會帶 URL 或地點名)
- search: 搜尋既有景點(帶條件如年齡、室內、附近)
- edit: 修改剛才或指名景點的某個欄位(「改成 5-10 歲」「加標籤沙坑」)
- delete: 刪除景點(「刪掉剛剛」「重做」「刪掉大湖公園」)
- visit: 記錄造訪(「我們今天去了 X」「上禮拜去過 Y」)
- setup: home location 設定(「設定家裡位置」「/setup」)
- unknown: 不屬以上任何一類

context: just_replied_card 表示阿福剛剛回了一張新增的卡片(影響 edit/delete 判斷優先)

輸出 JSON:
{
  "intent": "add" | "search" | ...,
  "confidence": 0.0-1.0,
  "reasoning": "一句話"
}

confidence < 0.6 回 unknown。
```

### 7.2 Edit Intent Parser (Sonnet)

```
你解析使用者對景點的編輯指令,輸出對 Notion property 的 update operation。

景點當前狀態:
{place_json}

使用者訊息:
"{message}"

可編輯 properties:Age Min, Age Max, Indoor/Outdoor, Categories, Seasons,
Stroller Friendly, Parking Friendly, Has Restroom, Has Nursing Room,
Energy Level, Stay Minutes, Reservation Needed, Crowded On Weekends,
Fee Type, Fee Details, Summary, Source Type, Status

輸出 JSON array of operations(支援一句多 update):
[
  { "property": "Age Min", "value": 5 },
  { "property": "Age Max", "value": 10 },
  ...
]

對 multi-select(Categories, Seasons, Source Type)使用 op:
{ "property": "Categories", "op": "add" | "remove" | "set", "values": [...] }

對 rich text(Summary, Fee Details)使用 op:
{ "property": "Summary", "op": "append" | "replace", "value": "..." }

無法解析 → 輸出 []
```

### 7.3 Visit Parser (Sonnet)

```
解析使用者的造訪記錄訊息,輸出結構化資料。

輸入:
"{message}"

輸出:
{
  "place_query": "大湖公園" | "last" | null,
  "visited_on": "YYYY-MM-DD" | null,    // 沒講就是今天的日期
  "rating_signal": 1-5 | null,           // 從語氣推測
  "notes": "..."                          // 體驗描述
}

規則:
- 「上次那個」「剛剛那個」 → place_query = "last"
- 「上禮拜五」、「昨天」、「上週末」 → 解析為具體日期
- 「玩瘋了 / 超愛 / 一直想再去」 → rating_signal = 5
- 「還不錯 / 喜歡」 → rating_signal = 4
- 「還好 / 普通」 → rating_signal = 3
- 「不太喜歡 / 沒什麼意思」 → rating_signal = 2
- 「無聊 / 後悔 / 不會再去」 → rating_signal = 1
```

---

## 8. Task Breakdown

執行順序:**M0 → M1 → M2 → 18 → 17 → 13 → 14 → 15 → 16 → 20 → 19 → 21**

### Task M0 — Migration Runner Infrastructure
建 `scripts/migrations/_runner.ts` + `_types.ts`,在 Notion 建 `Migrations` DB,README 補執行說明。

**Acceptance:** `npx tsx scripts/migrations/_runner.ts --dry-run` 列出 pending migrations。Runner 在 Notion 找不到 Migrations DB 時自動建立。

### Task M1 — First Migration: Place Summary Fields
`001-add-visit-summary-fields.ts`:Place DB 加 `Last Visited` / `Visit Count` / `Avg Rating`。

**Acceptance:** `npx tsx scripts/migrations/_runner.ts` 跑完無 error。Notion Place DB 有新的三個欄位。重跑一次 → 幂等,不重複建。

### Task M2 — Visits + Settings DBs
`002-create-visits-db.ts`、`003-create-settings-db.ts`。`integrations/notion.ts` 加 Visit / Setting CRUD。

**Acceptance:** 跑完 Notion 有 Visits DB(含 Place relation)+ Settings DB。Unit tests for CRUD functions pass。

### Task 13 — Within-Places Intent Classifier (1.5c)
`src/core/places-intent-classifier.ts`,handler.ts 接入。撤掉舊 keyword-based isSearchQuery。

**Acceptance:** `我們今天去了大湖公園` → intent=visit。`改成 5-10 歲` → intent=edit。`下雨天推薦` → intent=search。Unit tests 覆蓋各 intent + confidence threshold。

### Task 14 — Visit Tracking (1.5a)
`flow-visit.ts` + visit parser + `visit-summary.ts` + tests。

**Acceptance:** 發「我們今天去了大湖公園,小璃超愛」→ Notion 有新 Visit row,Place 的 Last Visited / Visit Count / Avg Rating 更新。

### Task 15 — Conversational Edit (1.5b part 1)
`flow-edit.ts` + `extract-edit-intent.ts` + last_place 路徑 + 指名 disambiguation。

**Acceptance:** 剛收卡片後發「改成 5-10 歲」→ Notion 的 Age Min / Age Max 更新。「大湖公園改成室內」→ 找到並更新。

### Task 16 — Conversational Delete (1.5b part 2)
`flow-delete.ts` + last_place 刪除 + 指名刪除(含 postback 確認)。

**Acceptance:** 「重做」→ last_place 對應 Notion entry 刪除。「刪掉西湖公園」→ 確認 Flex → 刪除。

### Task 17 — Distance / Transit (1.5e)
`integrations/routes-api.ts` + `flex-message.ts` 改版 + carousel 距離整合 + sort tie-breaker。

**Acceptance:** 新增一個有 lat/lng 的景點 → Flex 卡片底部顯示 🚗 / 🚇 時間。搜尋 carousel 各 bubble 都有距離。

### Task 18 — Home / Setup Flow (1.5e dependency)
`flow-setup.ts` + LocationMessage 處理 + `/setup` `/home` `/here` slash commands + 首次引導。

**Acceptance:** 沒設過 home 的 user 發訊息 → 收到引導。分享位置 → Settings DB 有資料,KV 有 cache。`/setup` `/home` 有效回應。

### Task 19 — Observability (1.5d)
`lib/observability.ts` + 各 flow 加 logEvent + `/review` slash command。

**Acceptance:** 發幾條訊息後 `/review` 回 PM → 收到 event summary,含各 type count、outcome 分布、avg latency。

### Task 20 — Search by Visit State (1.5a feature)
`search-parser.ts` 加 visit-related filters + Notion query。

**Acceptance:** 「沒去過的台北景點」→ carousel 只有 Visit Count = 0 的。「上次小璃很愛的地方」→ 高 Avg Rating 優先。

### Task 21 — Phase 1.5 Closeout
- Acceptance test 全套(§6 清單)
- Spec changelog 累計
- Phase 1.5 closeout commit

---

## 9. Open Questions / Design Freedom

Claude Code 可自行決定:
- LLM 解析失敗時的 fallback 訊息文案(只要符合 Phase 0+1 §6.9 風格)
- Flex 卡片精確布局細節(只要 distance row 在底部、不擠壓既有資訊)
- Routes API field mask 細節
- Visits DB row 的 title format(UUID 或 「{place_name} - {date}」)
- KV cache 的具體 hash 函數(origin_hash)
- `/review` 輸出格式

已確認(2026-05-04):
- Google Routes API key:重用 `GOOGLE_PLACES_API_KEY`(同 GCP project,Routes API 已啟用)
- `/review` 授權 PM LINE userId:`U90ddd03f8005e0b8704745b170390ee4`(硬式 check)
- 「Alfred — 設定」Notion page:沿用 `NOTION_PARENT_PAGE_ID`(356d06a9b2ec8009838cd212d2f17715),migration runner 在同一個 parent page 底下建 Migrations/Settings/Visits DB

---

## 10. Cross-References to Phase 0+1 Spec

延續使用,不重複定義:
- LINE webhook 流程、reply / push fallback、loading indicator(Phase 0+1 §6)
- Notion property mapper、schema-flexible 原則(§4.3)
- KV `place:{id}:raw` 跟 `user:{id}:last_place` anchor(§5)
- Capability 模組化原則 + intent router(§3.2)
- Error handling 風格(§6.9)
- Execution report 格式(§12)

更新後的 spec doc 預期在 Phase 1.5 完工後升 v1.2。
