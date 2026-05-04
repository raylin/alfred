# 2026-05-04 19:45 — Task 16: Conversational Delete (Story K)

Task 16 — Conversational Delete (Story K).

Spec 對照:Phase 1.5 spec §1 Story K + §4 (flow-delete.ts)

Pattern 高度 reuse Task 15。專注設計選擇:

A. Delete parser
   src/capabilities/places/delete-parser.ts (新)
   - 函式 parseDeleteIntent(message, env): { target: 'last' | string | null }
   - target:
     * 'last' → 「刪掉剛剛那筆」/「重做」/「不要這筆」/「刪掉那個」(配合 last_place anchor)
     * string → 「刪掉大湖公園」(指名)
     * null → 訊息不像 delete 意圖(理論上 intent classifier 不該 route 到這,
       但 safety net 一下)
   - Sonnet(語氣判斷:「重做」「不要這筆」這種要解析成 delete intent + last 而非 add)
   - 「重做」= 刪掉 last_place(把對話狀態 reset 到「等使用者重貼」)

B. Confirmation policy 設計選擇
   破壞性操作分兩種 confirmation 強度:
   
   - last_place 路徑(剛剛 5 min 內加的)→ NO confirmation
     * 老婆剛加錯,意圖明確,confirm 反而干擾
     * 風險:刪錯的話老婆要重加(但她本來就要 start over,所以「刪錯」≈「重做」)
   
   - 指名路徑(「刪掉大湖公園」)→ YES confirmation
     * 可能誤刪累積很久的資料(visits 記錄、評分)
     * Flex 卡片含 postback「確認刪除」/「取消」
     * 顯示要刪的 place name + visit_count(讓老婆看到「會失去 X 筆造訪記錄」)
   
   寫 ADR 說明 last vs 指名的不同 confirmation 強度。

C. Delete operation 實作細節
   src/integrations/notion.ts 加 archivePlace(notionPageId, env)
   - PATCH page with { archived: true }
   - 不是真硬刪,Notion 有 30 天 retention
   - search filter 預設不包含 archived,所以 searchPlaces 不會回 archived entries
   
   Place archive 後,相關 cleanup:
   1. KV dedup:{google_place_id} → 刪掉
      - 否則下次老婆加同地方會被誤判重複(指向 archived page)
   2. KV user:{userId}:last_place → 如果剛好指向被刪的 → 清掉
   3. Visits 不刪
      - 歷史記錄保留(老婆可能看「我們上半年去過哪些地方」回顧)
      - Visits 的 Place relation 仍指向 archived page,但 search filter 不會回來,
        實質上看不到。Phase 2+ 如果做年度回顧 feature 再決定要不要顯示
   
   寫 ADR 說明這三個 cleanup 跟 Visits 不刪的決定。

D. Delete flow
   src/capabilities/places/flow-delete.ts (新)
   流程:
   1. parseDeleteIntent
   2. target === 'last':
      - 讀 user:{id}:last_place
      - 沒命中 → 「找不到剛剛的記錄,可以告訴我要刪哪個嗎?」
      - 命中 → 直接 archive + cleanup + 「✓ 已刪除 X」
        * 「重做」不需要特別處理,效果就是刪掉 last_place,老婆下一句會自然重貼
   3. target === string:
      - searchPlaces by name
      - 0 → 「找不到 X」
      - 1 → 顯示確認卡片(name + visit_count + 「確認刪除」/「取消」postback)
      - >1 → disambiguate(reuse buildDisambiguateCard, action_type='delete')
        * 老婆選一筆 → 進確認卡片(不直接刪,因為 disambiguate 已經是「指名」路徑)

E. Disambiguate + Confirmation chains
   - postback delete:select:{page_id} → 顯示確認卡片
   - postback delete:confirm:{page_id} → 真刪除
   - postback delete:cancel:{page_id} → 取消,「好,沒刪。」
   
   pending_delete KV 設計選擇:
   - 因為 confirmation 卡片已經帶 page_id,理論上 pending_delete KV 不必要
   - 但若想要 expire(避免老婆 30 分鐘後不小心點到舊卡片)可以考慮
   - 我傾向不必要(Postback 沒有真正的 expire 概念,LINE 不會主動清舊卡片,
     但 page_id 自帶 destination,簡單。如果使用者點到「過期」的卡片,page 仍在,
     刪除仍 work,沒副作用)
   - 寫進 ADR

F. handler.ts 替換 stub
   - text → intent === 'delete' → runFlowDelete
   - postback delete:select / delete:confirm / delete:cancel 各自路由

G. Tests
   - delete-parser:
     * "刪掉剛剛那筆" / "重做" / "不要這筆" → 'last'
     * "刪掉大湖公園" → 'mountainlake'(string)
     * "我們去了 X" → null(這個應該被 intent classifier 路由到 visit,
       不該到 delete 但 safety net)
   - flow-delete:
     * last 路徑無 anchor → 友善訊息
     * last 路徑有 anchor → archive + cleanup
     * 指名 1 結果 → 確認卡片
     * 指名多結果 → disambiguate 卡片
     * disambiguate select → 確認卡片
     * confirm postback → archive + cleanup
     * cancel postback → 友善訊息
   - cleanup:
     * dedup KV deleted
     * last_place KV cleared if matched
     * Visits NOT deleted

Open question(寫進 report)

「重做」的 UX:刪掉 last_place 之後,老婆會立刻重貼她要的東西。
- 選項 A:阿福只回「✓ 已刪除 X」,等老婆下一句
- 選項 B:阿福回「✓ 已刪除 X。再貼一次?」(主動 prompt)

我傾向 A(零雜訊),老婆要重貼的話自然會做。實作這個。

驗收
1. 「刪掉剛剛那筆」(剛收完卡片)→ 直接刪 + 確認訊息
2. 「重做」(剛收完卡片)→ 同上
3. 「刪掉大湖公園」(只一筆)→ 確認卡片
4. 確認 → 刪除
5. 取消 → 沒事
6. 「刪掉動物園」(多筆)→ disambiguate → 選一筆 → 確認 → 刪除
7. dedup KV 確實清掉(下次加同地點不會誤判重複)
8. Visits 仍保留
9. Phase 0+1 + Task 14/15 regression(URL/Image/搜尋/新增/造訪/編輯)

完成後 deploy + 給 report。下個是 Task 20 (Search by Visit State)。
