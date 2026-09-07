import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DB_NAME = "novacore-db";
const BINDING = "DB";
const WRANGLER_PATH = "wrangler.json";
const INITIAL_SCHEMA = "prisma/migrations/20260906034131_add_refresh_token/migration.sql";

function sh(cmd, inherit = false) {
  return execSync(cmd, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}

function parseJsonPayload(raw, startChar) {
  const start = raw.indexOf(startChar);
  if (start === -1) {
    throw new Error(`No JSON ${startChar} in wrangler output:\n${raw}`);
  }
  return JSON.parse(raw.slice(start));
}

function listDatabases() {
  const raw = sh("npx wrangler d1 list --json");
  return parseJsonPayload(raw, "[");
}

function hasClientTable() {
  const raw = sh(
    `npx wrangler d1 execute ${DB_NAME} --remote --command "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Client';" --json`
  );
  const result = parseJsonPayload(raw, "[");
  return result.some((statement) =>
    statement.results?.some((row) => row.name === "Client")
  );
}

let databases = listDatabases();
let db = databases.find((item) => item.name === DB_NAME);

if (!db) {
  console.log(`D1 database "${DB_NAME}" not found on this Cloudflare account. Creating it…`);
  sh(`npx wrangler d1 create ${DB_NAME}`, true);
  databases = listDatabases();
  db = databases.find((item) => item.name === DB_NAME);
}

if (!db?.uuid) {
  console.error(
    `Could not find or create D1 database "${DB_NAME}". Create it in the Cloudflare dashboard for this account, then set database_id in wrangler.json.`
  );
  process.exit(1);
}

const config = JSON.parse(readFileSync(WRANGLER_PATH, "utf8"));
config.d1_databases = [
  {
    binding: BINDING,
    database_name: DB_NAME,
    database_id: db.uuid,
  },
];
writeFileSync(WRANGLER_PATH, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Using D1 ${DB_NAME} (${db.uuid})`);

if (!hasClientTable()) {
  console.log("D1 schema is not initialized. Applying the initial Prisma migration…");
  sh(`npx wrangler d1 execute ${DB_NAME} --remote --file=${INITIAL_SCHEMA}`, true);
}

sh("npx wrangler deploy", true);
