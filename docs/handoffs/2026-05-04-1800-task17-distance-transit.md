# 2026-05-04 18:00 — Task 17: Distance / Transit Display

Task 18.1 approved。Phase 1.5 plumbing 完成,接 Task 17 — Distance / Transit Display。

Spec 對照:Phase 1.5 spec §1 Story M + §4.5 + §6 Acceptance Criteria

實作前先確認:GCP Console Routes API 已啟用、API key restriction 已加勾 Routes API。
若沒有 → 跑前停下,先請使用者確認。

實作範圍

A. Routes API integration
   src/integrations/routes-api.ts (新)
   - 函式 computeRouteMatrix(origin, destinations[], env): RouteResult[]
     * destinations[] 最多 5 個(配合 carousel 上限)
     * 內部一次 API call 拿 driving + transit
     * Field mask 最小:'originIndex,destinationIndex,duration,distanceMeters,condition'
     * Endpoint: https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix
     * Auth: API key in X-Goog-Api-Key header
   - 函式 computeSingleRoute(origin, dest, env): SingleRouteResult
     * 對應 single bubble 卡片(Stories A/B/C/D/F)
     * 內部呼叫 computeRouteMatrix with 1 destination
   - RouteResult shape:
     {
       driving: { duration_minutes: number, distance_meters: number } | null,
       transit: { duration_minutes: number, distance_meters: number } | null
     }
     null = API 沒回該 mode 或 condition != ROUTE_EXISTS
   - 海外 / 無路線 / API 失敗 → 整個結果回 null,不報錯

B. KV cache
   Key: route:{origin_hash}:{dest_place_id}
   Value: RouteResult JSON
   TTL: 24h(地理 / 路線 / 大眾運輸變動緩慢)
   origin_hash: 簡單 lat/lng to fixed-precision string(例如 "25.0478,121.5170" 取小數點 4 位)

C. Distance formatter
   src/lib/distance-format.ts (新)
   - formatMinutes(min): string
     * < 60 → "22 分"
     * >= 60 → "1 小時 5 分"
   - formatRouteRow(route): string
     * driving + transit 都有: "🚗 22 分    🚇 35 分"
     * 只有 driving: "🚗 22 分"
     * 都沒有: 回空字串(caller 該 hide row)

D. Flex Message 改版
   src/capabilities/places/flex-message.ts (modify)
   buildDraftCard / buildSearchBubble:
   - 接受新 optional 參數 distance: RouteResult | null
   - 如有 + 至少 driving 或 transit 不是 null → 卡片底部加 separator + distance row
   - 注意 carousel bubble 寬度有限,單 bubble 也是窄的,文案濃縮
   - 完全不影響沒有 distance 的舊行為(向下相容)

E. Flow integration
   每個 add flow(flow-a-url / flow-b-text / flow-c-maps / flow-d-instagram / flow-image):
   - Notion write 完成後、build flex 之前
   - 拿 effective origin(getEffectiveOrigin)
   - origin 存在 + place 有 lat/lng → 算 distance(computeSingleRoute + cache)
   - 沒 origin 或算不出來 → 不影響卡片,不顯示 distance row
   - 寫 ADR:distance 計算放 Notion 寫入後是因為失敗不應 block 主流程

   flow-e-search:
   - 拿 top 5 result 之後、build carousel 之前
   - 拿 effective origin
   - 一次 computeRouteMatrix(top 5 destinations)
   - 把 RouteResult 跟 place pair 後,distance 短的 tie-break ranking

F. Sort tie-breaker
   flow-e-search 的 ranking:
   - 主 sort: relevance(現有 keyword scoring + filter match)
   - 次 sort: distance(driving 為主,沒有則 transit,都沒則放最後)
   - 把 places 同 ranking 分數內依 distance 排序
   - 寫 ADR:為什麼用 driving 而非 transit 當主要 tie-break

G. Tests
   - routes-api: mocked API response、海外 condition、各種失敗
   - distance-format: 邊界(60 分整、0 分等)
   - flex-message: with / without distance 兩種版本
   - flow integration: origin 有 / 無、distance 算成功 / 失敗都不擋 Notion 寫入
   - tie-breaker: 同 ranking 不同 distance 的排序

Open questions:
1. computeRouteMatrix 失敗 + 已寫 Notion → log warning 不影響卡片
2. transit 無路線識別 condition 欄位 → 先 log,PM review 後決定
3. 卡片 distance row 排版:同行 vs 兩行

驗收
1. 新增景點 → 卡片底部多一行距離
2. 搜尋 → carousel 每張 bubble 都有距離
3. 海外 / 無大眾運輸 → row 隱藏
4. 同 ranking 不同距離 → 短的在前
5. 沒 home/origin → 卡片無距離 row,不報錯
6. Routes API 失敗 → 卡片無距離 row,Notion 寫入正常,log warning
