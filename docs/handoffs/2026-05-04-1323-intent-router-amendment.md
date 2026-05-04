# 2026-05-04 13:23 — Spec Amendment: LLM-Based Intent Router (Task 5.5)

Spec amendment — Intent Routing 設計

把 src/core/intent-router.ts 的設計從「Phase 0+1 直接 dispatch 到 places」升級成完整的 LLM-based router，但僅註冊 places 一個 capability:

1. 建立 src/capabilities/_registry.ts（原本 spec §3.2 已預留）
   - 匯出 capabilities array，每筆有 id, description, examples_positive, examples_negative
   - 目前只有一個：places
   - 補上 routing keywords / phrases 欄位讓 router 提示更精準

2. src/core/intent-router.ts 實作:
   - 收訊息 → 呼叫 Haiku 分類 → 回傳 capability id + confidence
   - confidence < 0.6 走 unknown handler
   - 失敗（API timeout / parse error）走 unknown handler 不要硬塞

3. src/core/unknown-handler.ts:
   - 回友善釐清訊息（我會在 PM 端更新訊息文案）
   - 列出當前已啟用的 capabilities

4. Slash command 預留（Phase 0+1 至少實作一個）:
   - /help 列出 capabilities + 簡短使用說明
   - /place <text> 強制走 places（後備機制）
   - 在 src/core/slash-commands.ts 處理，優先級高於 LLM router

5. 觀測性：每次 routing 結果寫到 Cloudflare logs（capability + confidence + 訊息前 50 字），未來可以看分類準確度

寫 ADR：為什麼選 LLM-based router 而非關鍵字、為什麼 confidence threshold = 0.6、slash command 為何同時保留

執行順序：這個改動插在 Task 4 完成之後、Task 6 開始之前，因為 Task 6 開始就需要 router 了。把它當作 Task 5.5 處理。
