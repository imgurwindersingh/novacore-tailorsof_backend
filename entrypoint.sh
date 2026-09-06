#!/bin/sh
set -e

# Ensure the data directory exists when using a volume mount
if [ -n "$DATABASE_URL" ]; then
  DB_PATH=$(echo "$DATABASE_URL" | sed 's|file:||')
  DB_DIR=$(dirname "$DB_PATH")
  mkdir -p "$DB_DIR"
fi

echo "▶ Running database migrations…"
npx prisma migrate deploy

echo "▶ Starting server…"
exec node dist/index.js
