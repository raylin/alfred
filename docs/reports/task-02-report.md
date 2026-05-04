# Execution Report — Task 2: LINE Webhook Skeleton

## Summary

Built the full LINE webhook skeleton: HMAC-SHA256 signature verification, event parsing, echo handler for text messages, welcome message on follow/join, and loading indicator. Deployed to production at `alfred.raylin.cc`. Awaiting live verification (LINE webhook URL still needs to be set in LINE Developers Console).

## Files Changed

- `src/core/line-signature.ts` (new) — Hono middleware, Web Crypto HMAC-SHA256, stores raw body in context
- `src/core/variables.ts` (new) — typed Hono variable bag (`rawBody`)
- `src/integrations/line.ts` (new) — LINE event types, API client (reply, loading), helpers, welcome message
- `src/index.ts` (modified) — webhook route, event dispatcher, echo + welcome handlers
- `wrangler.toml` (modified) — KV namespace ID filled in; route changed to `custom_domain = true`
- `docs/ADR.md` (modified) — ADR-001 added

## Local Decisions Made

- **Web Crypto for HMAC-SHA256, not Node.js crypto:** Workers runtime doesn't expose Node.js `Buffer` in TypeScript types even with `nodejs_compat`. Used `TextEncoder` + `crypto.subtle` + manual `btoa(String.fromCharCode(...))` conversion. Pure web platform, no deps needed. (ADR-001 covers the related type predicate decision.)
- **Type predicate `isTextMessage`:** TypeScript cannot narrow a discriminated union when one member uses `type: string` (catch-all) as the discriminant. Exported a type predicate function instead of using inline `=== 'text'` checks. (ADR-001)
- **`custom_domain = true` on route:** `wrangler.toml` `[[custom_domains]]` is no longer recognized in wrangler 4.87. Using `[[routes]]` with `custom_domain = true` instead — this auto-provisions the DNS record and TLS cert for `alfred.raylin.cc`.

## Tests

- Added: none (webhook skeleton; integration tests in Task 11)
- TypeScript: `npx tsc --noEmit` exits 0

## Verification Performed

- `GET https://alfred.lieeray4136.workers.dev/health → {"ok":true}` ✓
- `GET https://alfred.raylin.cc/health → {"ok":true}` (via `--resolve` flag; local DNS cache lag) ✓
- DNS for `alfred.raylin.cc` resolves to Cloudflare IPs (104.21.59.40, 172.67.213.12) ✓

## Spec Deviations / Ambiguities

- LINE webhook live round-trip (echo test) not yet verified — requires PM to set webhook URL in LINE Developers Console to `https://alfred.raylin.cc/line/webhook` and send a test message.

## Blocking Questions for PM

None on code side.

**Action required from PM:**
1. In LINE Developers Console → channel → Messaging API settings:
   - Set Webhook URL: `https://alfred.raylin.cc/line/webhook`
   - Click "Verify" (LINE will POST a test event)
   - Enable "Use webhook"
2. Send a text message to 阿福 in LINE → should echo it back
3. Add 阿福 to a group → should send welcome message

## Next Task

Task 3: Notion Integration. Ready to proceed (doesn't require LINE verification to build).
