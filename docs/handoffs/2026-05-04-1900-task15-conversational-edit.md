# 2026-05-04 19:00 — Task 15: Conversational Edit (Story I + J)

Task 14 approved。接 Task 15 — Conversational Edit (Story I + J)。

Spec 對照:Phase 1.5 spec §1 Story I + Story J + §4.3 + §7.2

範圍涵蓋:
- Story I:剛回卡片 → 「改成 X」→ 用 last_place anchor 編輯
- Story J:指名「大湖公園改成室內」→ 找 + disambiguate + 編輯

實作

A. Edit intent parser
   src/capabilities/places/edit-parser.ts (新)
   - 函式 parseEditIntent(message, currentPlace, env): EditOp[]
   - 系統 prompt 對應 spec §7.2,輸出 array of operations
   - operations 對應 spec §4.3 的 EditOp union type
   - currentPlace 是 Place 當前狀態 JSON,LLM 要看當前值才能正確判斷
     例如「加沙坑」→ 要看當前 Categories 才能知道是 add 還是 set
   - Sonnet(需要理解 schema 跟微妙語義)
   - parse 失敗 retry once → 失敗回 [] 不擋 flow
   - 空 array → 友善回覆「沒看出要改什麼,可以再具體一點嗎?(例如『改成 5-10 歲』)」

B. Edit intent → Notion property update
   src/capabilities/places/apply-edit.ts (新)
   - 函式 applyEdits(notionPageId, edits[], env): { applied: EditOp[], failed: { op, error }[] }
   - 把 EditOp 翻譯成 Notion property update payload
   - 注意每個 property type:
     * Number / Select / Date → 直接 set
     * Multi-select with op:add/remove/set → fetch current → diff → patch
     * Rich text with op:append → fetch current → concat → patch
     * Status (Notion status type, not select) → 注意 API 細節
   - 一個 PATCH 帶所有 changes(Notion API 接受 multi-property update)
   - failed 不 throw,讓 caller 報告部分成功

C. Edit flow
   src/capabilities/places/flow-edit.ts (新)
   流程:
   1. Resolve target place
      - 從 user:{id}:last_place 拿 anchor(5 分內 = 強信號)
      - 沒 anchor → LLM 從訊息嘗試 extract place name(可能訊息開頭有「大湖公園 改成 X」這種句型)
        * Sonnet 解析「target_place_name」+ 「edit_message」(把「大湖公園」抽掉,留下編輯部分給 edit-parser)
        * 抽出 name → searchPlaces 找候選
          - 0 → 「沒找到 X,可以講具體一點嗎?」
          - 1 → 直接用
          - >1 → disambiguate(reuse Task 14 的 buildDisambiguateCard,action_type='edit')
        * 抽不出 name → 友善訊息「不確定要改哪一筆,可以指名嗎?(例如『大湖公園 改成室內』)」
   2. parseEditIntent(editMessage, currentPlace) → EditOp[]
      - 空 → 上述「沒看出要改什麼」
   3. applyEdits(pageId, ops) → 結果
   4. Reply
      - 全成功 → 「✓ 已更新:{ properties summary }」
        * properties summary 例如「適合年齡 5-10 歲、室內」
        * 不貼整張新卡片(spec §9 確認過淺版本足夠)
      - 部分成功 → 「✓ 已更新:X / 但 Y 沒改成功:{ reason }」
      - 全失敗 → 友善訊息

D. Disambiguate flow for edit
   - buildDisambiguateCard(places, 'edit') 生成卡片
   - postback edit:select:{notion_page_id} → 需要 KV store edit 指令(類似 visit 的 pending_visit)
     * KV key: user:{id}:pending_edit = { edit_message, expires } TTL 600s
   - postback handler 讀 pending_edit + place_id → 進入 step 2(parseEditIntent)
   - src/index.ts 加 edit:select postback 路由

E. handler.ts 替換 stub
   - text → intent === 'edit' → runFlowEdit(message, userId, chatId, env)
   - postback edit:select:{page_id} → resume edit flow with KV pending_edit

F. Tests
   - edit-parser:
     * "改成 5-10 歲" → [Age Min: 5, Age Max: 10]
     * "改室內" → [Indoor/Outdoor: 室內]
     * "加沙坑" → [Categories add: 沙坑] (依 currentPlace 已有 Categories)
     * "Status 設成 confirmed" → [Status: confirmed]
     * "改名叫 X" → 應該回 [] 並讓上層回「不支援改名」
       (spec §1 Story I 明列不支援)
   - apply-edit:
     * 各 property type 翻譯成 Notion patch payload
     * Multi-select add/remove/set 邏輯
     * Rich text append vs replace
   - flow-edit:
     * last_place anchor → 直接編輯
     * 抽 name + 1 candidate → 編輯
     * 抽 name + multi candidates → disambiguate
     * 抽不出 name → 友善訊息
     * pending_edit KV 寫入 + 後續 postback resume

Open questions(請寫進 report)

1. 改名是 hard reject 還是 soft suggest?
   spec §1 Story I 列為 not supported,但老婆可能會打。
   傾向:edit-parser 回 [] + 上層加特殊訊息「想改名請刪除這筆重新加」
   實作這個。

2. 「Status 設成 confirmed」是否要特別 onboard 老婆知道有這指令?
   傾向:不主動 onboard,但既然 LLM 能解析就 support。Phase 1.5 closeout
   時 README 增加常用編輯指令範例。

驗收
1. 剛收完卡片 → 「改成 5-10 歲」→ 「✓ 已更新:適合年齡 5-10 歲」
2. 「大湖公園改成室內」(指名)→ 找到 + 編輯
3. 「動物園改成室內」(多筆同名)→ disambiguate → 點選 → 編輯
4. 「改名叫兒童樂園」→ 「想改名請刪除這筆重新加」
5. 「沙坑超棒」(模糊)→ 「沒看出要改什麼,可以再具體一點嗎?」
6. Phase 0+1 + Task 14 regression(URL/Image/搜尋/新增/造訪)

完成後 deploy + 給 report。下個 Task 16 (Conversational Delete) 跟這個架構非常像,
會很快。
