/**
 * Prisma / better-sqlite3 still read CJS `__filename` / `__dirname`.
 * Those are not defined in ESM or Cloudflare Workers — set them before any DB import.
 */
const g = globalThis as typeof globalThis & {
  __filename?: string;
  __dirname?: string;
};

if (typeof g.__filename === "undefined") {
  g.__filename = "/index.js";
}
if (typeof g.__dirname === "undefined") {
  g.__dirname = "/";
}

export {};
