/**
 * Format the Notion page title for a Visit record.
 * Human-readable so the Visits DB can be browsed directly in Notion.
 * date must be YYYY-MM-DD.
 */
export function formatVisitTitle(placeName: string, date: string): string {
  return `${placeName} - ${date}`
}
