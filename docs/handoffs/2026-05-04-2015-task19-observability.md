# 2026-05-04 20:15 — Task 19: Observability

Spec 對照:Phase 1.5 spec §4.6

實作範圍

A. src/lib/observability.ts (新)
   - logEvent(env, event): Promise<void>
   - Event shape per spec §4.6:
     {
       type: string,
       user_id?: string,
       intent?: string,
       confidence?: number,
       filters?: object,
       result_count?: number,
       duration_ms: number,
       outcome: 'success' | 'error' | 'unknown',
       error?: string,
       meta?: object
     }
   - 加 timestamp + ULID
   - 寫 KV event:{ulid} TTL 7 天
   - Prepend ULID 到 KV events:recent (JSON array of last 100 ULIDs)
   - 失敗 non-fatal

B. ULID generation (src/lib/ulid.ts)

C. 替換各 flow 的 console.log → logEvent (只改有 actionable signal 的)
   type naming: places.add.url, places.add.text, places.add.image, places.add.instagram
   places.search, places.edit, places.delete, places.visit.log, places.dedup_hit
   places.intent_classify, places.intent_unknown, system.error

D. /review slash command
   - 只 PM_LINE_USER_ID 可用
   - 讀 events:recent → 讀各 event → markdown summary
   - 超 4500 字元截斷

E. Tests

Open questions:
1. /review 訊息切分:預設超過 4500 字元截斷;未來改 LIFF
2. error message 隱私:不記 user 訊息原文(只記 truncated preview 50 字元);error sanitize

驗收:
1. 各 flow 觸發 → KV 有 event entries
2. /review 給 PM → summary
3. /review 給其他 user → 拒絕
4. events:recent 最多 100 筆
5. 7 天 TTL
6. KV 失敗 non-fatal
7. Regression
