# 2026-05-04 18:30 — Task 13: Within-Places Intent Classifier

Task 17 approved。Phase 1.5 plumbing 完整,接 Task 13 — Within-Places Intent Classifier。

Spec 對照:Phase 1.5 spec §4.2 + §7.1

Context
Phase 0+1 的 intent router 把訊息分到 capability(places vs unknown)。
Task 13 在 places capability 之內再加一層分類,因為 Phase 1.5 的訊息類型增加:
add / search / edit / delete / visit / setup / unknown(within places)

A. src/core/places-intent-classifier.ts(新)
   函式 classifyPlacesIntent(message, context, env): { intent, confidence, reasoning }
   intent: 'add' | 'search' | 'edit' | 'delete' | 'visit' | 'setup' | 'unknown'
   context: { just_replied_card_at?: timestamp, last_place_internal_id?: string }
   Haiku LLM call, prompt 對應 spec §7.1
   confidence < 0.6 → 強制 'unknown'
   parse 失敗 / API timeout → 'unknown'

B. src/capabilities/places/handler.ts (modify)
   text → classifyPlacesIntent → dispatch
   add → flow-b-text / search → flow-e-search / edit/delete/visit → stub / setup → /setup 引導 / unknown → unknown handler
   Remove isSearchQuery from text dispatch path

C. context 來源
   handler 從 KV user:{id}:last_place 讀
   5 分鐘內 → just_replied_card_at = sent_at

D. 撤掉 isSearchQuery 從 handler(選項 A — 乾淨移除)
   isSearchQuery + QUESTION_WORDS 不再被 handler 呼叫
   保留 input-detect.ts 其他函式(detectInputType 仍需要)
   tests 對應更新

E. Observability: console.log { type: 'places.intent_classify', ... }

F. Tests
   各 intent query + confidence < 0.6 → unknown + parse failure → unknown
   context timestamps + context null

驗收
1. 「下雨天哪裡好玩」→ 搜尋
2. 「兒童新樂園」→ add
3. 「我們今天去了大湖公園」→ stub 造訪
4. 「改成 5-10 歲」剛收完卡片 → stub 編輯
5. 「刪掉剛剛那筆」→ stub 刪除
6. Phase 0+1 regression: URL/Image/名字/搜尋 work
