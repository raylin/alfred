# Execution Report — Task 11: Image Input Capability

## Summary

Built the full image input pipeline: LINE Content API fetch → Claude Vision extraction (with `no_place_detected` fallback) → Notion write → KV write (metadata only, no base64) → Flex card reply. Image messages bypass the LLM intent router. 221 tests pass (25 new); TypeScript clean.

## Files Changed

- `src/capabilities/_registry.ts` (modified) — added `accepts_images?: boolean` to `Capability` type; `places` set to `accepts_images: true`.
- `src/integrations/anthropic.ts` (modified) — refactored `chatJson` to use shared `parseJsonResponse` helper; added `toSafeMimeType()` and `chatJsonWithImage()` for vision calls.
- `src/integrations/line.ts` (modified) — added `LineImageMessageContent` type, `isImageMessage()` predicate, and `fetchMessageContent(messageId, accessToken)` (fetches binary from `api-data.line.me`, base64-encodes, returns `{contentBase64, mimeType, sizeBytes}`).
- `src/capabilities/places/kv-store.ts` (modified) — added `ImageRawInput` type; `RawExtractionData.raw_input` is now `string | ImageRawInput`.
- `src/capabilities/places/extract.ts` (modified) — added `IMAGE_SYSTEM_PROMPT` (vision-aware, includes `{ error: "no_place_detected" }` escape hatch), `NoPlaceDetectedError`, `callImageWithRetry` (retries on API failures; does NOT retry on `no_place_detected`), `extractFromImage(imageBase64, mimeType, env)`.
- `src/capabilities/places/flow-image.ts` (new) — `runFlowImage`: size check (> 5MB → error text) → `extractFromImage` → Notion → KV (metadata only) → Flex or `no_place_detected` text.
- `src/capabilities/places/handler.ts` (modified) — imported `runFlowImage`; added exported `placesImageHandler(image, replyToken, env, source?)` with same PlacesError wrapping pattern as `placesHandler`.
- `src/index.ts` (modified) — imported `isImageMessage`, `fetchMessageContent`, `placesImageHandler`; added image detection before text routing block — image messages skip `handleSlashCommand` and `routeIntent`, dispatched directly to `placesImageHandler`.
- `docs/ADR.md` (modified) — ADR-012 (image bypass + `accepts_images` forward-compat), ADR-013 (no base64 in KV).

## Local Decisions Made

- **`toSafeMimeType()` in anthropic.ts** — the Anthropic SDK accepts only `image/jpeg | image/png | image/gif | image/webp`. LINE may occasionally return other MIME types (e.g., `image/heic` on iPhone). Unrecognized types silently fall back to `image/jpeg` to avoid a hard failure.
- **`NoPlaceDetectedError` does not trigger retry** — `{ "error": "no_place_detected" }` is a deliberate semantic response from Claude, not a transient API failure. Retrying it would waste one API call and return the same result. Only network/parse errors trigger the retry.
- **IG fallback → Image flow connection confirmed** — `flow-d-instagram.ts` already sends "IG 連結我目前還沒辦法直接讀，可以截圖傳給我，或直接告訴我地點名稱。" No text change needed; the image flow now handles screenshots sent in response.
- **Error reply in index.ts for `fetchMessageContent` failure** — if the LINE Content API call itself fails (before `placesImageHandler`), index.ts sends a simple text reply without chatId push-fallback (no `chatId` available before `fetchMessageContent` returns, though `getChatId(event.source)` could be used — kept simple since this is a rare, non-critical path).

## Tests

- New: `line-content.test.ts` (7 tests — `isImageMessage`, `fetchMessageContent` URL, auth, MIME type, size, base64, error), `flow-image.test.ts` (10 tests)
- Modified: `extract.test.ts` (6 new `extractFromImage` tests — success, source_type, source_url, no_place_detected, no retry on semantic error, retry on API failure); mock updated to include `chatJsonWithImage`
- Run result: **221 passed (221)** across 19 test files
- TypeScript: `tsc --noEmit` clean

## Spec Deviations / Ambiguities

- **`source_type = []` (empty) for image flow** — spec §E says "source_type = null". Since `source_type` is `SourceType[]` in the schema (not nullable), empty array `[]` is the correct representation. Semantically equivalent — family reviews at Notion time.
- **Error reply for `fetchMessageContent` failure in `index.ts`** — spec doesn't specify this path explicitly. Used a simple `sendReply` without `chatId` fallback; this case should be extremely rare.

## Manual Acceptance Test (for PM)

1. **IG screenshot with caption** → send photo of IG post with place name/description → expect Flex draft card + Notion entry
2. **Physical shop sign photo** → snap restaurant sign → expect name/address extraction → Flex card
3. **Magazine clipping** → photo of a magazine page mentioning a family venue → expect Claude to read the text and extract
4. **LINE chat screenshot** (friend recommending a place) → expect extraction from the conversation text
5. **Pure landscape / selfie / meme** → expect "看起來不是景點相關的圖，可以再試一次，或直接告訴我地點名稱。"
6. **IG URL (flow D) → fallback → screenshot** → paste IG URL → receive IG fallback message → take screenshot → send it → expect it to work end-to-end
7. **Regression**: Stories A/B/C/E unaffected; text messages still go through intent router

## Blocking Questions for PM

None. Ready for deploy + acceptance test.
