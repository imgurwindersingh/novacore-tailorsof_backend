#!/bin/sh
set -e

# Create the DB directory when using a volume mount (e.g. Railway /data)
if [ -n "$DATABASE_URL" ]; then
  DB_PATH=$(echo "$DATABASE_URL" | sed 's|file:||' | sed 's|file://||')
  DB_DIR=$(dirname "$DB_PATH")
  mkdir -p "$DB_DIR"
fi

echo "▶ Running database migrations…"
npx prisma migrate deploy --config prisma.config.ts

echo "▶ Starting server…"
exec node dist/index.js
