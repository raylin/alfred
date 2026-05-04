export type Env = {
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  NOTION_TOKEN: string;
  NOTION_DB_ID: string;
  NOTION_PARENT_PAGE_ID: string;  // for DB discovery (ADR-019)
  PM_LINE_USER_ID: string;        // authorized for /review command
  GOOGLE_PLACES_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  ALFRED_KV: KVNamespace;
};
