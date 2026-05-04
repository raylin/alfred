# 2026-05-04 17:30 — Task 18 amendment: flag-based home update mechanism

Task 18 approved。一個小修正再進 Task 17 — 補完 home 更新機制。

問題:目前 /setup 對「已有 home 的 user」是 read-only,沒有更新 home 的路徑。

解法:flag-based 設計
- /setup with existing home → 設 KV flag user:{id}:home_update_pending(TTL 5 min)
  + 回訊息:「目前家裡位置:{address}。要更新的話,5 分鐘內分享新位置給我。」
- runFlowSetup 收到 location:
  1. 檢查 flag user:{id}:home_update_pending 存在 → 視為更新 home,清掉 flag
  2. 沒 flag + 沒 home → first time setup,設 home(現有行為)
  3. 沒 flag + 有 home → current_origin 2h(現有行為)

實作
src/capabilities/places/home-store.ts 加:
- markHomeUpdatePending(env, userId): 寫 KV TTL 5 min
- consumeHomeUpdatePending(env, userId): 讀 + 立刻刪(atomic-ish,失敗不致命)
- isHomeUpdatePending(env, userId): boolean

src/core/slash-commands.ts /setup with home → markHomeUpdatePending
src/capabilities/places/flow-setup.ts → location 進來先 consume flag,有 flag 走 home 更新分支

文案調整
- /setup 有 home:「目前家裡位置:{address}。要更新請在 5 分鐘內分享新位置。」
- 更新 home 成功:「家裡位置已更新為:{new_address}」
- 5 分鐘過期 + 又分享 location → fallback 到 current_origin(現有行為,沒 flag = 沒設定意圖)

Tests
- /setup with home → markHomeUpdatePending called
- location with flag → setHomeLocation called + flag cleared
- location without flag(已有 home)→ setCurrentOrigin called
- 5 分鐘過期 → flag 不存在 → 走 current_origin 路徑
- ADR-020 amend 或新增 ADR-021 記錄這個 mechanism

驗收
1. 已有 home 的 user 打 /setup → 看到「要更新請在 5 分鐘內」訊息
2. 5 分鐘內分享位置 → home 更新成功
3. 5 分鐘外分享位置 → 走 2h current_origin
4. 沒打 /setup 直接分享位置 → 走 2h current_origin
