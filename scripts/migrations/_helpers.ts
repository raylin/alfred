/**
 * Shared Notion helpers for migration scripts.
 *
 * All HTTP calls use raw fetch + Notion-Version 2022-06-28 (ADR-017).
 * No @notionhq/client SDK — avoids the dataSources/databases API split.
 */

export const NOTION_API = 'https://api.notion.com/v1'
export const NOTION_VERSION = '2022-06-28'

export function notionHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }
}

// --- Database schema ---

type RawDb = {
  id: string
  properties: Record<string, { id: string; type: string; name: string }>
}

export async function getDatabase(dbId: string, token: string): Promise<RawDb> {
  const res = await fetch(`${NOTION_API}/databases/${dbId}`, {
    headers: notionHeaders(token),
  })
  if (!res.ok) throw new Error(`getDatabase failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<RawDb>
}

// --- Add properties ---

export type PropertySpec = { name: string; config: unknown }

export type AddPropertiesResult = {
  added: string[]
  skipped: string[]
}

/**
 * Reads the DB schema once, then PATCHes any properties that are missing.
 * Returns which were added vs. already existed.
 * Safe to call multiple times (idempotent).
 */
export async function addPropertiesIfMissing(
  dbId: string,
  properties: PropertySpec[],
  token: string,
): Promise<AddPropertiesResult> {
  const db = await getDatabase(dbId, token)
  const existing = new Set(Object.keys(db.properties))

  const toAdd = properties.filter(p => !existing.has(p.name))
  const skipped = properties.filter(p => existing.has(p.name)).map(p => p.name)

  if (toAdd.length > 0) {
    const body: Record<string, unknown> = {}
    for (const { name, config } of toAdd) body[name] = config
    const res = await fetch(`${NOTION_API}/databases/${dbId}`, {
      method: 'PATCH',
      headers: notionHeaders(token),
      body: JSON.stringify({ properties: body }),
    })
    if (!res.ok) throw new Error(`addProperties failed (${res.status}): ${await res.text()}`)
  }

  return { added: toAdd.map(p => p.name), skipped }
}

// --- Find / create database ---

type BlocksResponse = {
  results: Array<{ type: string; id: string; child_database?: { title: string } }>
  has_more: boolean
  next_cursor: string | null
}

/**
 * Scans a page's block children for a child_database with the given title.
 * Returns the DB id if found, null if not.
 */
export async function findChildDatabase(
  parentPageId: string,
  title: string,
  token: string,
): Promise<string | null> {
  let cursor: string | undefined
  do {
    const url = new URL(`${NOTION_API}/blocks/${parentPageId}/children`)
    url.searchParams.set('page_size', '100')
    if (cursor) url.searchParams.set('start_cursor', cursor)

    const res = await fetch(url.toString(), { headers: notionHeaders(token) })
    if (!res.ok) throw new Error(`findChildDatabase failed (${res.status}): ${await res.text()}`)
    const data = (await res.json()) as BlocksResponse

    for (const block of data.results) {
      if (block.type === 'child_database' && block.child_database?.title === title) {
        return block.id
      }
    }
    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined
  } while (cursor)
  return null
}

/**
 * Creates a new database under parentPageId.
 * Properties use Notion API 2022-06-28 format (top-level, not under initial_data_source).
 * Returns the new DB id (hyphenated format).
 */
export async function createDatabase(
  parentPageId: string,
  title: string,
  properties: Record<string, unknown>,
  token: string,
): Promise<string> {
  const res = await fetch(`${NOTION_API}/databases`, {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: title } }],
      properties,
    }),
  })
  if (!res.ok) throw new Error(`createDatabase "${title}" failed (${res.status}): ${await res.text()}`)
  const data = (await res.json()) as { id: string }
  return data.id
}

/**
 * Idempotent: finds the DB by title under parentPageId, creates it if missing.
 * Returns { id, created: true } if newly created, { id, created: false } if it already existed.
 */
export async function ensureDatabase(
  parentPageId: string,
  title: string,
  properties: Record<string, unknown>,
  token: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await findChildDatabase(parentPageId, title, token)
  if (existing) return { id: existing, created: false }
  const id = await createDatabase(parentPageId, title, properties, token)
  return { id, created: true }
}
