#!/usr/bin/env node
/**
 * Apply missing D1 schema to the CURRENTLY logged-in Cloudflare account.
 *
 * Usage:
 *   1. `npx wrangler login` into the account that hosts the production
 *      worker (the one serving `novacore-tailorsof-backend.gora55039.workers.dev`).
 *   2. `node scripts/migrate-prod-d1.mjs`
 *
 * The script is idempotent — safe to run multiple times.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DB_NAME = "novacore-db";
const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "wrangler-migrations",
  "001_design_attachments_settings.sql"
);

const whoami = execSync("npx wrangler whoami", { encoding: "utf8" });
const accountLine = whoami
  .split("\n")
  .find((line) => line.includes("Account Name"));
console.log(`\nTargeting account: ${(accountLine ?? "").trim() || "unknown"}`);

function d1(sql) {
  return execSync(
    `npx wrangler d1 execute ${DB_NAME} --remote --json --command=${JSON.stringify(sql)}`,
    { encoding: "utf8" }
  );
}

let columns = [];
try {
  const out = d1(`SELECT "name" FROM pragma_table_info("OrderItem");`);
  columns = JSON.parse(out).flatMap((m) => m.results).map((r) => r.name);
} catch (err) {
  console.error(
    `Could not inspect ${DB_NAME}. Is it the right account ("whoami")?`,
    err.message.split("\n")[0]
  );
  process.exit(1);
}

const missing = ["designImageUrl", "designReferenceUrl"].filter(
  (c) => !columns.includes(c)
);
console.log(
  `OrderItem columns: ${columns.join(", ") || "(none)"}` +
    (missing.length ? ` -> missing ${missing.join(", ")}` : " -> everything present")
);

if (missing.length) {
  for (const col of missing) {
    d1(`ALTER TABLE "OrderItem" ADD COLUMN "${col}" TEXT;`);
    console.log(`  added ${col}`);
  }
}
d1('CREATE TABLE IF NOT EXISTS "Setting" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL);');
console.log("  Setting table ensured");

console.log("\nDone. Verify production endpoints:\n");
console.log(
  `  curl -s "https://novacore-tailorsof-backend.gora55039.workers.dev/api/public/clients/YOUR_CLIENT_ID"`
);