# Task 15 Execution Report — Conversational Edit (Story I + J)

## Summary

Implemented full conversational edit capability per spec §1 Story I + J, §2.2, §4.4.

---

## Files Changed

| File | Change |
|---|---|
| `src/capabilities/places/schema.ts` | Added `EditOp` discriminated union type |
| `src/capabilities/places/disambiguate.ts` | Extended action type from `'visit'` to `'visit' \| 'edit'` |
| `src/capabilities/places/kv-store.ts` | Added `PendingEditData`, `writePendingEdit`, `readPendingEdit`, `clearPendingEdit` (TTL 10 min) |
| `src/integrations/notion.ts` | Added `patchPageProperties(notionPageId, properties, env)` — general-purpose PATCH |
| `src/capabilities/places/edit-parser.ts` | New: `parseEditIntent`, `parseEditTarget` |
| `src/capabilities/places/apply-edit.ts` | New: `applyEdits`, `summarizeOp` |
| `src/capabilities/places/flow-edit.ts` | New: `runFlowEdit`, `runFlowEditSelect` |
| `src/capabilities/places/handler.ts` | Wired `edit` intent to `runFlowEdit` |
| `src/index.ts` | Routes `edit:select:{notionPageId}` postback to `runFlowEditSelect` |
| `tests/unit/edit-parser.test.ts` | New: 14 tests |
| `tests/unit/apply-edit.test.ts` | New: 23 tests |
| `tests/unit/flow-edit.test.ts` | New: 16 tests |

---

## Implementation Notes

### edit-parser.ts

`parseEditIntent(message, currentPlace, env)` builds a system prompt that includes the current place's full state as JSON plus the list of editable properties and their expected formats. Returns an `EditOp[]` — the LLM is instructed to return `[]` for ambiguous input. Retry-once; double failure returns `[]`. `sanitize()` filters out any response items missing a `property` field.

`parseEditTarget(message, env)` separates "大湖公園改成室內" into `{ target_place_name: '大湖公園', edit_message: '改成室內' }`. Returns null for `target_place_name` when no place name is found. Retry-once; double failure falls back to `{ target_place_name: null, edit_message: originalMessage }`.

### apply-edit.ts

Single PATCH strategy (ADR-027): all valid ops are accumulated into one `Record<string, unknown>` payload and sent to `PATCH /pages/{id}` once. If the PATCH fails, all ops move from `applied` to `failed`. Partial success at the validation level is preserved: `buildEntry` can throw for individual ops (e.g. unrecognized property), and those go to `failed` before the PATCH.

Multi-select `add`/`remove` and rich text `append` ops require the current place state. These trigger one `getPlaceByNotionPageId` call before building the payload. `set` and `replace` ops do not fetch.

Name ops are intercepted before any Notion call and put in `failed` with `error: 'rename_not_supported'` (ADR-028).

### flow-edit.ts

**Story I (anchor path)**: `resolveEditAnchor` reads `user:{id}:last_place` KV and checks age < 5 minutes. If valid, calls `findPlaceByInternalId`. The full message is used as `editMessage`.

**Story J (no anchor)**: `parseEditTarget` extracts `target_place_name` and `edit_message`. Searches Notion for candidates. 0 → "沒找到"; 1 → direct edit; 2+ → `writePendingEdit` + disambiguation card.

**performEdit**: empty edits → "沒看出要改什麼"; rename-only failure → "想改名請刪除重新加入"; applied with rename → success + rename note appended; partial failure → success + "但 X 沒改成功".

**runFlowEditSelect**: called on `edit:select:{notionPageId}` postback. Reads `pending_edit` KV, clears it, then calls `performEdit`. No pending_edit → "找不到之前的編輯指令，請重新輸入".

---

## Open Questions — Resolutions

1. **Rename handling**: Chose soft suggest ("想改名請刪除重新加入") over hard reject. LLM can detect rename intent; it flows through as an EditOp, gets filtered by `applyEdits`, and triggers a helpful reply. (ADR-028)
2. **Status edit**: Implemented — `Status` is an editable property. Not gated on any onboarding state.

---

## ADRs Recorded

- **ADR-027** — Single PATCH for all valid ops in `applyEdits`
- **ADR-028** — Rename detected by LLM, soft-rejected via `ApplyResult`

---

## Test Results

```
Test Files  37 passed (37)
     Tests  432 passed (432)
```

53 new tests across 3 files. All existing tests continue to pass.

---

## What's Next

Per spec, remaining stories in Phase 0+1 include any outstanding tasks. This completes Story I (anchor edit) and Story J (named edit). Task 15 is ready for acceptance.
