import { queryVisitsForPlace, patchPlaceSummary } from '../../integrations/notion'
import type { Env } from '../../core/env'

export async function recomputePlaceSummary(placeNotionPageId: string, env: Env): Promise<void> {
  try {
    const summary = await queryVisitsForPlace(placeNotionPageId, env)
    await patchPlaceSummary(placeNotionPageId, summary, env)
  } catch (err) {
    console.warn('[visit-summary] recomputePlaceSummary failed (non-fatal)', err)
  }
}
