# 2026-05-04 14:00 — Task 7+8 Spec Amendments + Execution Order

Task 6 已 approved。接下來連續做 Task 7 (Story B) + Task 8 (Story C),完成後一起部署做 manual acceptance test。

## Spec 補充 1: `raw_extraction` KV 寫入 (spec §5)

每個 Place 寫進 Notion 的同時，把原始抽取結果也存進 KV:
  key: `place:{internal_id}:raw`
  value: { raw_input, raw_html?, raw_google_places?, raw_claude_response, extracted_at }
  TTL: 90 days
如果 Task 6 還沒實作，在 Task 7 一併補進來（放在 flow-a-url 跟新的 flow-b-text 共用的 helper）

## Spec 補充 2: `user:{line_user_id}:last_place` KV 寫入 (取代 spec §5 的 last_bot_msg)

每次成功寫入 Place 後，更新這個 key:
  key: `user:{line_user_id}:last_place`
  value: { internal_id, sent_at, chat_id }
  TTL: 24 hours
這個是 Phase 1.5「改成 5-10 歲」要 reference 的 anchor。
寫 ADR 記錄為什麼用 user-side key 而非 message-side key（reply API 不回 message ID）。

## Task 7 注意點

- handler.ts 已有 B 的 stub，填進去
- input-detect 已能區分「URL / Google Maps URL / 其他文字」，Task 7 處理「其他文字」
- 「其他文字」要再分「搜尋 vs 加新景點」— 含問號或疑問詞走 Story E，否則走 Story B
- Story E 還沒做（Task 9），所以 Task 7 階段先把疑問句路由到 unknown handler 並回應「搜尋功能尚未開放」是 OK 的。Task 9 完成才接通

## Task 8 注意點

- Google Maps URL 的處理 google-places.ts 已備好（parseGoogleMapsUrl）
- AI 抽取的時候 ai_inferred_fields 應該很少（大部分從 Google 來）
- Source Type 設為 ['Google Maps']

兩個 task 都跑完、tests 都過，再回報。我這邊驗收後 deploy + acceptance test。
