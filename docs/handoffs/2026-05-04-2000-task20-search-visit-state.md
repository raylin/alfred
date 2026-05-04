# 2026-05-04 20:00 — Task 20: Search by Visit State (Story L)

Spec 對照:Phase 1.5 spec §1 Story L

實作範圍

擴充 search-parser 跟 Notion query,支援以下類型 visit-aware filter:

1. visit_state filter values:
   - 'never_visited' — 沒去過(Visit Count = 0 或 null)
   - 'visited_recently' — 最近一個月去過
   - 'visited_long_ago' — 半年沒去過(配合「常勝軍可以再排」概念)
   - 'highly_rated' — 平均評分 4.5+
   - 'loved_recently' — 最近一個月內 Rating = 5

2. search-parser 加 prompt rules:
   - 「沒去過的」/ 「還沒去過的」/ 「我沒去過的」→ never_visited
   - 「最近去過的」/ 「上週去過」/ 「這個月去過」→ visited_recently
   - 「很久沒去」/ 「半年沒去」/ 「常勝軍」→ visited_long_ago
   - 「上次很愛的」/ 「最近很愛的」→ loved_recently
   - 「最愛的」/ 「評分高的」→ highly_rated
   - 模糊 / 沒提 → 不加 visit_state filter
   
   注意:「上次去過很愛的某地」這種混合 — visit_state=loved_recently + place_query
   要 LLM 同時抽。
   
   prompt 也要明確指示「visit-related 措辭優先 visit_state」,避免 free_text_keywords
   把「沒去過」當關鍵字。

實作

A. src/capabilities/places/search-parser.ts (modify)
   - SearchFilters 加 visit_state?: VisitState | null
   - 加上述 prompt rules
   - 補 test cases

B. src/integrations/notion.ts (modify searchPlaces)
   - 接受 visit_state filter
   - 翻譯成 Notion filter:
     * never_visited:Visit Count empty OR Visit Count = 0
     * visited_recently:Last Visited on or after now - 30 days
     * visited_long_ago:Last Visited on or before now - 180 days(且 Visit Count > 0,
       排除沒去過的)
     * highly_rated:Avg Rating >= 4.5(也限 Visit Count >= 1 避免 noise)
     * loved_recently:這個用 Notion Place 端的 summary fields 推不出來,因為
       summary 是「平均」「最後造訪」,推不出「最近一個月內 Rating=5」
       
       兩個選擇:
       Option A:loved_recently 拆成 visited_recently + 結果端 in-memory filter
                 (查 Visits DB 的 Rating=5 + 過去 30 天的 visits → 取 place ids)
       Option B:不直接支援 loved_recently,讓 search-parser 把它降級成 highly_rated
       
       我傾向 Option A,因為老婆說「最近很愛的」是非常自然的查詢。實作 Option A:
       - searchPlaces 端如果是 loved_recently → 先查 Visits DB(filter Rating=5 +
         visited_on >= 30 days ago)→ 拿 place ids → 用這些 ids 限縮 Place query
       - 寫 ADR

C. flow-e-search.ts (modify)
   - 已經 ranking 過後,visit_state filter 應該不需要額外 in-memory re-rank
   - 但結果 carousel 上,如果是 visit-related search,bubble 上可以強化顯示 visit info
     (visit_count、last_visited、avg_rating)
   - Phase 1.5 先不在 carousel 加 visit info display,維持現有版面(spec §6.7)
     如果老婆覺得需要再 follow-up

D. Tests
   - search-parser:各 visit_state 用語
     * "沒去過的台北景點" → { region: '台北', visit_state: 'never_visited' }
     * "上次很愛的" → { visit_state: 'loved_recently' }
     * "最近常勝軍" → 模糊,讓 LLM 自由判斷,可能 visit_state: 'highly_rated' 或 'visited_long_ago'
       (寫測試 just 確認其中之一,不要鎖死哪個)
     * "下雨天三歲適合的景點" → 純 attribute 搜尋,visit_state 應該 null
   - searchPlaces:
     * never_visited 邏輯(Visit Count empty / 0)
     * visited_recently 日期邊界
     * visited_long_ago 日期邊界 + Visit Count > 0
     * highly_rated avg + visit count guard
     * loved_recently:mock Visits DB 回 ids → mock Place query 用 ids 限縮
   - flow-e-search regression:沒帶 visit_state 的 query 仍 work

驗收
1. 「沒去過的台北景點」→ never_visited filter,結果限 Visit Count=0/empty
2. 「上次很愛的」→ loved_recently,真的回最近一個月 Rating=5 的 places
3. 「半年沒去的常勝軍」→ visited_long_ago(可能再加 highly_rated)
4. 純 attribute 搜尋(下雨天三歲)→ visit_state null,行為同 Task 9
5. 0 結果 graceful loosening(現有行為)
6. Phase 0+1 + 14/15/16 regression

完成後 deploy + 給 report。下個是 Task 19 (Observability) 收尾用。
