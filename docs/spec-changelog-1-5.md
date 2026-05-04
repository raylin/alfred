# Spec Changelog — Alfred Phase 1.5

Changes between spec v1.0 (2026-05-04) and v1.1 (2026-05-04).
Each entry references the ADR that drove the change.

---

## CL-001 — Migrations DB placed under NOTION_PARENT_PAGE_ID (ADR-018)

**Spec section affected:** §3.3 Runner 行為 (step 1), §9 Open Questions confirmed block

Spec v1.0 said the Migrations DB should be created under "Alfred — 設定" page. Phase 1.5 pre-flight confirmed that we reuse the existing `NOTION_PARENT_PAGE_ID` hub page (same parent as the Place DB) rather than creating a new "Alfred — 設定" page.

**v1.1 change:** §3.3 step 1 now reads: "確保 Migrations DB 存在 NOTION_PARENT_PAGE_ID 底下（與 Place DB 同層），沒有就建。" The §9 confirmed block adds "Migrations / Visits / Settings DB 都建在 `NOTION_PARENT_PAGE_ID` 底下；不另開 Alfred — 設定 page。"

---

## CL-002 — DB ID discovery via parent-page scan + KV cache (ADR-019)

**Spec section affected:** §4.4 Visit Recording (Notion integration), §2.4 KV New Keys

Spec v1.0 was silent on how the Workers runtime discovers the Visits and Settings DB IDs created at migration time. ADR-019 chose Option B: `discoverDbIds()` scans `NOTION_PARENT_PAGE_ID` block children on cold start, caches the result in KV `system:db_ids` with 24h TTL.

**v1.1 change:** §2.4 KV table gains `system:db_ids` row. §4.4 adds a note: "Notion integration 透過 discoverDbIds() (parent page scan + KV cache 24h) 取得 Visits / Settings DB ID，不依賴額外 env var。"

---

## CL-003 — Setup: first location = home; subsequent = current_origin (ADR-020)

**Spec section affected:** §5.2 LocationMessage 處理

Spec v1.0 said "判斷是 home 設定 or current_origin override" without defining the heuristic. ADR-020 resolved this: if no home exists → home; if home exists and no pending flag → current_origin override (2h TTL).

**v1.1 change:** §5.2 adds clarification: "判斷規則：(a) 無 home → 設為 home；(b) home 已存在且無 home_update_pending flag → 設為 current_origin（2h TTL）；(c) home_update_pending flag 存在 → 清 flag，覆蓋 home。"

---

## CL-004 — /setup flag mechanism for home update (ADR-021)

**Spec section affected:** §5.3 Slash Commands (/setup), §2.4 KV New Keys

Spec v1.0 described `/setup` as "顯示當前 home，提示重設" without specifying how the next location message would be treated as a home update rather than a current_origin. ADR-021 added the `home_update_pending` KV flag with 5-min TTL.

**v1.1 change:** §5.3 `/setup` entry expands: "若 home 已設定：寫 user:{id}:home_update_pending (TTL 5 分鐘)，回覆當前 home 位置 + 提示。" §2.4 KV table gains `user:{line_user_id}:home_update_pending` row (value: `"1"`, TTL: 5 分鐘, 用途: /setup → 下一次 location → update home).

---

## CL-005 — Distance cache key: lat/lng hash for both origin and dest (ADR-022)

**Spec section affected:** §4.5 Distance / Transit (KV cache 說明)

Spec v1.0 wrote `route:{origin_hash}:{dest_place_id}` as the cache key. ADR-022 changed this to `route:{lat4dp,lng4dp}:{lat4dp,lng4dp}` (lat/lng truncated to 4 decimal places) for both origin and destination, because not all flows produce a `google_place_id`.

**v1.1 change:** §4.5 KV cache line updated to: "Cache key: `route:{originLat4dp},{originLng4dp}:{destLat4dp},{destLng4dp}`，TTL 24h。"

---

## CL-006 — Driving duration as search tie-break (ADR-023)

**Spec section affected:** §4.5 Distance / Transit (排序 note)

Spec v1.0 said "精確度先 > 距離次" without specifying which mode (driving vs. transit). ADR-023 chose driving duration as the primary distance tie-break (transit as fallback, both null → last).

**v1.1 change:** §4.5 adds: "Tie-break: 以 driving duration 為主（transit 為備選，兩者皆無則排末）。"

---

## CL-007 — LLM intent classifier replaces keyword isSearchQuery (ADR-024)

