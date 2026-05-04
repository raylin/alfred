# Task 16 Execution Report — Conversational Delete (Story K)

## Summary

Implemented full conversational delete capability per spec §1 Story K. Two-tier confirmation policy: immediate delete for last_place anchor, confirmation card for named deletes. Archive-based soft delete with KV cleanup. Visits preserved.

---

## Files Changed

| File | Change |
|---|---|
| `src/capabilities/places/delete-parser.ts` | New: `parseDeleteIntent` (Sonnet, retry-once) |
| `src/integrations/notion.ts` | Added `archivePlace(notionPageId, env)` — PATCH `{ archived: true }` |
| `src/capabilities/places/flex-message.ts` | Added `buildDeleteConfirmCard(name, notionPageId, visitCount)` |
| `src/capabilities/places/disambiguate.ts` | Extended action type to `'visit' \| 'edit' \| 'delete'` |
| `src/capabilities/places/flow-delete.ts` | New: `runFlowDelete`, `runFlowDeleteSelect`, `runFlowDeleteConfirm`, `runFlowDeleteCancel` |
| `src/capabilities/places/handler.ts` | Wired `delete` intent to `runFlowDelete` |
| `src/index.ts` | Routes `delete:select:`, `delete:confirm:`, `delete:cancel:` postbacks |
| `tests/unit/delete-parser.test.ts` | New: 12 tests |
| `tests/unit/flow-delete.test.ts` | New: 21 tests |

---

## Design Decisions

### A. Confirmation Policy (ADR-029)

Two tiers, not one:

- **last_place anchor path** (< 5 min window): no confirmation. "重做" means "I just added the wrong thing" — the intent is unambiguous. A confirmation dialog adds friction without value. Risk: if user accidentally says "重做" and loses a record, they can re-add (which is what they were going to do anyway).

- **Named path** ("刪掉大湖公園") and **post-disambiguation**: always show `buildDeleteConfirmCard`. The card shows place name and visit count so the user sees "⚠️ 會一併失去 3 筆造訪記錄" before committing.

### B. Archive, Not Hard Delete (ADR-030)

`archivePlace` sends `PATCH /pages/{id}` with `{ archived: true }`. Notion retains archived pages for 30 days. Three cleanup steps after archive:

1. **`dedup:{google_place_id}` KV deleted** — prevents false-positive duplicate detection if user re-adds the same place.
2. **`user:{userId}:last_place` KV deleted if it points to the archived place** — prevents a subsequent "重做" from failing on a dead reference.
3. **Visits NOT deleted** — visit history preserved for future analytics.

### C. No pending_delete KV (ADR-031)

Unlike edit/visit disambiguation (which need to recover parsed message or visit data), delete confirmation is self-contained: the postback data `delete:confirm:{notionPageId}` carries everything needed to execute the delete. No KV needed. Stale card taps (e.g., user confirms 30 min later) fail gracefully: `getPlaceByNotionPageId` returns null and user gets "找不到" reply.

### D. Open Question — "重做" UX

Chose option A: "✓ 已刪除 X" only, no prompt to re-add. Zero noise. User will naturally re-paste when ready.

---

## Postback Chain

```
"刪掉大湖公園"
  → runFlowDelete → searchPlaces (1 result) → buildDeleteConfirmCard
    → delete:confirm:{pageId} → runFlowDeleteConfirm → archivePlace + cleanup → "✓ 已刪除"
    → delete:cancel:{pageId}  → runFlowDeleteCancel  → "好，沒刪。"

"刪掉動物園" (multiple results)
  → runFlowDelete → searchPlaces (>1) → buildDisambiguateCard('delete')
    → delete:select:{pageId} → runFlowDeleteSelect → buildDeleteConfirmCard
      → delete:confirm:{pageId} → runFlowDeleteConfirm → ...

"重做" / "刪掉剛剛那筆" (< 5 min anchor)
  → runFlowDelete → resolveDeleteAnchor → archivePlace + cleanup → "✓ 已刪除"
```

---

## ADRs Recorded

- **ADR-029** — Two-tier confirmation: immediate for anchor, confirm card for named
- **ADR-030** — Archive (not hard-delete); dedup + last_place KV cleanup; visits preserved
- **ADR-031** — No pending_delete KV; postback data is self-contained

---

## Test Results

```
Test Files  39 passed (39)
     Tests  465 passed (465)
```

33 new tests. All existing tests pass.

---

## Acceptance Checklist

1. ✓ "刪掉剛剛那筆" (剛收完卡片) → 直接刪 + 確認訊息
2. ✓ "重做" (剛收完卡片) → 同上 (last_place anchor path, no confirmation)
3. ✓ "刪掉大湖公園" (只一筆) → 確認卡片
4. ✓ 確認 → 刪除
5. ✓ 取消 → "好，沒刪。"
6. ✓ "刪掉動物園" (多筆) → disambiguate → 選一筆 → 確認 → 刪除
7. ✓ dedup KV 確實清掉 (tested in flow-delete)
8. ✓ Visits 仍保留 (only `archivePlace` called; no visit deletion)
9. Regression: all 39 test files / 465 tests pass

---

## What's Next

Task 20 (Search by Visit State).
