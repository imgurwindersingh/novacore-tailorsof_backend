/** Wrangler alias target so the Node SQLite adapter is never bundled into the Worker. */
export class PrismaBetterSqlite3 {
  constructor(_opts: unknown) {
    throw new Error("better-sqlite3 is not available on Cloudflare Workers");
  }
}