**Spec section affected:** §4.2 Within-Places Intent Classifier

Spec v1.0 described the classifier accurately but was ambiguous about the fate of the old `isSearchQuery`. ADR-024 confirmed clean removal (Option A): `isSearchQuery` and `QUESTION_WORDS` are deleted from `input-detect.ts`.

**v1.1 change:** §4.2 adds: "舊的 keyword-based isSearchQuery 已完整移除（不保留 fallback）。"

---

## CL-008 — notion_page_id in disambiguation postback (ADR-026)

**Spec section affected:** §4.4 Visit Recording (disambiguation flow)

Spec v1.0 said `postback: visit:select:{internal_id}`. ADR-026 changed this to `notion_page_id` to allow a direct GET /pages/{id} instead of a filter query.

**v1.1 change:** §4.4 and §4.2 disambiguation note updated: "Disambiguation postback 用 `notion_page_id`（不是 internal_id），以節省 Notion filter 查詢。"

---

## CL-009 — Single PATCH for all edit ops; rename soft-rejected (ADR-027, ADR-028)

**Spec section affected:** §4.3 Conversational Edit Intent Parsing

Spec v1.0 left PATCH batching unspecified, and said "rename reject" without clarifying where. ADR-027 chose a single PATCH; ADR-028 chose soft-reject at `applyEdits` level (not at parser level), with a helpful user message.

**v1.1 change:** §4.3 adds two notes: "applyEdits 將所有合法 ops 合併為一次 PATCH /pages/{id} 呼叫。" and "改名指令（Name property）在 applyEdits 層軟性拒絕，回覆『想改名的話，請刪除這筆重新加入。』"

---

## CL-010 — Two-tier delete confirmation policy (ADR-029, ADR-030, ADR-031)

**Spec section affected:** §1 Story K, §6 Acceptance Criteria

Spec v1.0 described both "刪掉剛剛" and "刪掉大湖公園" as going through confirmation. ADR-029 separated these: last_place anchor → immediate delete; named path → confirmation card. ADR-030 specified archive (not hard-delete), with dedup KV + last_place KV cleanup, visits preserved. ADR-031 chose not to use a pending_delete KV (postback page_id is self-contained).

**v1.1 change:** §1 Story K updated to clarify the two tiers. §6 checklist Story K items updated: "「刪掉剛剛 / 重做」→ 立即刪除（無需確認），「刪掉 X」→ 確認 Flex（含造訪次數）→ 刪除。"

---

## CL-011 — loved_recently as two-phase query (ADR-032)

**Spec section affected:** §1 Story L, §4.4 Visit Recording (search by visit state)

Spec v1.0 did not specify how `loved_recently` would be implemented at the Notion layer. ADR-032 chose the two-phase approach: query Visits DB (Rating=5, last 30 days) → extract Place IDs → query Places DB + in-memory filter.

**v1.1 change:** §1 Story L adds: "loved_recently 以兩步查詢實作：Visits DB (Rating=5, 30天內) → Place IDs → in-memory filter；比其他 visit_state 多一次 API call，但精確度高。"

---

## CL-012 — Observability: user_id optional, intent_classify/intent_unknown split, /review PM-only (ADR-033, ADR-034, ADR-035)

**Spec section affected:** §4.6 Observability, §6 Acceptance Criteria

Spec v1.0 had `user_id: string` (required) in `logEvent`. Implementation uses `user_id?: string | undefined` (optional, for flows without userId like group chat). Spec v1.0 didn't specify event type names precisely; ADR-033 split `places.intent_unknown` from `places.intent_classify`. ADR-034 used `places.add.url` with `meta.flow:'maps'` for Google Maps URL flow. ADR-035 documented outer try/catch wrapper pattern. `/review` requires exact match to `PM_LINE_USER_ID` env var.

**v1.1 change:** §4.6 `logEvent` signature: `user_id` changed to `user_id?: string | undefined`. Event type list added: "places.add.url / .text / .image / .instagram, places.search, places.edit, places.delete, places.visit.log, places.dedup_hit, places.intent_classify, places.intent_unknown, system.error（Google Maps URL flow 用 places.add.url 加 meta.flow:'maps'）。" §6 /review criteria updated: "/review 須 userId === PM_LINE_USER_ID 才回 summary；其他 user 回『這指令僅限管理員。』"

---

*Changelog complete. See docs/ADR.md §ADR-017 through §ADR-035 for full decision records.*
