# Execution Report — Task 5: Google Places Integration

## Summary

Built `src/integrations/google-places.ts` covering the full Google Places API (New) surface needed for Stories B and C: text search, place details, Google Maps URL parsing (full and short URLs), and a `toGooglePlacesContext` converter that bridges `PlaceDetails` to the shape `extract.ts` expects. 16 unit tests; 69 total. TypeScript clean. `GOOGLE_PLACES_API_KEY` stored as Cloudflare secret (6/6 secrets complete).

## Files Changed

- `src/integrations/google-places.ts` (new) — `textSearch`, `getPlaceDetails`, `parseGoogleMapsUrl`, `toGooglePlacesContext`, `PlaceCandidate`, `PlaceDetails`, `ParsedMapsUrl` types
- `tests/unit/google-places.test.ts` (new) — 16 unit tests
- `docs/log.md` (modified)

## Local Decisions Made

- **`toGooglePlacesContext(details)` helper exported:** Converts `PlaceDetails` → `GooglePlacesContext` (the shape `extractFromGooglePlaces` in `extract.ts` expects). Flow files (Task 6-8) call this rather than doing the field mapping inline — one less place to get field names wrong.
- **`opening_hours` joined with `；`:** `regularOpeningHours.weekdayDescriptions` is an array of strings (one per weekday). Joined into one string for the Claude prompt since the context shape has a single `hours: string | null`.
- **`env: Env` added to `textSearch` and `getPlaceDetails`:** Spec shows signatures without env, but the API key lives in env — consistent with every other integration module.
- **`expandShortUrl` uses `redirect: 'follow'` + `res.url`:** Cloudflare Workers `fetch` with `redirect: 'follow'` (the default) follows all hops and `res.url` gives the final URL. Cleaner than `redirect: 'manual'` + parsing Location headers, and works for multi-hop redirects.
- **`parseGoogleMapsUrl` is pure for full URLs:** No network call for `google.com/maps` full URLs — only `isShortUrl()` check triggers a fetch. Makes static URL parsing tests require no mocks.

## Tests

- Added: `tests/unit/google-places.test.ts` (16 tests)
- Run result: **69 passed (69)** across 6 test files
- URL formats covered:
  1. Full `/place/{name}/@{lat},{lng}` URL — name + coordinates
  2. Full URL with `!1sChIJ...` data parameter — place_id extraction
  3. URL-encoded Chinese name (`%E5%85%...`) — `decodeURIComponent` handling
  4. `?q={lat},{lng}` coordinate query format
  5. `maps.app.goo.gl` short URL — redirect + parse
  6. `goo.gl/maps` short URL — redirect + parse

## Verification Performed

- `npm test` — 69 tests pass
- `npx tsc --noEmit` — zero errors
- `wrangler secret list` — all 6 secrets confirmed

## Spec Deviations / Ambiguities

None.

## Blocking Questions for PM

None. Ready for Task 6 (Story A: URL Input Flow).
