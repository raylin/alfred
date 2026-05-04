export type ScriptEnv = {
  NOTION_TOKEN: string
  NOTION_PARENT_PAGE_ID: string
  NOTION_DB_ID: string  // Alfred — 親子景點 Place DB
}

export interface Migration {
  id: string           // e.g. "001-add-visit-summary-fields"
  description: string
  up(env: ScriptEnv): Promise<void>  // must be idempotent
}
